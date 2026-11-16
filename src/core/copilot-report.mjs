import { normalizeQuery, localDay, dayOfMs, dayKey, dayNumber, parseDateDay, RANGE_DAYS } from './query.mjs';
import { mcpHistory } from './integrations.mjs';
import { createEfficiencyAccumulator, summarizeInteractions } from './efficiency.mjs';
import { summarizePromptCredits } from './prompt-credits.mjs';
import { environmentOf, environmentOptions, selectEnvironment } from './environments.mjs';
import { summarizeCoverage } from './coverage.mjs';
import { summarizeModelChanges } from './model-settings.mjs';

const MAX = Number.MAX_SAFE_INTEGER, NONE = Symbol('none');
const bucket = () => ({ requests: 0, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, completeTokens: 0, completeTokenRequests: 0, unclassifiedInput: 0, inputTotal: 0,
  missing: { input: 0, inputTotal: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, missingTokens: 0, knownTokenRequests: 0, missingCache: 0, missingCredits: 0, partialCredits: 0, chargedRequests: 0,
  nano: 0, completeCreditRequests: 0, completeCreditNano: 0, creditTokenRequests: 0, creditTokens: 0, creditTokenNano: 0, sessions: new Set(), wide: null });
const knownTokens = (r, includeCache) => ((includeCache ? r.inputTotal : r.input) ?? 0) + (r.output ?? 0);
// Credit totals are exact integers. They stay ordinary numbers until one would leave the safe
// range, and only then continue as a BigInt, so no request allocates one.
function addNano(b, field, value) {
  if (Number.isSafeInteger(value) && value >= 0 && b[field] <= MAX - value) b[field] += value;
  else { (b.wide ??= { nano: 0n, completeCreditNano: 0n, creditTokenNano: 0n })[field] += BigInt(b[field]) + BigInt(value); b[field] = 0; }
}
const nanoTotal = (b, field) => b.wide ? Number(b.wide[field] + BigInt(b[field])) : b[field];
function add(b, r, includeCache) {
  b.requests++; b.sessions.add(r.sessionId);
  const missing = b.missing;
  if (r.input == null) missing.input++; else b.input += r.input;
  if (r.inputTotal == null) missing.inputTotal++; else b.inputTotal += r.inputTotal;
  if (r.output == null) missing.output++; else b.output += r.output;
  if (r.cacheRead == null) missing.cacheRead++; else b.cacheRead += r.cacheRead;
  if (r.cacheWrite == null) missing.cacheWrite++; else b.cacheWrite += r.cacheWrite;
  if (r.reasoning == null) missing.reasoning++; else b.reasoning += r.reasoning;
  if (r.input === null) { b.missingCache++; b.unclassifiedInput += r.inputTotal ?? 0; }
  const input = includeCache ? r.inputTotal : r.input;
  if (input === null || r.output === null) b.missingTokens++;
  if (input !== null || r.output !== null) b.knownTokenRequests++;
  if (input != null && r.output != null) { b.completeTokens += input + r.output; b.completeTokenRequests++; }
  b.total += (input ?? 0) + (r.output ?? 0);
  if (r.nanoAiu === null) b.missingCredits++;
  else { addNano(b, 'nano', r.nanoAiu); b.chargedRequests++; }
  if (r.creditStatus === 'partial') b.partialCredits++;
  if (Number.isSafeInteger(r.nanoAiu) && r.nanoAiu >= 0 && r.creditStatus === 'complete') {
    b.completeCreditRequests++; addNano(b, 'completeCreditNano', r.nanoAiu);
    if (input != null && r.output != null) {
      b.creditTokenRequests++; b.creditTokens += input + r.output; addNano(b, 'creditTokenNano', r.nanoAiu);
    }
  }
}
function finish(b) {
  const { nano, sessions, completeTokens, completeCreditNano, creditTokens, creditTokenNano, wide, ...rest } = b;
  return { ...rest, sessions: sessions.size, averageTokens: b.completeTokenRequests ? completeTokens / b.completeTokenRequests : null, credits: b.requests && !b.chargedRequests ? null : nanoTotal(b, 'nano') / 1e9,
    averageCredits: b.completeCreditRequests ? nanoTotal(b, 'completeCreditNano') / 1e9 / b.completeCreditRequests : null,
    creditsPerMillionTokens: creditTokens > 0 ? nanoTotal(b, 'creditTokenNano') / 1e9 / creditTokens * 1e6 : null };
}
// Sessions with Copilot usage on or before `now`: the only ones activity can be attributed to.
function copilotSessionsAt(records, nowMs) {
  const sessions = new Set();
  for (const r of records) if (r.ms <= nowMs) sessions.add(r.sessionId);
  return sessions;
}
const skillIdentity = skill => JSON.stringify([skill.name, skill.plugin, skill.version, skill.path || '']);

function skillReport(copilotSessions, activity, input, start, end, now) {
  const nowMs = now.getTime();
  const excluded = new Set(activity.skillExcludedSessions || []), groups = new Map(), sessions = new Set(), projectOptions = new Set();
  const candidates = new Map(), seenFailures = new Set();
  const attributed = event => copilotSessions.has(event.sessionId) && !excluded.has(event.sessionId);
  const scope = (event, name) => JSON.stringify([event.sessionId, event.project, name]);
  const matching = event => {
    const day = dayOfMs(event.ms);
    return day >= start && day <= end && (!input.project || input.project === event.project) && (!input.session || input.session === event.sessionId);
  };
  const counts = event => ({ invocations: 0, failures: 0, triggers: { manual: 0, agent: 0, preloaded: 0, unknown: 0 }, sessions: new Set(), lastUsed: event.ts });
  function recordSkill(skill, event, failed = false) {
    const key = skill.unresolved ? JSON.stringify(['skill-load-failure', skill.name]) : skillIdentity(skill);
    if (!groups.has(key)) groups.set(key, { id: key, name: skill.name, plugin: skill.plugin || '', version: skill.version || '', path: skill.path || '', unresolved: !!skill.unresolved,
      ...counts(event), projects: new Map() });
    const row = groups.get(key);
    if (!row.projects.has(event.project)) row.projects.set(event.project, { name: event.project, ...counts(event) });
    const trigger = event.trigger === 'user-invoked' ? 'manual' : event.trigger === 'agent-invoked' ? 'agent' : event.trigger === 'context-load' ? 'preloaded' : 'unknown';
    for (const target of [row, row.projects.get(event.project)]) {
      target.sessions.add(event.sessionId);
      if (event.ts > target.lastUsed) target.lastUsed = event.ts;
      if (failed) target.failures++;
      else { target.invocations++; target.triggers[trigger]++; }
    }
    sessions.add(event.sessionId);
  }
  let invocations = 0, failures = 0, omitted = 0, omittedFailures = 0;
  for (const skill of activity.skills || []) {
    if (skill.ms > nowMs) continue;
    const known = attributed(skill);
    if (known) {
      projectOptions.add(skill.project);
      // Use all available identities, so narrowing dates cannot make an ambiguous name look unique.
      const key = scope(skill, skill.name);
      if (!candidates.has(key)) candidates.set(key, new Map());
      candidates.get(key).set(skillIdentity(skill), skill);
    }
    if (!matching(skill)) continue;
    // A skill event has no billing provider; mixed or unattributed sessions are not guessed.
    if (!known) { omitted++; continue; }
    recordSkill(skill, skill);
    invocations++;
  }
  for (const tool of activity.tools || []) {
    if (tool.name !== 'skill' || tool.server || tool.mcpTool || tool.success !== false || tool.completedMs == null ||
      tool.completedMs < tool.ms || tool.completedMs > nowMs || tool.ms > nowMs || seenFailures.has(tool.key)) continue;
    seenFailures.add(tool.key);
    if (attributed(tool)) projectOptions.add(tool.project);
    if (!matching(tool)) continue;
    if (!attributed(tool)) { omittedFailures++; continue; }
    const identities = candidates.get(scope(tool, tool.skillName));
    const skill = identities?.size === 1 ? identities.values().next().value : { name: tool.skillName || 'Unknown skill', unresolved: true };
    recordSkill(skill, tool, true);
    failures++;
  }
  const ranked = (a, b) => b.invocations - a.invocations || b.lastUsed.localeCompare(a.lastUsed) || a.name.localeCompare(b.name);
  const rows = [...groups.values()].map(row => ({ ...row, sessions: row.sessions.size, projects: row.projects.size,
    projectRows: [...row.projects.values()].map(project => ({ ...project, sessions: project.sessions.size })).sort(ranked) })).sort(ranked);
  return { rows, invocations, failures, sessions: sessions.size, omitted, omittedFailures, projectOptions: [...projectOptions] };
}

function toolReport(records, copilotSessions, activity, input, start, end, now) {
  const nowMs = now.getTime();
  const excluded = new Set(activity.skillExcludedSessions || []), groups = [], byName = new Map(), projectOptions = new Set();
  // The selector uses display labels; tool events carry raw model IDs.
  let modelIds = null;
  if (input.models) {
    modelIds = new Map();
    for (const r of records) if (r.ms <= nowMs && r.modelId && input.models.includes(r.model)) {
      let ids = modelIds.get(r.sessionId);
      if (!ids) modelIds.set(r.sessionId, ids = new Set());
      ids.add(r.modelId);
    }
  }
  let calls = 0, omitted = 0, mcpOmitted = 0, lastSession = NONE, lastAttributed = false;
  for (const tool of activity.tools || []) {
    if (tool.ms > nowMs) continue;
    if (tool.sessionId !== lastSession) { lastSession = tool.sessionId; lastAttributed = copilotSessions.has(lastSession) && !excluded.has(lastSession); }
    const attributed = lastAttributed;
    if (attributed) projectOptions.add(tool.project);
    const day = dayOfMs(tool.ms);
    const matchingModel = !input.models || input.models.includes(tool.model) || !!modelIds.get(tool.sessionId)?.has(tool.model);
    if (day < start || day > end || input.project && input.project !== tool.project || input.session && input.session !== tool.sessionId || !matchingModel) continue;
    if (!attributed) { omitted++; if (tool.server) mcpOmitted++; continue; }
    // One row per (name, server, MCP tool), kept in the order each first appeared.
    let servers = byName.get(tool.name);
    if (!servers) byName.set(tool.name, servers = new Map());
    let mcpTools = servers.get(tool.server);
    if (!mcpTools) servers.set(tool.server, mcpTools = new Map());
    let row = mcpTools.get(tool.mcpTool);
    if (!row) { mcpTools.set(tool.mcpTool, row = { name: tool.name, server: tool.server, mcpTool: tool.mcpTool, calls: 0, successes: 0, failures: 0, unknown: 0, lastUsed: tool.ts }); groups.push(row); }
    row.calls++; calls++;
    const outcome = tool.completedMs != null && tool.completedMs >= tool.ms && tool.completedMs <= nowMs ? tool.success : null;
    row[outcome === true ? 'successes' : outcome === false ? 'failures' : 'unknown']++;
    if (tool.ts > row.lastUsed) row.lastUsed = tool.ts;
  }
  const rows = groups.map(row => ({ ...row, successRate: row.successes + row.failures ? row.successes / (row.successes + row.failures) * 100 : null }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name) || a.server.localeCompare(b.server));
  return { rows, calls, omitted, mcpOmitted, projectOptions: [...projectOptions] };
}

function usageScope(records, input, now) {
  const q = normalizeQuery(input, now), today = localDay(now), nowMs = now.getTime();
  for (const name of ['project', 'session']) if (input[name] !== undefined && typeof input[name] !== 'string') throw new TypeError(`${name} must be a string`);
  const models = q.models, project = input.project, session = input.session, history = [];
  let first = today;
  for (const r of records) if (r.ms <= nowMs && (!q.environment || environmentOf(r) === q.environment) && (!models || models.includes(r.model)) && (!project || r.project === project) && (!session || r.sessionId === session)) {
    history.push(r);
    first = Math.min(first, dayOfMs(r.ms));
  }
  const start = q.range === 'custom' ? parseDateDay(q.startDate) : q.range === 'all' ? first
    : q.range === 'mtd' ? dayNumber(now.getFullYear(), now.getMonth(), 1) : today - RANGE_DAYS.get(q.range) + 1;
  const end = q.range === 'custom' ? parseDateDay(q.endDate) : today;
  return { q, today, history, start, end };
}

function modelRequestScope(records, input, now, extra) {
  const allowed = new Set(['range', 'startDate', 'endDate', 'models', 'environment', 'includeCache', 'project', 'session', 'model', 'offset', extra]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new TypeError('Unknown request filter');
  if (typeof input.model !== 'string' || !input.model.trim()) throw new TypeError('Expected a model');
  if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) throw new TypeError('Invalid request offset');
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id || input.id.length > 8192)) throw new TypeError('Invalid request ID');
  const { q, history, start, end } = usageScope(records, input, now);
  const matching = history.filter(r => {
    if (r.model !== input.model || input.id !== undefined && r.key !== input.id) return false;
    const day = dayOfMs(r.ms);
    return day >= start && day <= end;
  });
  return { q, matching, start, end };
}

