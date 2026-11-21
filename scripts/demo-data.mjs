import { createSyntheticHistory, mulberry32 } from './synthetic-history.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';

// Synthetic usage only. No user transcripts or account data belong in previews.
// Journals come from the deterministic generator and pass through the real parser, so the demo
// carries what a history can: prompts, tools, subagents, skills, model and effort changes, and
// compactions. Nothing here reads a Copilot home.
const SOURCE = 'Synthetic demo';
const NAMES = { 'claude-sonnet-4.5': 'Claude Sonnet 4.5', 'gpt-5.1': 'GPT-5.1', 'gpt-5-mini': 'GPT-5 mini', 'claude-opus-4.5': 'Claude Opus 4.5', 'gemini-3-pro': 'Gemini 3 Pro' };
const mainAgent = e => !e.agentId && !e.data?.parentToolCallId && !e.data?.usage?.parentToolCallId;

// [output tokens per second once generation starts, how much the model reasons] per demo model.
const OUTPUT_PROFILE = { 'claude-sonnet-4.5': [75, 1], 'gpt-5.1': [60, 1.15], 'gpt-5-mini': [140, .7], 'claude-opus-4.5': [45, 1.25], 'gemini-3-pro': [95, .9] };
// Gives a call the output a history shows: most calls are short and a few are long generations,
// a higher effort level reasons more, and the call's time follows what it generated. A call the
// generator left without an output count, or without reasoning, keeps that gap.
function shapeOutput(u, effort, rand) {
  if (!Number.isFinite(u.outputTokens)) return;
  const [speed, weight] = OUTPUT_PROFILE[u.model] || [80, 1], size = rand();
  const other = Math.round(size < .42 ? 30 + rand() * 170 : size < .8 ? 200 + rand() * 800 : size < .95 ? 1000 + rand() * 3000 : 4000 + rand() * 8000);
  u.reasoningTokens = u.reasoningTokens ? Math.round(({ high: 900, medium: 300 }[effort] ?? 550) * weight * (.3 + rand() * 1.4)) : 0;
  u.outputTokens = other + u.reasoningTokens;
  u.duration = Math.round(500 + rand() * 2000 + u.outputTokens / speed * 1000 * (.75 + rand() * .5));
}

