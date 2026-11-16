// Public identity allowlist, not a price list. Exact IDs only; no suffix removal or label matching.
// Sources and extension procedure: docs/model-reference.md.
const publicModelLabels = Object.freeze({
  'gpt-5.3-codex': 'GPT-5.3-Codex', 'gpt-5.4-nano': 'GPT-5.4 nano',
  'gpt-5.6-luna': 'GPT-5.6 Luna', 'gpt-5.6-sol': 'GPT-5.6 Sol', 'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-6-astra': 'GPT-6 Astra', 'gpt-6-luna': 'GPT-6 Luna', 'gpt-6-sol': 'GPT-6 Sol',
  'claude-haiku-4.5': 'Claude Haiku 4.5', 'claude-haiku-5.5': 'Claude Haiku 5.5',
  'claude-sonnet-4.5': 'Claude Sonnet 4.5', 'claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'claude-sonnet-5': 'Claude Sonnet 5', 'claude-sonnet-5.5': 'Claude Sonnet 5.5',
  'claude-opus-4.6': 'Claude Opus 4.6', 'claude-opus-4.7': 'Claude Opus 4.7', 'claude-opus-4.8': 'Claude Opus 4.8',
  'claude-opus-5': 'Claude Opus 5', 'claude-opus-5.5': 'Claude Opus 5.5',
});
const referenceObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const referenceDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const referenceCount = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;
const referenceLimit = v => Number.isSafeInteger(v) && v > 0 && v <= 100_000_000 ? v : null;
const referenceRate = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const referenceEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const referenceRateFields = { input: 'inputPrice', output: 'outputPrice', cacheRead: 'cacheReadPrice', cacheWrite: 'cacheWritePrice', cacheWrite1h: 'cacheWrite1hPrice' };
export const modelReferenceInstructions = 'Use only verified public model IDs and supplied modelReference facts for model-specific claims. Availability is a captured observation, not a promise. Current rates are not historical charges; request multipliers are not token prices. Pricing does not establish task capability or success. Do not calculate savings or hypothetical costs from aggregates, infer tiers from averages, or assume cache-write billing semantics. Suggest a bounded experiment with outcome checks, never call the cheapest model the best. Missing reference facts stay unknown.';
export function publicModelId(id) { return typeof id === 'string' && Object.hasOwn(publicModelLabels, id) ? id : null; }

// The unit must come from the separate models.listTokenPriceUnits RPC, never a guessed currency.
export function normalizeTokenPricing(billing, unit) {
  const empty = (status, reason) => ({ status, reason, unit: null, batchSize: null, tiers: [], cacheWriteSemantics: 'unverified', tierSelection: 'unverified' });
  if (billing?.tokenPrices === undefined) return empty('missing', 'no-token-prices');
  const p = billing.tokenPrices;
  if (!referenceObject(p)) return empty('malformed', 'invalid-token-prices');
  if (!['ai_credits', 'nano_aiu'].includes(unit)) return empty('unsupported', 'price-unit-unavailable');
  if (billing.discountPercent !== undefined || billing.promo !== undefined) return empty('unsupported', 'promotion-or-auto-regime');
  if (!referenceLimit(p.batchSize)) return empty('malformed', 'invalid-batch-size');
  const divisor = unit === 'nano_aiu' ? 1e9 : 1;
  const tiers = [];
  for (const [kind, tier] of [['default', p], ...(p.longContext === undefined ? [] : [['long-context', p.longContext]])]) {
    if (!referenceObject(tier)) return empty('malformed', 'invalid-tier');
    const budget = tier.maxPromptTokens ?? tier.contextMax;
    if (budget !== undefined && !referenceLimit(budget) || tier.maxPromptTokens !== undefined && tier.contextMax !== undefined && tier.maxPromptTokens !== tier.contextMax) return empty('malformed', 'invalid-tier-budget');
    const rates = {};
    for (const [name, key] of Object.entries(referenceRateFields)) {
      const value = name === 'cacheRead' ? tier[key] ?? tier.cachePrice : tier[key];
      // Explicit null is malformed too, not an absent/free rate.
      if (Object.hasOwn(tier, key) && !referenceRate(tier[key]) || name === 'cacheRead' && tier.cachePrice !== undefined && !referenceRate(tier.cachePrice) || value !== undefined && !referenceRate(value)) return empty('malformed', 'invalid-rate');
      rates[name] = value === undefined ? null : value / divisor;
    }
    tiers.push({ kind, maxPromptTokens: budget ?? null, rates });
  }
  if (tiers.length === 2 && (!tiers[0].maxPromptTokens || !tiers[1].maxPromptTokens || tiers[1].maxPromptTokens <= tiers[0].maxPromptTokens)) return empty('malformed', 'invalid-tier-order');
  return { status: tiers.every(t => Object.values(t.rates).every(v => v !== null)) ? 'available' : 'partial', reason: null,
    unit: 'AI credits', sourceUnit: unit, batchSize: p.batchSize, tiers, cacheWriteSemantics: 'unverified', tierSelection: 'unverified' };
}