export function buildRequestPage(records, input = {}, now = new Date()) {
  const { q, matching } = modelRequestScope(records, input, now, 'id');
  matching.sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key));
  const limit = input.id === undefined ? 25 : 1;
  const offset = input.id === undefined ? Math.min(input.offset || 0, Math.max(0, Math.ceil(matching.length / limit) - 1) * limit) : 0;
  return { total: matching.length, offset, limit, rows: matching.slice(offset, offset + limit).map(r => {
    const b = bucket(); add(b, r, q.includeCache);
    return { id: r.key, ts: r.ts, sessionId: r.sessionId, sessionName: r.sessionName || r.project || 'Unnamed session',
      project: r.project, model: r.model, modelId: r.modelId, responseModel: r.responseModel || '',
      initiator: r.initiator || '', isAuto: r.isAuto ?? null, duration: r.duration ?? null, ...finish(b) };
  }) };
}

// Labels depend only on the records. A scanner never alters a list it has returned, so its
// cache keeps the labels for as long as the same list is current.
function sessionNames(records, cache) {
  if (cache?.labels?.records === records) return cache.labels.names;
  const sessionInfo = new Map();
  let lastId = NONE, previous;
  for (const r of records) {
    if (r.sessionId !== lastId) { lastId = r.sessionId; previous = sessionInfo.get(lastId); }
    if (!previous || r.ms < previous.ms) sessionInfo.set(lastId, previous = { ms: r.ms, project: r.project, name: r.sessionName || previous?.name || '' });
    else if (!previous.name && r.sessionName) previous.name = r.sessionName;
  }
  const nameCounts = new Map();
  for (const s of sessionInfo.values()) if (s.name) nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1);
  const names = new Map();
  for (const [id, s] of sessionInfo) {
    const name = s.name || (s.project === 'Unknown project' ? 'Session' : s.project);
    const dated = !s.name || nameCounts.get(s.name) > 1;
    names.set(id, dated ? `${name} · ${new Date(s.ms).toLocaleString()}` : name);
  }
  if (cache) cache.labels = { records, names };
  return names;
}

