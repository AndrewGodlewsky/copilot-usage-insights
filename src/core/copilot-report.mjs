import { normalizeQuery, localDay, dayKey, parseDateDay, RANGE_DAYS } from './query.mjs';
import { mcpHistory } from './integrations.mjs';
import { createEfficiencyAccumulator, summarizeInteractions } from './efficiency.mjs';

const tokenFields = ['input', 'inputTotal', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
const bucket = () => ({ requests: 0, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, completeTokens: 0, completeTokenRequests: 0, unclassifiedInput: 0, inputTotal: 0, missing: Object.fromEntries(tokenFields.map(k => [k, 0])), missingTokens: 0, knownTokenRequests: 0, missingCache: 0, missingCredits: 0, partialCredits: 0, chargedRequests: 0, nano: 0n, sessions: new Set() });
const knownTokens = (r, includeCache) => ((includeCache ? r.inputTotal : r.input) ?? 0) + (r.output ?? 0);
function add(b, r, includeCache) {
  b.requests++; b.sessions.add(r.sessionId);
  for (const k of tokenFields) { b[k] += r[k] ?? 0; if (r[k] == null) b.missing[k]++; }
  if (r.input === null) { b.missingCache++; b.unclassifiedInput += r.inputTotal ?? 0; }
  const input = includeCache ? r.inputTotal : r.input;
  if (input === null || r.output === null) b.missingTokens++;
  if (input !== null || r.output !== null) b.knownTokenRequests++;
  if (input != null && r.output != null) { b.completeTokens += input + r.output; b.completeTokenRequests++; }
  b.total += knownTokens(r, includeCache);
  if (r.nanoAiu === null) b.missingCredits++;
  else { b.nano += BigInt(r.nanoAiu); b.chargedRequests++; }
  if (r.creditStatus === 'partial') b.partialCredits++;
}
function finish(b) {
  const { nano, sessions, completeTokens, ...rest } = b;
  return { ...rest, sessions: sessions.size, averageTokens: b.completeTokenRequests ? completeTokens / b.completeTokenRequests : null, credits: b.requests && !b.chargedRequests ? null : Number(nano) / 1e9 };
}
function skillReport(records, activity, input, start, end, now) {
  const copilotSessions = new Set(records.filter(r => r.ms <= now.getTime()).map(r => r.sessionId));
  const excluded = new Set(activity.skillExcludedSessions || []), groups = new Map(), sessions = new Set(), projectOptions = new Set();
  let invocations = 0, omitted = 0;
  for (const skill of activity.skills || []) {
    if (skill.ms > now.getTime()) continue;
    const attributed = copilotSessions.has(skill.sessionId) && !excluded.has(skill.sessionId);
    if (attributed) projectOptions.add(skill.project);
    const day = localDay(new Date(skill.ms));
    if (day < start || day > end || input.project && input.project !== skill.project || input.session && input.session !== skill.sessionId) continue;
    // A skill event has no billing provider; mixed or unattributed sessions are not guessed.
    if (!attributed) { omitted++; continue; }
    const key = JSON.stringify([skill.name, skill.plugin, skill.version, skill.path || '']);
    if (!groups.has(key)) groups.set(key, { id: key, name: skill.name, plugin: skill.plugin, version: skill.version, path: skill.path || '', invocations: 0, triggers: { manual: 0, agent: 0, preloaded: 0, unknown: 0 }, sessions: new Set(), projects: new Set(), lastUsed: skill.ts });
    const row = groups.get(key);
    row.invocations++; row.sessions.add(skill.sessionId); row.projects.add(skill.project);
    const trigger = skill.trigger === 'user-invoked' ? 'manual' : skill.trigger === 'agent-invoked' ? 'agent' : skill.trigger === 'context-load' ? 'preloaded' : 'unknown';
    row.triggers[trigger]++;
    if (skill.ts > row.lastUsed) row.lastUsed = skill.ts;
    sessions.add(skill.sessionId); invocations++;
  }
  const rows = [...groups.values()].map(row => ({ ...row, sessions: row.sessions.size, projects: row.projects.size }))
    .sort((a, b) => b.invocations - a.invocations || b.lastUsed.localeCompare(a.lastUsed) || a.name.localeCompare(b.name));
  return { rows, invocations, sessions: sessions.size, omitted, projectOptions: [...projectOptions] };
}

function toolReport(records, activity, input, start, end, now) {
  const copilotSessions = new Set(records.filter(r => r.ms <= now.getTime()).map(r => r.sessionId));
  const excluded = new Set(activity.skillExcludedSessions || []), groups = new Map(), projectOptions = new Set();
  // The selector uses display labels; tool events carry raw model IDs.
  const modelIds = new Set(records.filter(r => r.ms <= now.getTime() && r.modelId && input.models?.includes(r.model)).map(r => JSON.stringify([r.sessionId, r.modelId])));
  let calls = 0, omitted = 0, mcpOmitted = 0;
  for (const tool of activity.tools || []) {
    if (tool.ms > now.getTime()) continue;
    const attributed = copilotSessions.has(tool.sessionId) && !excluded.has(tool.sessionId);
    if (attributed) projectOptions.add(tool.project);
    const day = localDay(new Date(tool.ms));
    const matchingModel = !input.models || input.models.includes(tool.model) || modelIds.has(JSON.stringify([tool.sessionId, tool.model]));
    if (day < start || day > end || input.project && input.project !== tool.project || input.session && input.session !== tool.sessionId || !matchingModel) continue;
    if (!attributed) { omitted++; if (tool.server) mcpOmitted++; continue; }
    const key = JSON.stringify([tool.name, tool.server, tool.mcpTool]);
    if (!groups.has(key)) groups.set(key, { name: tool.name, server: tool.server, mcpTool: tool.mcpTool, calls: 0, successes: 0, failures: 0, unknown: 0, lastUsed: tool.ts });
    const row = groups.get(key);
    row.calls++; calls++;
    const outcome = tool.completedMs != null && tool.completedMs >= tool.ms && tool.completedMs <= now.getTime() ? tool.success : null;
    row[outcome === true ? 'successes' : outcome === false ? 'failures' : 'unknown']++;
    if (tool.ts > row.lastUsed) row.lastUsed = tool.ts;
  }
  const rows = [...groups.values()].map(row => ({ ...row, successRate: row.successes + row.failures ? row.successes / (row.successes + row.failures) * 100 : null }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name) || a.server.localeCompare(b.server));
  return { rows, calls, omitted, mcpOmitted, projectOptions: [...projectOptions] };
}

function usageScope(records, input, now) {
  const q = normalizeQuery(input, now), today = localDay(now);
  for (const name of ['project', 'session']) if (input[name] !== undefined && typeof input[name] !== 'string') throw new TypeError(`${name} must be a string`);
  const history = records.filter(r => r.ms <= now.getTime() && (!q.models || q.models.includes(r.model)) && (!input.project || r.project === input.project) && (!input.session || r.sessionId === input.session));
  const first = history.reduce((min, r) => Math.min(min, localDay(new Date(r.ms))), today);
  const start = q.range === 'custom' ? parseDateDay(q.startDate) : q.range === 'all' ? first : today - RANGE_DAYS.get(q.range) + 1;
  const end = q.range === 'custom' ? parseDateDay(q.endDate) : today;
  return { q, today, history, start, end };
}

export function buildRequestPage(records, input = {}, now = new Date()) {
  const allowed = new Set(['range', 'startDate', 'endDate', 'models', 'includeCache', 'project', 'session', 'model', 'offset', 'id']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new TypeError('Unknown request filter');
  if (typeof input.model !== 'string' || !input.model.trim()) throw new TypeError('Expected a model');
  if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) throw new TypeError('Invalid request offset');
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id || input.id.length > 8192)) throw new TypeError('Invalid request ID');
  const { q, history, start, end } = usageScope(records, input, now);
  const matching = history.filter(r => {
    const day = localDay(new Date(r.ms));
    return r.model === input.model && day >= start && day <= end && (input.id === undefined || r.key === input.id);
  }).sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key));
  const limit = input.id === undefined ? 25 : 1;
  const offset = input.id === undefined ? Math.min(input.offset || 0, Math.max(0, Math.ceil(matching.length / limit) - 1) * limit) : 0;
  return { total: matching.length, offset, limit, rows: matching.slice(offset, offset + limit).map(r => {
    const b = bucket(); add(b, r, q.includeCache);
    return { id: r.key, ts: r.ts, sessionId: r.sessionId, sessionName: r.sessionName || r.project || 'Unnamed session',
      project: r.project, model: r.model, modelId: r.modelId, responseModel: r.responseModel || '',
      initiator: r.initiator || '', isAuto: r.isAuto ?? null, duration: r.duration ?? null, ...finish(b) };
  }) };
}