export function normalizeModelCatalog(result, { capturedAt, priceUnits } = {}) {
  if (!Array.isArray(result?.list) || !referenceDate(capturedAt)) return null;
  const duplicates = new Set(), seen = new Set(), units = new Map(), duplicateUnits = new Set();
  // Only the fixed public registry can enter these maps, even with an enormous untrusted list.
  for (const row of result.list) if (publicModelId(row?.id)) { if (seen.has(row.id)) duplicates.add(row.id); seen.add(row.id); }
  for (const row of Array.isArray(priceUnits?.units) ? priceUnits.units : []) if (publicModelId(row?.modelId)) {
    if (units.has(row.modelId)) duplicateUnits.add(row.modelId);
    units.set(row.modelId, row.unit);
  }
  const omitted = { unverified: 0, provider: 0, duplicate: 0, selection: 0 }, models = [];
  for (const row of result.list) {
    if (!publicModelId(row?.id)) { omitted.unverified++; continue; }
    if (duplicates.has(row.id)) { omitted.duplicate++; continue; }
    if (row.provider?.kind !== 'copilot') { omitted.provider++; continue; }
    const supports = {}, limits = {}, missing = [];
    for (const key of ['vision', 'reasoningEffort', 'thinking', 'toolCalls']) { supports[key] = typeof row.capabilities?.supports?.[key] === 'boolean' ? row.capabilities.supports[key] : null; if (supports[key] === null) missing.push(key); }
    supports.adaptive_thinking = ['unsupported', 'optional', 'required', 'adaptive_only'].includes(row.capabilities?.supports?.adaptive_thinking) ? row.capabilities.supports.adaptive_thinking : null;
    for (const key of ['max_prompt_tokens', 'max_output_tokens', 'max_context_window_tokens']) { limits[key] = referenceLimit(row.capabilities?.limits?.[key]); if (limits[key] === null) missing.push(key); }
    for (const key of ['max_prompt_tokens', 'max_output_tokens']) if (limits.max_context_window_tokens && limits[key] > limits.max_context_window_tokens) { limits[key] = null; missing.push(key); }
    const reasoning = supports.reasoningEffort === true && Array.isArray(row.supportedReasoningEfforts) ? referenceEfforts.filter(e => row.supportedReasoningEfforts.includes(e)) : [];
    const policy = row.policy === undefined ? 'unspecified' : ['enabled', 'disabled', 'unconfigured'].includes(row.policy?.state) ? row.policy.state : 'unknown';
    models.push({ id: row.id, label: publicModelLabels[row.id], provider: 'copilot', policy,
      availability: ['enabled', 'unspecified'].includes(policy) ? 'available' : 'unavailable',
      supports, limits, reasoning: { supported: reasoning, default: reasoning.includes(row.defaultReasoningEffort) ? row.defaultReasoningEffort : null }, missing,
      requestMultiplier: referenceRate(row.billing?.multiplier) ? row.billing.multiplier : null,
      pricing: normalizeTokenPricing(row.billing, duplicateUnits.has(row.id) ? undefined : units.get(row.id)) });
  }
  models.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { schemaVersion: 1, source: 'copilot.session.model.list', capturedAt: referenceDate(capturedAt),
    freshness: 'captured', priceUnitSource: Array.isArray(priceUnits?.units) ? 'copilot.models.listTokenPriceUnits' : null, models, omitted,
    estimates: { status: 'unavailable', reason: 'Unverified cache-write semantics and per-request tier coverage. Rates alone do not establish hypothetical cost or savings.' } };
}