const promptCountFields = p => ({ userPrompts: p && (p.count || !p.uncertain) ? p.count : null, uncertainPrompts: p?.uncertain || 0 });
function promptCountsFor(records, activity, input, start, end, now) {
  return summarizePromptCredits(activity.promptEvents, records, input, input.range === 'all' ? -Infinity : start, end, now,
    activity.cache ? { memo: activity.cache, unique: activity.cache.uniquePromptEvents === true } : undefined);
}

function buildModelGroups(records, input, now, activity, projects) {
  ({ records, activity } = selectEnvironment(records, activity, input.environment));
  const { q, matching, start, end } = modelRequestScope(records, input, now, 'sort');
  const sort = input.sort ?? 'total';
  if (!['total', 'credits', 'requests', 'userPrompts'].includes(sort)) throw new TypeError('Invalid session sort');
  const names = sessionNames(records, activity.cache), sessions = new Map();
  for (const r of matching) {
    const key = projects ? r.project : r.sessionId;
    if (!sessions.has(key)) sessions.set(key, bucket());
    add(sessions.get(key), r, q.includeCache);
  }
  const counts = promptCountsFor(records, activity, { ...input, models: [input.model] }, start, end, now);
  const prompts = new Map();
  for (const p of projects ? counts.projectPrompts : counts.sessionPrompts.filter(p => !input.project || p.project === input.project)) {
    const key = projects ? p.name : p.id, previous = prompts.get(key);
    prompts.set(key, { count: p.count + (previous?.count || 0), uncertain: p.uncertain + (previous?.uncertain || 0) });
  }
  const rows = [...sessions].map(([id, b]) => ({ id, name: projects ? id : names.get(id), ...finish(b), ...promptCountFields(prompts.get(id)) }))
    .sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const limit = 25, offset = Math.min(input.offset || 0, Math.max(0, Math.ceil(rows.length / limit) - 1) * limit);
  return { total: rows.length, offset, limit, rows: rows.slice(offset, offset + limit) };
}
export function buildModelSessionPage(records, input = {}, now = new Date(), activity = {}) {
  return buildModelGroups(records, input, now, activity, false);
}
export function buildModelProjectPage(records, input = {}, now = new Date(), activity = {}) {
  return buildModelGroups(records, input, now, activity, true);
}

