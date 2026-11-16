import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewService } from '../src/node/ai-review.mjs';

const waitFor = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(setImmediate); assert.ok(predicate()); };
function fixture(t, options = {}) {
  const state = { calls: 0, authCalls: 0, now: 0, login: 'SECRET-account', policy: 'enabled', provider: 'copilot' };
  const parent = { rpc: {
    gitHubAuth: { getStatus: async () => { state.authCalls++; return { isAuthenticated: true, login: state.login, host: 'github.com' }; } },
    model: { list: async () => {
      state.calls++;
      if (state.hold) await state.hold;
      if (state.error) throw new Error('SECRET-error');
      return { list: [{ id: 'gpt-5.3-codex', name: 'SECRET-label', provider: { kind: state.provider }, policy: { state: state.policy },
        capabilities: { supports: { vision: true } }, billing: { tokenPrices: { inputPrice: 1, batchSize: 1000 } } }] };
    } },
  } };
  const service = createReviewService(parent, { clock: () => state.now, catalogTtlMs: 1000, ...options, runtime: async () => { if (state.unavailable) throw new Error('SECRET-sdk'); return {}; } });
  t.after(() => service.close());
  return { state, service };
}

test('catalog reads coalesce, cache by canvas/account, expire and refresh explicitly', async t => {
  const { state, service } = fixture(t);
  const [a, b] = await Promise.all([service.catalog(), service.catalog()]);
  assert.equal(state.calls, 1); assert.equal(a.token, b.token);
  assert.doesNotMatch(JSON.stringify(a.reference), /SECRET/);
  assert.equal(a.reference.models[0].pricing.reason, 'price-unit-unavailable');
  a.reference.models[0].label = 'changed';
  assert.notEqual((await service.catalog(null, { refresh: false })).reference.models[0].label, 'changed');
  assert.equal(state.calls, 1);
  state.now = 1001;
  const expired = await service.catalog(null, { refresh: false }); assert.equal(state.calls, 2); assert.notEqual(expired.token, b.token);
  state.login = 'SECRET-other-account';
  const changed = await service.catalog(null, { refresh: false }); assert.equal(state.calls, 3); assert.notEqual(changed.token, expired.token);
  await service.catalog(); assert.equal(state.calls, 4);
  state.policy = 'disabled'; await assert.rejects(service.catalog(), { code: 'REVIEW_CATALOG' });
  state.policy = 'enabled'; await service.catalog(null, { refresh: false }); assert.equal(state.calls, 6, 'failed refresh invalidates the old cache');
  state.provider = 'byok'; await assert.rejects(service.catalog(), { code: 'REVIEW_CATALOG' });
});

test('failure, unavailable SDK and late cancellation never publish a stale catalog; recovery works', async t => {
  const { state, service } = fixture(t);
  state.unavailable = true; await assert.rejects(service.catalog(), { code: 'REVIEW_FAILED' });
  assert.equal(state.calls, 0);
  state.unavailable = false; state.error = true;
  await assert.rejects(service.catalog(), error => error.code === 'REVIEW_FAILED' && !/SECRET/.test(error.message));
  state.error = false;
  let release;
  state.hold = new Promise(resolve => { release = resolve; });
  const controller = new AbortController(), pending = service.catalog(controller.signal);
  await waitFor(() => state.calls === 2);
  controller.abort(); await assert.rejects(pending);
  release(); state.hold = null; await new Promise(setImmediate);
  await service.catalog(null, { refresh: false }); assert.equal(state.calls, 3);
});

test('one cancelled reader does not abort another; an account switch during a read rejects metadata', async t => {
  const { state, service } = fixture(t);
  let release; state.hold = new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  const first = service.catalog(controller.signal), second = service.catalog();
  await waitFor(() => state.calls === 1);
  controller.abort(); await assert.rejects(first);
  release(); state.hold = null; assert.ok((await second).reference);
  state.hold = new Promise(resolve => { release = resolve; });
  const changed = service.catalog(); await waitFor(() => state.calls === 2);
  state.login = 'SECRET-changed'; release(); state.hold = null;
  await assert.rejects(changed, { code: 'REVIEW_ACCOUNT' });
  await service.catalog(null, { refresh: false }); assert.equal(state.calls, 3);
});

test('an explicit refresh does not reuse a simultaneous cached read', async t => {
  const { state, service } = fixture(t);
  await service.catalog();
  await Promise.all([service.catalog(null, { refresh: false }), service.catalog()]);
  assert.equal(state.calls, 2);
});

test('catalog timeouts release ownership, reject late results and permit recovery without inference', async t => {
  const { state, service } = fixture(t, { catalogTimeoutMs: 10 });
  let release; state.hold = new Promise(resolve => { release = resolve; });
  await assert.rejects(service.catalog(), { code: 'REVIEW_TIMEOUT' });
  release(); state.hold = null; await new Promise(setImmediate);
  await service.catalog(null, { refresh: false }); assert.equal(state.calls, 2);
});
