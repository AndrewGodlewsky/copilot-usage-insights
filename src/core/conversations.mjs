import { dayOfMs, dayKey } from './query.mjs';

const bins = labels => labels.map(label => ({ label, count: 0 }));
const depthBin = count => count === 1 ? 0 : count <= 5 ? 1 : count <= 15 ? 2 : 3;
function histogramMedian(histogram) {
  const count = [...histogram.values()].reduce((a, b) => a + b, 0);
  if (!count) return null;
  let seen = 0, lower, upper;
  for (const [value, n] of [...histogram].sort((a, b) => a[0] - b[0])) {
    seen += n;
    if (lower === undefined && seen > Math.floor((count - 1) / 2)) lower = value;
    if (seen > Math.floor(count / 2)) { upper = value; break; }
  }
  return (lower + upper) / 2;
}
// Human submissions and financial attribution have different certainty requirements.
export const confirmedHuman = prompt => prompt.humanDelivery === true || prompt.humanDelivery === undefined && prompt.identity;

function conversationWindow(start, end, examples) {
  const sessions = new Map(), stopSessions = new Set(), callCounts = new Map();
  const promptWork = { prompts: 0, totalPrompts: 0, calls: 0, medianCalls: null, averageCalls: null,
    distribution: bins(['1 call', '2–5 calls', '6–15 calls', '16+ calls']) };
  let userStops = 0;
  const session = id => {
    if (!sessions.has(id)) sessions.set(id, { active: false, prompts: 0, deliveryPrompts: 0, unconfirmedDelivery: 0, uncertain: 0, complete: 0, calls: 0, days: new Set(), prior: false,
      delivery: { idle: 0, steering: 0, queued: 0, unknown: 0 }, events: [], eventCount: 0, latest: -Infinity, workBins: [0, 0, 0, 0] });
    return sessions.get(id);
  };
  const remember = (s, ms, event) => {
    if (!examples || !Number.isFinite(ms)) return;
    s.latest = Math.max(s.latest, ms); s.eventCount++;
    if (s.events.length < 16) s.events.push({ ms, ...event });
  };
  return {
    record(record, day) { if (day >= start && day <= end) session(record.sessionId).active = true; },
    stop(item) {
      if (item.day < start || item.day > end) return;
      userStops++; stopSessions.add(item.sessionId);
      remember(session(item.sessionId), item.ms, { kind: 'stop' });
    },
    add(prompt, complete) {
      if (prompt.day > end) return;
      if (!examples && prompt.day < start) return;
      const s = session(prompt.sessionId), human = confirmedHuman(prompt);
      if (prompt.day < start) { if (human) s.prior = true; return; }
      s.active = true;
      if (prompt.humanDelivery) {
        s.deliveryPrompts++; s.delivery[['idle', 'steering', 'queued'].includes(prompt.delivery) ? prompt.delivery : 'unknown']++;
      } else s.unconfirmedDelivery++;
      if (!human) { s.uncertain++; return; }
      promptWork.totalPrompts++;
      s.prompts++; s.days.add(prompt.day);
      const calls = complete ? prompt.charges.length : null;
      remember(s, prompt.sample?.ms, { kind: 'prompt', delivery: prompt.delivery || 'unknown', calls });
      if (complete) {
        s.complete++; s.calls += calls; s.workBins[depthBin(calls)]++;
        promptWork.prompts++; promptWork.calls += calls; promptWork.distribution[depthBin(calls)].count++;
        callCounts.set(calls, (callCounts.get(calls) || 0) + 1);
      }
    },
    finish() {
      const result = { windowed: Number.isFinite(start), sessions: 0, countedSessions: 0, uncertainSessions: 0, withoutPrompts: 0, prompts: 0,
        medianPrompts: null, averagePrompts: null, multiDaySessions: 0, priorSessions: 0,
        distribution: bins(['1 prompt', '2–5 prompts', '6–15 prompts', '16+ prompts']),
        dayDistribution: bins(['1 day', '2–3 days', '4+ days']),
        workSessions: 0, workPrompts: 0, modelCalls: 0, averageCallsPerPrompt: null,
        workMatrix: Array.from({ length: 3 }, () => [0, 0, 0]),
        promptWork: { ...promptWork, medianCalls: histogramMedian(callCounts), averageCalls: promptWork.prompts ? promptWork.calls / promptWork.prompts : null },
        steering: { sessions: 0, topSessions: 0, topMessages: 0 },
        delivery: { idle: 0, steering: 0, queued: 0, unknown: 0, known: 0, prompts: 0, sessions: 0, unconfirmedPrompts: 0,
          classifiedSessions: 0, steeredSessions: 0, averageSteering: null, userStops, stopSessions: stopSessions.size } };
      const delivery = result.delivery, counts = new Map(), steering = [], recent = [];
      let classifiedSteering = 0, exampleCount = 0;
      for (const s of sessions.values()) {
        if (!s.active) continue;
        result.sessions++;
        if (examples && s.events.length) {
          exampleCount++; recent.push(s); recent.sort((a, b) => b.latest - a.latest);
          if (recent.length > 8) recent.pop();
        }
        if (s.delivery.steering) {
          result.steering.sessions++;
          steering.push(s.delivery.steering); steering.sort((a, b) => b - a); if (steering.length > 3) steering.pop();
        }
        delivery.unconfirmedPrompts += s.unconfirmedDelivery;
        if (s.deliveryPrompts) {
          delivery.sessions++; delivery.prompts += s.deliveryPrompts;
          for (const key of ['idle', 'steering', 'queued', 'unknown']) delivery[key] += s.delivery[key];
          if (!s.delivery.unknown && !s.unconfirmedDelivery) {
            delivery.classifiedSessions++; delivery.steeredSessions += Number(s.delivery.steering > 0);
            classifiedSteering += s.delivery.steering;
          }
        }
        if (s.uncertain) { result.uncertainSessions++; continue; }
        if (!s.prompts) { result.withoutPrompts++; continue; }
        result.countedSessions++; result.prompts += s.prompts; counts.set(s.prompts, (counts.get(s.prompts) || 0) + 1);
        result.multiDaySessions += Number(s.days.size > 1); result.priorSessions += Number(s.prior);
        result.distribution[depthBin(s.prompts)].count++;
        result.dayDistribution[s.days.size === 1 ? 0 : s.days.size <= 3 ? 1 : 2].count++;
        if (s.complete !== s.prompts) continue;
        result.workSessions++; result.workPrompts += s.prompts; result.modelCalls += s.calls;
        const calls = s.calls / s.prompts;
        result.workMatrix[calls <= 1 ? 0 : calls <= 5 ? 1 : 2][s.prompts === 1 ? 0 : s.prompts <= 5 ? 1 : 2]++;
      }
      result.medianPrompts = histogramMedian(counts);
      if (result.countedSessions) result.averagePrompts = result.prompts / result.countedSessions;
      if (result.workPrompts) result.averageCallsPerPrompt = result.modelCalls / result.workPrompts;
      delivery.known = delivery.idle + delivery.steering + delivery.queued;
      if (delivery.classifiedSessions) delivery.averageSteering = classifiedSteering / delivery.classifiedSessions;
      result.steering.topSessions = steering.length; result.steering.topMessages = steering.reduce((a, b) => a + b, 0);
      if (examples) {
        result.examples = recent.map((s, index) => ({ index, prompts: s.prompts, days: s.days.size, uncertain: !!s.uncertain,
          delivery: { ...s.delivery }, workBins: s.workBins.slice(), events: s.events.slice().sort((a, b) => a.ms - b.ms), eventsOmitted: s.eventCount - s.events.length }));
        result.examplesOmitted = exampleCount - recent.length;
      }
      return result;
    },
  };
}

// Both periods consume the existing attributed stream; no second journal read or attribution pass.
export function createConversationAccumulator(records, query, start, end, now) {
  if (query.models) return { add() {}, stop() {}, finish: () => ({ reason: 'model-filter' }) };
  const current = conversationWindow(start, end, true);
  const previousStart = start - (end - start + 1), previous = Number.isFinite(start) ? conversationWindow(previousStart, start - 1, false) : null;
  const matches = item => (!query.project || item.project === query.project) && (!query.session || item.sessionId === query.session);
  for (const record of records) if (record.ms <= now.getTime() && matches(record)) {
    const day = dayOfMs(record.ms); current.record(record, day); previous?.record(record, day);
  }
  return {
    add(prompt, complete) { if (prompt.provider && matches(prompt)) { current.add(prompt, complete); previous?.add(prompt, complete); } },
    stop(item) { if (matches(item)) { current.stop(item); previous?.stop(item); } },
    finish() {
      const result = current.finish();
      result.comparison = previous ? { startDate: dayKey(previousStart), endDate: dayKey(start - 1), previous: previous.finish() } : null;
      return result;
    },
  };
}
