import { buildModelReference, verifiedHistoricalModelId, modelReferenceInstructions, serializeReviewEvidence } from '../core/model-reference.mjs';
import { benchmarkHistory } from '../core/benchmark-reference.mjs';
const reviewMetricKeys = ['requests', 'inputRequests', 'inputTokens', 'outputRequests', 'outputTokens', 'cacheRequests', 'cacheInput', 'cacheRead', 'creditRequests', 'credits', 'averageInput', 'averageOutput', 'cacheHitRate', 'averageCredits', 'pairedRequests', 'pairedInput', 'pairedOutput', 'toolRequests', 'toolTokens', 'toolInput', 'averageToolTokens', 'toolShare', 'reasoningRequests', 'reasoningTokens'];
const reviewNumbers = (row, keys) => Object.fromEntries(keys.map(key => [key, Number.isFinite(row?.[key]) && row[key] >= 0 ? row[key] : null]));
const reviewDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value) ? value : null;

export function toolOutcomeSummary(tools) {
  return [false, true].map(mcp => {
    const rows = (tools?.rows || []).filter(row => Boolean(row.server) === mcp);
    const sum = key => rows.reduce((total, row) => total + (Number.isFinite(row[key]) && row[key] >= 0 ? row[key] : 0), 0);
    const successes = sum('successes'), failures = sum('failures');
    return { name: mcp ? 'MCP tools' : 'Other tools', calls: sum('calls'), successes, failures, unknown: sum('unknown'),
      successRate: successes + failures ? successes / (successes + failures) * 100 : null };
  });
}

export function buildEfficiencyReview(report, context, scope = {}, modelReference = {}) {
  const e = report.efficiency, models = e.models.slice(0, 20);
  const reference = buildModelReference(modelReference, benchmarkHistory(models, e.efforts));
  const modelAlias = name => { const index = models.findIndex(row => row.name === name); return index < 0 ? 'Other model' : `Model ${index + 1}`; };
  const mcp = (report.mcp?.rows || []).filter(row => row.calls > 0).sort((a, b) => b.calls - a.calls);
  const data = {
    schema: 'usage-insights-efficiency-v1', capturedAt: reviewDate(report.generatedAt), modelReference: reference,
    units: 'Tokens are counts; credits are Copilot AI credits; shares/rates are percentages (0–100). Counts may have different coverage.',
    scope: { range: ['1d', '7d', 'mtd', '30d', '90d', 'all', 'custom'].includes(report.query.range) ? report.query.range : null,
      startDate: reviewDate(report.query.startDate), endDate: reviewDate(report.query.endDate),
      modelFiltered: Boolean(scope.models?.length), projectFiltered: Boolean(scope.project), sessionFiltered: Boolean(scope.session) },
    history: { summary: reviewNumbers(e.summary, reviewMetricKeys),
      models: models.map(row => ({ name: modelAlias(row.name), ...reviewNumbers(row, ['requests', 'inputRequests', 'averageInput', 'outputRequests', 'averageOutput', 'cacheRequests', 'cacheInput', 'cacheRead', 'cacheHitRate', 'toolRequests', 'averageToolTokens', 'toolShare', 'creditRequests', 'credits', 'averageCredits']) })), modelsOmitted: Math.max(0, e.models.length - models.length),
      patterns: e.insights.filter(i => ['growth', 'cache', 'spend', 'tools'].includes(i.kind)).slice(0, 4).map(i => ({ kind: i.kind, model: modelAlias(i.model),
        ...reviewNumbers(i, ['early', 'late', 'multiple', 'rate', 'input', 'cached', 'credits', 'share', 'average', 'samples', 'requests']) })),
      mcp: mcp.slice(0, 20).map((row, i) => ({ name: `Server ${i + 1}`, ...reviewNumbers(row, ['calls', 'successes', 'failures', 'unknown', 'successRate']) })), mcpServersOmitted: Math.max(0, mcp.length - 20) },
    currentContext: context?.available ? { checkedAt: reviewDate(context.checkedAt), ...reviewNumbers(context, ['totalTokens', 'limit']),
      categories: reviewNumbers(context.categories, ['systemPrompt', 'customInstructions', 'systemTools', 'mcpTools', 'messages']) } : null,
    limits: [
      'Historical filters apply to history only. Current context is a separate, on-demand snapshot of the conversation hosting the dashboard.',
      'Input includes cache. Tool definitions are a subset of input, not tool results. Reasoning is a subset of output. Do not add these subsets to totals.',
      'Averages use only known samples. Paired input/output uses the same requests; cache/tool shares use their own matched denominators.',
      'No prompt text, outcomes of the actual work, installed-skill usage ratio, per-skill tokens, or historical context-source attribution are available here.',
      'Low cache reuse does not prove chat switching. Large context does not prove waste. MCP tool failures do not prove connectivity failures.',
      'Model and server names are aliases; nullable modelId adds only an exact verified public identity. Workloads can differ. Current context is an estimate, not a historical bill.',
      modelReferenceInstructions,
      'Conversation averages use only sessions with observed relevant events in the date/project/session scope; they are not full lifetime session lengths. Model filters make these session-wide measures unavailable.',
      'Prompt length counts displayed text characters, not tokens, completeness, detail, or quality. Attachments and injected prompts are excluded. Agent turns, user messages, and model requests are different units.',
      'Session errors are recorded incidents, not failed model-request counts. Failed tools can recover; no wasted-call or wasted-token estimate is justified. Planning versus coding cannot be inferred from these statistics.'
    ]
  };
  data.history.interactions = e.interactions?.reason === 'model-filter' ? { available: false, reason: 'model-filter' }
    : reviewNumbers(e.interactions, ['prompts', 'promptSamples', 'promptSessions', 'averagePromptChars', 'averagePromptsPerSession', 'turns', 'turnSessions', 'averageTurnsPerSession', 'sessionErrors', 'observedSessions', 'omitted']);
  data.history.tools = toolOutcomeSummary(report.tools);
  data.history.models.forEach((row, i) => { row.modelId = verifiedHistoricalModelId(models[i], reference); });
  return 'Review my AI resource use using ONLY the snapshot below. Give up to three useful observations, including a pattern working well when the evidence supports it. For each, cite the exact field and sample coverage, explain an alternative explanation, suggest one small experiment, and say what I should compare afterward. Distinguish measurement from hypothesis. Do not invent savings, a score, task success, or an optimal target. Do not use tools or modify my setup. If evidence is weak, say what is missing.\n\n' + serializeReviewEvidence(data, 46 * 1024);
}
