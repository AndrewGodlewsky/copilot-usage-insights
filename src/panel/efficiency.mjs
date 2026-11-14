const reviewMetricKeys = ['requests', 'inputRequests', 'inputTokens', 'outputRequests', 'outputTokens', 'cacheRequests', 'cacheInput', 'cacheRead', 'creditRequests', 'credits', 'averageInput', 'averageOutput', 'cacheHitRate', 'averageCredits', 'pairedRequests', 'pairedInput', 'pairedOutput', 'toolRequests', 'toolTokens', 'toolInput', 'averageToolTokens', 'toolShare', 'reasoningRequests', 'reasoningTokens'];
const reviewNumbers = (row, keys) => Object.fromEntries(keys.map(key => [key, Number.isFinite(row?.[key]) && row[key] >= 0 ? row[key] : null]));
const reviewDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value) ? value : null;

export function buildEfficiencyReview(report, context, scope = {}) {
  const e = report.efficiency, models = e.models.slice(0, 20);
  const modelAlias = name => { const index = models.findIndex(row => row.name === name); return index < 0 ? 'Other model' : `Model ${index + 1}`; };
  const mcp = (report.mcp?.rows || []).filter(row => row.calls > 0).sort((a, b) => b.calls - a.calls);
  const data = {
    schema: 'usage-insights-efficiency-v1', capturedAt: reviewDate(report.generatedAt),
    units: 'Tokens are counts; credits are Copilot AI credits; shares/rates are percentages (0–100). Counts may have different coverage.',
    scope: { range: ['1d', '7d', '30d', '90d', 'all', 'custom'].includes(report.query.range) ? report.query.range : null,
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
      'No prompts, outcomes of the actual work, installed-skill usage ratio, per-skill tokens, or historical context-source attribution are available here.',
      'Low cache reuse does not prove chat switching. Large context does not prove waste. MCP tool failures do not prove connectivity failures.',
      'Model and server names are aliases. Workloads can differ. Current context is an estimate, not a historical bill.'
    ]
  };
  return 'Review my AI resource use using ONLY the snapshot below. Give up to three useful observations. For each, cite the exact field and sample coverage, explain an alternative explanation, suggest one small experiment, and say what I should compare afterward. Distinguish measurement from hypothesis. Do not invent savings, a score, task success, or an optimal target. Do not use tools or modify my setup. If evidence is weak, say what is missing.\n\n' + JSON.stringify(data, null, 2);
}
