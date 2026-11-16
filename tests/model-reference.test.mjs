import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelCatalog, normalizeTokenPricing, buildModelReference, verifiedHistoricalModelId, serializeReviewEvidence } from '../src/core/model-reference.mjs';
import { createEfficiencyAccumulator } from '../src/core/efficiency.mjs';
import { buildEfficiencyReview } from '../src/panel/efficiency.mjs';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';
import { finalizeInsightReview, analyzeInsights, INSIGHT_RESPONSE_SCHEMA } from '../src/node/review-insights.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

const capturedAt = '2026-11-16T12:00:00.000Z';
const model = (id = 'gpt-5.3-codex', extra = {}) => ({ id, name: 'SECRET <script>private alias</script>', provider: { kind: 'copilot' }, policy: { state: 'enabled' },
  capabilities: { supports: { vision: true, reasoningEffort: true, toolCalls: false }, limits: { max_context_window_tokens: 100000, max_output_tokens: 10000 } },
  supportedReasoningEfforts: ['low', 'medium', 'high', 'SECRET'], defaultReasoningEffort: 'medium', endpoint: 'SECRET', ...extra });
const catalog = rows => normalizeModelCatalog({ list: rows }, { capturedAt });
const prices = () => ({ inputPrice: 2, outputPrice: 8, cacheReadPrice: .2, cacheWritePrice: 2.5, cacheWrite1hPrice: 4, batchSize: 1000000, maxPromptTokens: 200000,
  longContext: { inputPrice: 4, outputPrice: 16, cacheReadPrice: .4, cacheWritePrice: 5, cacheWrite1hPrice: 8, maxPromptTokens: 800000 } });

test('catalog accepts only exact public Copilot identities and allowlisted metadata', () => {
  const c = catalog([model(), model('SECRET'), model('gpt-5.3-codex-private'), model('claude-opus-5', { provider: { kind: 'byok' } }),
    model('claude-sonnet-5', { policy: { state: 'disabled' } }), model('claude-haiku-4.5', { policy: { state: 'unconfigured' } }),
    model('claude-opus-4.8'), model('claude-opus-4.8')]);
  assert.equal(c.models.length, 3);
  assert.deepEqual(c.omitted, { unverified: 2, provider: 1, duplicate: 2, selection: 0 });
  const row = c.models.find(m => m.id === 'gpt-5.3-codex');
  assert.equal(row.label, 'GPT-5.3-Codex'); assert.equal(row.limits.max_prompt_tokens, null);
  assert.deepEqual(row.reasoning, { supported: ['low', 'medium', 'high'], default: 'medium' });
  assert.equal(row.supports.toolCalls, false); assert.equal(row.supports.thinking, null);
  assert.equal(c.models.find(m => m.id === 'claude-sonnet-5').availability, 'unavailable');
  assert.doesNotMatch(JSON.stringify(c), /SECRET|script|endpoint/);
  assert.equal(normalizeModelCatalog({ models: [model()] }, { capturedAt }), null, 'do not conflate server and session RPC shapes');
  assert.equal(normalizeModelCatalog({ list: [] }, { capturedAt: 'SECRET' }), null);
  assert.equal(catalog([model('gpt-5.3-codex', { capabilities: undefined, policy: undefined })]).models[0].policy, 'unspecified');
});

