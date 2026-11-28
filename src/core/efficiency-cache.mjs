// When is cached input reused? Groups main-conversation calls by what came just before them in
// the same session and reports the cache-read share of each group. It measures timing only: the
// logs do not record why input was or was not read from cache.
const CACHE_GAP_SHORT = 5 * 60_000, CACHE_GAP_LONG = 60 * 60_000;
const CACHE_SITUATIONS = ['under5', 'mid', 'over60', 'first', 'modelChange'];
// A session needs this many measured calls before it is listed.
const CACHE_SESSION_CALLS = 5, CACHE_SESSION_ROWS = 5, CACHE_STRIDE = 5;
const cacheCount = value => Number.isFinite(value) && value >= 0;
const cacheShare = (read, input) => input > 0 ? read / input * 100 : null;

export function createCacheTiming(context = {}) {
  // Five numbers per call in one flat list per session: time, model index, input (-1 when the
  // cache split is incomplete), cache read, cache write. Calls usually arrive in order, so a sort is rare.
  const sessions = new Map(), models = new Map();
  let sessionId, session, modelName, model = -1, mainCalls = 0;
  return {
    add(r) {
      // Subagent calls run in parallel and cannot be placed in one ordered conversation.
      if (r.initiator !== 'user' && r.initiator !== 'agent') return;
      mainCalls++;
      if (!Number.isFinite(r.ms) || typeof r.sessionId !== 'string' || !r.sessionId) return;
      if (r.sessionId !== sessionId) {
        sessionId = r.sessionId; session = sessions.get(sessionId);
        if (!session) sessions.set(sessionId, session = { calls: [], ordered: true, latest: -Infinity });
      }
      if (r.model !== modelName) {
        modelName = r.model; model = models.get(modelName);
        if (model === undefined) models.set(modelName, model = models.size);
      }
      // The same rule the summary uses for a complete cache split.
      const measured = r.cacheDetailsReported !== false && cacheCount(r.inputTotal) && cacheCount(r.cacheRead) && cacheCount(r.cacheWrite) && r.cacheRead + r.cacheWrite <= r.inputTotal;
      session.calls.push(r.ms, model, measured ? r.inputTotal : -1, measured ? r.cacheRead : 0, measured ? r.cacheWrite : 0);
      if (r.ms < session.latest) session.ordered = false; else session.latest = r.ms;
    },
    finish() {
      const totals = new Map(CACHE_SITUATIONS.map(id => [id, { id, calls: 0, input: 0, cacheRead: 0, cacheWrite: 0 }]));
      const top = [];
      let measuredCalls = 0, listedSessions = 0;
      for (const [id, { calls: list, ordered }] of sessions) {
        const count = list.length / CACHE_STRIDE;
        // Equal times keep the order the calls were recorded in.
        const order = ordered ? null : Array.from({ length: count }, (_, index) => index).sort((a, b) => list[a * CACHE_STRIDE] - list[b * CACHE_STRIDE] || a - b);
        let previousMs = null, previousModel = -1, calls = 0, input = 0, cacheRead = 0, cacheWrite = 0;
        for (let index = 0; index < count; index++) {
          const at = (order ? order[index] : index) * CACHE_STRIDE, ms = list[at], tokens = list[at + 2];
          if (tokens >= 0) {
            const gap = ms - previousMs;
            const total = totals.get(previousMs === null ? 'first' : list[at + 1] !== previousModel ? 'modelChange'
              : gap < CACHE_GAP_SHORT ? 'under5' : gap <= CACHE_GAP_LONG ? 'mid' : 'over60');
            total.calls++; total.input += tokens; total.cacheRead += list[at + 3]; total.cacheWrite += list[at + 4];
            calls++; input += tokens; cacheRead += list[at + 3]; cacheWrite += list[at + 4];
          }
          previousMs = ms; previousModel = list[at + 1];
        }
        measuredCalls += calls;
        if (calls < CACHE_SESSION_CALLS) continue;
        listedSessions++;
        const row = { id, calls, input, cacheRead, cacheWrite, uncached: input - cacheRead - cacheWrite, notRead: input - cacheRead };
        let place = top.length;
        while (place > 0 && (top[place - 1].notRead < row.notRead || top[place - 1].notRead === row.notRead && top[place - 1].id > id)) place--;
        if (place < CACHE_SESSION_ROWS) { top.splice(place, 0, row); if (top.length > CACHE_SESSION_ROWS) top.pop(); }
      }
      return {
        mainCalls, measuredCalls, modelFiltered: !!context.query?.models, minimumSessionCalls: CACHE_SESSION_CALLS, listedSessions,
        situations: [...totals.values()].map(total => ({ ...total, share: cacheShare(total.cacheRead, total.input) })),
        sessions: top.map(({ id, ...row }) => ({ name: context.sessionLabels?.get(id) || 'Unnamed session', ...row, share: cacheShare(row.cacheRead, row.input) })),
      };
    },
  };
}
