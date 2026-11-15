import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { buildReport } from '../core/copilot-report.mjs';
import { selectEnvironment } from '../core/environments.mjs';
import { parseDateDay } from '../core/query.mjs';
import { reviewPromptCandidates } from '../core/prompt-credits.mjs';
import { reviewUsageHome } from './settings.mjs';
import { readRequestPrompts } from './request-prompts.mjs';

const measured = value => Number.isFinite(value) && value >= 0;
const sourceKey = source => { const p = path.resolve(source || '.'); return process.platform === 'win32' ? p.toLowerCase() : p; };
const scopeLimits = [
  'Input includes cache; reasoning is part of output. Do not add subsets to totals.',
  'Known values only. Missing or partial recordings are not zero; coverage differs by measurement.',
  'Skills ignore the model filter. Session-wide interaction metrics are unavailable with a model filter.',
  'Prompt costs group linked work before date/model filtering. Model-filtered amounts are contributions, not whole-prompt costs.',
  'Prompt lengths are characters, not tokens or quality. Visible session lengths cover only the selected period.',
  'Tool definitions are not tool results. MCP tool failures are not proof of connectivity failure.',
  'Own review activity is excluded by known source identity. Unrecognized older copied review journals may remain.',
];

export async function prepareInsightReview(scan, filters, now = new Date(), context) {
  const ownRoot = sourceKey(reviewUsageHome());
  const excluded = new Set(scan.records.filter(r => r.reviewOrigin || r.source && sourceKey(r.source) === ownRoot).map(r => r.sessionId));
  const activity = { ...scan, cache: {} };
  for (const key of ['skills', 'tools', 'interactions', 'promptEvents']) activity[key] = (scan[key] || []).filter(e => !excluded.has(e.sessionId));
  let records = scan.records.filter(r => !excluded.has(r.sessionId));
  const selected = selectEnvironment(records, activity, filters.environment);
  records = selected.records;
  const scoped = selected.activity, report = buildReport(records, filters, now, scoped), e = report.efficiency;
  const evidence = [], labels = {};
  const add = (id, topic, label, value, unit, samples, total, limitation = '', localLabel = label) => {
    if (!measured(value) || !measured(samples) || samples <= 0) return;
    evidence.push({ id, topic, label, template: 'statistic', value, unit, samples, total: measured(total) ? total : samples, limitation });
    labels[id] = localLabel;
  };
  const s = e.summary;
  add('input', 'context-cache', 'Average input', s.averageInput, 'tokens/turn', s.inputRequests, s.requests);
  add('cache', 'context-cache', 'Cache reuse', s.cacheHitRate, '%', s.cacheRequests, s.requests, 'Read/input ratio on turns with a valid cache split. Low reuse alone does not identify a behavior.');
  add('tool-footprint', 'tools-mcp', 'Tool definitions', s.toolShare, '% of input', s.toolRequests, s.requests, 'Matched input only; definitions, not returned tool results.');
  add('reasoning', 'delegation', 'Reasoning output', s.reasoningShare, '% of output', s.reasoningRequests, s.requests, 'Subset of output on matched turns; not a measure of task value.');
  add('credits', 'model-spend', 'Recorded complete charges', s.credits, 'AI credits', s.creditRequests, s.requests, 'Excludes partial/missing charges; zero recorded charges are valid.');
  add('credit-turn', 'model-spend', 'Average turn charge', s.averageCredits, 'AI credits/turn', s.creditRequests, s.requests);
  const p = report.promptCredits;
  add('credit-prompt', 'prompts-sessions', 'Average prompt charge', p.averageCredits, 'AI credits/prompt', p.eligiblePrompts, p.prompts, p.modelFiltered ? 'Selected model contribution per eligible prompt, including linked continuations.' : 'Eligible whole prompts including linked continuations; excludes ambiguous, incomplete and unfinished work.');
  add('prompt-work', 'delegation', 'Work per prompt', p.work.averageRequests, 'turns/prompt', p.eligiblePrompts, p.prompts, 'Fully accounted prompts only. Multiple calls can be useful work.');
  const i = e.interactions;
  if (i.reason !== 'model-filter') {
    add('prompt-length', 'prompts-sessions', 'Average prompt length', i.averagePromptChars, 'characters', i.promptSamples, i.prompts, 'Displayed text only; attachments/injected context excluded. Length does not measure completeness.');
    add('session-length', 'prompts-sessions', 'Conversation length', i.averagePromptsPerSession, 'prompts/session', i.promptSessions, i.observedSessions, 'Observed prompts within these dates, not lifetime session length.');
  }
  for (const row of e.byInitiator || []) if (row.id === 'sub-agent') add('delegated', 'delegation', 'Delegated model turns', row.requests, 'turns', row.requests, s.requests, 'Explicit sub-agent initiator only. Unknown initiators remain unknown.');
  // Even without delegated calls, the observed initiator coverage is useful evidence.
  const knownInitiators = (e.byInitiator || []).filter(r => r.id !== 'unknown').reduce((n, r) => n + r.requests, 0);
  add('initiators', 'delegation', 'Known call origins', knownInitiators, 'turns', knownInitiators, s.requests, 'Does not establish the purpose or success of delegated work.');
  for (const [n, row] of e.models.slice(0, 6).entries()) {
    add(`model-${n + 1}`, 'model-spend', `Model ${n + 1}: average charge`, row.averageCredits, 'AI credits/turn', row.creditRequests, row.requests, 'Different workloads are not comparable solely by cost.', `${row.name}: average charge`);
    add(`model-cache-${n + 1}`, 'context-cache', `Model ${n + 1}: cache reuse`, row.cacheHitRate, '%', row.cacheRequests, row.requests, '', `${row.name}: cache reuse`);
  }
  for (const [n, row] of report.skills.rows.slice(0, 6).entries()) {
    const note = 'Recorded successful loads and explicit failed loads only, not skill task outcomes or per-skill tokens. Ignores model filter.';
    add(`skill-${n + 1}`, 'skills-instructions', `Skill ${n + 1}: uses`, row.invocations, 'loads', row.invocations + row.failures, row.invocations + row.failures, note, `${row.name}: uses`);
    add(`skill-fail-${n + 1}`, 'skills-instructions', `Skill ${n + 1}: failed loads`, row.failures, 'failures', row.invocations + row.failures, row.invocations + row.failures, note, `${row.name}: failed loads`);
  }
  for (const [n, row] of report.mcp.rows.slice(0, 6).entries()) {
    add(`mcp-${n + 1}`, 'tools-mcp', `Server ${n + 1}: known failure rate`, row.successes + row.failures ? row.failures / (row.successes + row.failures) * 100 : null, '%', row.successes + row.failures, row.calls, 'Unknown outcomes excluded; tool failure does not diagnose connectivity.', `${row.name}: known failure rate`);
  }
  for (const insight of e.insights) if (insight.kind === 'growth') {
    evidence.push({ id: 'context-growth', topic: 'context-cache', label: 'Input growth', template: 'comparison', unit: 'tokens', samples: insight.samples, total: insight.requests,
      values: [{ label: 'Early median', value: insight.early }, { label: 'Late median', value: insight.late }], limitation: 'First/last three measured turns within one project, session, model and initiator. Context growth does not prove waste.' });
  }
  if (s.inputRequests || s.outputRequests) {
    const stride = Math.max(1, Math.ceil(report.daily.length / 12)), values = [];
    for (let at = 0; at < report.daily.length; at += stride) {
      const days = report.daily.slice(at, at + stride);
      values.push({ label: days.length === 1 ? days[0].day : `${days[0].day} to ${days.at(-1).day}`, value: days.reduce((n, d) => n + d.inputTotal + d.output, 0) });
    }
    if (values.length > 1) evidence.push({ id: 'token-trend', topic: 'model-spend', label: 'Recorded tokens over time', template: 'trend', unit: 'tokens', values, samples: s.pairedRequests, total: s.requests, limitation: 'Known input including cache plus output. Partial days/logs and workload mix can change the trend.' });
  }
  if (context?.available) for (const key of ['systemPrompt', 'customInstructions', 'systemTools', 'mcpTools', 'messages']) {
    add(`context-${key}`, key === 'customInstructions' ? 'skills-instructions' : 'context-cache', `Current context: ${key}`, context.categories?.[key], 'tokens', 1, 1, `Separate current snapshot at ${context.checkedAt}; not historical attribution or a charge.`);
  }
  const start = report.query.range === 'all' ? -Infinity : parseDateDay(report.daily[0].day), end = parseDateDay(report.daily.at(-1).day);
  const chars = new Map((scoped.interactions || []).filter(v => v.kind === 'prompt').map(v => [v.key, v.chars]));
  const candidates = reviewPromptCandidates(scoped.promptEvents || [], records, filters, start, end, now, { memo: scoped.cache })
    .map(c => ({ ...c, record: { ...c.record }, chars: chars.get(JSON.stringify(['interaction', 'prompt', c.sessionId, c.promptId])) ?? null }))
    .sort((a, b) => (a.chars ?? 0) - (b.chars ?? 0) || a.ms - b.ms || a.promptId.localeCompare(b.promptId));
  const chosen = candidates.length <= 24 ? candidates : Array.from({ length: 24 }, (_, n) => candidates[Math.floor(n * (candidates.length - 1) / 23)]);
  chosen.forEach((c, n) => { c.id = `prompt-${n + 1}`; });
  const scope = { range: report.query.range, startDate: report.daily[0].day, endDate: report.daily.at(-1).day, modelFiltered: !!filters.models?.length, projectFiltered: !!filters.project, sessionFiltered: !!filters.session, environmentFiltered: !!filters.environment, ownReviewSessionsExcluded: excluded.size };
  const payload = { schema: 'usage-insights-evidence-v1', capturedAt: now.toISOString(), scope, evidence,
    candidates: chosen.map(c => ({ id: c.id, characters: c.chars, model: `Model ${Math.max(0, e.models.findIndex(m => m.name === c.record.model)) + 1}` })),
    limits: scopeLimits, omitted: { models: Math.max(0, e.models.length - 6), skills: Math.max(0, report.skills.rows.length - 6), mcp: Math.max(0, report.mcp.rows.length - 6), promptCandidates: candidates.length - chosen.length } };
  const preview = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(preview) > 38 * 1024) throw new Error('Review evidence is too large. Narrow the filters.');
  return { id: randomUUID(), payload, preview, labels, candidates: chosen, scope, filters: JSON.stringify(filters) };
}

export async function readReviewSamples(candidates, { signal } = {}) {
  signal?.throwIfAborted();
  const selected = candidates.slice(0, 6);
  const prompts = await readRequestPrompts(selected.map(c => ({ ...c.record, expectedPrompt: c.promptId, expectedInteraction: c.interaction })), { maxChars: 2000, signal, humanOnly: true });
  signal?.throwIfAborted();
  return selected.flatMap(c => { const p = prompts.get(c.record.key); return p?.available ? [{ id: c.id, text: p.text, truncated: p.truncated }] : []; });
}
