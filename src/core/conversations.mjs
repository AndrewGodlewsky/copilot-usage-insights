import { dayOfMs } from './query.mjs';

// Consumes already-deduplicated, attributed prompts. No message text or session IDs leave this summary.
export function createConversationAccumulator(records, query, start, end, now) {
  if (query.models) return { add() {}, stop() {}, finish: () => ({ reason: 'model-filter' }) };
  const sessions = new Map(), stopSessions = new Set();
  let userStops = 0;
  const matches = item => (!query.project || item.project === query.project) && (!query.session || item.sessionId === query.session);
  const session = id => {
    if (!sessions.has(id)) sessions.set(id, { active: false, prompts: 0, uncertain: 0, complete: 0, calls: 0, days: new Set(), prior: false,
      delivery: { idle: 0, steering: 0, queued: 0, unknown: 0 } });
    return sessions.get(id);
  };
  for (const record of records) if (record.ms <= now.getTime() && matches(record)) {
    const day = dayOfMs(record.ms);
    if (day >= start && day <= end) session(record.sessionId).active = true;
  }
  return {
    stop(item) {
      if (!matches(item) || item.day < start || item.day > end) return;
      userStops++; stopSessions.add(item.sessionId);
    },
    add(prompt, complete) {
      if (!prompt.provider || !matches(prompt) || prompt.day > end) return;
      const s = session(prompt.sessionId);
      if (prompt.day < start) { if (prompt.identity) s.prior = true; return; }
      s.active = true;
      if (!prompt.identity) { s.uncertain++; return; }
      s.prompts++; s.days.add(prompt.day);
      s.delivery[['idle', 'steering', 'queued'].includes(prompt.delivery) ? prompt.delivery : 'unknown']++;
      if (complete) { s.complete++; s.calls += prompt.charges.length; }
    },
    finish() {
      const result = { windowed: Number.isFinite(start), sessions: 0, countedSessions: 0, uncertainSessions: 0, withoutPrompts: 0, prompts: 0,
        medianPrompts: null, averagePrompts: null, multiDaySessions: 0, priorSessions: 0,
        distribution: ['1 prompt', '2–5 prompts', '6–15 prompts', '16+ prompts'].map(label => ({ label, count: 0 })),
        workSessions: 0, workPrompts: 0, modelCalls: 0, averageCallsPerPrompt: null,
        workMatrix: Array.from({ length: 3 }, () => [0, 0, 0]),
        delivery: { idle: 0, steering: 0, queued: 0, unknown: 0, known: 0, classifiedSessions: 0, steeredSessions: 0, averageSteering: null, userStops, stopSessions: stopSessions.size } };
      const delivery = result.delivery;
      let classifiedSteering = 0;
      const counts = [];
      for (const s of sessions.values()) {
        if (!s.active) continue;
        result.sessions++;
        if (s.uncertain) { result.uncertainSessions++; continue; }
        if (!s.prompts) { result.withoutPrompts++; continue; }
        result.countedSessions++; result.prompts += s.prompts; counts.push(s.prompts);
        for (const key of ['idle', 'steering', 'queued', 'unknown']) delivery[key] += s.delivery[key];
        if (!s.delivery.unknown) {
          delivery.classifiedSessions++; delivery.steeredSessions += Number(s.delivery.steering > 0);
          classifiedSteering += s.delivery.steering;
        }
        result.multiDaySessions += Number(s.days.size > 1); result.priorSessions += Number(s.prior);
        result.distribution[s.prompts === 1 ? 0 : s.prompts <= 5 ? 1 : s.prompts <= 15 ? 2 : 3].count++;
        if (s.complete !== s.prompts) continue;
        result.workSessions++; result.workPrompts += s.prompts; result.modelCalls += s.calls;
        const calls = s.calls / s.prompts;
        result.workMatrix[calls <= 1 ? 0 : calls <= 5 ? 1 : 2][s.prompts === 1 ? 0 : s.prompts <= 5 ? 1 : 2]++;
      }
      counts.sort((a, b) => a - b);
      if (counts.length) {
        result.medianPrompts = (counts[Math.floor((counts.length - 1) / 2)] + counts[Math.floor(counts.length / 2)]) / 2;
        result.averagePrompts = result.prompts / counts.length;
      }
      if (result.workPrompts) result.averageCallsPerPrompt = result.modelCalls / result.workPrompts;
      delivery.known = delivery.idle + delivery.steering + delivery.queued;
      if (delivery.classifiedSessions) delivery.averageSteering = classifiedSteering / delivery.classifiedSessions;
      return result;
    },
  };
}