test('pricing distinguishes absent, unsupported, malformed and zero; unit conversions are explicit', () => {
  assert.equal(normalizeTokenPricing().status, 'missing');
  assert.equal(normalizeTokenPricing({ tokenPrices: prices() }).reason, 'price-unit-unavailable');
  assert.equal(normalizeTokenPricing({ tokenPrices: prices() }, 'USD').status, 'unsupported');
  const zero = normalizeTokenPricing({ tokenPrices: { inputPrice: 0, outputPrice: 0, batchSize: 1000 } }, 'ai_credits');
  assert.equal(zero.tiers[0].rates.input, 0); assert.equal(zero.tiers[0].rates.cacheWrite, null); assert.equal(zero.status, 'partial');
  const p = prices(); p.inputPrice = 2000000000; p.outputPrice = 8000000000; p.cacheReadPrice = 200000000;
  const converted = normalizeTokenPricing({ tokenPrices: p }, 'nano_aiu');
  assert.equal(converted.tiers[0].rates.input, 2); assert.equal(converted.tiers[0].rates.output, 8); assert.equal(converted.tiers[0].rates.cacheRead, .2);
  assert.equal(converted.unit, 'AI credits'); assert.equal(converted.batchSize, 1000000);
  assert.equal(converted.cacheWriteSemantics, 'unverified'); assert.equal(converted.tierSelection, 'unverified');
  assert.deepEqual(converted.tiers.map(t => t.maxPromptTokens), [200000, 800000]);
  for (const value of [-1, NaN, Infinity, null, '0']) assert.equal(normalizeTokenPricing({ tokenPrices: { ...prices(), inputPrice: value } }, 'ai_credits').status, 'malformed');
  for (const value of [0, -1, 1.5, Infinity]) assert.equal(normalizeTokenPricing({ tokenPrices: { ...prices(), batchSize: value } }, 'ai_credits').status, 'malformed');
  for (const value of [199999, 200000, undefined]) {
    const p = prices(); p.longContext.maxPromptTokens = value;
    assert.equal(normalizeTokenPricing({ tokenPrices: p }, 'ai_credits').reason, 'invalid-tier-order');
  }
  const legacy = normalizeTokenPricing({ tokenPrices: { inputPrice: 1, cachePrice: 0, batchSize: 1000, contextMax: 10000 } }, 'ai_credits');
  assert.equal(legacy.tiers[0].rates.cacheRead, 0); assert.equal(legacy.tiers[0].maxPromptTokens, 10000);
  assert.equal(normalizeTokenPricing({ multiplier: 0 }).status, 'missing');
  assert.equal(normalizeTokenPricing({ tokenPrices: prices(), discountPercent: 10 }, 'ai_credits').reason, 'promotion-or-auto-regime');
});

test('typed price-unit fixtures survive normalization; invalid pricing does not erase capabilities', () => {
  const c = normalizeModelCatalog({ list: [model('gpt-5.3-codex', { billing: { multiplier: 0, tokenPrices: prices() } })] },
    { capturedAt, priceUnits: { units: [{ modelId: 'gpt-5.3-codex', unit: 'ai_credits' }] } });
  const ref = buildModelReference({ catalog: c }, [{ modelId: 'gpt-5.3-codex' }]);
  assert.equal(ref.catalog.models[0].pricing.status, 'available'); assert.equal(ref.catalog.models[0].requestMultiplier, 0);
  c.models[0].pricing.tiers[0].rates.input = -1;
  const bad = buildModelReference({ catalog: c }).catalog.models[0];
  assert.equal(bad.pricing.status, 'malformed'); assert.equal(bad.supports.vision, true);
  const noUnits = catalog([model('gpt-5.3-codex', { billing: { tokenPrices: prices() } })]);
  assert.equal(buildModelReference({ catalog: noUnits }).catalog.models[0].pricing.status, 'unsupported');
  c.models[0].pricing.tiers = [null];
  assert.equal(buildModelReference({ catalog: c }).catalog.models[0].pricing.status, 'malformed');
});

test('historical identity uses unanimous raw IDs, never display labels or suffix guessing', () => {
  const acc = createEfficiencyAccumulator();
  for (const r of [{ model: 'SECRET', modelId: 'gpt-5.3-codex' }, { model: 'mixed', modelId: 'gpt-5.3-codex' }, { model: 'mixed', modelId: 'claude-opus-5' }, { model: 'gpt-5.3-codex' }, { model: 'missing', modelId: 'gpt-5.3-codex' }, { model: 'missing' }]) acc.add({ inputTotal: 100, output: 20, creditStatus: 'complete', nanoAiu: 1000000000, ...r });
  const e = acc.finish(), ref = buildModelReference({ catalog: catalog([model()]) }, e.models);
  for (const row of e.models) assert.equal(verifiedHistoricalModelId(row, ref), row.name === 'SECRET' ? 'gpt-5.3-codex' : null);
  assert.equal(e.summary.credits, 6); assert.equal(e.summary.inputTokens, 600); assert.equal(e.summary.outputTokens, 120);
  const report = { efficiency: e, query: { range: 'all' }, generatedAt: capturedAt };
  const plain = buildEfficiencyReview(report, null), enriched = buildEfficiencyReview(report, null, {}, { catalog: catalog([model()]) });
  assert.doesNotMatch(enriched, /SECRET|"name": "mixed"|"name": "missing"/);
  assert.deepEqual(JSON.parse(plain.slice(plain.indexOf('{'))).modelReference, { schemaVersion: 1, catalog: null, benchmarks: null });
  assert.equal(JSON.parse(enriched.slice(enriched.indexOf('{'))).history.models.find(m => m.modelId)?.modelId, 'gpt-5.3-codex');
});

