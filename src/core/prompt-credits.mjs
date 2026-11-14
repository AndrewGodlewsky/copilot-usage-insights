import { localDay } from './query.mjs';

// IDs must remain exact: truncating long API call IDs can alias unrelated calls.
export const linkId = value => typeof value === 'string' && value.length <= 8192 ? value : '';
const kinds = { 'user.message': 'user', 'assistant.message': 'message', 'assistant.turn_start': 'turn-start', 'assistant.turn_end': 'turn-end',
  'tool.execution_start': 'tool-start', 'tool.execution_complete': 'tool-end', 'subagent.started': 'agent-start', 'subagent.completed': 'agent-end', 'subagent.failed': 'agent-end', 'session.usage_record': 'receipt' };

// An allowlist of identifiers and accounting/completion evidence, never message or tool payloads.
export function promptEvent(e, { sessionId, project, receipt, receiptKey } = {}) {
  const kind = kinds[e?.type], ms = Date.parse(e?.timestamp), id = linkId(e?.id);
  if (!kind || !id || e.ephemeral || e.checkpoint || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) return null;
  const d = e.data || {}, u = d.usage || {};
  const event = { kind, id, sessionId, ms, agent: linkId(e.agentId), parentTool: linkId(kind === 'receipt' ? u.parentToolCallId : d.parentToolCallId) };
  if (kind === 'receipt') return { ...event, receiptKey, api: linkId(u.apiCallId), model: receipt?.model || '',
    nano: receipt?.nanoAiu ?? null, status: receipt?.creditStatus || 'unavailable', copilot: !!receipt, initiator: receipt?.initiator || '' };
  if (kind === 'agent-start' || kind === 'agent-end' || kind === 'tool-start' || kind === 'tool-end') event.tool = linkId(d.toolCallId);
  if (kind === 'user') {
    const child = !!(event.agent || event.parentTool);
    const automated = d.isAutopilotContinuation || d.source && d.source !== 'user' || Array.isArray(d.causalDependencies) && d.causalDependencies.length;
    Object.assign(event, { promptId: linkId(d.messageId) || id, project, origin: child ? 'child' : automated ? 'automated' : d.source === 'user' ? 'user' : 'unspecified' });
  }
  if (kind === 'message') Object.assign(event, { api: linkId(d.apiCallId), originatingPrompt: linkId(d.originatingMessageId), tools: Array.isArray(d.toolRequests) ? [...new Set(d.toolRequests.map(t => linkId(t?.toolCallId)).filter(Boolean))].sort() : [],
    invalidTools: d.toolRequests != null && (!Array.isArray(d.toolRequests) || d.toolRequests.some(t => !linkId(t?.toolCallId))),
    terminal: d.phase === 'final_answer' || d.phase === 'response' || !d.phase && Array.isArray(d.toolRequests) && d.toolRequests.length === 0 });
  event.interaction = linkId(d.interactionId);
  event.turn = linkId(d.turnId);
  return event;
}

const key = (...parts) => JSON.stringify(parts);
const addTo = (map, id, value) => { if (!map.has(id)) map.set(id, new Set()); map.get(id).add(value); };

