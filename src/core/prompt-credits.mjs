import { dayOfMs, dayKey } from './query.mjs';
import { createConversationAccumulator } from './conversations.mjs';
import { createContextGrowthAccumulator } from './context-growth.mjs';
import { createHabitsAccumulator } from './efficiency-habits.mjs';

// IDs must remain exact: truncating long API call IDs can alias unrelated calls.
export const linkId = value => typeof value === 'string' && value.length <= 8192 ? value : '';
// A journal repeats the same identifiers on many lines, and every parsed line holds its own
// copy of the text. Bound both entries and UTF-16 character storage; oversized values
// remain intact in their records but do not stay alive in this process-wide cache.
const shared = new Map();
let sharedBytes = 0;
export function intern(value) {
  if (typeof value !== 'string' || !value || value.length > 8192) return value;
  const known = shared.get(value);
  if (known !== undefined) return known;
  const bytes = value.length * 2;
  if (shared.size >= 16384 || sharedBytes + bytes > 4 * 1024 * 1024) { shared.clear(); sharedBytes = 0; }
  shared.set(value, value);
  sharedBytes += bytes;
  return value;
}
const link = value => intern(linkId(value));
const kinds = { 'user.message': 'user', 'assistant.message': 'message', 'assistant.turn_start': 'turn-start', 'assistant.turn_end': 'turn-end',
  'tool.execution_start': 'tool-start', 'tool.execution_complete': 'tool-end', 'subagent.started': 'agent-start', 'subagent.completed': 'agent-end', 'subagent.failed': 'agent-end', 'session.usage_record': 'receipt',
  abort: 'abort', 'session.resume': 'resume' };
export const promptEventTypes = new Set(Object.keys(kinds));

// An allowlist of identifiers and accounting/completion evidence, never message or tool payloads.
export function promptEvent(e, { sessionId, project, receipt, receiptKey } = {}) {
  const kind = kinds[e?.type], ms = Date.parse(e?.timestamp), id = linkId(e?.id);
  if (!kind || !id || e.ephemeral || e.checkpoint || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) return null;
  const d = e.data || {}, u = d.usage || {};
  const agent = link(e.agentId), parentTool = link(kind === 'receipt' ? u.parentToolCallId : d.parentToolCallId);
  // Each kind is written out whole, so its fields are stored in the object itself.
  if (kind === 'receipt') return { kind, id, sessionId, ms, agent, parentTool, receiptKey, api: link(u.apiCallId), model: receipt?.model || '',
    nano: receipt?.nanoAiu ?? null, status: receipt?.creditStatus || 'unavailable', copilot: !!receipt, initiator: receipt?.initiator || '',
    context: [receipt?.modelId || '', receipt?.inputTotal ?? null, receipt?.cacheRead ?? null, receipt?.cacheWrite ?? null, receipt?.cacheDetailsReported ?? null] };
  const interaction = link(d.interactionId), turn = link(d.turnId);
  if (kind === 'abort') return { kind, id, sessionId, ms, agent, parentTool, project, interaction, turn, cancelled: d.reason === 'user_initiated' };
  if (kind === 'agent-start' || kind === 'agent-end' || kind === 'tool-start' || kind === 'tool-end') return { kind, id, sessionId, ms, agent, parentTool, tool: link(d.toolCallId), interaction, turn };
  if (kind === 'user') {
    const child = !!(agent || parentTool);
    const automated = d.isAutopilotContinuation || d.source && d.source !== 'user' || Array.isArray(d.causalDependencies) && d.causalDependencies.length;
    const delivery = ['idle', 'steering', 'queued'].includes(d.delivery) ? d.delivery : 'unknown';
    return { kind, id, sessionId, ms, agent, parentTool, promptId: link(d.messageId) || id, project, origin: child ? 'child' : automated ? 'automated' : d.source === 'user' ? 'user' : 'unspecified', delivery, interaction, turn };
  }
  if (kind === 'message') return { kind, id, sessionId, ms, agent, parentTool, api: link(d.apiCallId), originatingPrompt: link(d.originatingMessageId),
    tools: Array.isArray(d.toolRequests) ? [...new Set(d.toolRequests.map(t => link(t?.toolCallId)).filter(Boolean))].sort() : [],
    invalidTools: d.toolRequests != null && (!Array.isArray(d.toolRequests) || d.toolRequests.some(t => !linkId(t?.toolCallId))),
    terminal: d.phase === 'final_answer' || d.phase === 'response' || !d.phase && Array.isArray(d.toolRequests) && d.toolRequests.length === 0, interaction, turn };
  return { kind, id, sessionId, ms, agent, parentTool, interaction, turn };
}

// Replayed journal lines yield equal metadata and count once; conflicting copies of one event
// must both survive so the conflict can be detected. Equivalent to comparing their JSON.
export function samePromptEvent(a, b, accounting = false) {
  if (a === b) return true;
  const abortProject = accounting && a.kind === 'abort' && b.kind === 'abort';
  for (const k in a) {
    // Context/delivery and stop-location disagreements do not change financial accounting.
    if (k === 'environment' || accounting && (k === 'delivery' || k === 'context') || abortProject && k === 'project') continue;
    const x = a[k], y = b[k];
    if (x === y) continue;
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
  }
  for (const k in b) if (k !== 'environment' && !(accounting && (k === 'delivery' || k === 'context') || abortProject && k === 'project') && !(k in a)) return false;
  return true;
}
export function createPromptEventSet() {
  const byId = new Map(), events = [];
  // Conflicts remain distinct, but an adversarial reused ID must not compare every prior copy.
  const signature = e => JSON.stringify(Object.keys(e).filter(k => k !== 'environment' && e[k] !== undefined).sort().map(k => [k, e[k]]));
  return {
    events,
    // Returns the retained event: the first equal copy, or `e` itself when it is new.
    add(e) {
      const seen = byId.get(e.id);
      if (seen === undefined) byId.set(e.id, e);
      else if (seen instanceof Map) {
        const key = signature(e), variants = seen.get(key), match = variants?.find(x => samePromptEvent(x, e));
        if (match) return match;
        if (variants) variants.push(e); else seen.set(key, [e]);
      }
      else if (samePromptEvent(seen, e)) return seen;
      else {
        const variants = new Map([[signature(seen), [seen]]]), key = signature(e);
        if (variants.has(key)) variants.get(key).push(e); else variants.set(key, [e]);
        byId.set(e.id, variants);
      }
      events.push(e);
      return e;
    },
  };
}

