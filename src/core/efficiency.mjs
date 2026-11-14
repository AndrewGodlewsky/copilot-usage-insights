const measurement = () => ({ requests: 0, inputRequests: 0, inputTokens: 0, outputRequests: 0, outputTokens: 0, cacheRequests: 0, cacheInput: 0, cacheRead: 0, creditRequests: 0, creditNano: 0n,
  pairedRequests: 0, pairedInput: 0, pairedOutput: 0, toolRequests: 0, toolTokens: 0, toolInput: 0, reasoningRequests: 0, reasoningTokens: 0 });
const known = value => Number.isFinite(value) && value >= 0;
function addMeasurement(b, r) {
  b.requests++;
  if (known(r.inputTotal)) { b.inputRequests++; b.inputTokens += r.inputTotal; }
  if (known(r.output)) { b.outputRequests++; b.outputTokens += r.output; }
  if (known(r.inputTotal) && known(r.output)) { b.pairedRequests++; b.pairedInput += r.inputTotal; b.pairedOutput += r.output; }
  if (known(r.toolTokenCount) && known(r.inputTotal) && r.toolTokenCount <= r.inputTotal) {
    b.toolRequests++; b.toolTokens += r.toolTokenCount; b.toolInput += r.inputTotal;
  }
  if (known(r.reasoning) && known(r.output) && r.reasoning <= r.output) { b.reasoningRequests++; b.reasoningTokens += r.reasoning; }
  if (r.cacheDetailsReported !== false && known(r.inputTotal) && known(r.cacheRead) && known(r.cacheWrite) && r.cacheRead + r.cacheWrite <= r.inputTotal) {
    b.cacheRequests++; b.cacheInput += r.inputTotal; b.cacheRead += r.cacheRead;
  }
  if (Number.isSafeInteger(r.nanoAiu) && r.nanoAiu >= 0 && r.creditStatus === 'complete') { b.creditRequests++; b.creditNano += BigInt(r.nanoAiu); }
}
function finishMeasurement(b) {
  const { creditNano, ...rest } = b;
  const credits = Number(creditNano) / 1e9;
  return { ...rest, credits: b.creditRequests ? credits : null,
    averageInput: b.inputRequests ? b.inputTokens / b.inputRequests : null,
    averageOutput: b.outputRequests ? b.outputTokens / b.outputRequests : null,
    averageToolTokens: b.toolRequests ? b.toolTokens / b.toolRequests : null,
    toolShare: b.toolInput > 0 ? b.toolTokens / b.toolInput * 100 : null,
    cacheHitRate: b.cacheInput > 0 ? b.cacheRead / b.cacheInput * 100 : null,
    averageCredits: b.creditRequests ? credits / b.creditRequests : null };
}
const compareSamples = (a, b) => a.ms - b.ms || a.key.localeCompare(b.key);
const medianInput = samples => samples.map(s => s.input).sort((a, b) => a - b)[1];

export function createEfficiencyAccumulator() {
  const total = measurement(), models = new Map(), groups = new Map();
  return {
    add(r) {
      addMeasurement(total, r);
      if (!models.has(r.model)) models.set(r.model, measurement());
      addMeasurement(models.get(r.model), r);
      // Parallel subagents cannot be reliably ordered as one growing conversation.
      if (!['user', 'agent'].includes(r.initiator)) return;
      const key = JSON.stringify([r.project, r.sessionId, r.model, r.initiator]);
      if (!groups.has(key)) groups.set(key, { project: r.project, session: r.sessionId, model: r.model, initiator: r.initiator, requests: 0, inputRequests: 0, first: [], last: [] });
      const group = groups.get(key);
      group.requests++;
      if (!known(r.inputTotal) || !Number.isFinite(r.ms)) return;
      group.inputRequests++;
      const sample = { key: r.key, ms: r.ms, input: r.inputTotal };
      group.first.push(sample); group.first.sort(compareSamples); group.first = group.first.slice(0, 3);
      group.last.push(sample); group.last.sort(compareSamples); group.last = group.last.slice(-3);
    },
    finish(sessionLabels = new Map()) {
      const summary = finishMeasurement(total);
      const rows = [...models].map(([name, b]) => ({ name, ...finishMeasurement(b) }))
        .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
      const insights = [];
      let growth;
      for (const g of groups.values()) {
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
      return { summary, models: rows, insights };
    },
  };
}
