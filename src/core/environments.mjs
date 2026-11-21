export const environmentOf = record => record.environment || 'local';
export const environmentName = id => ({ windows: 'Windows', macos: 'macOS', linux: 'Linux', local: 'This computer' })[id]
  || (id.startsWith('wsl:') ? `WSL · ${id.slice(4)}` : id.startsWith('remote:') ? `Remote · ${id.slice(7)}` : id);

export function environmentOptions(records, sources = []) {
  const found = new Map();
  for (const s of sources) if (s.environment) found.set(s.environment, s.environmentName || environmentName(s.environment));
  for (const r of records) if (!found.has(environmentOf(r))) found.set(environmentOf(r), environmentName(environmentOf(r)));
  return [...found].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// Filter activity together with its receipts, before prompt grouping or any other filters.
export function selectEnvironment(records, activity, id) {
  if (!id) return { records, activity };
  let scopes = activity.cache?.environments;
  if (scopes?.records !== records || scopes?.activity !== activity) {
    scopes = { records, activity, selected: new Map() };
    if (activity.cache) activity.cache.environments = scopes;
  }
  if (scopes.selected.has(id)) return scopes.selected.get(id);
  const selected = records.filter(r => environmentOf(r) === id), sessions = new Set(selected.map(r => r.sessionId));
  const scoped = { ...activity, cache: { uniquePromptEvents: activity.cache?.uniquePromptEvents === true } };
  for (const key of ['skills', 'tools', 'interactions', 'promptEvents', 'modelChanges', 'compactionEvents']) scoped[key] = (activity[key] || []).filter(e => e.environment ? e.environment === id : sessions.has(e.sessionId));
  for (const key of ['skills', 'tools']) for (const event of scoped[key]) sessions.add(event.sessionId);
  scoped.skillExcludedSessions = (activity.skillExcludedSessions || []).filter(s => sessions.has(s));
  const result = { records: selected, activity: scoped };
  if (scopes.selected.size >= 16) scopes.selected.delete(scopes.selected.keys().next().value);
  scopes.selected.set(id, result);
  return result;
}