// Exact integer total without allocating a BigInt per addend; spills only beyond 2^53.
export function exactTotal() {
  let low = 0, high = 0n;
  return {
    add(n) { if (low > Number.MAX_SAFE_INTEGER - n) { high += BigInt(low); low = 0; } low += n; },
    number: () => high ? Number(high + BigInt(low)) : low,
  };
}

const order = { user: 0, 'turn-start': 1, receipt: 2, message: 3, 'tool-start': 4, 'agent-start': 5, 'agent-end': 6, 'tool-end': 7, 'turn-end': 8, abort: 9, resume: 10 };
const byTime = (a, b) => a.ms - b.ms || order[a.kind] - order[b.kind] || a.id.localeCompare(b.id);
const addTo = (map, id, value) => { let set = map.get(id); if (!set) map.set(id, set = new Set()); set.add(value); };
const sub = (map, id) => { let inner = map.get(id); if (!inner) map.set(id, inner = new Map()); return inner; };
const sameList = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const EMPTY = [];
const ELIGIBLE = 0, ATTRIBUTION = 1, ACCOUNTING = 2, UNFINISHED = 3;
// What a linked call was: work under a parent tool call is a subagent's, whatever its own
// initiator says. Every other call keeps the initiator Copilot recorded, or none.
const ROLES = ['initial', 'continuation', 'subagent', 'unrecorded'];
const INITIAL = 0, CONTINUATION = 1, SUBAGENT = 2, UNRECORDED = 3;
const CALL_BINS = ['1 call', '2 to 5 calls', '6 to 15 calls', '16+ calls'];
const HEAVIEST = 5, TREND_POINTS = 62;

function medianOf(values) {
  if (!values.length) return null;
  const sorted = Float64Array.from(values).sort(), low = Math.floor((sorted.length - 1) / 2), high = Math.floor(sorted.length / 2);
  return (sorted[low] + sorted[high]) / 2;
}

// The spread behind the per-prompt averages, over the same eligible prompts and the same
// selected charges. Charges of eligible prompts are complete, so each total is exact. The
// per-prompt totals fill one numeric buffer for the length of the pass; only a few numbers
// and the heaviest prompts are reported.
function promptSpread() {
  const callCounts = [], bins = CALL_BINS.map(() => ({ prompts: 0, nano: 0 })), roles = ROLES.map(() => ({ requests: 0, nano: 0 })), top = [];
  const sides = [0, 1].map(() => ({ calls: [], nano: [], requests: 0, nanoTotal: exactTotal() }));
  const days = new Map();
  let totals = new Float64Array(1024), count = 0, delegatedPrompts = 0;
  // A total order, so equal charges rank the same however the history was read.
  const outranks = (nano, prompt, other) => nano !== other.nano ? nano > other.nano
    : prompt.sample.ms !== other.prompt.sample.ms ? prompt.sample.ms > other.prompt.sample.ms
    : prompt.sessionId !== other.prompt.sessionId ? prompt.sessionId < other.prompt.sessionId : prompt.sample.promptId < other.prompt.sample.promptId;
  const credits = nano => nano / 1e9;
  return {
    add(prompt, charges, tokens) {
      let nano = 0, delegated = false;
      for (const r of charges) {
        const role = roles[r.role];
        nano += r.nano; role.requests++; role.nano += r.nano;
        if (r.role === SUBAGENT) delegated = true;
      }
      const calls = charges.length, bin = bins[calls <= 1 ? 0 : calls <= 5 ? 1 : calls <= 15 ? 2 : 3];
      bin.prompts++; bin.nano += nano;
      callCounts[calls] = (callCounts[calls] || 0) + 1;
      if (delegated) delegatedPrompts++;
      const side = sides[delegated ? 1 : 0];
      side.calls.push(calls); side.nano.push(nano); side.requests += calls; side.nanoTotal.add(nano);
      if (Number.isFinite(prompt.day)) {
        let d = days.get(prompt.day);
        if (!d) days.set(prompt.day, d = { prompts: 0, requests: 0, nano: exactTotal() });
        d.prompts++; d.requests += calls; d.nano.add(nano);
      }
      if (count === totals.length) { const grown = new Float64Array(count * 2); grown.set(totals); totals = grown; }
      totals[count++] = nano;
      if (nano > 0 && (top.length < HEAVIEST || outranks(nano, prompt, top[top.length - 1]))) {
        let at = top.length;
        while (at > 0 && outranks(nano, prompt, top[at - 1])) at--;
        top.splice(at, 0, { prompt, nano, requests: calls, tokens });
        if (top.length > HEAVIEST) top.pop();
      }
    },
    finish(labels) {
      const sorted = totals.subarray(0, count).sort(), low = Math.floor((count - 1) / 2), high = Math.floor(count / 2), heavy = Math.floor(count / 10);
      const spread = { medianRequests: null, bins: bins.map((b, i) => ({ label: CALL_BINS[i], prompts: b.prompts, credits: b.prompts ? credits(b.nano) : null })),
        medianCredits: null, heavyPrompts: heavy, heavyCredits: null, heavyShare: null, halfPrompts: null };
      let total = 0;
      for (let i = 0; i < count; i++) total += sorted[i];
      if (count) {
        let seen = 0, lower;
        for (let calls = 0; calls < callCounts.length; calls++) {
          if (!callCounts[calls]) continue;
          seen += callCounts[calls];
          if (lower === undefined && seen > low) lower = calls;
          if (seen > high) { spread.medianRequests = (lower + calls) / 2; break; }
        }
        spread.medianCredits = credits((sorted[low] + sorted[high]) / 2);
      }
      // A tenth needs at least ten prompts; a share needs a charge above zero.
      if (heavy) {
        let sum = 0;
        for (let i = count - heavy; i < count; i++) sum += sorted[i];
        spread.heavyCredits = credits(sum);
        if (total > 0) spread.heavyShare = sum / total * 100;
      }
      if (total > 0) {
        let sum = 0, prompts = 0;
        for (let i = count - 1; i >= 0 && sum * 2 < total; i--) { sum += sorted[i]; prompts++; }
        spread.halfPrompts = prompts;
      }
      const mix = { delegatedPrompts };
      ROLES.forEach((name, i) => { mix[name] = { requests: roles[i].requests, credits: roles[i].requests ? credits(roles[i].nano) : null }; });
      const heaviest = top.map(({ prompt, nano, requests, tokens }) => ({ day: dayKey(prompt.day), session: prompt.sessionId, sessionName: labels?.get(prompt.sessionId) ?? null,
        project: prompt.project, requests, tokens, credits: credits(nano) }));
      const finishSide = side => {
        const prompts = side.calls.length, sumCredits = prompts ? credits(side.nanoTotal.number()) : null;
        return { prompts, medianCalls: medianOf(side.calls), averageCalls: prompts ? side.requests / prompts : null,
          medianCredits: prompts ? credits(medianOf(side.nano)) : null, averageCredits: prompts ? sumCredits / prompts : null, credits: sumCredits };
      };
      const delegationSplit = { mainOnly: finishSide(sides[0]), delegated: finishSide(sides[1]) };
      const orderedDays = [...days].sort((a, b) => a[0] - b[0]);
      let trend = { unit: 'day', points: [] };
      if (orderedDays.length) {
        const first = orderedDays[0][0], weekly = orderedDays.at(-1)[0] - first >= TREND_POINTS, span = weekly ? 7 : 1, points = [];
        let startBucket = null, cur = null;
        const flush = () => {
          if (!cur) return;
          points.push({ day: dayKey(startBucket), prompts: cur.prompts, averageRequests: cur.requests / cur.prompts,
            averageCredits: credits(cur.nano.number()) / cur.prompts });
        };
        for (const [day, d] of orderedDays) {
          const bucket = first + Math.floor((day - first) / span) * span;
          if (bucket !== startBucket) { flush(); startBucket = bucket; cur = { prompts: 0, requests: 0, nano: exactTotal() }; }
          cur.prompts += d.prompts; cur.requests += d.requests; cur.nano.add(d.nano.number());
        }
        flush();
        trend = { unit: weekly ? 'week' : 'day', points: points.slice(-TREND_POINTS) };
      }
      return { spread, mix, heaviest, delegationSplit, trend };
    },
  };
}

