import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/node/canvas-server.mjs';
import { createSettings } from '../src/node/settings.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const emptyScan = () => ({ records: [], sources: [], coverage: {} });
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'usage-security-pause-'));
  const settings = createSettings(directory);
  const server = await startServer({ html: '<title>Fixture</title>', settings, defaultHome: directory,
    scanner: { scan: async () => emptyScan() }, ...options });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (method, input = {}) => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input }) });
  return { settings, request, directory };
}
async function paused(response) {
  assert.equal(response.status, 423);
  assert.deepEqual(await response.json(), { code: 'paused', paused: true, error: 'Usage Insights is paused. Resume it in Settings.' });
}

test('pause persists and blocks history, prompts, host inventory/context and every AI entry point', async t => {
  let calls = 0;
  const fail = () => { calls++; throw new Error('Unexpected activity'); };
  const { request, directory } = await fixture(t, { scanner: { scan: fail }, readContext: fail, readIntegrations: fail,
    reviewService: { review: fail, reconnect: fail, catalog: fail, cancel() {}, async close() {} } });
  assert.equal((await request('settings.set', { paused: true })).status, 200);
  assert.equal((await createSettings(directory).get()).paused, true);
  for (const method of ['usage.report', 'usage.refresh', 'usage.requests', 'usage.sessions', 'usage.modelProjects', 'usage.sessionModels', 'efficiency.context', 'usage.inventory', 'review.catalog', 'review.reconnect', 'review.prepare', 'review.analyze']) {
    const input = method === 'review.prepare' ? { filters: {} } : method === 'review.analyze' ? { snapshotId: 'fixture', expectedReasoning: 'high', allowSamples: true } : {};
    await paused(await request(method, input));
  }
  assert.equal(calls, 0);
  assert.equal((await request('settings.get')).status, 200);
  assert.equal((await request('diagnostics.get')).status, 200);
  assert.equal((await request('review.cancel')).status, 200);
  for (const value of [1, null, 'true']) assert.equal((await request('settings.set', { paused: value })).status, 400);
});

test('pause aborts an active scan, drops its late result, and resume scans afresh', { timeout: 5000 }, async t => {
  const entered = deferred(), late = deferred(); let calls = 0, firstSignal;
  const { request } = await fixture(t, { scanner: { scan: async (_roots, options) => {
    calls++;
    if (calls === 1) { firstSignal = options.signal; entered.resolve(); return late.promise; }
    return emptyScan();
  } } });
  const running = request('usage.report'); await entered.promise;
  assert.equal((await request('settings.set', { paused: true })).status, 200);
  assert.equal(firstSignal.aborted, true);
  await paused(await running);
  assert.equal((await request('settings.set', { paused: false })).status, 200);
  assert.equal((await request('usage.report')).status, 200);
  assert.equal(calls, 2);
  late.resolve({ ...emptyScan(), sources: [{ path: 'PRIVATE_STALE_SOURCE' }] });
  await new Promise(setImmediate);
  assert.doesNotMatch(await (await request('usage.report')).text(), /PRIVATE_STALE_SOURCE/);
  assert.equal(calls, 2);
});

test('pause discards uncancellable context results even after immediate resume', { timeout: 5000 }, async t => {
  const entered = deferred(), late = deferred(); let calls = 0;
  const { request } = await fixture(t, { readContext: async () => {
    calls++;
    if (calls === 1) { entered.resolve(); return late.promise; }
    return { available: false };
  } });
  const running = request('efficiency.context'); await entered.promise;
  await request('settings.set', { paused: true });
  await request('settings.set', { paused: false });
  late.resolve({ available: true, privateMarker: 'STALE_CONTEXT' });
  await paused(await running);
  assert.deepEqual(await (await request('efficiency.context')).json(), { available: false });
});

test('pause cancels an active review and cannot return a late review result', { timeout: 5000 }, async t => {
  const entered = deferred(), late = deferred(); let signal, cancelled = 0;
  const { request } = await fixture(t, { reviewService: {
    async catalog() { return { models: [{ id: 'claude-sonnet-5.5', label: 'Claude Sonnet 5.5', reasoningEfforts: ['medium', 'high'] }], reference: null, token: 'tok' }; },
    async review(_input, value) { signal = value; entered.resolve(); return late.promise; },
    cancel() { cancelled++; }, async close() {},
  } });
  assert.equal((await request('usage.report', { range: '7d' })).status, 200);
  const prepared = await (await request('review.prepare', { filters: { range: '7d' } })).json();
  const running = request('review.analyze', { snapshotId: prepared.id, expectedModel: 'claude-sonnet-5.5', expectedReasoning: 'high', allowSamples: true }); await entered.promise;
  await request('settings.set', { paused: true });
  assert.equal(signal.aborted, true); assert.equal(cancelled, 1);
  await paused(await running);
  await request('settings.set', { paused: false });
  late.resolve({ text: 'STALE_REVIEW' });
});

test('another settings writer is observed before a new source or AI request', async t => {
  let calls = 0;
  const { directory, request } = await fixture(t, { scanner: { scan: async () => { calls++; return emptyScan(); } } });
  await createSettings(directory).set({ paused: true });
  await paused(await request('usage.report'));
  assert.equal(calls, 0);
  await createSettings(directory).set({ paused: false });
  assert.equal((await request('usage.report')).status, 200);
  assert.equal(calls, 1);
});

test('invalid saved pause state blocks source and AI activity instead of defaulting to resumed', async t => {
  let calls = 0;
  const fail = () => { calls++; throw new Error('Unexpected activity'); };
  const { directory, request } = await fixture(t, { scanner: { scan: fail },
    reviewService: { catalog: fail, cancel() {}, async close() {} } });
  await writeFile(join(directory, 'pause.json'), '{invalid');
  assert.equal((await request('usage.report')).status, 500);
  assert.equal((await request('review.catalog')).status, 500);
  assert.equal(calls, 0);
});
