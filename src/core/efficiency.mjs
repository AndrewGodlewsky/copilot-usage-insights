import { dayOfMs } from './query.mjs';
import { recordedEffort } from './model-settings.mjs';

export function summarizeInteractions(records, activity, query, start, end, now, copilotSessions) {
  const result = { prompts: 0, promptSamples: 0, promptSessions: 0, averagePromptChars: null, averagePromptsPerSession: null,
    turns: 0, turnSessions: 0, averageTurnsPerSession: null, sessionErrors: 0, observedSessions: 0, omitted: 0 };
  if (query.models) return { ...result, reason: 'model-filter' };
  const nowMs = now.getTime(), excluded = new Set(activity.skillExcludedSessions || []);
  // The caller may already know which sessions have Copilot usage by now.
  let eligible = copilotSessions;
  if (!eligible) { eligible = new Set(); for (const r of records) if (r.ms <= nowMs) eligible.add(r.sessionId); }
  const promptSessions = new Set(), turnSessions = new Set(), observed = new Set(), seen = new Set();
  let chars = 0;
  for (const event of activity.interactions || []) {
    if (seen.has(event.key) || !Number.isFinite(event.ms) || event.ms > nowMs) continue;
    seen.add(event.key);
    const day = dayOfMs(event.ms);
    if (day < start || day > end || query.project && query.project !== event.project || query.session && query.session !== event.sessionId) continue;
    if (!eligible.has(event.sessionId) || excluded.has(event.sessionId)) { result.omitted++; continue; }
    observed.add(event.sessionId);
    if (event.kind === 'prompt') {
      result.prompts++; promptSessions.add(event.sessionId);
      if (Number.isSafeInteger(event.chars) && event.chars >= 0) { result.promptSamples++; chars += event.chars; }
    } else if (event.kind === 'turn') { result.turns++; turnSessions.add(event.sessionId); }
    else if (event.kind === 'error') result.sessionErrors++;
  }
  return { ...result, observedSessions: observed.size, promptSessions: promptSessions.size, turnSessions: turnSessions.size,
    averagePromptChars: result.promptSamples ? chars / result.promptSamples : null,
    averagePromptsPerSession: promptSessions.size ? result.prompts / promptSessions.size : null,
    averageTurnsPerSession: turnSessions.size ? result.turns / turnSessions.size : null };
}

const measurement = () => ({ requests: 0, inputRequests: 0, inputTokens: 0, outputRequests: 0, outputTokens: 0, cacheRequests: 0, cacheInput: 0, cacheRead: 0, cacheWrite: 0, creditRequests: 0, creditNano: 0, creditWide: 0n,
  pairedRequests: 0, pairedInput: 0, pairedOutput: 0, toolRequests: 0, toolTokens: 0, toolInput: 0, toolCountRequests: 0, availableTools: 0, reasoningRequests: 0, reasoningTokens: 0, reasoningOutput: 0 });