export function buildReport(records, input = {}, now = new Date(), activity = {}) {
  const { q, today, history, start, end } = usageScope(records, input, now);
  const sessionInfo = new Map();
  for (const r of records) {
    const previous = sessionInfo.get(r.sessionId);
    if (!previous || r.ms < previous.ms) sessionInfo.set(r.sessionId, { ms: r.ms, project: r.project, name: r.sessionName || previous?.name || '' });
    else if (!previous.name && r.sessionName) previous.name = r.sessionName;
  }
  const nameCounts = new Map();
  for (const s of sessionInfo.values()) if (s.name) nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1);
  const sessionLabels = new Map([...sessionInfo].map(([id, s]) => {
    const name = s.name || (s.project === 'Unknown project' ? 'Session' : s.project);
    const dated = !s.name || nameCounts.get(s.name) > 1;
    return [id, dated ? `${name} · ${new Date(s.ms).toLocaleString()}` : name];
  }));
  const totals = bucket(), todayTotal = bucket(), days = new Map(), models = new Map(), projects = new Map(), sessions = new Map();
  const efficiency = createEfficiencyAccumulator();
  const calendar = new Map(), rhythm = Array(168).fill(0);
  const get = (map, key) => { if (!map.has(key)) map.set(key, bucket()); return map.get(key); };
  for (const r of history) {
    const date = new Date(r.ms), day = localDay(date);
    add(get(calendar, day), r, q.includeCache);
    if (day === today) add(todayTotal, r, q.includeCache);
    if (day < start || day > end) continue;
    efficiency.add(r);
    add(totals, r, q.includeCache); add(get(days, day), r, q.includeCache);
    add(get(models, r.model), r, q.includeCache); add(get(projects, r.project), r, q.includeCache); add(get(sessions, JSON.stringify([r.project, r.sessionId])), r, q.includeCache);
    rhythm[date.getDay() * 24 + date.getHours()] += knownTokens(r, q.includeCache);
  }
  const ranked = map => [...map].map(([name, b]) => ({ name, ...finish(b) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let current = 0;
  for (let d = calendar.has(today) ? today : today - 1; calendar.has(d); d--) current++;
  const activityStart = q.range === 'all' ? -Infinity : start;
  const { projectOptions, ...skills } = skillReport(records, activity, input, activityStart, end, now);
  const { projectOptions: toolProjects, ...tools } = toolReport(records, activity, { ...input, models: q.models }, activityStart, end, now);
  return {
    generatedAt: now.toISOString(), query: q, totals: finish(totals), today: finish(todayTotal), streak: { current },
    daily: Array.from({ length: end - start + 1 }, (_, i) => ({ day: dayKey(start + i), ...finish(days.get(start + i) ?? bucket()) })),
    calendar: Array.from({ length: 182 }, (_, i) => ({ day: dayKey(today - 181 + i), ...finish(calendar.get(today - 181 + i) ?? bucket()) })),
    rhythm, models: ranked(models), projects: ranked(projects), sessions: ranked(sessions).map(s => {
      const [project, id] = JSON.parse(s.name);
      return { ...s, project, id, name: sessionLabels.get(id) };
    }),
    skills, tools, mcp: mcpHistory(tools), efficiency: { ...efficiency.finish(sessionLabels), interactions: summarizeInteractions(records, activity, { ...input, models: q.models }, activityStart, end, now) },
    options: { models: [...new Set(records.map(r => r.model))].sort(), projects: [...new Set([...records.map(r => r.project), ...projectOptions, ...toolProjects])].sort(), sessions: [...sessionLabels].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) },
  };
}
