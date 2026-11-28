// Tool calls that repeat an identical earlier call in the same conversation.
//
// "Identical" is decided inside the journal parser, the only place a call's arguments exist. The
// parser leaves two numbers on each tool event: `repeat`, how many identical calls it had
// already seen in that conversation (0 for a first call, null when the call was not compared),
// and `repeatOfMs`, when the most recent of those started. No argument, path, query or
// fingerprint reaches a tool event, this module's report, or the panel.

// A call is compared only when the journal line recording its start is at most `eventChars`
// characters long. A conversation compares its first `sessionCalls` calls and a journal its first
// `journalCalls`. Later calls are not compared, so one parser never remembers more than
// `journalCalls` fingerprints.
export const REPEAT_LIMITS = Object.freeze({ eventChars: 4096, sessionCalls: 20000, journalCalls: 50000 });

// What one parser remembers so that it can compare calls: for each conversation, a fingerprint
// of every distinct call with how often it was seen and when it last started. `fingerprint`
// turns the text that identifies a call into a short keyed value; the text itself is not kept.
// "Earlier" means recorded earlier in the journal, which is the order calls were made in, so
// reading the same lines again gives the same counts.
export function createRepeatMemory(fingerprint, limits = REPEAT_LIMITS) {
  const sessions = new Map(), found = { repeat: 0, repeatOfMs: null }, NONE = Symbol('none');
  let compared = 0, id = NONE, session;
  return {
    // Whether this conversation, and this journal, can still take another compared call.
    open(sessionId) {
      if (compared >= limits.journalCalls) return false;
      if (sessionId !== id) {
        id = sessionId; session = sessions.get(id);
        if (!session) sessions.set(id, session = { seen: new Map(), compared: 0 });
      }
      return session.compared < limits.sessionCalls;
    },
    // Counts one call of the conversation last passed to open(), which must have returned true.
    // The same object is returned every time, so its two numbers are read before the next call.
    note(text, ms) {
      const print = fingerprint(text), known = session.seen.get(print);
      compared++; session.compared++;
      if (known) { found.repeat = known.count++; found.repeatOfMs = known.ms; known.ms = ms; }
      else { session.seen.set(print, { count: 1, ms }); found.repeat = 0; found.repeatOfMs = null; }
      return found;
    },
  };
}

// The two groups are told apart by the recorded tool name alone: reading and searching when a
// word of the name is in the first list, unless a word names a shell. For an MCP call the name
// is its MCP tool name. This is a naming convention, not knowledge of what a tool does.
const READING_WORDS = ['view', 'read', 'get', 'list', 'ls', 'grep', 'glob', 'search', 'find', 'fetch', 'lookup', 'query'];
const SHELL_WORDS = ['bash', 'powershell', 'pwsh', 'shell', 'terminal'];
const readingWords = new Set(READING_WORDS), shellWords = new Set(SHELL_WORDS);
export function readsOrSearches(name, mcpTool = '') {
  const words = String(mcpTool || name).split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).map(word => word.toLowerCase());
  return words.some(word => readingWords.has(word)) && !words.some(word => shellWords.has(word));
}

const LIST = 5, MINIMUM_MODEL_CALLS = 20, SOON = 5 * 60_000, LATER = 60 * 60_000;
const share = (part, whole) => whole > 0 ? part / whole * 100 : null;
const text = (a, b) => String(a).localeCompare(String(b));
const byIdentity = (a, b) => text(a.name, b.name) || text(a.server, b.server) || text(a.mcpTool, b.mcpTool);
// Whether a compaction finished after the earlier call started and before the repeat did.
function compactedBetween(times, earlier, ms) {
  for (let i = 0; i < times.length && times[i] < ms; i++) if (times[i] > earlier) return true;
  return false;
}