const known = value => Number.isFinite(value) && value >= 0;
function addMeasurement(b, r) {
  b.requests++;
  if (known(r.inputTotal)) { b.inputRequests++; b.inputTokens += r.inputTotal; }
  if (known(r.output)) { b.outputRequests++; b.outputTokens += r.output; }
  if (known(r.inputTotal) && known(r.output)) { b.pairedRequests++; b.pairedInput += r.inputTotal; b.pairedOutput += r.output; }
  if (known(r.toolTokenCount) && known(r.inputTotal) && r.toolTokenCount <= r.inputTotal) {
    b.toolRequests++; b.toolTokens += r.toolTokenCount; b.toolInput += r.inputTotal;
  }
  if (known(r.availableToolCount)) { b.toolCountRequests++; b.availableTools += r.availableToolCount; }
  if (known(r.reasoning) && known(r.output) && r.reasoning <= r.output) { b.reasoningRequests++; b.reasoningTokens += r.reasoning; b.reasoningOutput += r.output; }
  if (r.cacheDetailsReported !== false && known(r.inputTotal) && known(r.cacheRead) && known(r.cacheWrite) && r.cacheRead + r.cacheWrite <= r.inputTotal) {
    b.cacheRequests++; b.cacheInput += r.inputTotal; b.cacheRead += r.cacheRead; b.cacheWrite += r.cacheWrite;
  }
  if (Number.isSafeInteger(r.nanoAiu) && r.nanoAiu >= 0 && r.creditStatus === 'complete') {
    b.creditRequests++;
    // An exact integer total: a BigInt is involved only if the sum would leave the safe range.
    if (b.creditNano > Number.MAX_SAFE_INTEGER - r.nanoAiu) { b.creditWide += BigInt(b.creditNano); b.creditNano = 0; }
    b.creditNano += r.nanoAiu;
  }
}
function finishMeasurement(b) {
  const { creditNano, creditWide, ...rest } = b;
  const credits = (creditWide ? Number(creditWide + BigInt(creditNano)) : creditNano) / 1e9;
  return { ...rest, credits: b.creditRequests ? credits : null,
    averageInput: b.inputRequests ? b.inputTokens / b.inputRequests : null,
    averageOutput: b.outputRequests ? b.outputTokens / b.outputRequests : null,
    averageToolTokens: b.toolRequests ? b.toolTokens / b.toolRequests : null,
    averageAvailableTools: b.toolCountRequests ? b.availableTools / b.toolCountRequests : null,
    uncachedInput: b.cacheRequests ? b.cacheInput - b.cacheRead - b.cacheWrite : null,
    otherOutput: b.reasoningRequests ? b.reasoningOutput - b.reasoningTokens : null,
    reasoningShare: b.reasoningOutput > 0 ? b.reasoningTokens / b.reasoningOutput * 100 : null,
    toolShare: b.toolInput > 0 ? b.toolTokens / b.toolInput * 100 : null,
    cacheHitRate: b.cacheInput > 0 ? b.cacheRead / b.cacheInput * 100 : null,
    averageCredits: b.creditRequests ? credits / b.creditRequests : null };
}
const compareSamples = (a, b) => a.ms - b.ms || a.key.localeCompare(b.key);
const medianInput = samples => samples.map(s => s.input).sort((a, b) => a - b)[1];

// Keeps the three earliest (or latest) samples in order without sorting on every request.
function keep(list, sample, earliest) {
  if (list.length === 3 && (earliest ? compareSamples(sample, list[2]) >= 0 : compareSamples(sample, list[0]) < 0)) return;
  let at = list.length;
  while (at > 0 && compareSamples(list[at - 1], sample) > 0) at--;
  list.splice(at, 0, sample);
  if (list.length > 3) { if (earliest) list.pop(); else list.shift(); }
}

