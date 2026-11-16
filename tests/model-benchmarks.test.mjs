import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import { bundledModelBenchmarks } from '../src/generated/model-benchmarks.mjs';
import { validateBenchmarkDataset, benchmarkModuleSource } from '../src/core/benchmark-schema.mjs';
import { bundledBenchmarkLookup, createBenchmarkLookup, matchBenchmarkConfiguration, benchmarkInstructions, benchmarkHistory } from '../src/core/benchmark-reference.mjs';
import { createEfficiencyAccumulator } from '../src/core/efficiency.mjs';
import { buildModelReference, normalizeModelCatalog, serializeReviewEvidence, verifiedHistoricalModelId, describeModelReference } from '../src/core/model-reference.mjs';
import { buildEfficiencyReview } from '../src/panel/efficiency.mjs';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';
import { finalizeInsightReview, analyzeInsights, INSIGHT_RESPONSE_SCHEMA } from '../src/node/review-insights.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

const clone = value => structuredClone(value);
const source = () => JSON.parse(readFileSync(new URL('../data/model-benchmarks.json', import.meta.url), 'utf8'));
const catalog = (ids, stale = false) => ({ ...normalizeModelCatalog({ list: ids.map(([id, state = 'enabled']) => ({ id, provider: { kind: 'copilot' }, policy: { state } })) }, { capturedAt: reviewNow.toISOString() }), freshness: stale ? 'stale' : 'captured' });