// Adds the settings and compaction events the scale generator leaves out, then shrinks later
// input the way a compacted conversation would. Returns journal lines.
// `breaks` is its own random stream: it puts pauses of minutes or hours before some prompts,
// never moving the session past `latest`, and decides how little the next call reads from cache.
function enrich(session, rand, outputRand, breaks, latest, flaky) {
  const events = session.lines.map(line => { try { return JSON.parse(line); } catch { return line; } });
  const out = [], pick = list => list[Math.floor(rand() * list.length)], childCalls = new Map();
  // Tool outcomes worth a closer look: a browser tool that often fails, a shell that now and then
  // fails several times in a row, and a few calls whose outcome was never recorded. Each call is
  // decided once, from its own random stream, so a replayed line stays identical and nothing
  // else in the demo changes.
  const tools = new Map(), fates = new Map();
  let failing = 0;
  const fate = name => {
    if (name === 'playwright-navigate') return flaky() < .35 ? 'failed' : '';
    if (name === 'bash') {
      if (failing > 0) { failing--; return 'failed'; }
      if (flaky() < .018) { failing = 2 + Math.floor(flaky() * 4); return 'failed'; }
    }
    return flaky() < .012 ? 'unrecorded' : '';
  };
  // An empty effort stands for a producer that does not record one.
  let effort = rand() < .2 ? '' : rand() < .6 ? 'medium' : 'high', model = '', input = 0, removed = 0, cold = false, serial = 0;
  const end = Date.parse(events.findLast(e => typeof e !== 'string')?.timestamp);
  let shift = 0, stale = false, prompt = '', prompts = 0;
  const emit = (type, data, ms) => out.push(JSON.stringify({ type, data, id: `demo-${type}-${session.id}-${serial++}`, timestamp: new Date(ms).toISOString(), parentId: null }));
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (typeof e === 'string') { out.push(e); continue; }
    if (e.type === 'user.message' && mainAgent(e) && e.id !== prompt) {
      prompt = e.id;
      const roll = prompts++ ? breaks() : 1, wait = Math.round((roll < .07 ? 70 + breaks() * 600 : roll < .2 ? 6 + breaks() * 44 : 0) * 60_000);
      if (wait && end + shift + wait < latest) { shift += wait; stale = roll < .07 || breaks() < .5; }
      // Demo prompts vary in length without drawing from any random stream.
      if (e.data) e.data.content = 'x'.repeat([60, 240, 900, 2600][prompts % 4]);
    }
    if (shift) e.timestamp = new Date(Date.parse(e.timestamp) + shift).toISOString();
    if (e.type === 'user.message' && mainAgent(e)) {
      const ms = Date.parse(e.timestamp);
      let next;
      for (let j = i + 1; j < events.length && !next; j++) if (events[j]?.type === 'session.usage_record' && mainAgent(events[j])) next = events[j].data.usage.model;
      const nextEffort = effort && rand() < .07 ? (effort === 'medium' ? 'high' : 'medium') : effort;
      if (model && next && (next !== model || nextEffort !== effort)) emit('session.model_change', { previousModel: model, newModel: next,
        ...(effort ? { previousReasoningEffort: effort, reasoningEffort: nextEffort } : {}), source: pick(['model_picker', 'model_picker', 'model_picker', 'agent', 'sdk']) }, ms - 3000);
      effort = nextEffort;
      if (model && next && next !== model) stale = true;
      if (next) model = next;
      if (input > 64000 && model) {
        const attempt = `demo-compaction-${session.id}-${serial}`, trigger = rand() < .2 ? 'manual' : 'threshold', failed = rand() < .08;
        const post = failed ? input : Math.round(input * (.22 + rand() * .2)), system = 4200, definitions = 9000;
        emit('session.compaction_start', { compactionAttemptId: attempt, currentTokens: input, conversationTokens: input - system - definitions, systemTokens: system,
          toolDefinitionsTokens: definitions, tokenLimit: 200000, trigger, model }, ms - 2500);
        emit('session.compaction_complete', { compactionAttemptId: attempt, success: !failed, trigger, tokenLimit: 200000, tokenAccountingBasis: 'local_full_context_estimate',
          preCompactionTokens: input, preCompactionMessagesLength: 40 + Math.floor(rand() * 160),
          ...(failed ? {} : { postCompactionTokens: post, tokensRemoved: input - post, messagesRemoved: 30 + Math.floor(rand() * 120) }),
          compactionTokensUsed: { provider: { id: 'copilot', kind: 'copilot' }, model, modelDisplayName: NAMES[model] || model, inputTokens: input, outputTokens: 900 + Math.floor(rand() * 1400),
            cacheReadTokens: Math.floor(input * .8), cacheWriteTokens: 0, duration: 4000 + Math.floor(rand() * 9000), requestCount: 1,
            copilotUsage: { totalNanoAiu: Math.round(input * 900 + 2e7) }, aiCreditsStatus: 'complete' } }, ms - 600);
        if (!failed) { removed += input - post; input = post; cold = true; }
      }
    }
    if (e.type === 'session.usage_record') {
      const u = e.data.usage, recorded = u.inputTokens;
      if (effort) u.reasoningEffort = effort;
      shapeOutput(u, effort, outputRand);
      if (removed && Number.isFinite(recorded)) {
        const smaller = Math.max((u.toolTokenCount || 0) + 1500, recorded - removed), scale = smaller / recorded;
        u.inputTokens = smaller;
        // The first call after a compaction rereads the rewritten history without a warm cache.
        u.cacheReadTokens = cold && mainAgent(e) ? Math.floor(smaller * .08) : Math.floor(u.cacheReadTokens * scale);
        u.cacheWriteTokens = Math.min(smaller - u.cacheReadTokens, Math.floor(u.cacheWriteTokens * scale) + (cold && mainAgent(e) ? Math.floor(smaller * .6) : 0));
        if (mainAgent(e)) cold = false;
      }
      // The first call after a break or a model change rereads the conversation with little from cache.
      if (stale && mainAgent(e) && Number.isFinite(u.inputTokens)) {
        u.cacheReadTokens = Math.floor(u.inputTokens * .12 * breaks());
        u.cacheWriteTokens = Math.floor((u.inputTokens - u.cacheReadTokens) * (.5 + .4 * breaks()));
        stale = false;
      }
      if (mainAgent(e) && Number.isFinite(u.inputTokens)) input = u.inputTokens;
      // A subagent starts from its own short context, not the parent's history: its tool
      // definitions, the task, and what it has read so far. Its first call has no warm cache.
      if (!mainAgent(e) && u.inputTokens > 0) {
        const child = e.agentId || u.parentToolCallId, call = (childCalls.get(child) || 0) + 1, before = u.inputTokens;
        childCalls.set(child, call);
        const fresh = Math.min(before, (u.toolTokenCount || 0) + 1800 + call * 2600), scale = fresh / before;
        u.inputTokens = fresh;
        u.cacheReadTokens = call === 1 ? 0 : Math.floor(u.cacheReadTokens * scale);
        u.cacheWriteTokens = Math.min(fresh - u.cacheReadTokens, Math.floor(u.cacheWriteTokens * scale));
      }
    }
    if (e.type === 'tool.execution_start') tools.set(e.data.toolCallId, e.data.toolName);
    if (e.type === 'tool.execution_complete') {
      const id = e.data.toolCallId;
      if (!fates.has(id)) fates.set(id, fate(tools.get(id)));
      if (fates.get(id) === 'failed') e.data.success = false;
      else if (fates.get(id) === 'unrecorded') delete e.data.success;
    }
    out.push(JSON.stringify(e));
  }
  return out;
}

