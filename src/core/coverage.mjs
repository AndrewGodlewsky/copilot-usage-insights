import { dayOfMs, dayKey } from './query.mjs';

export const coverageTime = value => {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) && ms >= Date.UTC(2020, 0, 1) && ms < Date.UTC(2100, 0, 1) ? ms : null;
};

// Keep identities for replay detection, but never retain rejected payloads or malformed lines.
export function createCoverageCollector(source, file) {
  const entries = new Map();
  return {
    add(kind, { key = '', timestamp, sessionId = '', project = '', model = '' } = {}) {
      const ms = coverageTime(timestamp);
      const identity = key ? JSON.stringify([kind, key]) : JSON.stringify([kind, ms, sessionId, project, model]);
      const previous = entries.get(identity);
      if (previous) { if (!key) previous.count++; return; }
      entries.set(identity, { kind, key, ms, sessionId, project, model, source, file, count: 1 });
    },
    snapshot: () => [...entries.values()].map(e => ({ ...e })),
  };
}

export function mergeCoverage(entries, countedSessions = new Set()) {
  const seen = new Map(), out = [];
  for (const entry of entries) {
    if (entry.kind === 'aggregateOnly' && countedSessions.has(entry.sessionId)) continue;
    if (entry.key) {
      const key = JSON.stringify([entry.kind, entry.key]);
      const previous = seen.get(key);
      if (previous) {
        if (entry.kind === 'aggregateOnly') {
          // Copies may contain different portions of a session. Preserve the full observed span.
          previous.ms = previous.ms === null || entry.ms === null ? null : Math.min(previous.ms, entry.ms);
          previous.endMs = previous.endMs === null || entry.endMs === null ? null : Math.max(previous.endMs, entry.endMs);
        }
        continue;
      }
      const copy = { ...entry };
      seen.set(key, copy); out.push(copy); continue;
    }
    out.push(entry);
  }
  return out;
}

// Only definite matches enter the banner. Unknown dates or filter metadata stay inspectable.
export function summarizeCoverage(entries = [], sources = [], query, start, end, now) {
  const counts = {}, groups = new Map(), sourceByPath = new Map(sources.map(s => [s.path, s]));
  for (const entry of entries) {
    const environment = sourceByPath.get(entry.source)?.environment;
    const filters = [[query.environment, environment], [query.project, entry.project], [query.session, entry.sessionId]];
    if (filters.some(([wanted, value]) => wanted && value && wanted !== value)) continue;
    if (query.models?.length && entry.model && !query.models.includes(entry.model)) continue;
    const unknownFilter = filters.some(([wanted, value]) => wanted && !value) || query.models?.length > 0 && !entry.model;
    const first = entry.ms, last = entry.endMs === undefined ? first : entry.endMs;
    const dated = first !== null && last !== null;
    const outside = dated && (dayOfMs(last) < start || dayOfMs(first) > end || first > now.getTime());
    const scope = outside ? 'outside' : !dated || unknownFilter ? 'unknown' : 'current';
    if (scope === 'current') counts[entry.kind] = (counts[entry.kind] || 0) + entry.count;
    // Group by local date and file so large histories do not produce a row per rejected call.
    const from = first === null ? '' : dayKey(dayOfMs(first)), to = last === null ? '' : dayKey(dayOfMs(last));
    const key = JSON.stringify([scope, entry.kind, entry.file, from, to]);
    let group = groups.get(key);
    if (!group) groups.set(key, group = { scope, kind: entry.kind, file: entry.file || entry.source, from, to, count: 0 });
    group.count += entry.count;
  }
  const rows = [...groups.values()].sort((a, b) => a.scope.localeCompare(b.scope) || b.from.localeCompare(a.from) || a.file.localeCompare(b.file));
  const unreadable = sources.filter(s => ['error', 'warning', 'missing'].includes(s.state) && (!query.environment || s.environment === query.environment))
    .map(s => ({ file: s.path, state: s.state }));
  return { counts, rows, unreadable };
}