// Links every model call to the prompt that caused it. `all` is one closed set of sessions in
// time order: nothing outside it shares a receipt with it, so sets can be solved independently.
function attributeSessions(all, records, recordByKey) {
  const spaces = new Map(), nodes = [], eventNode = new Map(), receipts = new Map(), uncertain = new Set(), conflictingReceipts = new Set(), conflictingContext = new Set();
  let spaceId, spaceRef;
  // Identifiers are scoped by session. Nested maps avoid building a composite key per lookup.
  const space = id => {
    if (spaceRef && id === spaceId) return spaceRef;
    let s = spaces.get(id);
    if (!s) spaces.set(id, s = { byEvent: new Map(), calls: new Map(), receiptCalls: new Map(), receiptLinks: new Map(), owners: new Map(), requestedAt: new Map(), agents: new Map(),
      toolEvents: new Map(), children: new Map(), userNodes: new Map(), userEvents: new Map(), prompts: new Map(), nodes: new Map(), missing: new Map(), open: new Map(), latest: new Map(), retired: new Map(), resumed: false });
    spaceId = id;
    return spaceRef = s;
  };
  const root = node => {
    let top = node;
    while (top.parent !== top) top = top.parent;
    while (node.parent !== top) { const next = node.parent; node.parent = top; node = next; }
    return top;
  };
  const join = (a, b) => { const x = root(a), y = root(b); if (x !== y) y.parent = x; };
  // Multiple candidate owners are connected only to reject the entire ambiguous cohort.
  const connect = (candidates, ambiguous = false) => {
    let first;
    for (const node of candidates) { if (ambiguous) node.bad = true; if (first) join(first, node); else first = node; }
  };
  for (const e of all) {
    const s = space(e.sessionId), seen = s.byEvent.get(e.id);
    if (seen === undefined) s.byEvent.set(e.id, e);
    else if (Array.isArray(seen)) seen.push(e);
    else s.byEvent.set(e.id, [seen, e]);
    if (e.kind === 'resume') { s.resumed = true; continue; }
    if (e.kind === 'abort') continue;
    if (e.kind === 'receipt') {
      let variants = receipts.get(e.receiptKey);
      if (!variants) receipts.set(e.receiptKey, variants = []);
      variants.push(e); addTo(s.receiptCalls, e.api, e.receiptKey); addTo(s.receiptLinks, e.api, e);
      continue;
    }
    let node = null;
    // Copilot closes interrupted tools under a synthetic interaction after resuming.
    // Only an explicit boundary and one recorded owner justify using that owner.
    const resumedTool = e.kind === 'tool-end' && e.interaction === 'resume' && s.resumed && s.owners.get(e.tool)?.size === 1;
    if (resumedTool) { node = s.owners.get(e.tool).values().next().value; node.events.push(e); eventNode.set(e, node); }
    else if (e.interaction || e.kind === 'user') {
      // Events without an interaction can only be user messages; they are keyed by prompt instead.
      const table = sub(e.interaction ? s.nodes : s.missing, e.agent || e.parentTool), id = e.interaction || e.promptId;
      node = table.get(id);
      if (!node) {
        node = { parent: null, space: s, events: [], messages: [], turns: [], receipts: new Map(), bad: false, accounting: false, unfinished: false, agents: null, scope: '' };
        node.parent = node; table.set(id, node); nodes.push(node);
      }
      node.events.push(e); eventNode.set(e, node);
      if (!e.interaction) node.bad = true;
    }
    if (e.kind === 'user') {
      addTo(s.userNodes, e.promptId, node); addTo(s.userEvents, e.promptId, e);
      if (e.origin === 'user' || e.origin === 'unspecified') { let variants = s.prompts.get(e.promptId); if (!variants) s.prompts.set(e.promptId, variants = []); variants.push(e); }
    } else if (e.kind === 'message') {
      if (!node) uncertain.add(e.sessionId);
      else {
        node.messages.push(e);
        if (e.invalidTools) node.bad = true;
        if (e.api) addTo(s.calls, e.api, node);
        else node.accounting = true;
        for (const tool of e.tools) { addTo(s.owners, tool, node); s.requestedAt.set(tool, Math.max(s.requestedAt.get(tool) || 0, e.ms)); }
      }
    } else if (e.kind === 'tool-start' || e.kind === 'tool-end' || e.kind === 'agent-start' || e.kind === 'agent-end') {
      if (e.tool) addTo(s.toolEvents, e.tool, e);
      if ((e.kind === 'tool-start' || e.kind === 'tool-end') && node && e.tool) addTo(s.owners, e.tool, node);
      if (e.kind === 'agent-start' && e.agent && e.tool) addTo(s.agents, e.agent, e.tool);
    }
  }
  for (const s of spaces.values()) {
    for (const [api, keys] of s.receiptCalls) if (api && keys.size > 1) for (const key of keys) conflictingReceipts.add(key);
    for (const candidates of s.calls.values()) if (candidates.size > 1) connect(candidates, true);
    for (const candidates of s.owners.values()) if (candidates.size > 1) connect(candidates, true);
  }
  // This logical ID stays stable even when stop hooks or steering change interactionId.
  for (const node of nodes) for (const m of node.messages) if (m.originatingPrompt) {
    const origins = node.space.userNodes.get(m.originatingPrompt);
    if (!origins?.size) { node.bad = true; uncertain.add(m.sessionId); }
    else connect(new Set([node, ...origins]), origins.size > 1);
  }
  for (const s of spaces.values()) for (const [tool, work] of s.toolEvents) if (!s.owners.has(tool)) for (const e of work) uncertain.add(e.sessionId);
  for (const r of records) if (!receipts.has(r.key) && r.origin !== 'compaction') uncertain.add(r.sessionId);
  for (const s of spaces.values()) for (const variants of s.byEvent.values()) if (Array.isArray(variants)) {
    if (variants.every(e => samePromptEvent(variants[0], e, true))) continue;
    for (const e of variants) {
      if (e.kind === 'receipt') conflictingReceipts.add(e.receiptKey);
      const node = eventNode.get(e); if (node) node.bad = true; else uncertain.add(e.sessionId);
    }
  }
  for (const node of nodes) {
    const s = node.space, session = node.events[0].sessionId, parentTools = new Set(), agents = new Set();
    let delegatedCharge = false, agentEvent = false;
    const inspect = e => {
      if (e.agent) agents.add(e.agent);
      if (e.parentTool) parentTools.add(e.parentTool);
      const spawned = e.agent && s.agents.get(e.agent);
      if (spawned) for (const tool of spawned) parentTools.add(tool);
    };
    for (const e of node.events) { inspect(e); if (e.agent) agentEvent = true; }
    for (const m of node.messages) {
      const links = s.receiptLinks.get(m.api);
      if (links) for (const e of links) { inspect(e); if (e.initiator === 'sub-agent') delegatedCharge = true; }
    }
    node.agents = agents;
    if (parentTools.size > 1 || agents.size > 1) node.bad = true;
    node.scope = agents.size ? `a:${agents.values().next().value}` : parentTools.size ? `t:${parentTools.values().next().value}` : '';
    for (const tool of parentTools) {
      addTo(s.children, tool, node);
      const parents = s.owners.get(tool);
      if (!parents?.size) { node.bad = true; uncertain.add(session); }
      else for (const parent of parents) { if (parent === node) node.bad = true; else join(parent, node); }
    }
    if (agentEvent && !parentTools.size) { node.bad = true; uncertain.add(session); }
    if (!parentTools.size && delegatedCharge) node.bad = true;
  }
  // Logical prompt IDs deduplicate replays even when the event envelope ID changed.
  for (const s of spaces.values()) for (const variants of s.prompts.values()) {
    const linked = new Set(variants.map(e => eventNode.get(e)));
    connect(linked, linked.size > 1 || variants.some(e => e.project !== variants[0].project || e.origin !== variants[0].origin));
  }
  const assigned = new Set();
  for (const [id, variants] of receipts) {
    const linked = new Set(), first = variants[0];
    let conflicting = false;
    for (const e of variants) {
      const candidates = e.api && space(e.sessionId).calls.get(e.api);
      if (candidates?.size) for (const node of candidates) linked.add(node);
      else uncertain.add(e.sessionId);
      if (e.api !== first.api || e.nano !== first.nano || e.status !== first.status || e.copilot !== first.copilot || e.model !== first.model || e.initiator !== first.initiator) conflicting = true;
      if (e.ms !== first.ms || !sameList(e.context || EMPTY, first.context || EMPTY)) conflictingContext.add(id);
    }
    if (conflicting || linked.size > 1) conflictingReceipts.add(id);
    if (!linked.size) continue;
    connect(linked, linked.size > 1 || conflicting);
    for (const node of linked) {
      node.receipts.set(id, first);
      if (!first.copilot) node.bad = true;
      if (first.status !== 'complete' || !Number.isSafeInteger(first.nano) || first.nano < 0) node.accounting = true;
    }
    assigned.add(id);
  }
  // An assistant message is evidence of a call even if its charge record never arrived.
  for (const node of nodes) for (const m of node.messages) {
    const matches = node.space.receiptCalls.get(m.api);
    if (!matches?.size) node.accounting = true;
    else if (matches.size > 1) node.bad = true;
  }
  // turnId repeats between prompts. Pair only a unique open turn in the same agent scope.
  for (const e of all) if (e.kind === 'user' || e.kind === 'abort' || e.kind === 'resume' || e.kind === 'turn-start' || e.kind === 'turn-end' || e.kind === 'message') {
    const s = space(e.sessionId), scope = e.agent || e.parentTool, open = sub(s.open, scope), retired = sub(s.retired, scope);
    if (e.kind === 'user') { s.latest.set(scope, eventNode.get(e)); continue; }
    if (e.kind === 'resume' || e.kind === 'abort') {
      const candidates = new Set([...open.values()].flatMap(turns => [...turns].map(t => t.node)));
      const latest = s.latest.get(scope);
      if (latest) candidates.add(latest);
      if (candidates.size === 1 && !scope && (e.kind === 'resume' || e.cancelled)) {
        const node = candidates.values().next().value;
        if (!e.interaction || node.events.some(item => item.interaction === e.interaction)) {
          const cancelled = node.interruption?.kind === 'abort' && !node.turns.some(t => t.start.ms > node.interruption.ms && t.start.ms < e.ms);
          node.interruption = { ms: e.ms, kind: cancelled ? 'abort' : e.kind };
        }
      }
      for (const [id, turns] of open) { retired.set(id, turns); }
      open.clear();
      continue;
    }
    if (e.kind === 'turn-start') {
      const node = eventNode.get(e);
      if (!node || !e.turn) { uncertain.add(e.sessionId); continue; }
      const turn = { start: e, end: null, node, messages: [] };
      s.latest.set(scope, node); retired.delete(e.turn);
      node.turns.push(turn); addTo(open, e.turn, turn);
    } else if (e.kind === 'message') {
      const candidates = open.get(e.turn), node = eventNode.get(e), only = candidates?.size === 1 ? candidates.values().next().value : null;
      if (only && only.node === node) only.messages.push(e);
      else if (node) node.unfinished = true;
    } else {
      const candidates = open.get(e.turn);
      if (candidates?.size === 1) {
        const turn = candidates.values().next().value; turn.end = e;
        if (e.interaction && eventNode.get(e) !== turn.node) turn.node.bad = true;
      }
      else if (candidates?.size) for (const turn of candidates) turn.node.bad = true;
      else if (!retired.has(e.turn)) uncertain.add(e.sessionId);
      open.delete(e.turn);
    }
  }
  const streams = new Map();
  for (const node of nodes) {
    addTo(sub(sub(streams, root(node)), node.space), node.scope, node);
    if (node.messages.length && !node.turns.length) node.unfinished = true;
    for (const turn of node.turns) if (!turn.end || !turn.messages.length) node.unfinished = true;
  }
  for (const bySpace of streams.values()) for (const byScope of bySpace.values()) for (const stream of byScope.values()) {
    const turns = [];
    for (const node of stream) for (const turn of node.turns) turns.push(turn);
    turns.sort((a, b) => a.start.ms - b.start.ms);
    const last = turns.at(-1), final = last?.messages.at(-1);
    if (!last?.end || !final?.terminal || final.tools.length) for (const node of stream) node.unfinished = true;
  }
  for (const s of spaces.values()) for (const [tool, candidates] of s.owners) {
    const finished = [], spawned = [], agentsDone = [];
    let lastStart = s.requestedAt.get(tool) || 0;
    for (const e of s.toolEvents.get(tool) || EMPTY) {
      if (e.kind === 'tool-start' || e.kind === 'agent-start') lastStart = Math.max(lastStart, e.ms);
      if (e.kind === 'tool-end') finished.push(e);
      else if (e.kind === 'agent-start') spawned.push(e);
      else if (e.kind === 'agent-end') agentsDone.push(e);
    }
    let incomplete = !finished.some(f => f.ms >= lastStart);
    if (!incomplete && spawned.length) {
      const spawnIds = new Set(spawned.map(spawn => spawn.agent)), workByAgent = new Map(), doneByAgent = new Map();
      for (const n of s.children.get(tool) || EMPTY) {
        let latest = -Infinity;
        for (const m of n.messages) latest = Math.max(latest, m.ms);
        for (const t of n.turns) latest = Math.max(latest, t.end?.ms || t.start.ms);
        // A tool-only link can cover one unambiguous spawn, never several distinct agents.
        for (const agent of n.agents.size ? n.agents : spawnIds.size === 1 ? spawnIds : EMPTY) {
          let work = workByAgent.get(agent);
          if (!work) workByAgent.set(agent, work = { messages: false, latest: -Infinity });
          work.messages ||= n.messages.length > 0; work.latest = Math.max(work.latest, latest);
        }
      }
      for (const done of agentsDone) doneByAgent.set(done.agent, Math.max(doneByAgent.get(done.agent) ?? -Infinity, done.ms));
      incomplete = spawned.some(spawn => {
        const work = workByAgent.get(spawn.agent);
        return !work?.messages || !(doneByAgent.get(spawn.agent) >= Math.max(spawn.ms, work.latest));
      });
    }
    if (incomplete) for (const node of candidates) node.unfinished = true;
  }
  const groups = new Map();
  for (const node of nodes) {
    const top = root(node);
    let group = groups.get(top);
    if (!group) groups.set(top, group = { nodes: [], prompts: [], receipts: new Map() });
    group.nodes.push(node);
    for (const [id, r] of node.receipts) group.receipts.set(id, r);
  }
  for (const s of spaces.values()) for (const variants of s.prompts.values()) groups.get(root(eventNode.get(variants[0]))).prompts.push(variants[0]);
  // A linked receipt is still unowned work if its root interaction has no initiating message.
  for (const group of groups.values()) if (!group.prompts.length && !group.nodes.some(n => n.events.some(e => e.kind === 'user' && e.origin === 'automated'))) {
    for (const node of group.nodes) for (const e of node.events) uncertain.add(e.sessionId);
    const invalid = group.nodes.some(n => n.bad || n.accounting);
    for (const id of group.receipts.keys()) { assigned.delete(id); if (invalid) conflictingReceipts.add(id); }
  }
  // Everything below is independent of the dashboard's filters, so it is computed once and kept.
  const copilotSessions = new Set(), otherSessions = new Set(), seeds = [], seeded = new Map();
  for (const r of records) copilotSessions.add(r.sessionId);
  for (const variants of receipts.values()) for (const e of variants) if (!e.copilot) otherSessions.add(e.sessionId);
  const attributed = id => copilotSessions.has(id) && !otherSessions.has(id);
  for (const s of spaces.values()) for (const events of s.userEvents.values()) for (const e of events) if (attributed(e.sessionId)) {
    const projects = seeded.get(e.sessionId) || seeded.set(e.sessionId, new Set()).get(e.sessionId);
    if (!projects.has(e.project)) { projects.add(e.project); seeds.push({ sessionId: e.sessionId, project: e.project }); }
  }
  const prompts = [];
  for (const group of groups.values()) {
    if (!group.prompts.length) continue;
    const receiptEvents = [...group.receipts.values()];
    // Receipts of interactions that ran under a parent tool call; most groups have none.
    let delegated = null;
    for (const node of group.nodes) if (node.scope) for (const key of node.receipts.keys()) (delegated ??= new Set()).add(key);
    const charges = receiptEvents.map(r => {
      const record = recordByKey.get(r.receiptKey);
      const measured = record && Number.isSafeInteger(record.inputTotal) && record.inputTotal >= 0 && Number.isSafeInteger(record.output) && record.output >= 0;
      return { model: r.model, nano: r.nano, tokens: measured ? record.inputTotal + record.output : -1,
        role: delegated?.has(r.receiptKey) ? SUBAGENT : r.initiator === 'user' ? INITIAL : r.initiator === 'agent' ? CONTINUATION : UNRECORDED };
    });
    const linksKnown = group.prompts.length === 1 && !group.nodes.some(n => n.bad);
    const doubtful = group.prompts.length !== 1 || group.nodes.some(n => n.bad || n.events.some(e => uncertain.has(e.sessionId)));
    const incomplete = !charges.length || group.nodes.some(n => n.accounting), unfinished = group.nodes.some(n => n.unfinished);
    // Interruptions explain unfinished work, never missing/conflicting bills or child work.
    const interrupted = !doubtful && unfinished && !group.nodes.some(n => n.accounting || n.scope || n.unfinished &&
      (!n.interruption || n.messages.some(m => m.ms > n.interruption.ms) || n.turns.some(t => t.start.ms > n.interruption.ms)));
    const limitation = interrupted ? group.nodes.some(n => n.interruption?.kind === 'abort') ? 'cancelledPrompts' : 'interruptedPrompts' : '';
    const contextScopes = new Map();
    for (const node of group.nodes) {
      let c = contextScopes.get(node.scope);
      if (!c) contextScopes.set(node.scope, c = { first: null, firstCount: 0, models: new Set(), conflict: false });
      for (const m of node.messages) {
        if (!c.first || m.ms < c.first.ms) { c.first = m; c.firstCount = 1; }
        else if (m.ms === c.first.ms) c.firstCount++;
      }
      for (const key of node.receipts.keys()) {
        if (conflictingContext.has(key)) c.conflict = true;
        const r = recordByKey.get(key);
        if (r && r.origin !== 'compaction' && r.initiator !== 'sub-agent') c.models.add(r.modelId || '');
      }
    }
    for (const prompt of group.prompts) {
      const origin = eventNode.get(prompt);
      const contextScope = contextScopes.get(origin.scope), firstCall = contextScope.first;
      const initial = receiptEvents.some(r => r.api === firstCall?.api && r.sessionId === prompt.sessionId && r.initiator === 'user');
      let identity = prompt.origin === 'user' || linksKnown && initial;
      if (identity) for (const e of origin.space.userEvents.get(prompt.promptId)) if (e.project !== prompt.project || e.origin !== prompt.origin || eventNode.get(e).scope) { identity = false; break; }
      const sampleReceipt = receiptEvents.find(r => r.api === firstCall?.api && r.sessionId === prompt.sessionId);
      // Context input is independent of bill completeness, but needs one unambiguous root call.
      const contextRecord = linksKnown && contextScope.firstCount === 1 && firstCall?.ms >= prompt.ms && sampleReceipt?.ms >= prompt.ms &&
        !conflictingReceipts.has(sampleReceipt?.receiptKey) && !conflictingContext.has(sampleReceipt?.receiptKey)
        ? recordByKey.get(sampleReceipt?.receiptKey) : null;
      const contextBoundary = contextScope.conflict || contextScope.models.size !== 1 || !contextRecord?.modelId || !contextScope.models.has(contextRecord.modelId);
      // Delivery describes a submission even when several submissions share a billing group.
      // An omitted source still requires a user-initiated root call; conflicting copies cannot establish its date or origin.
      let humanDelivery = prompt.origin === 'user' || prompt.origin === 'unspecified' && initial && !conflictingReceipts.has(sampleReceipt?.receiptKey);
      if (humanDelivery) for (const e of origin.space.userEvents.get(prompt.promptId))
        if (e.project !== prompt.project || e.origin !== prompt.origin || e.ms !== prompt.ms || e.interaction !== prompt.interaction || eventNode.get(e).scope) { humanDelivery = false; break; }
      let delivery = prompt.delivery || 'unknown';
      for (const e of origin.space.userEvents.get(prompt.promptId)) if ((e.delivery || 'unknown') !== delivery) { delivery = 'unknown'; break; }
      prompts.push({ sessionId: prompt.sessionId, project: prompt.project, day: dayOfMs(prompt.ms), charges, linksKnown, identity, humanDelivery, limitation, delivery, contextBoundary,
        contextRecord: contextRecord?.origin !== 'compaction' && !contextRecord?.reviewOrigin && !contextRecord?.backgroundActivity && contextRecord?.initiator !== 'sub-agent' ? contextRecord : null,
        sample: { promptId: prompt.promptId, interaction: prompt.interaction, recordKey: sampleReceipt?.receiptKey, ms: prompt.ms, delivery },
        provider: linksKnown && charges.length ? receiptEvents.every(r => r.copilot) : attributed(prompt.sessionId),
        state: doubtful || prompt.origin === 'unspecified' && !initial ? ATTRIBUTION : incomplete ? ACCOUNTING : unfinished ? UNFINISHED : ELIGIBLE });
    }
  }
  const stops = [];
  for (const [id, s] of spaces) if (attributed(id)) for (const variant of s.byEvent.values()) {
    // Conflicting copies cannot establish a stop's date, project or origin.
    if (!Array.isArray(variant) && variant.kind === 'abort' && variant.cancelled && !variant.agent && !variant.parentTool)
      stops.push({ sessionId: id, project: variant.project, day: dayOfMs(variant.ms), ms: variant.ms });
  }
  return { prompts, seeds, stops, unassigned: records.filter(r => !assigned.has(r.key)), conflictingReceipts };
}

