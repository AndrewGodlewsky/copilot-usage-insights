import { dayOfMs } from './query.mjs';

// What Copilot records as the reason a compaction started. Anything else is kept as 'unknown'.
const triggers = new Set(['threshold', 'context_limit_retry', 'manual', 'memory_pressure', 'model_switch']);
const whole = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const known = value => Number.isFinite(value) && value >= 0;

// The activity kept for one `session.compaction_complete`: when it finished, how it ended, why it
// started, and Copilot's own counts. The summary, focus instructions, error text and checkpoint
// path on the same event are never read. `id` is the attempt ID the journal repeats on a replay.
export function compactionEvent(e, id, sessionId, project) {
  const d = e.data, ms = Date.parse(e.timestamp);
  if (!id || d === null || typeof d !== 'object' || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) return null;
  return { key: JSON.stringify(['compaction-event', sessionId, id]), sessionId, project, ms,
    success: typeof d.success === 'boolean' ? d.success : null,
    trigger: triggers.has(d.trigger) ? d.trigger : 'unknown',
    // A subagent has its own context, so its compactions say nothing about the main conversation.
    subagent: typeof e.agentId === 'string' && e.agentId !== '',
    preCompactionTokens: whole(d.preCompactionTokens), postCompactionTokens: whole(d.postCompactionTokens), tokensRemoved: whole(d.tokensRemoved),
    messagesRemoved: whole(d.messagesRemoved), preCompactionMessagesLength: whole(d.preCompactionMessagesLength), tokenLimit: whole(d.tokenLimit) };
}

// The middle value: half of the samples are at or above it and half at or below. Sorts in place.
export function middle(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const half = values.length >> 1;
  return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2;
}
// Position of the first call, in time order, recorded after `ms`.
export function firstAfter(order, times, ms) {
  let low = 0, high = order.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[order[mid]] <= ms) low = mid + 1; else high = mid;
  }
  return low;
}

