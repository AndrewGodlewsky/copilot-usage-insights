// Deterministic synthetic Copilot history for scale tests and benchmarks. Reads no real usage.
// Event order, envelope key order, identifier lengths and relative payload sizes follow the
// session journal format; every value is generated. `truth` is counted here, independently of
// the parser and report code, so tests can compare the pipeline against known totals.
import fs from 'node:fs/promises';
import path from 'node:path';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = [
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', weight: 45, price: 1 },
  { id: 'gpt-5.1', name: 'GPT-5.1', weight: 25, price: .8 },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', weight: 15, price: .1 },
  { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', weight: 10, price: 5 },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', weight: 5, price: .9 },
];
const PROJECTS = ['acme/storefront', 'acme/billing-api', 'acme/mobile', 'acme/infra', 'acme/docs', 'labs/prototype', 'labs/data-pipeline', 'personal/dotfiles'];
const TOOLS = ['view', 'edit', 'bash', 'grep', 'glob', 'create'];
const MCP_TOOLS = [['github', 'search_issues'], ['github', 'get_pull_request'], ['playwright', 'navigate'], ['docs', 'lookup']];
const SKILLS = [['code-review', 'engineering', '1.4.0'], ['testing', 'engineering', '1.4.0'], ['release-notes', '', ''], ['debugging', 'superpowers', '5.0.2']];
const HOUR = 3_600_000, DAY = 24 * HOUR;
const pad = n => String(n).padStart(2, '0');
export const localDayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Prose with quotes and newlines, so JSON escaping costs resemble real message and tool payloads.
function buildFiller(rand, length) {
  const words = ['the', 'function', 'returns', 'a', 'value', 'when', 'tests', 'pass', 'and', 'file', 'changes', 'are', 'saved', '"quoted"', 'path/to/module.ts', 'const', 'x', '=', '42;', 'error:', 'retry'];
  let text = '';
  while (text.length < length) text += words[Math.floor(rand() * words.length)] + (rand() < .08 ? '\n' : ' ');
  return text;
}

