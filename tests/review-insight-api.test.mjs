import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/node/canvas-server.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

async function setup(t) {
  const f = reviewFixture(); f.user('p'); f.call('p', 'a');
  const state = { scans: 0, sent: [], config: { reviewModel: 'opus-fixture', reviewReasoning: 'medium', extraHomes: [], disabledHomes: [] } };
  const server = await startServer({ html: '<title>Fixture</title>', now: () => reviewNow, settings: { get: async () => state.config }, scanner: { scan: async () => { state.scans++; return f.scan(); } }, reviewService: {
    catalog: async () => ({ models: [{ id: 'opus-fixture', reasoningEfforts: ['medium', 'high'] }] }),
    review: async input => { state.sent.push(input); return { cards: [], emptyReason: 'Limited data', passes: 1, samples: 0 }; },
    cancel() {}, close: async () => {},
  } });
  t.after(() => server.close());
  const request = async (method, input = {}) => {
    const r = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input }) });
    return { status: r.status, body: await r.json() };
  };
  return { state, request };
}

test('preparation reuses loaded history, freezes filters, and analysis consumes one server-owned snapshot', async t => {
  const { state, request } = await setup(t);
  assert.notEqual((await request('review.prepare', { filters: { range: 'all' } })).status, 200);
  assert.equal(state.scans, 0);
  await request('usage.report', { range: 'all' });
  const p = await request('review.prepare', { filters: { range: '7d' } }); assert.equal(p.status, 200);
  assert.equal(state.scans, 1); assert.equal(state.sent.length, 0);
  assert.doesNotMatch(p.body.preview, /PRIVATE/);
  await request('usage.report', { range: '1d' });
  const input = { snapshotId: p.body.id, expectedModel: 'opus-fixture', expectedReasoning: 'medium', allowSamples: false };
  assert.equal((await request('review.analyze', { ...input, prompt: 'override' })).status, 400);
  assert.equal((await request('review.analyze', { ...input, snapshotId: 'foreign' })).status, 500);
  const result = await request('review.analyze', input); assert.equal(result.status, 200);
  assert.equal(state.sent[0].analysis.scope.range, '7d'); assert.equal(state.sent[0].allowSamples, false);
  assert.equal(result.body.scope.range, '7d'); assert.equal(state.scans, 1);
  assert.equal((await request('review.analyze', input)).status, 500); assert.equal(state.sent.length, 1);
});

test('changed saved effort/model and stale preparations cannot silently change analysis', async t => {
  const { state, request } = await setup(t); await request('usage.report', { range: 'all' });
  const first = (await request('review.prepare', { filters: { range: 'all' } })).body;
  const second = (await request('review.prepare', { filters: { range: '1d' } })).body;
  const input = { snapshotId: first.id, expectedModel: 'opus-fixture', expectedReasoning: 'medium', allowSamples: true };
  assert.equal((await request('review.analyze', input)).status, 500);
  state.config.reviewReasoning = 'high';
  assert.equal((await request('review.analyze', { ...input, snapshotId: second.id })).status, 500);
  assert.equal(state.sent.length, 0);
  assert.equal((await request('review.prepare', { filters: { range: 'all', path: '/private' } })).status, 400);
});