export function summarizePromptCredits(events = [], records = [], query, start, end, now) {
  const result = { prompts: 0, eligiblePrompts: 0, credits: null, averageCredits: null, modelFiltered: !!query.models,
    excluded: { attribution: 0, accounting: 0, unfinished: 0 }, unlinkedRequests: 0 };
  const unique = new Map();
  for (const event of events) if (event.ms <= now.getTime()) unique.set(JSON.stringify(event), event);
  const order = { user: 0, 'turn-start': 1, receipt: 2, message: 3, 'tool-start': 4, 'agent-start': 5, 'agent-end': 6, 'tool-end': 7, 'turn-end': 8 };
  const all = [...unique.values()].sort((a, b) => a.ms - b.ms || order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
  const nodes = new Map(), byEvent = new Map(), calls = new Map(), receipts = new Map(), receiptCalls = new Map(), receiptLinks = new Map(), owners = new Map(), requestedAt = new Map(), agents = new Map(), toolEvents = new Map(), children = new Map();
  const uncertainSessions = new Set(), eventNode = new Map(), userNodes = new Map();
  function nodeFor(e) {
    if (!e.interaction && e.kind !== 'user') return null;
    const id = key(e.sessionId, e.agent || e.parentTool, e.interaction || ['missing', e.promptId]);
    if (!nodes.has(id)) nodes.set(id, { id, parent: id, events: [], messages: [], turns: [], receipts: new Map(), bad: false, accounting: false, unfinished: false });
    const node = nodes.get(id);
    node.events.push(e); eventNode.set(e, node);
    if (!e.interaction) node.bad = true;
    return node;
  }
  function root(node) {
    if (node.parent !== node.id) node.parent = root(nodes.get(node.parent)).id;
    return nodes.get(node.parent);
  }
  function join(a, b) { const x = root(a), y = root(b); if (x !== y) y.parent = x.id; }
  for (const e of all) {
    addTo(byEvent, key(e.sessionId, e.id), e);
    if (e.kind === 'receipt') { addTo(receipts, e.receiptKey, e); addTo(receiptCalls, key(e.sessionId, e.api), e.receiptKey); addTo(receiptLinks, key(e.sessionId, e.api), e); continue; }
    const node = nodeFor(e);
    if (e.kind === 'user') addTo(userNodes, key(e.sessionId, e.promptId), node);
    if (e.kind === 'message' && !node) uncertainSessions.add(e.sessionId);
    if (e.kind === 'message' && node) {
      node.messages.push(e);
      if (e.invalidTools) node.bad = true;
      if (e.api) addTo(calls, key(e.sessionId, e.api), node);
      else node.accounting = true;
      for (const tool of e.tools) { addTo(owners, key(e.sessionId, tool), node); requestedAt.set(key(e.sessionId, tool), Math.max(requestedAt.get(key(e.sessionId, tool)) || 0, e.ms)); }
    }
    if (e.kind.startsWith('tool-') || e.kind.startsWith('agent-')) {
      if (e.tool) addTo(toolEvents, key(e.sessionId, e.tool), e);
      if (e.kind.startsWith('tool-') && node && e.tool) addTo(owners, key(e.sessionId, e.tool), node);
      if (e.kind === 'agent-start' && e.agent && e.tool) addTo(agents, key(e.sessionId, e.agent), e.tool);
    }
  }
  // Multiple candidate owners are connected only to reject the entire ambiguous cohort.
  function connect(candidates, ambiguous = false) {
    const items = [...candidates];
    for (const node of items) { if (ambiguous) node.bad = true; join(items[0], node); }
  }
  for (const candidates of [...calls.values(), ...owners.values()]) if (candidates.size > 1) connect(candidates, true);
  // This logical ID stays stable even when stop hooks or steering change interactionId.
  for (const node of nodes.values()) for (const m of node.messages) if (m.originatingPrompt) {
    const origins = userNodes.get(key(m.sessionId, m.originatingPrompt));
    if (!origins?.size) { node.bad = true; uncertainSessions.add(m.sessionId); }
    else connect(new Set([node, ...origins]), origins.size > 1);
  }
  for (const [id, work] of toolEvents) if (!owners.has(id)) for (const e of work) uncertainSessions.add(e.sessionId);
  for (const r of records) if (r.ms <= now.getTime() && !receipts.has(r.key)) uncertainSessions.add(r.sessionId);
  for (const variants of byEvent.values()) if (variants.size > 1) {
    for (const e of variants) { const node = eventNode.get(e); if (node) node.bad = true; else uncertainSessions.add(e.sessionId); }
  }
  for (const node of nodes.values()) {
    const parentTools = new Set();
    const evidence = [...node.events, ...node.messages.flatMap(m => [...(receiptLinks.get(key(m.sessionId, m.api)) || [])])];
    node.agents = new Set(evidence.map(e => e.agent).filter(Boolean));
    for (const e of evidence) {
      if (e.parentTool) parentTools.add(e.parentTool);
      for (const tool of agents.get(key(e.sessionId, e.agent)) || []) parentTools.add(tool);
    }
    if (parentTools.size > 1) node.bad = true;
    if (node.agents.size > 1) node.bad = true;
    node.scope = node.agents.size ? key('agent', [...node.agents][0]) : parentTools.size ? key('tool', [...parentTools][0]) : '';
    for (const tool of parentTools) {
      addTo(children, key(node.events[0].sessionId, tool), node);
      const parents = owners.get(key(node.events[0].sessionId, tool));
      if (!parents?.size) { node.bad = true; uncertainSessions.add(node.events[0].sessionId); }
      else for (const parent of parents) { if (parent === node) node.bad = true; else join(parent, node); }
    }
    if (node.events.some(e => e.agent) && !parentTools.size) { node.bad = true; uncertainSessions.add(node.events[0].sessionId); }
    if (!parentTools.size && evidence.some(e => e.kind === 'receipt' && e.initiator === 'sub-agent')) node.bad = true;
  }
  // Logical prompt IDs deduplicate replays even when the event envelope ID changed.
  const prompts = new Map();
  for (const e of all) if (e.kind === 'user' && ['user', 'unspecified'].includes(e.origin)) {
    const id = key(e.sessionId, e.promptId);
    if (!prompts.has(id)) prompts.set(id, []);
    prompts.get(id).push(e);
  }
  for (const variants of prompts.values()) {
    const linked = new Set(variants.map(e => eventNode.get(e)));
    connect(linked, linked.size > 1 || new Set(variants.map(e => key(e.project, e.origin))).size > 1);
  }
  const assignedReceipts = new Set();
  for (const [id, variants] of receipts) {
    const linked = new Set(), signatures = new Set();
    for (const e of variants) {
      const candidates = calls.get(key(e.sessionId, e.api));
      if (e.api && candidates?.size) for (const node of candidates) linked.add(node);
      else uncertainSessions.add(e.sessionId);
      signatures.add(key(e.api, e.nano, e.status, e.copilot, e.model, e.initiator));
    }
    if (!linked.size) continue;
    connect(linked, linked.size > 1 || signatures.size > 1);
    for (const node of linked) {
      const e = [...variants][0];
      node.receipts.set(id, e);
      if (!e.copilot) node.bad = true;
      if (e.status !== 'complete' || !Number.isSafeInteger(e.nano) || e.nano < 0) node.accounting = true;
    }
    assignedReceipts.add(id);
  }
  // An assistant message is evidence of a call even if its charge record never arrived.
  for (const node of nodes.values()) for (const m of node.messages) {
    const matches = receiptCalls.get(key(m.sessionId, m.api));
    if (!matches?.size) node.accounting = true;
    if (matches?.size > 1) node.bad = true;
  }
  // turnId repeats between prompts. Pair only a unique open turn in the same agent scope.
  const open = new Map();
  for (const e of all) if (e.kind === 'turn-start' || e.kind === 'turn-end' || e.kind === 'message') {
    const id = key(e.sessionId, e.agent || e.parentTool, e.turn);
    if (e.kind === 'turn-start') {
      const node = eventNode.get(e);
      if (!node || !e.turn) { uncertainSessions.add(e.sessionId); continue; }
      const turn = { start: e, end: null, node, messages: [] };
      node.turns.push(turn); addTo(open, id, turn);
    } else if (e.kind === 'message') {
      const candidates = open.get(id), node = eventNode.get(e);
      if (candidates?.size === 1 && [...candidates][0].node === node) [...candidates][0].messages.push(e);
      else if (node) node.unfinished = true;
    } else {
      const candidates = open.get(id);
      if (candidates?.size === 1) {
        const turn = [...candidates][0]; turn.end = e;
        if (e.interaction && eventNode.get(e) !== turn.node) turn.node.bad = true;
      }
      else if (candidates?.size) for (const turn of candidates) turn.node.bad = true;
      else uncertainSessions.add(e.sessionId);
      open.delete(id);
    }
  }
  const streams = new Map();
  for (const node of nodes.values()) {
    addTo(streams, key(root(node).id, node.events[0].sessionId, node.scope), node);
    if (node.messages.length && !node.turns.length) node.unfinished = true;
    for (const turn of node.turns) {
      if (!turn.end || !turn.messages.length) node.unfinished = true;
    }
  }
  for (const stream of streams.values()) {
    const turns = [...stream].flatMap(n => n.turns).sort((a, b) => a.start.ms - b.start.ms);
    const last = turns.at(-1), final = last?.messages.at(-1);
    if (!last?.end || !final?.terminal || final.tools.length) for (const node of stream) node.unfinished = true;
  }
  for (const [id, candidates] of owners) {
    const work = [...(toolEvents.get(id) || [])];
    const started = work.filter(e => e.kind === 'tool-start' || e.kind === 'agent-start');
    const finished = work.filter(e => e.kind === 'tool-end');
    const spawned = work.filter(e => e.kind === 'agent-start');
    const agentsDone = work.filter(e => e.kind === 'agent-end');
    const lastStart = started.reduce((ms, e) => Math.max(ms, e.ms), requestedAt.get(id) || 0);
    const childNodes = [...(children.get(id) || [])], spawnIds = new Set(spawned.map(s => s.agent));
    const incompleteChild = spawned.some(s => {
      // A tool-only link can cover one unambiguous spawn, never several distinct agents.
      const matched = childNodes.filter(n => n.agents.has(s.agent) || !n.agents.size && spawnIds.size === 1);
      if (!matched.some(n => n.messages.length)) return true;
      let lastChildWork = s.ms;
      for (const n of matched) {
        for (const m of n.messages) lastChildWork = Math.max(lastChildWork, m.ms);
        for (const t of n.turns) lastChildWork = Math.max(lastChildWork, t.end?.ms || t.start.ms);
      }
      return !agentsDone.some(done => done.agent === s.agent && done.ms >= lastChildWork);
    });
    if (!finished.some(f => f.ms >= lastStart) || incompleteChild) {
      for (const node of candidates) node.unfinished = true;
    }
  }
  const groups = new Map();
  for (const node of nodes.values()) {
    const id = root(node).id;
    if (!groups.has(id)) groups.set(id, { nodes: [], prompts: [], receipts: new Map() });
    const group = groups.get(id); group.nodes.push(node);
    for (const [id, r] of node.receipts) group.receipts.set(id, r);
  }
  for (const variants of prompts.values()) {
    const event = variants[0], group = groups.get(root(eventNode.get(event)).id);
    group.prompts.push(event);
  }
  // A linked receipt is still unowned work if its root interaction has no initiating message.
  for (const group of groups.values()) if (!group.prompts.length && !group.nodes.some(n => n.events.some(e => e.kind === 'user' && e.origin === 'automated'))) {
    for (const node of group.nodes) for (const e of node.events) uncertainSessions.add(e.sessionId);
    for (const id of group.receipts.keys()) assignedReceipts.delete(id);
  }
  let nano = 0n;
  const inScope = e => { const day = localDay(new Date(e.ms)); return day >= start && day <= end && (!query.project || query.project === e.project) && (!query.session || query.session === e.sessionId); };
  for (const group of groups.values()) for (const prompt of group.prompts) {
    if (!inScope(prompt)) continue;
    const charges = [...group.receipts.values()], selected = charges.filter(r => !query.models || query.models.includes(r.model));
    if (query.models && !selected.length) continue;
    result.prompts++;
    const origin = eventNode.get(prompt);
    let firstCall;
    for (const node of group.nodes) if (node.scope === origin.scope) for (const m of node.messages) if (!firstCall || m.ms < firstCall.ms) firstCall = m;
    const initial = charges.some(r => r.api === firstCall?.api && r.sessionId === prompt.sessionId && r.initiator === 'user');
    if (group.prompts.length !== 1 || group.nodes.some(n => n.bad || n.events.some(e => uncertainSessions.has(e.sessionId))) || prompt.origin === 'unspecified' && !initial) result.excluded.attribution++;
    else if (!charges.length || group.nodes.some(n => n.accounting)) result.excluded.accounting++;
    else if (group.nodes.some(n => n.unfinished)) result.excluded.unfinished++;
    else { result.eligiblePrompts++; for (const r of selected) nano += BigInt(r.nano); }
  }
  result.unlinkedRequests = records.filter(r => r.ms <= now.getTime() && !assignedReceipts.has(r.key) && inScope(r) && (!query.models || query.models.includes(r.model))).length;
  if (result.eligiblePrompts) { result.credits = Number(nano) / 1e9; result.averageCredits = result.credits / result.eligiblePrompts; }
  return result;
}
