import { publicModelId } from './public-models.mjs';
// Offline validation with no third-party dependencies. Unknown fields fail instead of entering a review export.
const benchmarkText = (max = 600) => v => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const benchmarkId = v => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(v);
const benchmarkDay = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const benchmarkUrl = v => {
  if (!benchmarkText(500)(v)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname && !/[<>\s]/.test(v); } catch { return false; }
};
const benchmarkEnum = (...values) => v => values.includes(v);
const benchmarkNullable = check => v => v === null || check(v);
const benchmarkInteger = v => Number.isSafeInteger(v) && v > 0 && v <= 1000000;
const benchmarkArray = (check, min, max) => v => Array.isArray(v) && v.length >= min && v.length <= max && v.every(check);
function benchmarkShape(fields) {
  return v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === Object.keys(fields).length && Object.entries(fields).every(([key, check]) => Object.hasOwn(v, key) && check(v[key]));
}
const benchmarkModelSchema = benchmarkShape({
  id: benchmarkId, provider: benchmarkEnum('OpenAI', 'Anthropic', 'Google'), evaluatedModel: benchmarkText(120),
  copilotId: benchmarkNullable(benchmarkId), identitySources: benchmarkArray(benchmarkUrl, 0, 4),
  mapping: benchmarkEnum('exact-public-alias', 'unknown'), mappingLimitation: benchmarkText(),
});
const benchmarkResultSchema = benchmarkShape({
  id: benchmarkId, model: benchmarkId,
  benchmark: benchmarkShape({ name: benchmarkEnum('aider-polyglot'), version: benchmarkText(80), subset: benchmarkText(120), suiteRevision: benchmarkNullable(benchmarkText(80)), category: benchmarkEnum('coding-exercises'), measurement: benchmarkText() }),
  environment: benchmarkShape({ agent: benchmarkEnum('Aider'), version: benchmarkText(80), revision: benchmarkText(80), editFormat: benchmarkEnum('diff', 'whole', 'architect'), reasoning: benchmarkNullable(benchmarkEnum('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')), thinking: benchmarkNullable(benchmarkEnum('disabled', 'enabled')), attempts: benchmarkInteger, tokenBudget: benchmarkNullable(benchmarkInteger), settings: benchmarkText() }),
  score: v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100,
  unit: benchmarkEnum('percent'), direction: benchmarkEnum('higher'), samples: benchmarkInteger, passed: v => v === 0 || benchmarkInteger(v),
  uncertainty: benchmarkNullable(benchmarkText(300)), unknowns: benchmarkArray(benchmarkText(300), 1, 8),
  evaluatedAt: benchmarkDay, publishedAt: benchmarkDay, verifiedAt: benchmarkDay,
  source: benchmarkShape({ url: benchmarkUrl, revision: v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v), row: benchmarkText(120), evaluator: benchmarkText(120), kind: benchmarkEnum('independent', 'vendor'), license: benchmarkEnum('Apache-2.0'), licenseUrl: benchmarkUrl, attribution: benchmarkText(300), notes: benchmarkText() }),
  limitations: benchmarkArray(benchmarkText(400), 1, 8),
});
export function validateBenchmarkDataset(input) {
  const shape = benchmarkShape({ schemaVersion: v => v === 1, revision: benchmarkId, reviewedAt: benchmarkDay,
    notes: benchmarkArray(benchmarkText(400), 1, 8), models: benchmarkArray(benchmarkModelSchema, 1, 64), results: benchmarkArray(benchmarkResultSchema, 1, 128) });
  if (!shape(input)) throw new Error('Invalid benchmark dataset schema or field bounds');
  const models = new Map(), copilotIds = new Set(), evaluatedIds = new Set(), ids = new Set(), configurations = new Set();
  for (const row of input.models) {
    const evaluatedId = JSON.stringify([row.provider, row.evaluatedModel]);
    if (models.has(row.id) || evaluatedIds.has(evaluatedId) || row.copilotId && copilotIds.has(row.copilotId)) throw new Error('Duplicate benchmark model identity');
    if (row.mapping === 'exact-public-alias' ? !row.copilotId || !row.identitySources.length : row.copilotId !== null) throw new Error('Inconsistent benchmark model mapping');
    if (row.copilotId && !publicModelId(row.copilotId)) throw new Error('Unverified public benchmark identity');
    models.set(row.id, row); evaluatedIds.add(evaluatedId); if (row.copilotId) copilotIds.add(row.copilotId);
  }
  for (const row of input.results) {
    if (!models.has(row.model)) throw new Error('Unknown benchmark model identity');
    if (ids.has(row.id)) throw new Error('Duplicate benchmark evidence ID');
    ids.add(row.id);
    const configuration = JSON.stringify([row.model, row.benchmark, row.environment, row.evaluatedAt]);
    if (configurations.has(configuration)) throw new Error('Duplicate benchmark evaluation');
    configurations.add(configuration);
    if (row.passed > row.samples || Math.abs(row.score - row.passed / row.samples * 100) > .051) throw new Error('Inconsistent benchmark score');
    if (row.evaluatedAt > row.publishedAt || row.publishedAt > row.verifiedAt || row.verifiedAt > input.reviewedAt) throw new Error('Inconsistent benchmark dates');
  }
  // Clone only after strict validation; callers cannot mutate the validated copy through input.
  return JSON.parse(JSON.stringify(input));
}

export function benchmarkModuleSource(dataset) {
  const safe = validateBenchmarkDataset(dataset);
  // This module is also flattened inside an HTML script, never fetched at runtime.
  return '// Generated by scripts/build.mjs from data/model-benchmarks.json. Do not edit.\nexport const bundledModelBenchmarks = ' + JSON.stringify(safe).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029') + ';\n';
}
