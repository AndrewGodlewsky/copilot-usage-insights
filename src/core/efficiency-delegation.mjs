// Delegated work: where recorded subagent calls happen. A request topic (see efficiency-topics.mjs).
// A subagent call is a model call whose initiator is exactly 'sub-agent'. 'user' and 'agent' calls
// are the main conversation. Any other initiator is not recorded: it stays in the totals and is
// never guessed onto either side. Parent links are not followed.
import { isCompleteCharge, createNanoTotal, bucketTrend } from './stats.mjs';

const TOP = 5, SERIES_POINTS = 62;
const tally = () => ({ requests: 0, main: 0, delegated: 0, mainCreditCalls: 0, mainNano: createNanoTotal(), delegatedCreditCalls: 0, delegatedNano: createNanoTotal(), project: null });
const find = (map, key, make = tally) => { let found = map.get(key); if (!found) map.set(key, found = make()); return found; };
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

// One point per day that has calls, or per week (counted from the first day) over a longer span,
// as the efficiency trend does. Only the latest periods are kept, so the series stays small.
function finishSeries(days) {
  return bucketTrend(days, {
    maxPoints: SERIES_POINTS,
    create: () => ({ requests: 0, delegated: 0 }),
    merge: (point, counts) => { point.requests += counts.requests; point.delegated += counts.delegated; },
    finish: (day, point) => ({ day, requests: point.requests, delegated: point.delegated }),
  });
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
      if (side) {
        total[side]++; session[side]++; modelTally[side]++;
        if (isCompleteCharge(r)) {
          const countKey = `${side}CreditCalls`, nanoKey = `${side}Nano`;
          total[countKey]++; total[nanoKey].add(r.nanoAiu);
          session[countKey]++; session[nanoKey].add(r.nanoAiu);
          modelTally[countKey]++; modelTally[nanoKey].add(r.nanoAiu);
        }
      }
      // A call with no usable time still counts everywhere else; it has no place on the series.
      if (!Number.isFinite(day)) return;
      if (day !== seriesDay) dayTally = find(days, seriesDay = day, () => ({ requests: 0, delegated: 0 }));
      dayTally.requests++;
      if (side === 'delegated') dayTally.delegated++;
    },
    finish() {
      const delegating = [];
      for (const [id, counts] of sessions) if (counts.delegated) {
        delegating.push({
          id, project: counts.project || '', name: sessionLabels?.get(id) || 'Unnamed session',
          requests: counts.requests, delegated: counts.delegated,
          delegatedCreditCalls: counts.delegatedCreditCalls,
          delegatedCredits: counts.delegatedCreditCalls ? counts.delegatedNano.credits() : null,
        });
      }
      delegating.sort((a, b) => b.delegated - a.delegated || b.requests - a.requests || byName(a, b) || String(a.id).localeCompare(String(b.id)));
      // The model mix lists the five models with the most subagent calls and the five with the
      // most main-conversation calls. Every other model is summed, so the shares still add up.
      const mix = [];
      for (const [name, counts] of models) if (counts.main || counts.delegated) {
        mix.push({
          name, mainRequests: counts.main, delegatedRequests: counts.delegated,
          mainCreditCalls: counts.mainCreditCalls, mainCredits: counts.mainCreditCalls ? counts.mainNano.credits() : null,
          delegatedCreditCalls: counts.delegatedCreditCalls, delegatedCredits: counts.delegatedCreditCalls ? counts.delegatedNano.credits() : null,
        });
      }
      const leading = field => mix.filter(row => row[field] > 0).sort((a, b) => b[field] - a[field] || byName(a, b)).slice(0, TOP);
      const listed = new Set([...leading('delegatedRequests'), ...leading('mainRequests')]);
      const otherModels = { models: 0, mainRequests: 0, delegatedRequests: 0 };
      for (const row of mix) if (!listed.has(row)) { otherModels.models++; otherModels.mainRequests += row.mainRequests; otherModels.delegatedRequests += row.delegatedRequests; }
      return {
        requests: total.requests, mainRequests: total.main, delegatedRequests: total.delegated,
        mainCreditCalls: total.mainCreditCalls, mainCredits: total.mainCreditCalls ? total.mainNano.credits() : null,
        delegatedCreditCalls: total.delegatedCreditCalls, delegatedCredits: total.delegatedCreditCalls ? total.delegatedNano.credits() : null,
        conversations: sessions.size, delegatedConversations: delegating.length,
        topConversations: delegating.slice(0, TOP).map(({ id, project, name, requests, delegated, delegatedCreditCalls, delegatedCredits }) =>
          ({ id, project, name, requests, delegated, share: delegated / requests * 100, delegatedCreditCalls, delegatedCredits })),
        models: [...listed].sort((a, b) => b.delegatedRequests - a.delegatedRequests || b.mainRequests - a.mainRequests || byName(a, b)), otherModels,
        series: finishSeries(days),
      };
    },
  };
}
