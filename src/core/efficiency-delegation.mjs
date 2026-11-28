// Delegated work: where recorded subagent calls happen. A request topic (see efficiency-topics.mjs).
// A subagent call is a model call whose initiator is exactly 'sub-agent'. 'user' and 'agent' calls
// are the main conversation. Any other initiator is not recorded: it stays in the totals and is
// never guessed onto either side. Parent links are not followed.
import { dayKey } from './query.mjs';

const TOP = 5, SERIES_POINTS = 62;
const tally = () => ({ requests: 0, main: 0, delegated: 0, project: null });
const find = (map, key) => { let found = map.get(key); if (!found) map.set(key, found = tally()); return found; };
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

// One point per day that has calls, or per week (counted from the first day) over a longer span,
// as the efficiency trend does. Only the latest periods are kept, so the series stays small.
function finishSeries(days) {
  const ordered = [...days].sort((a, b) => a[0] - b[0]);
  if (!ordered.length) return { unit: 'day', points: [], earlier: 0 };
  const first = ordered[0][0], weekly = ordered.at(-1)[0] - first >= SERIES_POINTS, span = weekly ? 7 : 1, points = [];
  let start = null, point;
  for (const [day, counts] of ordered) {
    const bucket = first + Math.floor((day - first) / span) * span;
    if (bucket !== start) { start = bucket; points.push(point = { day: dayKey(bucket), requests: 0, delegated: 0 }); }
    point.requests += counts.requests; point.delegated += counts.delegated;
  }
  return { unit: weekly ? 'week' : 'day', points: points.slice(-SERIES_POINTS), earlier: Math.max(0, points.length - SERIES_POINTS) };
}

export function createDelegationTopic({ sessionLabels } = {}) {
  const total = tally(), sessions = new Map(), models = new Map(), days = new Map(), NONE = Symbol('none');
  // Consecutive calls usually share a session, model and day, so each tally is looked up once per run.
  let sessionId = NONE, session, model = NONE, modelTally, seriesDay = NONE, dayTally;
  return {
    add(r, day) {
      const side = r.initiator === 'sub-agent' ? 'delegated' : r.initiator === 'user' || r.initiator === 'agent' ? 'main' : null;
      if (r.sessionId !== sessionId) session = find(sessions, sessionId = r.sessionId);
      if (r.project) {
        if (session.project === null) session.project = r.project;
        else if (session.project !== r.project) session.project = '';
      }
      if (r.model !== model) modelTally = find(models, model = r.model);
      total.requests++; session.requests++;
      if (side) { total[side]++; session[side]++; modelTally[side]++; }
      // A call with no usable time still counts everywhere else; it has no place on the series.
      if (!Number.isFinite(day)) return;
      if (day !== seriesDay) dayTally = find(days, seriesDay = day);
      dayTally.requests++;
      if (side === 'delegated') dayTally.delegated++;
    },
    finish() {
      const delegating = [];
      for (const [id, counts] of sessions) if (counts.delegated) delegating.push({ id, project: counts.project || '', name: sessionLabels?.get(id) || 'Unnamed session', requests: counts.requests, delegated: counts.delegated });
      delegating.sort((a, b) => b.delegated - a.delegated || b.requests - a.requests || byName(a, b) || String(a.id).localeCompare(String(b.id)));
      // The model mix lists the five models with the most subagent calls and the five with the
      // most main-conversation calls. Every other model is summed, so the shares still add up.
      const mix = [];
      for (const [name, counts] of models) if (counts.main || counts.delegated) mix.push({ name, mainRequests: counts.main, delegatedRequests: counts.delegated });
      const leading = field => mix.filter(row => row[field] > 0).sort((a, b) => b[field] - a[field] || byName(a, b)).slice(0, TOP);
      const listed = new Set([...leading('delegatedRequests'), ...leading('mainRequests')]), otherModels = { models: 0, mainRequests: 0, delegatedRequests: 0 };
      for (const row of mix) if (!listed.has(row)) { otherModels.models++; otherModels.mainRequests += row.mainRequests; otherModels.delegatedRequests += row.delegatedRequests; }
      return { requests: total.requests, mainRequests: total.main, delegatedRequests: total.delegated,
        conversations: sessions.size, delegatedConversations: delegating.length,
        topConversations: delegating.slice(0, TOP).map(({ id, project, name, requests, delegated }) => ({ id, project, name, requests, delegated, share: delegated / requests * 100 })),
        models: [...listed].sort((a, b) => b.delegatedRequests - a.delegatedRequests || b.mainRequests - a.mainRequests || byName(a, b)), otherModels,
        series: finishSeries(days) };
    },
  };
}
