// How much material tool activity brings into the conversation, as far as the history shows it.
//
// The history records no per-file or per-result token bill. Two things are measured instead:
//   - what the agent ran: executed tool calls grouped into plain families by the recorded tool
//     name (MCP tools by the recorded server field), with how long calls with a recorded
//     completion took;
//   - input added between consecutive main-conversation model calls: the next call's input minus
//     the earlier call's input and output. That is an ESTIMATE of what was added in between (tool
//     results plus any new user message), grouped by how many tool calls started in between.
// Tool arguments and results never reach this code.
//
// A conversation is used for the second measure only when it can be ordered and its tool calls
// can be told from a subagent's: tool events carry no agent field, so any conversation that
// recorded subagent calls (or calls with no recorded initiator) is left out, as is one with no
// tool events at all, where a count of zero would only mean "not recorded".
const FAMILIES = [
  { id: 'read', label: 'Reading files', names: ['view', 'read', 'read_file', 'open_file', 'cat', 'view_image'] },
  { id: 'search', label: 'Searching', names: ['grep', 'glob', 'search', 'find', 'rg', 'file_search', 'codebase_search', 'semantic_search', 'list_dir', 'ls'] },
  { id: 'command', label: 'Running commands', names: ['bash', 'powershell', 'shell', 'read_bash', 'write_bash', 'stop_bash', 'list_bash', 'read_powershell', 'write_powershell', 'stop_powershell', 'list_powershell', 'run_in_terminal', 'execute'] },
  { id: 'edit', label: 'Editing files', names: ['edit', 'create', 'write', 'apply_patch', 'str_replace', 'str_replace_editor', 'insert', 'multi_edit', 'write_file'] },
  { id: 'mcp', label: 'MCP tools', names: [] },
  { id: 'other', label: 'Other tools', names: [] },
];
const OTHER = FAMILIES.findIndex(family => family.id === 'other'), MCP = FAMILIES.findIndex(family => family.id === 'mcp');
const FAMILY_OF = new Map();
FAMILIES.forEach((family, index) => { for (const name of family.names) FAMILY_OF.set(name, index); });
// Steps are grouped by the number of tool calls that started between two model calls.
const GROUPS = [{ id: 'none', label: 'No tool call', low: 0, high: 0 }, { id: 'one', label: '1 tool call', low: 1, high: 1 },
  { id: 'few', label: '2 to 3 tool calls', low: 2, high: 3 }, { id: 'many', label: '4 or more tool calls', low: 4, high: Infinity }];
const groupOf = count => count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : 3;
const STRIDE = 3, TOOL_STRIDE = 2, LIST = 5, NAME_LIMIT = 200;
const STEP_FAMILIES = [...FAMILIES.map(({ id, label }) => ({ id, label })), { id: 'mixed', label: 'Multiple tool kinds' }];
const NONE = Symbol('none');
const known = value => Number.isFinite(value) && value >= 0;
const share = (part, whole) => whole > 0 ? part / whole * 100 : null;

// The middle value: half of the samples are at or above it and half at or below. Sorts in place.
function middleOf(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const half = values.length >> 1;
  return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2;
}

