import { dayOfMs, dayKey } from './query.mjs';

// What followed each failed tool call, and failures that came one after another.
//
// An operation is one (name, server, MCP tool), as in the tool report. A call is compared only
// with other calls of the same operation in the same session, in order of start time:
//   - what followed a failure is the first later call that started once the failed call had
//     finished, so a call that was already running beside it is not read as another try;
//   - a run is a stretch of calls in a row that all failed. A success or a call with no
//     recorded outcome ends it: an unknown outcome is never counted as a failure.
// Tool arguments never reach this code, so a following call is the same operation, not
// necessarily the same request. Tool events arrive in no particular order. Each (session,
// operation) keeps three numbers per call and is put in order only if it holds a failure.
const MINIMUM_KNOWN = 5;  // known outcomes an operation needs before its failure rate is ranked
const RUN_LENGTH = 3;     // failures in a row that are counted as a repeated-failure run
const LIST = 5, TREND_POINTS = 62, STRIDE = 3, UNKNOWN = 0, SUCCEEDED = 1, FAILED = 2, NONE = Symbol('none');
const AFTER = ['unknown', 'succeeded', 'failed'];

const share = (part, whole) => whole > 0 ? part / whole * 100 : null;
const text = (a, b) => String(a).localeCompare(String(b));
const byIdentity = (a, b) => text(a.name, b.name) || text(a.server, b.server) || text(a.mcpTool, b.mcpTool);

// Calls as [start, outcome, finished, ...] in order of start. Equal starts fall back to the
// other two numbers, so the result never depends on the order the events arrived in.
function inOrder(calls) {
  const order = Array.from({ length: calls.length / STRIDE }, (_, index) => index * STRIDE);
  order.sort((a, b) => calls[a] - calls[b] || calls[a + 1] - calls[b + 1] || calls[a + 2] - calls[b + 2]);
  const sorted = [];
  for (const at of order) sorted.push(calls[at], calls[at + 1], calls[at + 2]);
  return sorted;
}
// The first call from `from` on that started at or after `time`.
function startedFrom(calls, from, count, time) {
  let low = from, high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (calls[middle * STRIDE] < time) low = middle + 1; else high = middle;
  }
  return low;
}
// Longest first, then most recent, then by name, so equal runs always list the same way.
const compareRuns = (a, b) => b.length - a.length || b.ms - a.ms || byIdentity(a.op, b.op) || text(a.session, b.session);
function keepRun(list, run) {
  if (list.length === LIST && compareRuns(list[LIST - 1], run) <= 0) return;
  let at = list.length;
  while (at > 0 && compareRuns(list[at - 1], run) > 0) at--;
  list.splice(at, 0, run);
  if (list.length > LIST) list.pop();
}