export function buildSessionModels(records, input = {}, now = new Date(), activity = {}) {
  const allowed = new Set(['range', 'startDate', 'endDate', 'models', 'environment', 'includeCache', 'project', 'session']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new TypeError('Unknown session model filter');
  for (const key of ['project', 'session']) if (typeof input[key] !== 'string' || !input[key].trim()) throw new TypeError(`Expected a ${key}`);
  ({ records, activity } = selectEnvironment(records, activity, input.environment));
  const { q, history, start, end } = usageScope(records, input, now), models = new Map();
  for (const r of history) {
    const day = dayOfMs(r.ms);
    if (day < start || day > end) continue;
    if (!models.has(r.model)) models.set(r.model, bucket());
    add(models.get(r.model), r, q.includeCache);
  }
  const counts = promptCountsFor(records, activity, { ...input, models: q.models }, start, end, now);
  const prompts = new Map(counts.modelPrompts.map(p => [p.name, p]));
  return { rows: [...models].map(([name, b]) => ({ name, ...finish(b), ...promptCountFields(prompts.get(name)) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)) };
}

export function buildReport(records, input = {}, now = new Date(), activity = {}) {
  normalizeQuery(input, now);
  const environments = environmentOptions(records, activity.sources);
  ({ records, activity } = selectEnvironment(records, activity, input.environment));
  const { q, today, history, start, end } = usageScope(records, input, now);
  const includeCache = q.includeCache, nowMs = now.getTime();
  const sessionLabels = sessionNames(records, activity.cache);
  const totals = bucket(), todayTotal = bucket(), days = new Map(), models = new Map(), projects = new Map(), sessions = new Map(), sessionsByProject = new Map();
  const efficiency = createEfficiencyAccumulator();
  // Only the latest 182 days are drawn; older days matter solely for the length of the streak.
  const calendar = new Map(), activeDays = new Set(), calendarStart = today - 181, rhythm = Array(168).fill(0);
  const get = (map, key) => { let b = map.get(key); if (!b) map.set(key, b = bucket()); return b; };
  // Consecutive requests usually share a day, model, project and session, so each bucket is found once per run.
  let day, calendarDay, dayTotal, model = NONE, modelTotal, project = NONE, projectTotal, projectSessions, sessionId = NONE, sessionTotal;
  for (const r of history) {
    const ms = r.ms;
    if (dayOfMs(ms) !== day) { day = dayOfMs(ms); calendarDay = day >= calendarStart ? get(calendar, day) : null; dayTotal = null; activeDays.add(day); }
    if (calendarDay) add(calendarDay, r, includeCache);
    if (day === today) add(todayTotal, r, includeCache);
    if (day < start || day > end) continue;
    efficiency.add(r);
    add(totals, r, includeCache); add(dayTotal ??= get(days, day), r, includeCache);
    if (r.model !== model) { model = r.model; modelTotal = get(models, model); }
    add(modelTotal, r, includeCache);
    if (r.project !== project) { project = r.project; projectTotal = get(projects, project); projectSessions = sessionsByProject.get(project); if (!projectSessions) sessionsByProject.set(project, projectSessions = new Map()); sessionId = NONE; }
    add(projectTotal, r, includeCache);
    if (r.sessionId !== sessionId) {
      sessionId = r.sessionId; sessionTotal = projectSessions.get(sessionId);
      if (!sessionTotal) projectSessions.set(sessionId, sessionTotal = get(sessions, JSON.stringify([project, sessionId])));
    }
    add(sessionTotal, r, includeCache);
    const date = new Date(ms);
    rhythm[date.getDay() * 24 + date.getHours()] += knownTokens(r, includeCache);
  }
  const ranked = map => [...map].map(([name, b]) => ({ name, ...finish(b) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let current = 0;
  for (let d = activeDays.has(today) ? today : today - 1; activeDays.has(d); d--) current++;
  const activityStart = q.range === 'all' ? -Infinity : start;
  const promptCredits = summarizePromptCredits(activity.promptEvents, records, { ...input, models: q.models }, activityStart, end, now,
    activity.cache ? { memo: activity.cache, unique: activity.cache.uniquePromptEvents === true } : undefined);
  const { projectPrompts, modelPrompts, sessionPrompts, conversations, ...promptSummary } = promptCredits;
  const promptCounts = new Map(projectPrompts.map(p => [p.name, p]));
  const modelCounts = new Map(modelPrompts.map(p => [p.name, p]));
  const sessionCounts = new Map(sessionPrompts.map(p => [JSON.stringify([p.project, p.id]), p]));
  const withPrompts = rows => rows.map(row => {
    const p = promptCounts.get(row.name);
    return { ...row, ...promptCountFields(p) };
  });
  // Choice lists ignore their own filter, so other choices remain available after selection.
  const modelChoices = new Map(), projectChoices = new Map(), modelOptions = new Set(), projectOptionSet = new Set(), copilotSessions = new Set();
  const models_ = q.models, projectFilter = input.project, sessionFilter = input.session;
  model = project = NONE;
  let modelChoice, projectChoice, modelWanted = true, optionModel = NONE, optionProject = NONE, optionSession = NONE;
  for (const r of records) {
    if (r.model !== optionModel) modelOptions.add(optionModel = r.model);
    if (r.project !== optionProject) projectOptionSet.add(optionProject = r.project);
    if (r.ms <= nowMs && r.sessionId !== optionSession) copilotSessions.add(optionSession = r.sessionId);
    if (r.ms > nowMs || sessionFilter && r.sessionId !== sessionFilter) continue;
    const recordDay = dayOfMs(r.ms);
    if (recordDay < activityStart || recordDay > end) continue;
    if (r.model !== model) { model = r.model; modelChoice = null; modelWanted = !models_ || models_.includes(model); }
    if (r.project !== project) { project = r.project; projectChoice = null; }
    if (!projectFilter || project === projectFilter) add(modelChoice ??= get(modelChoices, model), r, includeCache);
    if (modelWanted) add(projectChoice ??= get(projectChoices, project), r, includeCache);
  }
  for (const p of projectPrompts) if (p.count) get(projectChoices, p.name);
  const { projectOptions, ...skills } = skillReport(copilotSessions, activity, input, activityStart, end, now);
  const { projectOptions: toolProjects, ...tools } = toolReport(records, copilotSessions, activity, { ...input, models: q.models }, activityStart, end, now);
  for (const name of projectOptions) projectOptionSet.add(name);
  for (const name of toolProjects) projectOptionSet.add(name);
  for (const name of projectChoices.keys()) projectOptionSet.add(name);
  return {
    coverageDetails: summarizeCoverage(activity.coverageEntries, activity.sources, { ...input, models: q.models }, activityStart, end, now),
    generatedAt: now.toISOString(), query: q, totals: finish(totals), today: finish(todayTotal), streak: { current },
    daily: Array.from({ length: end - start + 1 }, (_, i) => ({ day: dayKey(start + i), ...finish(days.get(start + i) ?? bucket()) })),
    calendar: Array.from({ length: 182 }, (_, i) => ({ day: dayKey(calendarStart + i), ...finish(calendar.get(calendarStart + i) ?? bucket()) })),
    rhythm, models: ranked(models).map(row => ({ ...row, ...promptCountFields(modelCounts.get(row.name)) })), projects: withPrompts(ranked(projects)), usageChoices: { models: ranked(modelChoices), projects: withPrompts(ranked(projectChoices)) }, sessions: ranked(sessions).map(s => {
      const [project, id] = JSON.parse(s.name);
      return { ...s, project, id, name: sessionLabels.get(id), ...promptCountFields(sessionCounts.get(s.name)) };
    }),
    skills, tools, mcp: mcpHistory(tools), promptCredits: promptSummary,
    efficiency: { ...efficiency.finish(sessionLabels), switches: summarizeModelChanges(records, activity, input, activityStart, end, now), conversations, interactions: summarizeInteractions(records, activity, { ...input, models: q.models }, activityStart, end, now, copilotSessions) },
    options: { environments, models: [...modelOptions].sort(), projects: [...projectOptionSet].sort(), sessions: [...sessionLabels].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) },
  };
}