export function createToolMaterial({ query = {}, now = new Date() } = {}) {
  const nowMs = now.getTime();
  const families = FAMILIES.map(() => ({ calls: 0, durations: [], totalMs: 0 }));
  const otherNames = new Map();
  let calls = 0, timed = 0, otherOverflow = 0;
  // Per session: model calls as [time, input, output] in one flat list (-1 when not recorded) and
  // the start time of every tool call. Records and tool events usually arrive in time order.
  const sessions = new Map();
  let id = NONE, session;
  const place = sessionId => {
    if (sessionId === id) return session;
    id = sessionId; session = sessions.get(id);
    if (!session) sessions.set(id, session = { calls: [], ordered: true, latest: -Infinity, tools: [], toolsOrdered: true, toolLatest: -Infinity, subagent: false, unknown: false });
    return session;
  };
  return {
    add(r) {
      if (typeof r.sessionId !== 'string' || !r.sessionId) return;
      // A summarization call for a compaction runs in its own context, not the conversation's.
      if (r.origin === 'compaction') return;
      const s = place(r.sessionId);
      if (r.initiator === 'sub-agent') { s.subagent = true; return; }
      if (r.initiator !== 'user' && r.initiator !== 'agent') { s.unknown = true; return; }
      if (!Number.isFinite(r.ms)) return;
      s.calls.push(r.ms, known(r.inputTotal) ? r.inputTotal : -1, known(r.output) ? r.output : -1);
      if (r.ms < s.latest) s.ordered = false; else s.latest = r.ms;
    },
    addTool(tool) {
      calls++;
      const family = tool.server ? MCP : FAMILY_OF.get(String(tool.name ?? '').trim().toLowerCase()) ?? OTHER;
      const row = families[family];
      row.calls++;
      if (family === OTHER) {
        const name = String(tool.name ?? '').trim();
        if (otherNames.has(name)) otherNames.set(name, otherNames.get(name) + 1);
        else if (otherNames.size < NAME_LIMIT) otherNames.set(name, 1);
        else otherOverflow++;
      }
      const ms = tool.ms;
      if (!Number.isFinite(ms)) return;
      if (Number.isFinite(tool.completedMs) && tool.completedMs >= ms && tool.completedMs <= nowMs) {
        const took = tool.completedMs - ms;
        row.durations.push(took); row.totalMs += took; timed++;
      }
      if (typeof tool.sessionId !== 'string' || !tool.sessionId) return;
      const s = place(tool.sessionId);
      s.tools.push(ms, family);
      if (ms < s.toolLatest) s.toolsOrdered = false; else s.toolLatest = ms;
    },
    finish() {
      const stats = GROUPS.map(() => ({ steps: 0, shrunk: 0, added: [] }));
      const familyStats = STEP_FAMILIES.map(() => ({ steps: 0, shrunk: 0, added: [] }));
      const used = { total: 0, used: 0, subagent: 0, unknownInitiator: 0, noToolEvents: 0, tooShort: 0 };
      let mainCalls = 0, steps = 0, unmeasured = 0, shrunk = 0, grew = 0;
      for (const s of sessions.values()) {
        const count = s.calls.length / STRIDE;
        if (!count && !s.subagent && !s.unknown) continue;
        used.total++;
        mainCalls += count;
        if (s.subagent) { used.subagent++; continue; }
        if (s.unknown) { used.unknownInitiator++; continue; }
        if (!s.tools.length) { used.noToolEvents++; continue; }
        if (count < 2) { used.tooShort++; continue; }
        used.used++;
        const list = s.calls;
        // Equal times keep the order the calls were recorded in.
        const order = s.ordered ? null : Array.from({ length: count }, (_, index) => index).sort((a, b) => list[a * STRIDE] - list[b * STRIDE] || a - b);
        const toolCount = s.tools.length / TOOL_STRIDE;
        let tools = s.tools;
        if (!s.toolsOrdered) {
          const toolOrder = Array.from({ length: toolCount }, (_, index) => index * TOOL_STRIDE)
            .sort((a, b) => tools[a] - tools[b] || tools[a + 1] - tools[b + 1]);
          const sorted = new Array(tools.length);
          for (let i = 0; i < toolOrder.length; i++) {
            sorted[i * TOOL_STRIDE] = tools[toolOrder[i]];
            sorted[i * TOOL_STRIDE + 1] = tools[toolOrder[i] + 1];
          }
          tools = sorted;
        }
        const at = index => (order ? order[index] : index) * STRIDE;
        // Tool calls that started at or after one call and before the next belong to the step
        // between them. One pointer moves through the tool calls as the model calls advance.
        let pointer = 0;
        while (pointer < toolCount && tools[pointer * TOOL_STRIDE] < list[at(0)]) pointer++;
        for (let index = 1; index < count; index++) {
          const before = at(index - 1), after = at(index), start = pointer;
          let singleFamily = -1, mixed = false;
          while (pointer < toolCount && tools[pointer * TOOL_STRIDE] < list[after]) {
            const fam = tools[pointer * TOOL_STRIDE + 1];
            if (singleFamily === -1) singleFamily = fam;
            else if (singleFamily !== fam) mixed = true;
            pointer++;
          }
          const inputBefore = list[before + 1], outputBefore = list[before + 2], inputAfter = list[after + 1];
          if (inputBefore < 0 || outputBefore < 0 || inputAfter < 0) { unmeasured++; continue; }
          const inStep = pointer - start, group = stats[groupOf(inStep)], added = inputAfter - inputBefore - outputBefore;
          steps++; group.steps++;
          if (added < 0) { shrunk++; group.shrunk++; } else { grew++; group.added.push(added); }
          if (inStep > 0) {
            const fRow = familyStats[mixed ? FAMILIES.length : singleFamily];
            fRow.steps++;
            if (added < 0) fRow.shrunk++; else fRow.added.push(added);
          }
        }
      }
      const total = families.reduce((sum, row) => sum + row.calls, 0);
      const other = [...otherNames].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, LIST).map(([name, count]) => ({ name, calls: count }));
      const everything = [].concat(...stats.map(row => row.added));
      return {
        calls, timedCalls: timed,
        families: FAMILIES.map((family, index) => {
          const row = families[index];
          return { id: family.id, label: family.label, calls: row.calls, share: share(row.calls, total),
            timedCalls: row.durations.length, middleMs: middleOf(row.durations), totalMs: row.durations.length ? row.totalMs : null };
        }),
        otherNames: other, otherDistinct: otherNames.size + (otherOverflow ? 1 : 0), otherOverflow,
        added: {
          modelFiltered: !!query.models, mainCalls, sessions: used, steps, unmeasured, shrunk, grew, middle: middleOf(everything),
          groups: GROUPS.map((group, index) => {
            const row = stats[index];
            return { id: group.id, label: group.label, steps: row.steps, shrunk: row.shrunk, grew: row.added.length, middle: middleOf(row.added) };
          }),
          byFamily: STEP_FAMILIES.map((family, index) => {
            const row = familyStats[index];
            return { id: family.id, label: family.label, steps: row.steps, shrunk: row.shrunk, grew: row.added.length, middle: middleOf(row.added) };
          }),
        },
      };
    },
  };
}