// Revalidate normalized input; never spread SDK/caller objects into a review export.
function validateReferenceCatalog(input) {
  if (input?.schemaVersion !== 1 || input.source !== 'copilot.session.model.list' || !Array.isArray(input.models)) return null;
  const units = [], list = input.models.map(row => {
    const prices = row?.pricing, tiers = prices?.tiers;
    const tier = t => t && Object.fromEntries([...Object.entries(referenceRateFields).filter(([key]) => t.rates?.[key] !== null && t.rates?.[key] !== undefined).map(([key, raw]) => [raw, t.rates[key]]), ...(t.maxPromptTokens === null ? [] : [['maxPromptTokens', t.maxPromptTokens]])]);
    const expectsRates = ['available', 'partial'].includes(prices?.status);
    const hasRates = expectsRates && prices.unit === 'AI credits' && Array.isArray(tiers) && tiers.length >= 1 && tiers.length <= 2 && tiers[0]?.kind === 'default' && referenceObject(tiers[0]?.rates) && (tiers.length === 1 || tiers[1]?.kind === 'long-context' && referenceObject(tiers[1]?.rates));
    if (hasRates && input.priceUnitSource === 'copilot.models.listTokenPriceUnits') units.push({ modelId: row.id, unit: 'ai_credits' });
    return { id: row?.id, provider: { kind: row?.provider }, policy: row?.policy === 'unspecified' ? undefined : { state: row?.policy },
      capabilities: { supports: row?.supports, limits: row?.limits }, supportedReasoningEfforts: row?.reasoning?.supported, defaultReasoningEffort: row?.reasoning?.default,
      billing: { multiplier: row?.requestMultiplier, ...(hasRates ? { tokenPrices: { ...tier(tiers[0]), batchSize: prices.batchSize, ...(tiers[1] ? { longContext: tier(tiers[1]) } : {}) } } : expectsRates ? { tokenPrices: null } : {}) } };
  });
  const safe = normalizeModelCatalog({ list }, { capturedAt: input.capturedAt, ...(input.priceUnitSource === 'copilot.models.listTokenPriceUnits' ? { priceUnits: { units } } : {}) });
  if (!safe) return null;
  for (const row of safe.models) {
    const original = input.models.find(m => m?.id === row.id)?.pricing;
    if (['available', 'partial'].includes(row.pricing.status) && ['nano_aiu', 'ai_credits'].includes(original?.sourceUnit)) row.pricing.sourceUnit = original.sourceUnit;
    if (['missing', 'unsupported', 'malformed'].includes(original?.status)) {
      const allowedReasons = ['no-token-prices', 'invalid-token-prices', 'price-unit-unavailable', 'promotion-or-auto-regime', 'invalid-batch-size', 'invalid-tier', 'invalid-tier-budget', 'invalid-rate', 'invalid-tier-order'];
      row.pricing = { ...normalizeTokenPricing(), status: original.status, reason: allowedReasons.includes(original.reason) ? original.reason : 'invalid-token-prices' };
    }
  }
  for (const key of Object.keys(safe.omitted)) safe.omitted[key] += referenceCount(input.omitted?.[key]);
  safe.freshness = input.freshness === 'stale' ? 'stale' : 'captured';
  return safe;
}

// Separate bundled-evidence contract; no runtime benchmark retrieval. Extend in the benchmark task.
function validateReferenceBenchmarks(input) {
  if (input?.schemaVersion !== 1 || input.source !== 'bundled' || !referenceDate(input.capturedAt) || !Array.isArray(input.entries)) return null;
  const entries = input.entries.filter(e => publicModelId(e?.modelId) && ['swe-bench-verified', 'terminal-bench', 'aider-polyglot'].includes(e.benchmark) && referenceRate(e.score) && e.score <= 100 && e.unit === 'percent')
    .map(e => ({ modelId: e.modelId, benchmark: e.benchmark, score: e.score, unit: 'percent' }))
    .sort((a, b) => a.modelId.localeCompare(b.modelId) || a.benchmark.localeCompare(b.benchmark) || a.score - b.score);
  return { schemaVersion: 1, source: 'bundled', capturedAt: referenceDate(input.capturedAt), entries: entries.slice(0, 8), omitted: referenceCount(input.omitted) + input.entries.length - Math.min(entries.length, 8) };
}
export function buildModelReference(input = {}, historical = []) {
  const catalog = validateReferenceCatalog(input?.catalog), benchmarks = validateReferenceBenchmarks(input?.benchmarks);
  if (catalog) {
    const wanted = new Set(historical.map(r => r.modelId).filter(publicModelId));
    const used = catalog.models.filter(m => wanted.has(m.id)).slice(0, 20);
    const alternatives = catalog.models.filter(m => !wanted.has(m.id) && m.availability === 'available').slice(0, 4);
    catalog.omitted.selection += catalog.models.length - used.length - alternatives.length;
    catalog.models = [...used, ...alternatives];
    catalog.coverage = { historicalGroups: historical.length, verifiedHistoricalGroups: historical.filter(r => used.some(m => m.id === r.modelId)).length, alternatives: alternatives.length };
  }
  return { schemaVersion: 1, catalog, benchmarks };
}
export function verifiedHistoricalModelId(row, reference) {
  return publicModelId(row?.modelId) && reference?.catalog?.models.some(m => m.id === row.modelId) ? row.modelId : null;
}

export function serializeReviewEvidence(data, maxBytes, spacing = 2) {
  const encoder = new TextEncoder();
  let json = JSON.stringify(data, null, spacing);
  while (encoder.encode(json).byteLength > maxBytes) {
    const ref = data.modelReference;
    if (ref?.catalog?.models.length) { ref.catalog.models.pop(); ref.catalog.omitted.selection++; }
    else if (ref?.benchmarks?.entries.length) { ref.benchmarks.entries.pop(); ref.benchmarks.omitted++; }
    else throw new Error('Review evidence is too large. Narrow the filters.');
    const historical = data.history?.models || data.models || [];
    for (const row of historical) if (!ref.catalog?.models.some(m => m.id === row.modelId)) row.modelId = null;
    if (ref.catalog?.coverage) {
      ref.catalog.coverage.verifiedHistoricalGroups = historical.filter(r => r.modelId !== null && ref.catalog.models.some(m => m.id === r.modelId)).length;
      ref.catalog.coverage.alternatives = ref.catalog.models.filter(m => !historical.some(r => r.modelId === m.id)).length;
    }
    json = JSON.stringify(data, null, spacing);
  }
  return json;
}