// Journals rarely change between reports, and one refresh usually changes a single session.
// `memo` belongs to the caller (one per history source); sessions whose events and records
// are the very same objects as last time keep their earlier attribution.
function attributePrompts(events, records, nowMs, { memo, unique } = {}) {
  const cached = memo?.prompts;
  if (cached && cached.events === events && cached.records === records && nowMs >= cached.latest && nowMs < cached.next) return cached;
  let latest = -Infinity, next = Infinity, source = events;
  if (!unique) { const set = createPromptEventSet(); for (const e of events) set.add(e); source = set.events; }
  const eventsBySession = new Map(), recordsBySession = new Map(), recordByKey = new Map(), future = new Set();
  const group = (map, id, item) => { const list = map.get(id); if (list) list.push(item); else map.set(id, [item]); };
  // Entries arrive journal by journal, so a session's list is looked up once per run of them.
  let run, runList;
  for (const e of source) {
    if (!(e.ms <= nowMs)) { if (e.ms > nowMs) { future.add(e.sessionId); if (e.ms < next) next = e.ms; } continue; }
    if (e.ms > latest) latest = e.ms;
    if (e.sessionId !== run || !runList) { run = e.sessionId; runList = eventsBySession.get(run); if (!runList) eventsBySession.set(run, runList = []); }
    runList.push(e);
  }
  run = runList = undefined;
  for (const r of records) {
    recordByKey.set(r.key, r);
    if (!(r.ms <= nowMs)) { if (r.ms > nowMs) { future.add(r.sessionId); if (r.ms < next) next = r.ms; } continue; }
    if (r.ms > latest) latest = r.ms;
    if (r.sessionId !== run || !runList) { run = r.sessionId; runList = recordsBySession.get(run); if (!runList) recordsBySession.set(run, runList = []); }
    runList.push(r);
  }
  // A receipt recorded in one journal for another session's call ties those sessions together.
  const parent = new Map(), receiptOwner = new Map();
  const find = id => {
    let top = id;
    while (parent.has(top)) top = parent.get(top);
    while (parent.has(id)) { const next = parent.get(id); parent.set(id, top); id = next; }
    return top;
  };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a); };
  for (const [id, list] of eventsBySession) for (const e of list) if (e.kind === 'receipt') {
    const record = recordByKey.get(e.receiptKey);
    if (record) { if (record.sessionId !== id) union(id, record.sessionId); continue; }
    const owner = receiptOwner.get(e.receiptKey);
    if (owner === undefined) receiptOwner.set(e.receiptKey, id);
    else if (owner !== id) union(owner, id);
  }
  const outcomes = [], sessions = new Map();
  const ids = new Set(eventsBySession.keys());
  for (const id of recordsBySession.keys()) ids.add(id);
  const solo = id => {
    const list = eventsBySession.get(id) || EMPTY, own = recordsBySession.get(id) || EMPTY;
    // A session with items dated after `now` is never reused: its inputs depend on the clock.
    const before = !future.has(id) && cached?.sessions.get(id);
    const entry = before && sameList(before.events, list) && sameList(before.records, own) ? before
      : { events: list, records: own, outcome: list.length ? attributeSessions(list.slice().sort(byTime), own, recordByKey) : { prompts: EMPTY, seeds: EMPTY, unassigned: own } };
    if (!future.has(id)) sessions.set(id, entry);
    outcomes.push(entry.outcome);
  };
  if (!parent.size) for (const id of ids) solo(id);
  else {
    const coupled = new Map();
    for (const id of ids) group(coupled, find(id), id);
    const inputs = new Map(), inputBySession = new Map();
    for (const [id, members] of coupled) if (members.length > 1) {
      const input = { events: [], records: [] }; inputs.set(id, input);
      for (const member of members) inputBySession.set(member, input);
    }
    // Partition once, retaining the input order used to break equal timestamp/ID ties.
    for (const e of source) if (e.ms <= nowMs) inputBySession.get(e.sessionId)?.events.push(e);
    for (const r of records) if (r.ms <= nowMs) inputBySession.get(r.sessionId)?.records.push(r);
    for (const [id, members] of coupled) {
      if (members.length === 1) { solo(members[0]); continue; }
      // Coupled sessions are solved together, in their original relative order.
      const input = inputs.get(id);
      outcomes.push(attributeSessions(input.events.sort(byTime), input.records, recordByKey));
    }
  }
  const result = { events, records, latest, next, sessions, outcomes };
  if (memo) memo.prompts = result;
  return result;
}