export function demoData(now = new Date()) {
  // Output shaping draws from its own sequence so the settings and compactions above stay as they were.
  const history = createSyntheticHistory({ seed: 7, records: 2600, days: 45, now, delegation: .25 }), rand = mulberry32(11), outputRand = mulberry32(23);
  const breaks = mulberry32(29), latest = now.getTime() - 30 * 60_000, flaky = mulberry32(31);
  const result = { records: [], skills: [], interactions: [], promptEvents: [], tools: [], modelChanges: [], compactionEvents: [], skillExcludedSessions: [], coverageEntries: [] };
  const coverage = { excluded: 0, unclassified: 0, invalid: 0, invalidSkills: 0, aggregateOnly: 0, fallbackRequests: 0 };
  let files = 0;
  for (const session of history.sessions()) {
    const parser = createReceiptParser({ sessionId: session.id, source: SOURCE, logFile: `${session.id}/events.jsonl` });
    for (const line of enrich(session, rand, outputRand, breaks, latest, flaky)) parser.push(line);
    const snapshot = parser.snapshot();
    files++;
    for (const record of [...snapshot.records, ...snapshot.compactions]) result.records.push(session.name ? { ...record, sessionName: session.name } : record);
    for (const key of ['skills', 'interactions', 'promptEvents', 'tools', 'modelChanges', 'compactionEvents', 'skillExcludedSessions', 'coverageEntries']) result[key].push(...snapshot[key]);
    for (const key of ['excluded', 'unclassified', 'invalid', 'invalidSkills']) coverage[key] += snapshot[key];
  }
  return { ...result, sources: [{ path: 'Synthetic demo — no account data', state: 'ok', files, records: result.records.length }], coverage };
}

// A made-up current-context snapshot in the shape the context reader returns.
export function demoContext(now = new Date()) {
  const entries = [
    ['tool', 'view', 11200], ['tool', 'bash', 6400], ['mcpServer', 'github', 4100], ['plugin', 'engineering', 3500], ['tool', 'grep', 3100],
    ['mcpServer', 'playwright', 2500], ['skill', 'code-review', 2100, 'plugin:engineering'], ['toolDefinition', 'bash', 1900], ['subagent', 'general-purpose', 1700],
    ['skill', 'testing', 1400, 'plugin:engineering'], ['toolDefinition', 'edit', 1300], ['skill', 'release-notes', 900], ['mcpServer', 'docs', 800], ['toolDefinition', 'view', 700],
  ].map(([kind, label, tokens, parentId]) => ({ kind, id: `${kind}:${label}`, label, tokens, ...(parentId ? { parentId } : {}) }));
  return { available: true, checkedAt: now.toISOString(), totalTokens: 61840, limit: 200000, modelId: 'claude-sonnet-4.5', modelSource: 'selected',
    categories: { systemPrompt: 4200, customInstructions: 3100, systemTools: 9800, mcpTools: 7400, messages: 37340 }, entries, omitted: 0 };
}