test('deterministic bounded reference coexists with bundled benchmarks and never copies arbitrary fields', () => {
  const ids = ['gpt-5.3-codex', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4.5', 'gpt-5.6-sol', 'gpt-5.6-luna'];
  const c = catalog([...ids.map(id => model(id)), ...Array.from({ length: 10000 }, (_, i) => model('SECRET-' + i, { name: '😀'.repeat(1000) }))]);
  const b = { schemaVersion: 1, source: 'bundled', capturedAt, SECRET: 'SECRET', entries: [{ modelId: ids[0], benchmark: 'swe-bench-verified', score: 80, unit: 'percent', prompt: 'SECRET' }] };
  const a = buildModelReference({ catalog: c, benchmarks: b, SECRET: 'SECRET' });
  const reverse = buildModelReference({ catalog: { ...c, models: [...c.models].reverse() }, benchmarks: b });
  assert.deepEqual(a, reverse); assert.equal(a.catalog.models.length, 4); assert.equal(a.catalog.omitted.selection, 2); assert.equal(a.catalog.omitted.unverified, 10000);
  assert.equal(a.benchmarks.entries[0].score, 80); assert.doesNotMatch(JSON.stringify(a), /SECRET|😀/);
  const data = { modelReference: a, label: '😀'.repeat(50) };
  const json = serializeReviewEvidence(data, 1500);
  assert.ok(Buffer.byteLength(json) <= 1500); assert.ok(JSON.parse(json).modelReference.catalog.omitted.selection > 2);
});

test('actual card review freezes catalog, guide and sampling policy into the exact first-pass preview', async () => {
  const f = reviewFixture(); f.user('one'); f.call('one', 'a', { model: 'gpt-5.3-codex', modelDisplayName: 'SECRET' });
  const c = catalog([model()]);
  const snapshot = await prepareInsightReview(f.scan(), { range: 'all' }, reviewNow, null, { catalog: c });
  await finalizeInsightReview(snapshot, false);
  const preview = snapshot.preview;
  c.models[0].limits.max_output_tokens = 999;
  assert.doesNotMatch(preview, /PRIVATE|SECRET|endpoint/);
  assert.equal(snapshot.payload.models[0].modelId, 'gpt-5.3-codex');
  assert.ok(Buffer.byteLength(preview) + Buffer.byteLength(JSON.stringify(INSIGHT_RESPONSE_SCHEMA)) <= 46 * 1024);
  let sent;
  await analyzeInsights(snapshot, { send: async text => { sent = text; return JSON.stringify({ cards: [], emptyReason: 'Limited evidence', followUp: null }); } });
  assert.equal(sent, preview); assert.equal(snapshot.preview, preview);
  await assert.rejects(analyzeInsights(snapshot, { allowSamples: true }), /settings changed/);
});

test('100,000 receipts retain exact totals and bounded identity state in the existing aggregation pass', () => {
  const acc = createEfficiencyAccumulator();
  for (let n = 0; n < 100000; n++) acc.add({ model: 'one group', modelId: n === 99999 ? 'private-other' : 'gpt-5.3-codex', inputTotal: 100, output: 20, reasoning: 10,
    cacheRead: 50, cacheWrite: 10, nanoAiu: 10000000, creditStatus: 'complete' });
  const e = acc.finish();
  assert.equal(e.models.length, 1); assert.equal(e.models[0].modelId, null);
  assert.equal(e.summary.requests, 100000); assert.equal(e.summary.inputTokens, 10000000); assert.equal(e.summary.outputTokens, 2000000); assert.equal(e.summary.credits, 1000);
});