// Reuse the accounting graph's human identity and ambiguity checks; no prompt text is retained.
export function reviewPromptCandidates(events, records, query, start, end, now, options) {
  const { outcomes } = attributePrompts(events, records, now.getTime(), options), found = [], seen = new Set();
  const models = query.models && new Set(query.models);
  const byKey = new Map(records.map(r => [r.key, r]));
  for (const outcome of outcomes) for (const p of outcome.prompts) {
    if (!p.identity || !p.linksKnown || !p.provider || p.day < start || p.day > end || query.project && p.project !== query.project || query.session && p.sessionId !== query.session) continue;
    if (models && !p.charges.some(r => models.has(r.model))) continue;
    const record = byKey.get(p.sample.recordKey), key = JSON.stringify([p.sessionId, p.sample.promptId]);
    if (!record?.logFile || !record.apiCallId || !p.sample.interaction || seen.has(key)) continue;
    seen.add(key); found.push({ ...p.sample, record, sessionId: p.sessionId });
  }
  return found;
}

export function summarizePromptCredits(events = [], records = [], query, start, end, now, options) {
  const result = { prompts: 0, eligiblePrompts: 0, credits: null, averageCredits: null, modelFiltered: !!query.models,
    excluded: { attribution: 0, accounting: 0, unfinished: 0 }, unlinkedRequests: 0,
    coverage: { cancelledPrompts: 0, interruptedPrompts: 0, pluginCalls: 0, compactionCalls: 0, unexpectedPrompts: 0, unexpectedCalls: 0 },
    work: { requests: 0, averageRequests: null, maxRequests: null, tokenPrompts: 0, tokens: null, averageTokens: null } };
  const { outcomes } = attributePrompts(events, records, now.getTime(), options);
  const models = query.models && new Set(query.models), work = result.work, nano = exactTotal(), projectPrompts = new Map(), modelPrompts = new Map(), sessionPrompts = new Map();
  const conversations = createConversationAccumulator(records, query, start, end, now);
  const contextGrowth = createContextGrowthAccumulator(query, start, end, now);
  const habits = options?.interactions ? createHabitsAccumulator(query, start, end, now, options.interactions) : null;
  const spread = promptSpread();
  let previousCharges, selectedCharges, groupModels;
  let groupVisible = false, groupCount = 0, groupUncertain = 0;
  const projectCount = name => projectPrompts.get(name) || projectPrompts.set(name, { name, count: 0, uncertain: 0 }).get(name);
  const sessionCount = (project, id) => {
    const key = JSON.stringify([project, id]);
    return sessionPrompts.get(key) || sessionPrompts.set(key, { project, id, count: 0, uncertain: 0 }).get(key);
  };
  const modelCount = name => modelPrompts.get(name) || modelPrompts.set(name, { name, count: 0, uncertain: 0 }).get(name);
  const finishGroupModels = () => {
    if (groupVisible) for (const name of groupModels) {
      const model = modelCount(name); model.count += groupCount; model.uncertain += groupUncertain;
    }
    groupVisible = false; groupCount = groupUncertain = 0;
  };
  // Count submissions separately from cost eligibility; missing charges do not erase a known user action.
  for (const outcome of outcomes) {
    for (const stop of outcome.stops || EMPTY) conversations.stop(stop);
    if (!models) for (const seed of outcome.seeds) if (!query.session || query.session === seed.sessionId) {
      projectCount(seed.project); sessionCount(seed.project, seed.sessionId);
    }
    for (const prompt of outcome.prompts) {
      conversations.add(prompt, prompt.state === ELIGIBLE);
      contextGrowth.add(prompt);
      habits?.add(prompt, prompt.state === ELIGIBLE);
      if (query.session && query.session !== prompt.sessionId) continue;
      const charges = prompt.charges;
      // Prompts from one shared interaction are consecutive and share the charge array.
      if (charges !== previousCharges) {
        finishGroupModels();
        previousCharges = charges;
        selectedCharges = models ? charges.filter(r => models.has(r.model)) : charges;
        groupModels = new Set(selectedCharges.map(r => r.model).filter(Boolean));
      }
      const selected = selectedCharges;
      const dated = prompt.day >= start && prompt.day <= end;
      if (prompt.provider && (!models || selected.length || !charges.length)) {
        const count = projectCount(prompt.project);
        const session = sessionCount(prompt.project, prompt.sessionId);
        if (dated) {
          const key = prompt.identity && (!models || prompt.linksKnown && selected.length) ? 'count' : 'uncertain';
          count[key]++; session[key]++;
        }
        if (!query.project || query.project === prompt.project) {
          groupVisible = true;
          if (dated) { if (prompt.identity && prompt.linksKnown) groupCount++; else groupUncertain++; }
        }
      }
      if (!dated || query.project && query.project !== prompt.project || models && !selected.length) continue;
      result.prompts++;
      if (prompt.state !== ELIGIBLE) result.coverage[prompt.limitation || 'unexpectedPrompts']++;
      if (prompt.state === ATTRIBUTION) result.excluded.attribution++;
      else if (prompt.state === ACCOUNTING) result.excluded.accounting++;
      else if (prompt.state === UNFINISHED) result.excluded.unfinished++;
      else {
        result.eligiblePrompts++;
        work.requests += selected.length;
        work.maxRequests = Math.max(work.maxRequests ?? 0, selected.length);
        let tokens = 0, measured = true;
        for (const r of selected) { nano.add(r.nano); if (r.tokens < 0) measured = false; else tokens += r.tokens; }
        if (measured) { work.tokenPrompts++; work.tokens = (work.tokens ?? 0) + tokens; }
        spread.add(prompt, selected, measured ? tokens : null);
      }
    }
    for (const r of outcome.unassigned) {
      if (query.session && query.session !== r.sessionId || query.project && query.project !== r.project || models && !models.has(r.model)) continue;
      const day = dayOfMs(r.ms);
      if (day >= start && day <= end) {
        result.unlinkedRequests++;
        const conflict = outcome.conflictingReceipts?.has(r.key);
        result.coverage[conflict ? 'unexpectedCalls' : r.reviewOrigin || r.backgroundActivity ? 'pluginCalls' : r.origin === 'compaction' ? 'compactionCalls' : 'unexpectedCalls']++;
      }
    }
  }
  finishGroupModels();
  result.projectPrompts = [...projectPrompts.values()];
  result.conversations = conversations.finish(options?.sessionLabels);
  result.contextGrowth = contextGrowth.finish(options?.sessionLabels);
  if (habits) result.habits = habits.finish();
  result.modelPrompts = [...modelPrompts.values()];
  result.sessionPrompts = [...sessionPrompts.values()];
  if (result.eligiblePrompts) { result.credits = nano.number() / 1e9; result.averageCredits = result.credits / result.eligiblePrompts; }
  work.averageRequests = result.eligiblePrompts ? work.requests / result.eligiblePrompts : null;
  work.averageTokens = work.tokenPrompts ? work.tokens / work.tokenPrompts : null;
  return Object.assign(result, spread.finish(options?.sessionLabels));
}
