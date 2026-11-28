import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { startServer } from '../src/node/canvas-server.mjs';
import { createSettings } from '../src/node/settings.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, readSettings) {
  const state = { calls: [], cancelled: 0, closed: 0 }, config = { extraHomes: [], disabledHomes: [], reviewModel: 'fixture-model', reviewReasoning: 'default', reviewAllowSamples: false };
  const server = await startServer({ html: '<title>Fixture</title>',
    settings: { get: readSettings || (async () => config) },
    scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) },
    reviewService: {
      catalog: async () => ({ models: [{ id: 'fixture-model', label: 'Fixture', reasoningEfforts: [] }], reference: null, token: 'tok' }),
      reconnect: async () => ({ models: [], verified: true }),
      review: async (input, signal) => { state.calls.push(input); state.signal = signal; if (state.hold) await state.hold.promise; if (state.fail) throw new Error('PRIVATE_SECRET'); return { cards: [], emptyReason: 'Fixture response', model: input.model, passes: 1, samples: 0, guidanceVersion: '1.0.0' }; },
      cancel() { state.cancelled++; }, close: async () => { state.closed++; },
    },
  });
  t.after(() => server.close());
  const request = (method, input = {}) => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input }) });
  return { state, server, request };
}
test('review API rejects legacy review.run, uses only saved model, validates payloads, and keeps SDK errors private', async t => {
  const { state, request } = await fixture(t);
  assert.equal((await request('review.run', { prompt: 'safe snapshot', expectedModel: 'fixture-model' })).status, 400);
  assert.equal((await request('review.prepare', { filters: { range: '7d' }, extra: true })).status, 400);
  assert.equal(state.calls.length, 0);
  assert.equal((await request('usage.report', { range: '7d' })).status, 200);
  const prepared = await (await request('review.prepare', { filters: { range: '7d' } })).json();
  assert.equal((await request('review.analyze', { snapshotId: prepared.id, expectedModel: 'old-model', expectedReasoning: 'default', allowSamples: false })).status, 500);
  assert.equal(state.calls.length, 0, 'changing the saved model after preview cannot silently switch the billed model');
  const analyzed = await (await request('review.analyze', { snapshotId: prepared.id, expectedModel: 'fixture-model', expectedReasoning: 'default', allowSamples: false })).json();
  assert.equal(analyzed.emptyReason, 'Fixture response');
  assert.equal(state.calls[0].model, 'fixture-model');
  assert.equal((await request('usage.report', { range: '7d' })).status, 200);
  const prepared2 = await (await request('review.prepare', { filters: { range: '7d' } })).json();
  state.fail = true;
  const failure = await request('review.analyze', { snapshotId: prepared2.id, expectedModel: 'fixture-model', expectedReasoning: 'default', allowSamples: false });
  assert.equal(failure.status, 500); assert.doesNotMatch(await failure.text(), /PRIVATE/);
  const logs = await (await request('diagnostics.get')).text();
  assert.doesNotMatch(logs, /PRIVATE|safe snapshot/);
});
test('Cancel during settings read prevents late review startup and releases ownership', async t => {
  const read = deferred(), entered = deferred();
  const { state, request } = await fixture(t, () => { entered.resolve(); return read.promise; });
  const run = request('review.reconnect', {}); await entered.promise;
  assert.equal((await request('review.reconnect', {})).status, 500);
  assert.equal((await request('review.cancel')).status, 200);
  const cancelled = await run; assert.match((await cancelled.json()).error, /cancelled/i);
  read.resolve({ reviewModel: 'fixture-model' }); await new Promise(setImmediate);
  assert.equal(state.calls.length, 0);
});
test('disconnect before settings return prevents late startup; shutdown aborts pending setup', async t => {
  const read = deferred(), entered = deferred();
  const { state, server } = await fixture(t, () => { entered.resolve(); return read.promise; });
  const req = httpRequest(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  req.on('error', () => {}); req.end(JSON.stringify({ method: 'review.reconnect', input: {} }));
  await entered.promise; req.destroy(); await new Promise(resolve => setTimeout(resolve, 20));
  await server.close(); read.resolve({ reviewModel: 'fixture-model' }); await new Promise(setImmediate);
  assert.equal(state.calls.length, 0); assert.equal(state.closed, 1);
});
test('saved review model rejects arbitrary settings values and preserves existing preferences', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'review-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const settings = createSettings(dir);
  await settings.set({ reviewModel: 'gpt-5.1', textSize: 'large' });
  assert.equal((await createSettings(dir).get()).reviewModel, 'gpt-5.1');
  await settings.set({ reviewModel: '' }); assert.equal((await settings.get()).textSize, 'large');
  await settings.set({ reviewReasoning: 'high' }); assert.equal((await createSettings(dir).get()).reviewReasoning, 'high');
  for (const reviewReasoning of ['low', null, {}, 'x']) await assert.rejects(settings.set({ reviewReasoning }));
  for (const reviewModel of [null, {}, 'bad\nname', 'x'.repeat(129)]) await assert.rejects(settings.set({ reviewModel }));
});