export function createRecoveryTopic(context = {}) {
  const byName = new Map(), operations = [], bySession = new Map(), sequences = [], days = new Map();
  let session = NONE, sessionSequences;
  return {
    add(tool, outcome) {
      const name = tool.name ?? '', server = tool.server || '', mcpTool = tool.mcpTool || '';
      let servers = byName.get(name);
      if (!servers) byName.set(name, servers = new Map());
      let mcpTools = servers.get(server);
      if (!mcpTools) servers.set(server, mcpTools = new Map());
      let op = mcpTools.get(mcpTool);
      if (!op) {
        mcpTools.set(mcpTool, op = { name, server, mcpTool, calls: 0, successes: 0, failures: 0, unknown: 0,
          failedMs: 0, failedCalls: 0, knownMs: 0, knownCalls: 0, placed: 0, after: null, longestRun: 0 });
        operations.push(op);
      }
      op.calls++;
      const ms = tool.ms, timed = Number.isFinite(ms);
      // Time in a call needs both ends. A call recorded without them still counts as a call.
      const finished = timed && Number.isFinite(tool.completedMs) && tool.completedMs >= ms ? tool.completedMs : null;
      const code = outcome === true ? SUCCEEDED : outcome === false ? FAILED : UNKNOWN;
      if (code === UNKNOWN) op.unknown++;
      else {
        if (finished !== null) { op.knownCalls++; op.knownMs += finished - ms; }
        if (code === SUCCEEDED) op.successes++;
        else { op.failures++; if (finished !== null) { op.failedCalls++; op.failedMs += finished - ms; } }
        if (timed) {
          const day = dayOfMs(ms);
          let bucket = days.get(day);
          if (!bucket) days.set(day, bucket = { known: 0, failures: 0 });
          bucket.known++;
          if (code === FAILED) bucket.failures++;
        }
      }
      // A call with no usable start time has no place in a sequence.
      if (!timed) return;
      if (tool.sessionId !== session) {
        session = tool.sessionId; sessionSequences = bySession.get(session);
        if (!sessionSequences) bySession.set(session, sessionSequences = new Map());
      }
      let sequence = sessionSequences.get(op);
      if (!sequence) { sessionSequences.set(op, sequence = { op, session, calls: [], failures: 0, ordered: true }); sequences.push(sequence); }
      const calls = sequence.calls, last = calls.length - STRIDE, end = code === FAILED ? finished ?? ms : 0;
      if (sequence.ordered && last >= 0 && (ms - calls[last] || code - calls[last + 1] || end - calls[last + 2]) < 0) sequence.ordered = false;
      calls.push(ms, code, end);
      if (code === FAILED) sequence.failures++;
    },
    finish() {
      const labels = context.sessionLabels, top = [];
      const followed = { failures: 0, succeeded: 0, failed: 0, unknown: 0, none: 0 };
      let longest = 0, repeated = 0, repeatedFailures = 0, runs = 0;
      for (const op of operations) { op.placed = 0; op.longestRun = 0; op.after = { succeeded: 0, failed: 0, unknown: 0, none: 0 }; }
      const endRun = (sequence, length, ms, then) => {
        const op = sequence.op;
        if (length > op.longestRun) op.longestRun = length;
        if (length > longest) longest = length;
        if (length >= RUN_LENGTH) { repeated++; repeatedFailures += length; }
        if (length >= 2) { runs++; keepRun(top, { op, session: sequence.session, length, ms, then }); }
      };
      for (const sequence of sequences) {
        if (!sequence.failures) continue;
        if (!sequence.ordered) { sequence.calls = inOrder(sequence.calls); sequence.ordered = true; }
        const calls = sequence.calls, count = calls.length / STRIDE, op = sequence.op;
        let run = 0, runStart = 0;
        for (let i = 0; i < count; i++) {
          const code = calls[i * STRIDE + 1];
          if (code !== FAILED) {
            if (run) endRun(sequence, run, runStart, AFTER[code]);
            run = 0;
            continue;
          }
          if (!run++) runStart = calls[i * STRIDE];
          const finished = calls[i * STRIDE + 2];
          let next = i + 1;
          if (next < count && calls[next * STRIDE] < finished) next = startedFrom(calls, next + 1, count, finished);
          const then = next < count ? AFTER[calls[next * STRIDE + 1]] : 'none';
          op.placed++; op.after[then]++; followed.failures++; followed[then]++;
        }
        if (run) endRun(sequence, run, runStart, 'none');
      }
      const row = op => {
        const known = op.successes + op.failures, a = op.after;
        return { name: op.name, server: op.server, mcpTool: op.mcpTool, calls: op.calls, successes: op.successes, failures: op.failures, unknown: op.unknown,
          known, failureRate: share(op.failures, known),
          followed: { failures: op.placed, ...a, known: a.succeeded + a.failed, share: share(a.succeeded, a.succeeded + a.failed) },
          longestRun: op.longestRun, failedMs: op.failedCalls ? op.failedMs : null, failedCalls: op.failedCalls };
      };
      const total = key => operations.reduce((sum, op) => sum + op[key], 0);
      const calls = total('calls'), successes = total('successes'), failures = total('failures'), known = successes + failures;
      const failedCalls = total('failedCalls'), knownCalls = total('knownCalls'), failedMs = total('failedMs'), knownMs = total('knownMs');
      const failing = operations.filter(op => op.failures > 0).map(row);
      const ranked = failing.filter(op => op.known >= MINIMUM_KNOWN);
      const orderedDays = [...days].sort((a, b) => a[0] - b[0]);
      let trend = { unit: 'day', points: [] };
      if (orderedDays.length) {
        const first = orderedDays[0][0], weekly = orderedDays.at(-1)[0] - first >= TREND_POINTS, span = weekly ? 7 : 1, points = [];
        let startBucket = null, cur = null;
        const flush = () => {
          if (!cur) return;
          points.push({ day: dayKey(startBucket), known: cur.known, failures: cur.failures, failureRate: cur.known > 0 ? Math.round(cur.failures / cur.known * 10000) / 100 : null });
        };
        for (const [day, d] of orderedDays) {
          const bucket = first + Math.floor((day - first) / span) * span;
          if (bucket !== startBucket) { flush(); startBucket = bucket; cur = { known: 0, failures: 0 }; }
          cur.known += d.known; cur.failures += d.failures;
        }
        flush();
        trend = { unit: weekly ? 'week' : 'day', points: points.slice(-TREND_POINTS) };
      }
      return {
        minimumKnown: MINIMUM_KNOWN, runLength: RUN_LENGTH,
        calls, successes, failures, unknown: total('unknown'), known, failureRate: share(failures, known),
        followed: { ...followed, known: followed.succeeded + followed.failed, share: share(followed.succeeded, followed.succeeded + followed.failed) },
        runs: { longest, repeated, repeatedFailures, total: runs,
          top: top.map(run => ({ name: run.op.name, server: run.op.server, mcpTool: run.op.mcpTool, session: labels?.get(run.session) || 'Unnamed session',
            length: run.length, day: dayKey(dayOfMs(run.ms)), then: run.then })) },
        time: { failedMs: failedCalls ? failedMs : null, failedCalls, knownMs: knownCalls ? knownMs : null, knownCalls,
          share: failedCalls && knownMs > 0 ? failedMs / knownMs * 100 : null },
        trend,
        operations: { called: operations.length, failing: failing.length, ranked: ranked.length,
          byFailures: failing.slice().sort((a, b) => b.failures - a.failures || b.failureRate - a.failureRate || byIdentity(a, b)).slice(0, LIST),
          byRate: ranked.sort((a, b) => b.failureRate - a.failureRate || b.failures - a.failures || byIdentity(a, b)).slice(0, LIST) },
      };
    },
  };
}
