import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/node/canvas-server.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';
import { normalizeModelCatalog } from '../src/core/model-reference.mjs';
import { createSettings } from '../src/node/settings.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup(t, usage = {}) {
  const f = reviewFixture(); f.user('p'); f.call('p', 'a', usage);
  const state = { scans: 0, sent: [], config: { reviewModel: 'opus-fixture', reviewReasoning: 'medium', extraHomes: [], disabledHomes: [] } };
  const server = await startServer({ html: '<title>Fixture</title>', now: () => reviewNow, settings: { get: async () => state.config }, scanner: { scan: async () => { state.scans++; return f.scan(); } }, reviewService: {
    catalog: async () => { state.catalogCalls = (state.catalogCalls || 0) + 1; state.entered?.(); if (state.hold) await state.hold; if (state.catalogFailure) throw new Error('PRIVATE'); return { models: [{ id: state.config.reviewModel, reasoningEfforts: ['medium', 'high'] }], reference: state.reference }; },
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

test('default Sonnet High is frozen into preparation and sent unchanged to the reviewer', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'review-default-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { state, request } = await setup(t);
  state.config = await createSettings(dir).get();
  await request('usage.report', { range: 'all' });
  const { status, body } = await request('review.prepare', { filters: { range: 'all' } });
  assert.equal(status, 200);
  assert.equal(body.model, 'claude-sonnet-5.5'); assert.equal(body.reasoningEffort, 'high');
  assert.equal((await request('review.analyze', { snapshotId: body.id, expectedModel: body.model, expectedReasoning: body.reasoningEffort, allowSamples: body.allowSamples })).status, 200);
  assert.equal(state.sent[0].model, 'claude-sonnet-5.5'); assert.equal(state.sent[0].reasoningEffort, 'high');
});

test('preparation reuses loaded history, freezes filters, and analysis consumes one server-owned snapshot', async t => {
  const { state, request } = await setup(t); state.config.reviewAllowSamples = false;
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
  assert.equal(state.sent[0].analysis.preview, p.body.preview, 'copyable preview is the frozen first-pass input');
  assert.equal(state.catalogCalls, 1, 'usage loads and filter changes do not read the catalog');
  assert.equal(result.body.scope.range, '7d'); assert.equal(state.scans, 1);
  assert.equal((await request('review.analyze', input)).status, 500); assert.equal(state.sent.length, 1);
});

test('bundled evidence survives catalog failure and reaches analysis unchanged without new history reads', async t => {
  const { state, request } = await setup(t, { model: 'gpt-5', reasoningEffort: 'medium' });
  state.catalogFailure = true; state.config.reviewAllowSamples = false;
  await request('usage.report', { range: 'all' });
  const prepared = await request('review.prepare', { filters: { range: '7d' } });
  assert.equal(prepared.status, 200); assert.match(prepared.body.referenceStatus, /Bundled Aider evidence/);
  assert.match(prepared.body.preview, /aider-gpt5-medium-20250825/);
  assert.match(prepared.body.preview, /"configurationMatch": "incompatible"/);
  await request('usage.report', { range: 'all' });
  await request('usage.report', { range: '90d' });
  assert.equal(state.catalogCalls, 1); assert.equal(state.scans, 1);
  const result = await request('review.analyze', { snapshotId: prepared.body.id, expectedModel: 'opus-fixture', expectedReasoning: 'medium', allowSamples: false });
  assert.equal(result.status, 200); assert.equal(state.sent[0].analysis.preview, prepared.body.preview);
});

test('reference failure produces a labelled statistics-only preview and does not prevent explicit review', async t => {
  const { state, request } = await setup(t); state.catalogFailure = true;
  await request('usage.report', { range: 'all' });
  const p = await request('review.prepare', { filters: { range: 'all' } });
  assert.equal(p.status, 200); assert.match(p.body.referenceStatus, /Statistics-only/);
  assert.match(p.body.preview, /"catalog": null/); assert.equal(state.sent.length, 0);
  assert.equal((await request('review.analyze', { snapshotId: p.body.id, expectedModel: 'opus-fixture', expectedReasoning: 'medium', allowSamples: true })).status, 200);
});

test('reference preparation freezes metadata and rejects cancellation or settings changes during a late read', async t => {
  const { state, request } = await setup(t);
  state.reference = normalizeModelCatalog({ list: [{ id: 'gpt-5.3-codex', provider: { kind: 'copilot' } }] }, { capturedAt: reviewNow.toISOString() });
  await request('usage.report', { range: 'all' });
  const first = await request('review.prepare', { filters: { range: 'all' } });
  assert.match(first.body.preview, /gpt-5.3-codex/); assert.doesNotMatch(first.body.preview, /PRIVATE/);
  state.reference.models[0].label = 'PRIVATE';
  assert.doesNotMatch(first.body.preview, /PRIVATE/);
  let release, enter;
  state.hold = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { enter = resolve; }); state.entered = enter;
  const late = request('review.prepare', { filters: { range: '7d' } }); await entered;
  state.config.reviewModel = 'changed'; release(); state.hold = null;
  assert.equal((await late).status, 500); assert.equal(state.sent.length, 0);
  state.hold = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { state.entered = resolve; });
  const cancelled = request('review.prepare', { filters: { range: '7d' } }); await waiting;
  await request('review.cancel'); assert.equal((await cancelled).status, 500);
  release(); state.hold = null;
  const next = await request('review.prepare', { filters: { range: '1d' } }); assert.equal(next.status, 200);
  assert.equal((await request('review.analyze', { snapshotId: first.body.id, expectedModel: 'opus-fixture', expectedReasoning: 'medium', allowSamples: true })).status, 500);
});

test('excerpt policy is frozen; changed settings or requests require re-preparation', async t => {
  const { state, request } = await setup(t);
  for (const [prepared, current, requested, valid] of [
    [undefined, undefined, true, true], [false, false, false, true], [false, false, true, false],
    [true, false, true, false], [false, true, true, false], [true, true, false, false],
  ]) {
    state.config.reviewAllowSamples = prepared;
    await request('usage.report', { range: 'all' });
    const snapshot = (await request('review.prepare', { filters: { range: 'all' } })).body;
    assert.equal(snapshot.allowSamples, prepared !== false);
    state.config.reviewAllowSamples = current;
    const result = await request('review.analyze', { snapshotId: snapshot.id, expectedModel: 'opus-fixture', expectedReasoning: 'medium', allowSamples: requested });
    assert.equal(result.status, valid ? 200 : 500);
    if (valid) assert.equal(state.sent.at(-1).allowSamples, requested);
  }
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