export function createSyntheticHistory({ seed = 1, records = 20000, days = 90, now = new Date(), payload = 'compact', idLength = 496, messy = true, delegation = .05, linkStyles = false } = {}) {
  const rand = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = p => rand() < p;
  const pick = list => list[Math.floor(rand() * list.length)];
  const hex = n => { let s = ''; while (s.length < n) s += Math.floor(rand() * 0x100000000).toString(16).padStart(8, '0'); return s.slice(0, n); };
  const uuid = () => { const h = hex(32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`; };
  const filler = buildFiller(rand, 160 * 1024), idFiller = hex(Math.max(64, idLength));
  const realistic = payload === 'realistic';
  // (compact, realistic) sizes for payloads the dashboard never needs.
  const blob = (compact, real) => { const n = realistic ? real : compact, at = int(0, filler.length - n - 1); return filler.slice(at, at + n); };
  const modelWeights = MODELS.flatMap(m => Array(m.weight).fill(m));
  let serial = 0;
  // Copilot call IDs are long opaque strings; their length drives key and memory costs.
  const longId = () => { const head = `${(serial++).toString(36)}.${hex(16)}.`; return (head + idFiller).slice(0, Math.max(head.length, idLength)); };
  const group = () => ({ requests: 0, total: 0, nano: 0n });
  const truth = {
    sessions: 0, sessionFiles: 0, records: 0, excluded: 0, unclassified: 0, invalidLines: 0,
    inputTotal: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, nano: 0n,
    missingCredits: 0, partialCredits: 0, missingCache: 0, missingTokens: 0,
    byModel: new Map(), byProject: new Map(), byDay: new Map(),
    tools: { calls: 0, failures: 0, mcpCalls: 0, omitted: 0 }, skills: { invocations: 0, omitted: 0 },
    interactions: { prompts: 0, turns: 0, errors: 0 },
    prompts: { prompts: 0, eligible: 0, attribution: 0, accounting: 0, unfinished: 0, nano: 0n, requests: 0, tokenPrompts: 0, tokens: 0 },
  };
  const bump = (map, key) => { if (!map.has(key)) map.set(key, group()); return map.get(key); };

  function session() {
    const id = uuid(), project = pick(PROJECTS), cwd = `/work/${project}`;
    const kind = !messy ? 'copilot' : chance(.01) ? 'byok' : chance(.005) ? 'unclassified' : 'copilot';
    const attributed = kind === 'copilot', lines = [];
    const promptCount = Math.min(60, 1 + Math.floor(-Math.log(1 - rand()) * 8));
    let clock = now.getTime() - int(3 * HOUR, Math.max(4 * HOUR, days * DAY)), last = null, context = int(6000, 14000), sequence = 0, validRecords = 0, turnIds = 0;
    let sessionModel = pick(modelWeights);
    const toolTokens = int(5000, 13000), availableTools = int(28, 90);
    const emit = (type, data, envelope) => {
      const eventId = uuid();
      lines.push(JSON.stringify({ type, data, id: eventId, timestamp: new Date(clock).toISOString(), parentId: last, ...envelope }));
      last = eventId;
      // Journals can replay a line verbatim after a resume; identical copies must not double count.
      if (messy && chance(.002)) lines.push(lines.at(-1));
    };
    const tick = (lo, hi) => { clock += int(lo, hi); };

    function modelCall(model, initiator, interaction, turnId, tools, terminal, envelope, parentToolCallId) {
      const api = longId(), links = { interactionId: interaction.id, turnId, ...(parentToolCallId ? { parentToolCallId } : {}) };
      context += int(200, 2500);
      const input = context, cacheRead = sequence ? Math.floor(input * (.5 + rand() * .45)) : 0, cacheWrite = Math.floor((input - cacheRead) * rand() * .8);
      const output = int(40, 2400), reasoning = chance(.6) ? Math.floor(output * rand() * .7) : 0;
      const nano = Math.round(((input - cacheRead - cacheWrite) * 3 + cacheRead * .3 + cacheWrite * 3.75 + output * 15) * model.price * 1000);
      const flaw = messy && attributed ? rand() : 1;
      const credit = flaw < .01 ? 'unavailable' : flaw < .02 ? 'partial' : 'complete';
      const cacheUnknown = messy && chance(.01), outputMissing = messy && chance(.005);
      emit('assistant.turn_start', { ...links, agentMode: 'agent' }, envelope);
      tick(900, 6000);
      const usage = { model: model.id, responseModel: `${model.id}-2026-10-01`, modelDisplayName: model.name,
        provider: kind === 'unclassified' ? undefined : kind === 'byok' ? { id: 'custom', kind: 'custom', label: 'Custom' } : { id: 'copilot', kind: 'copilot', label: 'GitHub Copilot' },
        inputTokens: input, ...(outputMissing ? {} : { outputTokens: output }), cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, reasoningTokens: reasoning,
        cost: 1, duration: int(700, 9000), timeToFirstTokenMs: int(200, 1500), initiator, interactionType: 'conversation-agent', isByok: kind === 'byok', isAuto: chance(.2),
        maxPromptTokens: 200000, transport: 'http', requestBodyBytes: input * 4, apiCallId: api, providerCallId: hex(48), serviceRequestId: uuid(), apiEndpoint: '/v1/messages',
        ...(parentToolCallId ? { parentToolCallId } : {}),
        accounting: { sourceSessionId: id, sequence: ++sequence, usageId: api },
        ...(kind !== 'copilot' || credit === 'unavailable' ? {} : { copilotUsage: { tokenDetails: [{ batchSize: 1, costPerBatch: 1, tokenCount: input, tokenType: 'input', model: model.id }], totalNanoAiu: nano }, aiCreditsStatus: credit }),
        availableToolCount: availableTools, toolTokenCount: Math.min(toolTokens, input), cacheDetailsReported: !cacheUnknown, numToolCalls: tools.length, finishReason: terminal ? 'stop' : 'tool_use' };
      emit('session.usage_record', { usage }, envelope);
      const receiptMs = clock;
      tick(1, 4);
      emit('assistant.message', { messageId: uuid(), originatingMessageId: interaction.prompt, model: model.id, providerId: 'copilot', content: blob(40, 180),
        toolRequests: tools.map(tool => ({ toolCallId: tool.id, name: tool.name, arguments: blob(30, 220), type: 'function' })), ...links,
        reasoningOpaque: blob(24, 440), encryptedContent: blob(48, 6600), reasoningBlocks: [{ type: 'reasoning', text: blob(48, 7300) }],
        ...(terminal ? { phase: 'final_answer' } : {}), apiCallId: api }, envelope);
      if (kind === 'byok') truth.excluded++;
      else if (kind === 'unclassified') truth.unclassified++;
      else {
        validRecords++; truth.records++;
        const knownOutput = outputMissing ? null : output, known = input + (knownOutput ?? 0);
        truth.inputTotal += input; truth.output += knownOutput ?? 0; truth.reasoning += reasoning; truth.total += known;
        if (cacheUnknown) truth.missingCache++; else { truth.cacheRead += cacheRead; truth.cacheWrite += cacheWrite; }
        if (outputMissing) truth.missingTokens++;
        if (credit === 'unavailable') truth.missingCredits++; else truth.nano += BigInt(nano);
        if (credit === 'partial') truth.partialCredits++;
        for (const g of [bump(truth.byModel, model.name), bump(truth.byProject, project), bump(truth.byDay, localDayKey(receiptMs))]) {
          g.requests++; g.total += known; if (credit !== 'unavailable') g.nano += BigInt(nano);
        }
      }
      return { nano, complete: attributed && credit === 'complete', measured: !outputMissing, tokens: input + output };
    }

    function runTool(tool, interaction, turnId, model) {
      tick(2, 8);
      emit('hook.start', { hookInvocationId: uuid(), hookType: 'preToolUse', input: blob(60, 2300) });
      emit('tool.execution_start', { toolCallId: tool.id, toolName: tool.name, arguments: blob(30, 220), turnId, model: model.id,
        ...(tool.server ? { mcpServerName: tool.server, mcpToolName: tool.mcpTool } : {}) });
      tick(5, 900);
      const success = !chance(.03);
      emit('tool.execution_complete', { toolCallId: tool.id, model: model.id, interactionId: interaction.id, turnId, success, result: { content: blob(40, 900) } });
      emit('hook.end', { hookInvocationId: uuid(), hookType: 'postToolUse', success: true });
      if (attributed) { truth.tools.calls++; if (tool.server) truth.tools.mcpCalls++; if (!success) truth.tools.failures++; }
      else truth.tools.omitted++;
    }

    emit('session.start', { sessionId: id, version: 1, producer: 'copilot-agent', copilotVersion: '1.4.2', startTime: new Date(clock).toISOString(), selectedModel: sessionModel.id,
      context: { cwd, repository: project, gitRoot: cwd, branch: 'main' }, remoteSteerable: false });
    tick(400, 2500);
    emit('session.info', { message: 'Session ready', infoType: 'status' });
    for (let p = 0; p < promptCount && clock < now.getTime() - HOUR; p++) {
      tick(15_000, 240_000);
      if (chance(.08)) {
        const [name, plugin, version] = pick(SKILLS);
        emit('skill.invoked', { name, path: `/skills/${name}/SKILL.md`, content: blob(40, 400), ...(plugin ? { pluginName: plugin, pluginVersion: version } : {}), trigger: pick(['user-invoked', 'agent-invoked', 'agent-invoked', 'context-load']) });
        if (attributed) truth.skills.invocations++; else truth.skills.omitted++;
      }
      if (chance(.1)) sessionModel = pick(modelWeights);
      const interaction = { id: uuid(), prompt: uuid() };
      // Real journals omit `source` on typed prompts; the first user-initiated call corroborates them.
      emit('user.message', { content: blob(60, 1600), transformedContent: blob(60, 1600), messageId: interaction.prompt, ...(chance(.2) ? { source: 'user' } : {}), delivery: 'immediate', interactionId: interaction.id, turnId: '0' });
      if (realistic && chance(.5)) emit('system.message', { role: 'system', content: blob(0, 52000), interactionId: interaction.id });
      if (attributed) truth.interactions.prompts++;
      const calls = Math.min(25, 1 + Math.floor(-Math.log(1 - rand()) * 3));
      const unfinished = messy && p === promptCount - 1 && chance(.04);
      const delegate = messy && calls > 1 && chance(delegation);
      const outcomes = [];
      turnIds = Math.max(turnIds, calls);
      for (let t = 0; t < calls; t++) {
        const terminal = t === calls - 1, turnId = String(t);
        const tools = terminal ? [] : Array.from({ length: delegate && t === 0 ? 1 : int(1, 3) }, () => {
          if (delegate && t === 0) return { id: `toolu_${hex(24)}`, name: 'task', agent: `agent-${hex(12)}` };
          if (chance(.12)) { const [server, mcpTool] = pick(MCP_TOOLS); return { id: `toolu_${hex(24)}`, name: `${server}-${mcpTool}`, server, mcpTool }; }
          return { id: `toolu_${hex(24)}`, name: pick(TOOLS) };
        });
        tick(1, 12);
        outcomes.push(modelCall(sessionModel, t === 0 ? 'user' : 'agent', interaction, turnId, tools, terminal));
        for (const tool of tools) {
          if (!tool.agent) { runTool(tool, interaction, turnId, sessionModel); continue; }
          // A delegated task: the child agent's calls carry its agent ID and the parent tool call.
          // Journals link a child agent by agent ID, by parent tool call, or both.
          const style = linkStyles ? pick(['both', 'both', 'agent', 'tool']) : 'both', parentTool = style === 'agent' ? undefined : tool.id;
          const envelope = style === 'tool' ? {} : { agentId: tool.agent }, child = { id: uuid(), prompt: uuid() }, childModel = MODELS[2];
          tick(2, 8);
          emit('tool.execution_start', { toolCallId: tool.id, toolName: 'task', arguments: blob(30, 220), turnId, model: sessionModel.id });
          emit('subagent.started', { toolCallId: tool.id, agentName: 'general-purpose' }, { agentId: tool.agent });
          emit('user.message', { content: blob(60, 800), messageId: child.prompt, source: 'agent-root', interactionId: child.id, ...(parentTool ? { parentToolCallId: parentTool } : {}) }, envelope);
          const childCalls = int(1, 3);
          for (let c = 0; c < childCalls; c++) {
            tick(1, 12);
            outcomes.push(modelCall(childModel, 'sub-agent', child, String(c), [], c === childCalls - 1, envelope, parentTool));
            tick(1, 4);
            emit('assistant.turn_end', { turnId: String(c), ...(parentTool ? { parentToolCallId: parentTool } : {}) }, envelope);
          }
          tick(1, 4);
          emit('subagent.completed', { toolCallId: tool.id }, { agentId: tool.agent });
          tick(1, 4);
          emit('tool.execution_complete', { toolCallId: tool.id, model: sessionModel.id, interactionId: interaction.id, turnId, success: true, result: { content: blob(40, 900) } });
          if (attributed) truth.tools.calls++; else truth.tools.omitted++;
        }
        tick(1, 20);
        if (!(unfinished && terminal)) emit('assistant.turn_end', { turnId });
      }
      if (chance(.005)) { emit('session.error', { errorType: 'rate_limit', message: blob(20, 120) }); if (attributed) truth.interactions.errors++; }
      emit('session.usage_checkpoint', { totalNanoAiu: 0, totalPremiumRequests: sequence, accountingSnapshot: blob(120, 9800) });
      const stats = truth.prompts;
      stats.prompts++;
      if (!attributed) stats.attribution++;
      else if (outcomes.some(o => !o.complete)) stats.accounting++;
      else if (unfinished) stats.unfinished++;
      else {
        stats.eligible++; stats.requests += outcomes.length;
        for (const o of outcomes) stats.nano += BigInt(o.nano);
        if (outcomes.every(o => o.measured)) { stats.tokenPrompts++; stats.tokens += outcomes.reduce((sum, o) => sum + o.tokens, 0); }
      }
    }
    if (chance(.7)) emit('session.shutdown', { shutdownType: 'routine', totalPremiumRequests: sequence, accountingSnapshot: blob(80, 4200) });
    if (messy && chance(.01)) { lines.splice(int(1, lines.length), 0, '{"type":"assistant.message","data":{"content":"truncated'); truth.invalidLines++; }
    // Turn IDs restart at 0 for every prompt, so a session's distinct turn IDs equal its longest prompt.
    if (attributed) truth.interactions.turns += turnIds;
    if (validRecords) truth.sessions++;
    truth.sessionFiles++;
    return { id, project, cwd, kind, name: chance(.7) ? `Work on ${project.split('/')[1]} ${hex(4)}` : '', lines, records: validRecords, endMs: clock };
  }
  return { truth, *sessions() { while (truth.records < records) yield session(); } };
}

// Writes a Copilot home. `emptyDirs` adds session folders that have a name but no journal,
// which is what most real session folders look like.
export async function writeSyntheticHome(root, options = {}) {
  const { emptyDirs = 0, ...rest } = options;
  const now = rest.now ?? new Date(), written = Date.now();
  const history = createSyntheticHistory({ ...rest, now }), state = path.join(root, 'session-state');
  await fs.mkdir(state, { recursive: true });
  const workspace = (id, name, cwd) => `id: ${id}\ncwd: ${cwd}\n${name ? `name: ${JSON.stringify(name)}\n` : ''}created_at: 2026-01-01T00:00:00.000Z\n`;
  let bytes = 0;
  const sessions = [];
  for (const session of history.sessions()) {
    const dir = path.join(state, session.id), text = session.lines.join('\n') + '\n';
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'workspace.yaml'), workspace(session.id, session.name, session.cwd));
    await fs.writeFile(path.join(dir, 'events.jsonl'), text);
    // A journal was last written when its session ended; keep that age relative to today.
    const ended = new Date(written - Math.max(0, now.getTime() - session.endMs));
    await fs.utimes(path.join(dir, 'events.jsonl'), ended, ended);
    bytes += Buffer.byteLength(text);
    sessions.push({ id: session.id, file: path.join(dir, 'events.jsonl'), records: session.records, lines: session.lines.length, name: session.name, kind: session.kind, project: session.project });
  }
  const rand = mulberry32((rest.seed ?? 1) + 7919);
  for (let i = 0; i < emptyDirs; i++) {
    const id = `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`, dir = path.join(state, id);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'workspace.yaml'), workspace(id, rand() < .5 ? `Idle session ${i}` : '', '/work/idle'));
  }
  return { truth: history.truth, sessions, bytes };
}
