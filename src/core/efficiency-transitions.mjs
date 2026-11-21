import { dayOfMs } from './query.mjs';
import { middle, firstAfter } from './efficiency-compaction.mjs';

const known = value => Number.isFinite(value) && value >= 0;
const SOURCES = ['model_picker', 'sdk', 'agent', 'startup', 'unknown'];
const top = (map, build) => [...map.values()].sort((a, b) => b.count - a.count || (a.from + a.to < b.from + b.to ? -1 : 1)).slice(0, 5).map(build);

// What changes in the recorded model and effort settings: which pairs, how each change was
// made, how many conversations used more than one model, which conversations changed most, and
// the main-conversation call just before and just after each model change.
// Calls are kept (as four numbers each) only for conversations that have a model change.
export function createTransitionsTopic({ query = {}, start = -Infinity, end = Infinity, now = new Date(), sessionLabels = new Map(), activity = {}, records = [] } = {}) {
  const nowMs = now.getTime(), NONE = Symbol('none'), modelFiltered = !!query.models;
  const bySession = new Map(), seen = new Set();
  for (const e of activity.modelChanges || []) {
    if (seen.has(e.key) || !(e.ms <= nowMs)) continue;
    seen.add(e.key);
    const day = dayOfMs(e.ms);
    if (day < start || day > end || query.project && query.project !== e.project || query.session && query.session !== e.sessionId) continue;
    let session = bySession.get(e.sessionId);
    if (!session) bySession.set(e.sessionId, session = { events: [], times: [], input: [], cacheRead: [], model: [], used: false });
    session.events.push(e);
  }
  const chooser = { calls: 0, automatic: 0, selected: 0, unrecorded: 0 };
  const flags = new Map(), names = new Map(), seenModels = new Set();
  let multi = 0, mainSessions = 0, lastSession = NONE, current, flag;
  return {
    add(r) {
      chooser.calls++;
      if (r.isAuto === true) chooser.automatic++; else if (r.isAuto === false) chooser.selected++; else chooser.unrecorded++;
      const model = r.modelId || r.model || '';
      if (model) { seenModels.add(model); if (r.model) seenModels.add(r.model); }
      if (r.sessionId !== lastSession) { lastSession = r.sessionId; current = bySession.get(lastSession); flag = flags.get(lastSession); }
      if (current) current.used = true;
      // Subagent calls run in their own context and cannot be ordered with the main conversation.
      if (r.origin === 'compaction' || r.initiator !== 'user' && r.initiator !== 'agent' || !model) return;
      if (!flag) {
        flags.set(lastSession, flag = { first: model, several: false }); mainSessions++;
      } else if (!flag.several && flag.first !== model) { flag.several = true; multi++; }
      if (!current || !Number.isFinite(r.ms)) return;
      let code = names.get(model);
      if (code === undefined) names.set(model, code = names.size);
      current.times.push(r.ms); current.model.push(code);
      current.input.push(known(r.inputTotal) ? r.inputTotal : -1);
      current.cacheRead.push(r.cacheDetailsReported !== false && known(r.inputTotal) && known(r.cacheRead) && known(r.cacheWrite) && r.cacheRead + r.cacheWrite <= r.inputTotal ? r.cacheRead : -1);
    },
    finish() {
      const excluded = new Set(activity.skillExcludedSessions || []), unresolved = new Set();
      for (const [id, session] of bySession) if (!session.used && !excluded.has(id) && !modelFiltered) unresolved.add(id);
      if (unresolved.size) {
        let last = NONE, pending = false, left = unresolved.size;
        for (const r of records) {
          if (r.sessionId !== last) { last = r.sessionId; pending = unresolved.has(last); }
          if (!pending || !(r.ms <= nowMs)) continue;
          unresolved.delete(last); pending = false;
          if (!--left) break;
        }
      }
      const wanted = model => !modelFiltered || seenModels.has(model);
      const result = { events: 0, sessions: 0, modelChanges: 0, effortChanges: 0, omitted: 0 };
      const sources = new Map(SOURCES.map(id => [id, 0])), modelPairs = new Map(), effortPairs = new Map(), rows = [];
      const inputBefore = [], inputAfter = [], inputChange = [], cacheBefore = [], cacheAfter = [];
      let paired = 0, sameModel = 0, lower = 0;
      for (const [id, session] of bySession) {
        if (!session.used && modelFiltered) continue;
        const events = session.events.filter(e => !modelFiltered || wanted(e.fromModel) || wanted(e.toModel));
        if (!events.length) continue;
        if (excluded.has(id) || unresolved.has(id)) { result.omitted += events.length; continue; }
        events.sort((a, b) => a.ms - b.ms || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        result.events += events.length; result.sessions++;
        let modelCount = 0, effortCount = 0;
        for (const e of events) {
          sources.set(e.source, (sources.get(e.source) || 0) + 1);
          if (e.modelChanged) {
            modelCount++;
            const key = JSON.stringify([e.fromModel, e.toModel]);
            let pair = modelPairs.get(key);
            if (!pair) modelPairs.set(key, pair = { from: e.fromModel, to: e.toModel, count: 0 });
            pair.count++;
          }
          if (e.effortChanged) {
            effortCount++;
            const key = JSON.stringify([e.fromEffort, e.toEffort]);
            let pair = effortPairs.get(key);
            if (!pair) effortPairs.set(key, pair = { from: e.fromEffort, to: e.toEffort, count: 0 });
            pair.count++;
          }
        }
        result.modelChanges += modelCount; result.effortChanges += effortCount;
        rows.push({ id, modelChanges: modelCount, effortChanges: effortCount });
        // Pair the last main call before a model change with the first one after it. With a model
        // filter the calls kept are only the selected models', so neighbours cannot be trusted.
        const { times, input, cacheRead, model } = session, calls = times.length;
        if (modelFiltered || !calls || !modelCount) continue;
        const order = Array.from(times.keys()).sort((a, b) => times[a] - times[b] || a - b);
        let previous = -1;
        for (const e of events) {
          if (!e.modelChanged) continue;
          const first = firstAfter(order, times, e.ms);
          if (first <= 0 || first >= calls || first === previous) continue;
          previous = first;
          const was = order[first - 1], next = order[first];
          if (model[was] === model[next]) { sameModel++; continue; }
          if (input[was] <= 0 || input[next] < 0) continue;
          paired++; inputBefore.push(input[was]); inputAfter.push(input[next]); inputChange.push((input[was] - input[next]) / input[was] * 100);
          if (cacheRead[was] >= 0 && cacheRead[next] >= 0 && input[next] > 0) {
            const before = cacheRead[was] / input[was] * 100, after = cacheRead[next] / input[next] * 100;
            cacheBefore.push(before); cacheAfter.push(after);
            if (after < before) lower++;
          }
        }
      }
      const name = id => sessionLabels.get(id) || 'Unnamed session';
      return { ...result, modelFiltered,
        sources: SOURCES.map(id => ({ id, count: sources.get(id) })).filter(row => row.count),
        modelPairsTotal: modelPairs.size, effortPairsTotal: effortPairs.size,
        models: top(modelPairs, ({ from, to, count }) => ({ from, to, count })),
        efforts: top(effortPairs, ({ from, to, count }) => ({ from, to, count })),
        usage: { sessions: modelFiltered ? null : mainSessions, severalModels: modelFiltered ? null : multi },
        chooser: { ...chooser },
        next: { paired, sameModel, inputBefore: middle(inputBefore), inputAfter: middle(inputAfter), change: middle(inputChange),
          cachePairs: cacheBefore.length, cacheBefore: middle(cacheBefore), cacheAfter: middle(cacheAfter), lower },
        conversations: rows.map(row => ({ ...row, name: name(row.id) }))
          .sort((a, b) => b.modelChanges + b.effortChanges - a.modelChanges - a.effortChanges || b.modelChanges - a.modelChanges || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .slice(0, 5).map(({ id, ...row }) => row) };
    },
  };
}
