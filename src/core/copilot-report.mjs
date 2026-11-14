import { normalizeQuery, localDay, dayKey, parseDateDay, RANGE_DAYS } from './query.mjs';

const tokenFields = ['input', 'inputTotal', 'output', 'cacheRead', 'cacheWrite'];
const bucket = () => ({ requests: 0, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, unclassifiedInput: 0, inputTotal: 0, missing: Object.fromEntries(tokenFields.map(k => [k, 0])), missingTokens: 0, knownTokenRequests: 0, missingCache: 0, missingCredits: 0, partialCredits: 0, chargedRequests: 0, nano: 0n, sessions: new Set() });
const knownTokens = (r, includeCache) => ((includeCache ? r.inputTotal : r.input) ?? 0) + (r.output ?? 0);
function add(b, r, includeCache) {
  b.requests++; b.sessions.add(r.sessionId);
  for (const k of tokenFields) { b[k] += r[k] ?? 0; if (r[k] === null) b.missing[k]++; }
  if (r.input === null) { b.missingCache++; b.unclassifiedInput += r.inputTotal ?? 0; }
  const input = includeCache ? r.inputTotal : r.input;
  if (input === null || r.output === null) b.missingTokens++;
  if (input !== null || r.output !== null) b.knownTokenRequests++;
  b.total += knownTokens(r, includeCache);
  if (r.nanoAiu === null) b.missingCredits++;
  else { b.nano += BigInt(r.nanoAiu); b.chargedRequests++; }
  if (r.creditStatus === 'partial') b.partialCredits++;
}
function finish(b) {
  const { nano, sessions, ...rest } = b;
  return { ...rest, sessions: sessions.size, credits: b.requests && !b.chargedRequests ? null : Number(nano) / 1e9 };
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
    const key = JSON.stringify([skill.name, skill.plugin, skill.version]);
    if (!groups.has(key)) groups.set(key, { name: skill.name, plugin: skill.plugin, version: skill.version, invocations: 0, sessions: new Set(), projects: new Set(), lastUsed: skill.ts });
    const row = groups.get(key);
    row.invocations++; row.sessions.add(skill.sessionId); row.projects.add(skill.project);
    if (skill.ts > row.lastUsed) row.lastUsed = skill.ts;
    sessions.add(skill.sessionId); invocations++;
  }
  const rows = [...groups.values()].map(row => ({ ...row, sessions: row.sessions.size, projects: row.projects.size }))
    .sort((a, b) => b.invocations - a.invocations || b.lastUsed.localeCompare(a.lastUsed) || a.name.localeCompare(b.name));
  return { rows, invocations, sessions: sessions.size, omitted, projectOptions: [...projectOptions] };
}

export function buildReport(records, input = {}, now = new Date(), activity = {}) {
  const q = normalizeQuery(input, now), today = localDay(now);
  for (const name of ['project', 'session']) if (input[name] !== undefined && typeof input[name] !== 'string') throw new TypeError(`${name} must be a string`);
  const history = records.filter(r => r.ms <= now.getTime() && (!q.models || q.models.includes(r.model)) && (!input.project || r.project === input.project) && (!input.session || r.sessionId === input.session));
  const first = history.reduce((min, r) => Math.min(min, localDay(new Date(r.ms))), today);
  const start = q.range === 'custom' ? parseDateDay(q.startDate) : q.range === 'all' ? first : today - RANGE_DAYS.get(q.range) + 1;
  const end = q.range === 'custom' ? parseDateDay(q.endDate) : today;
  const totals = bucket(), todayTotal = bucket(), days = new Map(), models = new Map(), projects = new Map(), sessions = new Map();
  const calendar = new Map(), rhythm = Array(168).fill(0);
  const get = (map, key) => { if (!map.has(key)) map.set(key, bucket()); return map.get(key); };
  for (const r of history) {
    const date = new Date(r.ms), day = localDay(date);
    add(get(calendar, day), r, q.includeCache);
    if (day === today) add(todayTotal, r, q.includeCache);
    if (day < start || day > end) continue;
    add(totals, r, q.includeCache); add(get(days, day), r, q.includeCache);
    add(get(models, r.model), r, q.includeCache); add(get(projects, r.project), r, q.includeCache); add(get(sessions, r.sessionId), r, q.includeCache);
    rhythm[date.getDay() * 24 + date.getHours()] += knownTokens(r, q.includeCache);
  }
  const ranked = map => [...map].map(([name, b]) => ({ name, ...finish(b) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let current = 0;
  for (let d = calendar.has(today) ? today : today - 1; calendar.has(d); d--) current++;
  const { projectOptions, ...skills } = skillReport(records, activity, input, q.range === 'all' ? -Infinity : start, end, now);
  return {
    generatedAt: now.toISOString(), query: q, totals: finish(totals), today: finish(todayTotal), streak: { current },
    daily: Array.from({ length: end - start + 1 }, (_, i) => ({ day: dayKey(start + i), ...finish(days.get(start + i) ?? bucket()) })),
    calendar: Array.from({ length: 182 }, (_, i) => ({ day: dayKey(today - 181 + i), ...finish(calendar.get(today - 181 + i) ?? bucket()) })),
    rhythm, models: ranked(models), projects: ranked(projects), sessions: ranked(sessions),
    skills,
    options: { models: [...new Set(records.map(r => r.model))].sort(), projects: [...new Set([...records.map(r => r.project), ...projectOptions])].sort(), sessions: [...new Set(records.map(r => r.sessionId))].sort() },
  };
}