// How many compared tool calls repeated an earlier one: by operation, by how long ago the
// earlier call was, across a compaction, and by conversation. An operation is one (name, server,
// MCP tool), as in the tool report. Counters are kept per operation and per conversation, never
// per call.
export function createRepetitionTopic({ query = {}, now = new Date(), sessionLabels, activity = {}, records = [] } = {}) {
  const nowMs = now.getTime(), NONE = Symbol('none');
  const modelDisplay = new Map();
  for (const r of records || []) if (r?.modelId && r.model) modelDisplay.set(r.modelId, r.model);
  // When each conversation's own context was reduced. A failed compaction changed nothing, and
  // a subagent's compaction says nothing about the calls of the main conversation.
  const compactions = new Map();
  for (const e of activity.compactionEvents || []) {
    if (e.subagent || e.success !== true || !(e.ms <= nowMs)) continue;
    const times = compactions.get(e.sessionId);
    if (times) times.push(e.ms); else compactions.set(e.sessionId, [e.ms]);
  }
  for (const times of compactions.values()) times.sort((a, b) => a - b);
  const byName = new Map(), operations = [], sessions = new Map(), byModel = new Map();
  let sessionId = NONE, session, repeatedMs = 0, timedCalls = 0, readingMs = 0, readingTimedCalls = 0, unattributedModelCalls = 0;
  return {
    add(tool) {
      const name = tool.name ?? '', server = tool.server || '', mcpTool = tool.mcpTool || '';
      let servers = byName.get(name);
      if (!servers) byName.set(name, servers = new Map());
      let mcpTools = servers.get(server);
      if (!mcpTools) servers.set(server, mcpTools = new Map());
      let op = mcpTools.get(mcpTool);
      if (!op) {
        mcpTools.set(mcpTool, op = { name, server, mcpTool, reading: readsOrSearches(name, mcpTool),
          calls: 0, measured: 0, repeated: 0, timed: 0, soon: 0, mid: 0, late: 0, compactable: 0, after: 0 });
        operations.push(op);
      }
      op.calls++;
      // Anything but a whole count means the parser did not compare this call. That is not zero.
      const repeat = tool.repeat;
      if (!Number.isSafeInteger(repeat) || repeat < 0) return;
      op.measured++;
      const rawModel = typeof tool.model === 'string' && tool.model ? tool.model : '';
      if (rawModel) {
        const modelName = modelDisplay.get(rawModel) || rawModel;
        let modelStats = byModel.get(modelName);
        if (!modelStats) byModel.set(modelName, modelStats = { name: modelName, measured: 0, repeated: 0, readingMeasured: 0, readingRepeated: 0 });
        modelStats.measured++;
        if (repeat > 0) modelStats.repeated++;
        if (op.reading) { modelStats.readingMeasured++; if (repeat > 0) modelStats.readingRepeated++; }
      } else unattributedModelCalls++;
      if (tool.sessionId !== sessionId) {
        sessionId = tool.sessionId; session = sessions.get(sessionId);
        if (!session) sessions.set(sessionId, session = { id: sessionId, project: null, measured: 0, repeated: 0, times: 0, op: null, compactions: compactions.get(sessionId) });
      }
      if (tool.project) {
        if (session.project === null) session.project = tool.project;
        else if (session.project !== tool.project) session.project = '';
      }
      session.measured++;
      if (!repeat) return;
      op.repeated++; session.repeated++;
      const ms = tool.ms;
      if (Number.isFinite(ms) && Number.isFinite(tool.completedMs) && tool.completedMs >= ms && tool.completedMs <= nowMs) {
        const dur = tool.completedMs - ms;
        repeatedMs += dur; timedCalls++;
        if (op.reading) { readingMs += dur; readingTimedCalls++; }
      }
      // The same call made `repeat + 1` times so far. Equal counts keep the first name in order.
      const times = repeat + 1;
      if (times > session.times || times === session.times && byIdentity(op, session.op) < 0) { session.times = times; session.op = op; }
      // The time between two calls needs both starts, in the order the journal recorded them.
      const earlier = tool.repeatOfMs;
      if (!Number.isFinite(ms) || !Number.isFinite(earlier) || earlier > ms) return;
      op.timed++;
      const gap = ms - earlier;
      if (gap < SOON) op.soon++; else if (gap <= LATER) op.mid++; else op.late++;
      if (!session.compactions) return;
      op.compactable++;
      if (compactedBetween(session.compactions, earlier, ms)) op.after++;
    },
    finish() {
      const label = id => sessionLabels?.get(id) || 'Unnamed session';
      const group = reading => {
        const own = operations.filter(op => op.reading === reading), total = key => own.reduce((sum, op) => sum + op[key], 0);
        const measured = total('measured'), repeated = total('repeated'), repeating = own.filter(op => op.repeated > 0);
        return { calls: total('calls'), measured, repeated, share: share(repeated, measured), operations: repeating.length,
          top: repeating.sort((a, b) => b.repeated - a.repeated || b.repeated / b.measured - a.repeated / a.measured || byIdentity(a, b)).slice(0, LIST)
            .map(op => ({ name: op.name, server: op.server, mcpTool: op.mcpTool, calls: op.calls, measured: op.measured, repeated: op.repeated, share: share(op.repeated, op.measured) })),
          timing: { timed: total('timed'), under5: total('soon'), mid: total('mid'), over60: total('late') },
          compactable: total('compactable'), afterCompaction: total('after') };
      };
      const reading = group(true), other = group(false), rows = [];
      const measured = reading.measured + other.measured, repeated = reading.repeated + other.repeated;
      let compacted = 0, most = null;
      for (const s of sessions.values()) {
        if (s.compactions) compacted++;
        if (!s.repeated) continue;
        const row = { id: s.id, project: s.project || '', name: label(s.id), measured: s.measured, repeated: s.repeated, share: share(s.repeated, s.measured), times: s.times, op: s.op };
        rows.push(row);
        if (!most || row.times > most.times || row.times === most.times && (text(row.name, most.name) || text(row.id, most.id) || byIdentity(row.op, most.op)) < 0) most = row;
      }
      const modelRows = [...byModel.values()]
        .filter(m => m.readingMeasured >= MINIMUM_MODEL_CALLS)
        .map(m => ({ name: m.name, measured: m.measured, repeated: m.repeated, share: share(m.repeated, m.measured),
          readingMeasured: m.readingMeasured, readingRepeated: m.readingRepeated, readingShare: share(m.readingRepeated, m.readingMeasured) }))
        .sort((a, b) => (b.readingShare ?? -1) - (a.readingShare ?? -1) || b.readingRepeated - a.readingRepeated || text(a.name, b.name))
        .slice(0, LIST);
      return { limits: { ...REPEAT_LIMITS }, readingWords: READING_WORDS, shellWords: SHELL_WORDS, modelFiltered: !!query.models,
        calls: reading.calls + other.calls, measured, repeated, share: share(repeated, measured), sessions: sessions.size, repeatSessions: rows.length,
        reading, other,
        time: { repeatedMs: timedCalls ? repeatedMs : null, timedCalls, readingMs: readingTimedCalls ? readingMs : null, readingTimedCalls },
        minimumModelCalls: MINIMUM_MODEL_CALLS, modelsMeasured: byModel.size, unattributedModelCalls, byModel: modelRows,
        most: most && { times: most.times, name: most.op.name, server: most.op.server, mcpTool: most.op.mcpTool, session: most.name },
        compaction: { sessions: compacted, repeats: reading.compactable + other.compactable, after: reading.afterCompaction + other.afterCompaction, afterReading: reading.afterCompaction },
        conversations: rows.sort((a, b) => b.repeated - a.repeated || b.share - a.share || text(a.name, b.name) || text(a.id, b.id)).slice(0, LIST)
          .map(({ id, project, name, measured, repeated, share, times }) => ({ id, project, name, measured, repeated, share, times })) };
    },
  };
}