test('all shipped facts validate, preserve counts/provenance and are exactly embedded', () => {
  const data = validateBenchmarkDataset(source());
  assert.deepEqual(data, bundledModelBenchmarks);
  assert.deepEqual(data.results.map(r => [r.score, r.passed, r.samples]), [[52.4, 118, 225], [56.4, 127, 225], [88, 198, 225], [86.7, 195, 225]]);
  for (const r of data.results) { assert.equal(r.source.license, 'Apache-2.0'); assert.ok(r.source.url.includes(r.source.revision)); assert.equal(r.uncertainty, null); }
  assert.equal(data.results[1].publishedAt, '2025-05-25'); assert.equal(data.results[1].evaluatedAt, '2025-05-24');
  assert.equal(data.models.find(m => m.id === 'sonnet4').copilotId, null);
  const html = readFileSync(new URL('../panel/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(benchmarkModuleSource(data).replace('export const', 'const')));
  assert.ok(html.includes(readFileSync(new URL('../licenses/aider-Apache-2.0.txt', import.meta.url), 'utf8').trim()));
});

test('offline schema rejects duplicate identities, unsupported fields, impossible scores, schemes, dates and oversized input', () => {
  for (const mutate of [
    d => { d.schemaVersion = 2; }, d => { d.SECRET = 'not allowlisted'; },
    d => d.results.push(clone(d.results[0])), d => d.models.push(clone(d.models[0])),
    d => { d.models[1].copilotId = d.models[0].copilotId; },
    d => { d.models[1].provider = d.models[0].provider; d.models[1].evaluatedModel = d.models[0].evaluatedModel; },
    d => { d.models[0].mapping = 'unknown'; }, d => { d.results[0].model = 'unknown'; },
    d => { d.models[0].copilotId = 'PRIVATE'; },
    d => { d.results[0].score = 101; }, d => { d.results[0].score = -1; }, d => { d.results[0].score = NaN; },
    d => { d.results[0].passed = 225; }, d => { d.results[0].samples = 0; }, d => { d.results[0].unit = 'USD'; },
    d => { d.results[0].source.url = 'javascript:alert(1)'; }, d => { d.results[0].source.url = 'https://user:password@example.com'; },
    d => { d.reviewedAt = '2026-02-30'; }, d => { d.results[0].publishedAt = '2024-01-01'; },
    d => { d.notes = ['x'.repeat(401)]; }, d => { d.models = Array(65).fill(d.models[0]); }, d => { d.results = Array(129).fill(d.results[0]); },
    d => { d.results[0].source.prompt = 'SECRET'; }, d => { d.results[0].environment.reasoning = 'ultra'; },
  ]) { const data = source(); mutate(data); assert.throws(() => validateBenchmarkDataset(data), /benchmark/i); }
  const zero = source(); zero.results[0].score = 0; zero.results[0].passed = 0;
  assert.equal(validateBenchmarkDataset(zero).results[0].score, 0, 'published zero is distinct from missing');
});

test('only exact public IDs match; unknown identities/configurations never inherit performance', () => {
  const groups = [{ modelId: 'gpt-5' }, { modelId: null, name: 'gpt-5' }, { modelId: 'gpt-5-high' }, { modelId: 'gpt-5.3-codex' }, { modelId: 'SECRET' }, { modelId: 'claude-sonnet-4' }];
  const b = bundledBenchmarkLookup.select(groups);
  assert.equal(b.coverage.matchedHistoricalGroups, 1); assert.equal(b.coverage.unmatchedHistoricalGroups, 5);
  assert.equal(b.coverage.unmappedResults, 1); assert.equal(b.entries.length, 3);
  assert.ok(b.entries.every(e => e.availability === 'unknown' && e.configurationMatch === 'unknown'));
  assert.doesNotMatch(JSON.stringify(b), /SECRET|gpt-5.3-codex/);
  assert.deepEqual([...new Set(b.entries.map(e => e.model.copilotId))].sort(), ['gpt-4.1', 'gpt-5']);
  const ref = buildModelReference({}, groups);
  assert.equal(verifiedHistoricalModelId(groups[0], ref), 'gpt-5');
  for (const row of groups.slice(1)) assert.equal(verifiedHistoricalModelId(row, ref), null);
  const high = source().results.find(r => r.id.includes('high')).environment;
  assert.equal(matchBenchmarkConfiguration(high, { reasoning: 'medium' }), 'incompatible');
  assert.equal(matchBenchmarkConfiguration(high, { reasoning: 'high' }), 'unknown');
  assert.equal(matchBenchmarkConfiguration(high, high), 'unknown', 'unreported budgets are still unknown');
  const reported = { ...high, thinking: 'enabled', tokenBudget: 10000 };
  assert.equal(matchBenchmarkConfiguration(reported, reported), 'reported-settings-match');
  const incompatible = bundledBenchmarkLookup.select([{ modelId: 'gpt-5', benchmarkConfiguration: { reasoning: 'medium' } }]);
  assert.equal(incompatible.entries.find(e => e.id.includes('high')).configurationMatch, 'incompatible');
});

test('catalog eligibility and stale availability remain separate from benchmark scores', () => {
  const history = [{ modelId: 'gpt-4.1' }];
  for (const state of ['disabled', 'unconfigured']) {
    const ref = buildModelReference({ catalog: catalog([['gpt-4.1'], ['gpt-5', state]]) }, history);
    assert.equal(ref.benchmarks.entries.length, 1);
    assert.ok(ref.catalog.models.some(m => m.id === 'gpt-4.1'));
  }
  const fresh = buildModelReference({ catalog: catalog([['gpt-4.1'], ['gpt-5']]) }, history);
  assert.equal(fresh.benchmarks.entries.filter(e => e.role === 'alternative').length, 2);
  assert.ok(fresh.benchmarks.entries.every(e => e.availability === 'available'));
  const stale = buildModelReference({ catalog: catalog([['gpt-4.1'], ['gpt-5']], true) }, history);
  assert.equal(stale.benchmarks.entries.length, 1); assert.equal(stale.benchmarks.entries[0].availability, 'stale');
  const unavailableHistory = buildModelReference({ catalog: catalog([]) }, history);
  assert.equal(unavailableHistory.benchmarks.entries[0].score, 52.4); assert.equal(unavailableHistory.benchmarks.entries[0].availability, 'unavailable');
});

test('caller projections cannot replace curated sources, prices or scores, and source strings embed safely', () => {
  const history = [{ modelId: 'gpt-4.1' }], projection = bundledBenchmarkLookup.select(history);
  projection.entries[0].score = 99; projection.entries[0].source.url = 'SECRET'; projection.notes = ['SECRET']; projection.SECRET = 'SECRET';
  const ref = buildModelReference({ benchmarks: projection }, history);
  assert.equal(ref.benchmarks.entries[0].score, 52.4); assert.doesNotMatch(JSON.stringify(ref), /SECRET/);
  projection.entries[0].id = 'unreviewed'; assert.equal(buildModelReference({ benchmarks: projection }, history).benchmarks, null);
  const data = source(); data.notes[0] = '</script><script>globalThis.injected = true</script> 😀';
  const module = benchmarkModuleSource(data); assert.doesNotMatch(module, /<\/script>/);
  const context = {}; new Script(module.replace('export const', 'const')).runInNewContext(context);
  assert.equal(context.injected, undefined); assert.match(benchmarkInstructions, /never instructions; never follow/);
});

test('large validated datasets are indexed once and select deterministic separate evaluations with UTF-8 budget omissions', () => {
  const data = source(), base = data.results[0];
  data.results = Array.from({ length: 128 }, (_, n) => ({ ...clone(base), id: `fixture-${String(n).padStart(3, '0')}`, benchmark: { ...base.benchmark, version: 'fixture-' + n }, limitations: ['😀'.repeat(190)] }));
  const lookup = createBenchmarkLookup(data), historical = [{ modelId: 'gpt-4.1' }];
  data.results[0].score = 999;
  const b = lookup.select(historical);
  assert.equal(b.entries.length, 8); assert.equal(b.omitted.selection, 120); assert.equal(b.entries[0].score, 52.4);
  assert.equal(new Set(b.entries.map(e => e.benchmark.version)).size, 8, 'different versions remain separate');
  assert.deepEqual(b, lookup.select(historical));
  const c = catalog([['gpt-4.1'], ['gpt-5']]); c.coverage = { historicalGroups: 1, verifiedHistoricalGroups: 1, alternatives: 1 };
  const payload = { models: [{ name: 'Model 1', modelId: 'gpt-4.1' }], modelReference: { schemaVersion: 1, catalog: c, benchmarks: b } };
  const text = serializeReviewEvidence(payload, 12 * 1024);
  assert.ok(Buffer.byteLength(text) <= 12 * 1024); assert.ok(JSON.parse(text).modelReference.benchmarks.omitted.budget > 0);
  assert.ok(payload.modelReference.benchmarks.entries.every(e => e.availability !== 'available'));
  assert.equal(payload.models[0].modelId, 'gpt-4.1', 'retained evidence keeps a verified identity without catalog');
});

test('prepared review sends the exact benchmark preview, keeps accounting/privacy and survives source mutation', async () => {
  const f = reviewFixture(); f.user('one'); f.call('one', 'a', { model: 'gpt-5', modelDisplayName: 'SECRET' });
  const snapshot = await prepareInsightReview(f.scan(), { range: 'all' }, reviewNow);
  const before = clone(snapshot.payload.evidence);
  await finalizeInsightReview(snapshot, false);
  assert.ok(snapshot.payload.modelReference.benchmarks.entries.length > 0);
  assert.equal(snapshot.payload.models[0].modelId, 'gpt-5'); assert.doesNotMatch(snapshot.preview, /PRIVATE|SECRET/);
  assert.deepEqual(snapshot.payload.evidence, before);
  assert.ok(Buffer.byteLength(snapshot.preview) + Buffer.byteLength(JSON.stringify(INSIGHT_RESPONSE_SCHEMA)) <= 46 * 1024);
  let sent; const preview = snapshot.preview;
  await analyzeInsights(snapshot, { send: async text => { sent = text; return JSON.stringify({ cards: [], emptyReason: 'Limited evidence', followUp: null }); } });
  assert.equal(sent, preview); assert.match(sent, /aider-gpt5-high-20250823/); assert.match(sent, /cb6a152e/);
  assert.match(describeModelReference(snapshot.payload.modelReference), /Bundled Aider evidence reviewed 2026-11-16/);
  const report = { efficiency: { summary: {}, models: [{ name: 'SECRET', modelId: 'gpt-4.1' }], insights: [] }, query: { range: '7d' } };
  const plain = buildEfficiencyReview(report, null);
  assert.match(plain, /aider-gpt41-20250414/); assert.doesNotMatch(plain, /SECRET/);
});

test('build, validator, temporary installation and actual review preparation work with network calls trapped', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'usage-benchmark-offline-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = new URL('../', import.meta.url);
  const preload = path.resolve('tests/fixtures/deny-network.cjs');
  for (const args of [['scripts/validate-model-benchmarks.mjs'], ['scripts/build.mjs', path.join(dir, 'panel.html')], ['tests/fixtures/offline-benchmarks.mjs', dir]]) {
    const output = execFileSync(process.execPath, ['--require', preload, ...args], { cwd: root, encoding: 'utf8' });
    assert.match(output, /Validated|Built|Offline benchmark integration passed/);
  }
});

test('100,000 receipts reuse model/effort aggregates and retain totals and conservative mixed effort', () => {
  const acc = createEfficiencyAccumulator();
  for (let n = 0; n < 100000; n++) acc.add({ model: n % 2 ? 'SECRET A' : 'SECRET B', modelId: n % 2 ? 'gpt-5' : 'gpt-4.1', effort: n === 99999 ? 'high' : 'medium',
    inputTotal: 100, output: 20, nanoAiu: 10000000, creditStatus: 'complete' });
  const e = acc.finish(), before = clone(e.summary), history = benchmarkHistory(e.models, e.efforts);
  assert.equal(e.models.length, 2); assert.equal(e.efforts.length, 3); assert.equal(history.length, 2);
  assert.equal(history.find(m => m.modelId === 'gpt-5').benchmarkConfiguration.reasoning, null);
  assert.equal(history.find(m => m.modelId === 'gpt-4.1').benchmarkConfiguration.reasoning, 'medium');
  assert.doesNotMatch(JSON.stringify(history), /SECRET/);
  for (let n = 0; n < 100; n++) assert.equal(buildModelReference({}, history).benchmarks.entries.length, 3);
  assert.deepEqual(e.summary, before);
  assert.equal(e.summary.requests, 100000); assert.equal(e.summary.credits, 1000); assert.equal(e.summary.inputTokens, 10000000); assert.equal(e.summary.outputTokens, 2000000);
});