export function createEfficiencyAccumulator() {
  const total = measurement(), models = new Map(), groups = [], bySession = new Map(), NONE = Symbol('none');
  const efforts = new Map();
  let model = NONE, modelTotal, project = NONE, session = NONE, sessionGroups;
  const initiators = new Map(['user', 'agent', 'sub-agent', 'unknown'].map(id => [id, measurement()])), delegatedModels = new Map();
  return {
    add(r) {
      addMeasurement(total, r);
      if (r.model !== model) { model = r.model; modelTotal = models.get(model); if (!modelTotal) models.set(model, modelTotal = measurement()); }
      addMeasurement(modelTotal, r);
      // A display group is identifiable only if every record carries the same exact raw ID.
      const rawModelId = typeof r.modelId === 'string' && r.modelId.length <= 128 && r.modelId ? r.modelId : null;
      if (modelTotal.requests === 1) modelTotal.modelId = rawModelId;
      else if (modelTotal.modelId !== rawModelId) modelTotal.modelId = null;
      const effort = recordedEffort(r.effort), effortKey = JSON.stringify([r.model, effort]);
      if (!efforts.has(effortKey)) efforts.set(effortKey, { name: r.model, effort, ...measurement(), durationRequests: 0, durationTotal: 0 });
      const effortTotal = efforts.get(effortKey);
      addMeasurement(effortTotal, r);
      if (known(r.duration)) { effortTotal.durationRequests++; effortTotal.durationTotal += r.duration; }
      addMeasurement(initiators.get(initiators.has(r.initiator) ? r.initiator : 'unknown'), r);
      if (r.initiator === 'sub-agent') {
        if (!delegatedModels.has(r.model)) delegatedModels.set(r.model, measurement());
        addMeasurement(delegatedModels.get(r.model), r);
      }
      // Parallel subagents cannot be reliably ordered as one growing conversation.
      if (!['user', 'agent'].includes(r.initiator)) return;
      // One group per (project, session, model, initiator), listed in the order each first appeared.
      if (r.project !== project || r.sessionId !== session) {
        project = r.project; session = r.sessionId;
        const key = JSON.stringify([project, session]);
        sessionGroups = bySession.get(key);
        if (!sessionGroups) bySession.set(key, sessionGroups = new Map());
      }
      let byInitiator = sessionGroups.get(r.model);
      if (!byInitiator) sessionGroups.set(r.model, byInitiator = { user: null, agent: null });
      let group = byInitiator[r.initiator];
      if (!group) groups.push(group = byInitiator[r.initiator] = { project: r.project, session: r.sessionId, model: r.model, initiator: r.initiator, requests: 0, inputRequests: 0, first: [], last: [] });
      group.requests++;
      if (!known(r.inputTotal) || !Number.isFinite(r.ms)) return;
      group.inputRequests++;
      const sample = { key: r.key, ms: r.ms, input: r.inputTotal };
      keep(group.first, sample, true); keep(group.last, sample, false);
    },
    finish(sessionLabels = new Map()) {
      const summary = finishMeasurement(total);
      const rows = [...models].map(([name, b]) => ({ name, ...finishMeasurement(b) }))
        .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
      const insights = [];
      let growth;
      for (const g of groups) {
        if (g.inputRequests < 6 || g.inputRequests / g.requests < .8 || g.first[2].ms >= g.last[0].ms) continue;
        const early = medianInput(g.first), late = medianInput(g.last), increase = late - early;
        if (early <= 0 || late < early * 2 || increase < 10000) continue;
        if (!growth || increase > growth.increase) growth = { kind: 'growth', model: g.model, project: g.project, session: g.session,
          sessionName: sessionLabels.get(g.session) || 'Unnamed session', initiator: g.initiator, early, late, increase, multiple: late / early, samples: g.inputRequests, requests: g.requests };
      }
      if (growth) insights.push(growth);
      const toolHeavy = rows.filter(r => r.toolRequests >= 5 && r.toolRequests / r.requests >= .8 && r.toolShare >= 10 && r.averageToolTokens >= 1000)
        .sort((a, b) => b.toolTokens - a.toolTokens || a.name.localeCompare(b.name))[0];
      if (toolHeavy) insights.push({ kind: 'tools', model: toolHeavy.name, average: toolHeavy.averageToolTokens, share: toolHeavy.toolShare, samples: toolHeavy.toolRequests, requests: toolHeavy.requests });
      const lowCache = rows.filter(r => r.cacheRequests >= 5 && r.cacheRequests / r.requests >= .8 && r.cacheInput >= 50000 && r.cacheHitRate < 50)
        .sort((a, b) => (b.cacheInput - b.cacheRead) - (a.cacheInput - a.cacheRead) || a.name.localeCompare(b.name))[0];
      if (lowCache) insights.push({ kind: 'cache', model: lowCache.name, rate: lowCache.cacheHitRate, input: lowCache.cacheInput, cached: lowCache.cacheRead, samples: lowCache.cacheRequests, requests: lowCache.requests });
      const charged = rows.filter(r => r.creditRequests >= 5).sort((a, b) => b.credits - a.credits || a.name.localeCompare(b.name));
      if (charged.length >= 2 && summary.creditRequests / summary.requests >= .8 && summary.credits > 0 && charged[0].credits / summary.credits >= .6) {
        const row = charged[0];
        insights.push({ kind: 'spend', model: row.name, credits: row.credits, share: row.credits / summary.credits * 100, samples: summary.creditRequests, requests: summary.requests });
      }
      return { summary, models: rows, insights,
        efforts: [...efforts.values()].map(b => ({ ...finishMeasurement(b), averageDuration: b.durationRequests ? b.durationTotal / b.durationRequests : null }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.effort.localeCompare(b.effort)),
        byInitiator: [...initiators].map(([id, b]) => ({ id, ...finishMeasurement(b) })),
        delegatedModels: [...delegatedModels].map(([name, b]) => ({ name, ...finishMeasurement(b) }))
          .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)) };
    },
  };
}