// Compactions in the selected history: how many, how they ended, what Copilot says they removed,
// what the summarization calls used, and how the main conversation's calls changed around them.
// Model calls are kept only for conversations that have a compaction, as three numbers per call.
export function createCompactionTopic({ query = {}, start = -Infinity, end = Infinity, now = new Date(), sessionLabels = new Map(), activity = {}, records = [] } = {}) {
  const nowMs = now.getTime(), from = query.range === 'all' ? -Infinity : start, NONE = Symbol('none');
  const bySession = new Map(), seen = new Set();
  for (const e of activity.compactionEvents || []) {
    if (seen.has(e.key) || !(e.ms <= nowMs)) continue;
    seen.add(e.key);
    const day = dayOfMs(e.ms);
    if (day < from || day > end || query.project && query.project !== e.project || query.session && query.session !== e.sessionId) continue;
    let session = bySession.get(e.sessionId);
    if (!session) bySession.set(e.sessionId, session = { events: [], times: [], input: [], cacheRead: [], used: false });
    session.events.push(e);
  }
  const cost = { calls: 0, inputCalls: 0, inputTokens: 0, outputCalls: 0, outputTokens: 0, creditCalls: 0, durationCalls: 0 };
  let nano = 0, wide = 0n, duration = 0, lastSession = NONE, current;
  return {
    add(r) {
      if (r.sessionId !== lastSession) { lastSession = r.sessionId; current = bySession.get(lastSession); }
      if (current) current.used = true;
      if (r.origin === 'compaction') {
        cost.calls++;
        if (known(r.inputTotal)) { cost.inputCalls++; cost.inputTokens += r.inputTotal; }
        if (known(r.output)) { cost.outputCalls++; cost.outputTokens += r.output; }
        if (known(r.duration)) { cost.durationCalls++; duration += r.duration; }
        if (Number.isSafeInteger(r.nanoAiu) && r.nanoAiu >= 0 && r.creditStatus === 'complete') {
          cost.creditCalls++;
          if (nano > Number.MAX_SAFE_INTEGER - r.nanoAiu) { wide += BigInt(nano); nano = 0; }
          nano += r.nanoAiu;
        }
        return;
      }
      // Subagent calls run in their own context and cannot be ordered with the main conversation.
      if (!current || r.initiator !== 'user' && r.initiator !== 'agent' || !Number.isFinite(r.ms)) return;
      current.times.push(r.ms);
      current.input.push(known(r.inputTotal) ? r.inputTotal : -1);
      current.cacheRead.push(r.cacheDetailsReported !== false && known(r.inputTotal) && known(r.cacheRead) && known(r.cacheWrite) && r.cacheRead + r.cacheWrite <= r.inputTotal ? r.cacheRead : -1);
    },
    finish() {
      // A compaction is attributed like other activity: its session needs Copilot usage and no
      // rejected provider evidence. A session with calls in this view has that usage; any other
      // is looked up once. With a model filter, only sessions with selected-model calls remain.
      const excluded = new Set(activity.skillExcludedSessions || []), unresolved = new Set();
      for (const [id, session] of bySession) if (!session.used && !excluded.has(id) && !query.models) unresolved.add(id);
      if (unresolved.size) {
        let last = NONE, pending = false, left = unresolved.size;
        for (const r of records) {
          if (r.sessionId !== last) { last = r.sessionId; pending = unresolved.has(last); }
          if (!pending || !(r.ms <= nowMs)) continue;
          unresolved.delete(last); pending = false;
          if (!--left) break;
        }
      }
      const result = { compactions: 0, sessions: 0, succeeded: 0, failed: 0, unknownOutcome: 0, subagent: 0, omitted: 0, modelFiltered: !!query.models, repeatSessions: 0, repeatCompactions: 0 };
      const reasons = new Map(), rows = [];
      const before = [], after = [], reduction = [], fillBefore = [], fillAfter = [], messagesRemoved = [], messagesBefore = [];
      const inputBefore = [], inputAfter = [], inputChange = [], cacheBefore = [], cacheAfter = [], regainCalls = [];
      let removed = 0, larger = 0, paired = 0, smaller = 0, compactedAgain = 0, ended = 0;
      for (const [id, session] of bySession) {
        if (!session.used && query.models) continue;
        if (excluded.has(id) || unresolved.has(id)) { result.omitted += session.events.length; continue; }
        const events = session.events.filter(e => !e.subagent).sort((a, b) => a.ms - b.ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        result.subagent += session.events.length - events.length;
        if (!events.length) continue;
        result.compactions += events.length; result.sessions++;
        if (events.length > 1) { result.repeatSessions++; result.repeatCompactions += events.length; }
        let sessionRemoved = 0, sessionPairs = 0;
        for (const e of events) {
          result[e.success === true ? 'succeeded' : e.success === false ? 'failed' : 'unknownOutcome']++;
          reasons.set(e.trigger, (reasons.get(e.trigger) || 0) + 1);
          if (e.success !== true) continue;
          const pre = e.preCompactionTokens, post = e.postCompactionTokens;
          if (known(pre) && pre > 0 && known(post)) {
            before.push(pre); after.push(post); reduction.push((pre - post) / pre * 100);
            removed += pre - post; sessionRemoved += pre - post; sessionPairs++;
            if (post > pre) larger++;
            if (known(e.tokenLimit) && e.tokenLimit > 0) { fillBefore.push(pre / e.tokenLimit * 100); fillAfter.push(post / e.tokenLimit * 100); }
          }
          if (known(e.messagesRemoved) && known(e.preCompactionMessagesLength) && e.messagesRemoved <= e.preCompactionMessagesLength) {
            messagesRemoved.push(e.messagesRemoved); messagesBefore.push(e.preCompactionMessagesLength);
          }
        }
        rows.push({ id, compactions: events.length, pairs: sessionPairs, removed: sessionPairs ? sessionRemoved : null });
        // Calls between two compactions belong to the earlier one. A failed compaction changed
        // nothing, so it does not end that stretch.
        const { times, input, cacheRead } = session, calls = times.length;
        if (!calls) continue;
        const order = Array.from(times.keys()).sort((a, b) => times[a] - times[b] || a - b);
        const applied = events.filter(e => e.success !== false), at = applied.map(e => firstAfter(order, times, e.ms));
        for (let k = 0; k < applied.length; k++) {
          if (applied[k].success !== true) continue;
          const first = at[k], low = k ? at[k - 1] : 0, high = k + 1 < applied.length ? at[k + 1] : calls;
          if (first <= low || first >= high) continue;
          const was = input[order[first - 1]], next = input[order[first]];
          if (was <= 0 || next < 0) continue;
          paired++; inputBefore.push(was); inputAfter.push(next); inputChange.push((was - next) / was * 100);
          const readBefore = cacheRead[order[first - 1]], readAfter = cacheRead[order[first]];
          if (readBefore >= 0 && readAfter >= 0 && next > 0) { cacheBefore.push(readBefore / was * 100); cacheAfter.push(readAfter / next * 100); }
          if (next >= was) continue;
          smaller++;
          let reached = 0;
          for (let j = first + 1; j < high && !reached; j++) if (input[order[j]] >= was) reached = j - first + 1;
          if (reached) regainCalls.push(reached);
          else if (k + 1 < applied.length) compactedAgain++;
          else ended++;
        }
      }
      const pairs = before.length, credits = (wide ? Number(wide + BigInt(nano)) : nano) / 1e9;
      const name = id => sessionLabels.get(id) || 'Unnamed session';
      return { ...result,
        triggers: [...reasons].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
        tokens: { pairs, before: middle(before), after: middle(after), reduction: middle(reduction), removed: pairs ? removed : null, larger,
          limitPairs: fillBefore.length, fillBefore: middle(fillBefore), fillAfter: middle(fillAfter) },
        messages: { samples: messagesRemoved.length, removed: middle(messagesRemoved), before: middle(messagesBefore) },
        cost: { ...cost, credits: cost.creditCalls ? credits : null, averageDuration: cost.durationCalls ? duration / cost.durationCalls : null },
        next: { paired, inputBefore: middle(inputBefore), inputAfter: middle(inputAfter), change: middle(inputChange), smaller,
          cachePairs: cacheBefore.length, cacheBefore: middle(cacheBefore), cacheAfter: middle(cacheAfter),
          regained: regainCalls.length, regainCalls: middle(regainCalls), compactedAgain, ended },
        conversations: rows.map(row => ({ ...row, name: name(row.id) }))
          .sort((a, b) => b.compactions - a.compactions || (b.removed ?? -1) - (a.removed ?? -1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .slice(0, 5).map(({ id, ...row }) => row) };
    },
  };
}
