import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryTopic } from '../src/core/efficiency-recovery.mjs';
import { createEfficiencyTopics } from '../src/core/efficiency-topics.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderRecovery } from '../src/panel/recovery.mjs';
import { formatNumber } from '../src/core/format.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

// Local noon, so the calendar date of a run does not depend on the machine's time zone.
const base = new Date(2026, 5, 1, 12).getTime(), MINUTE = 60_000, DAY = 86_400_000;
let serial = 0;
// One call per character: F failed, S succeeded, ? has no recorded outcome. Calls of one
// pattern start a minute apart and a completed call takes 100 ms.
function calls(pattern, { sessionId = 's1', start = base, name = 'bash', server = '', mcpTool = '' } = {}) {
  return [...pattern].map((mark, index) => {
    const ms = start + index * MINUTE;
    return [{ key: `call-${serial++}`, sessionId, ms, ts: new Date(ms).toISOString(), name, server, mcpTool, project: 'p', model: 'm',
      success: mark === '?' ? null : mark === 'S', completedMs: mark === '?' ? null : ms + 100 }, mark === '?' ? null : mark === 'S'];
  });
}
function measure(events, sessionLabels = new Map()) {
  const topic = createRecoveryTopic({ sessionLabels });
  for (const [tool, outcome] of events) topic.add(tool, outcome);
  return topic.finish();
}
function shuffled(list, seed = 3) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));

test('what followed each failure is counted within one operation and one session', () => {
  const events = [
    ...calls('FSFF?F'),
    // Another operation in the same session and the same operation in another session never follow.
    ...calls('F', { name: 'view', start: base + 30_000 }),
    ...calls('S', { name: 'view', sessionId: 's2', start: base + 45_000 }),
  ];
  const result = measure(events, new Map([['s1', 'Named session']]));
  assert.deepEqual(pick(result, ['calls', 'successes', 'failures', 'unknown', 'known', 'failureRate', 'minimumKnown', 'runLength']),
    { calls: 8, successes: 2, failures: 5, unknown: 1, known: 7, failureRate: 5 / 7 * 100, minimumKnown: 5, runLength: 3 });
  // bash: the first failure is followed by a success, the next by a failure, the third by a call
  // with no outcome, and the last by nothing. The view failure has no later view call in s1.
  assert.deepEqual(result.followed, { failures: 5, succeeded: 1, failed: 1, unknown: 1, none: 2, known: 2, share: 50 });
  assert.deepEqual(result.runs, { longest: 2, repeated: 0, repeatedFailures: 0, total: 1,
    top: [{ name: 'bash', server: '', mcpTool: '', sessionId: 's1', project: 'p', session: 'Named session', length: 2, day: '2026-06-01', then: 'unknown' }] });
  assert.deepEqual(result.time, { failedMs: 500, failedCalls: 5, knownMs: 700, knownCalls: 7, share: 500 / 700 * 100 });
  assert.deepEqual(pick(result.operations, ['called', 'failing', 'ranked']), { called: 2, failing: 2, ranked: 1 });
  assert.deepEqual(result.operations.byFailures, [
    { name: 'bash', server: '', mcpTool: '', calls: 6, successes: 1, failures: 4, unknown: 1, known: 5, failureRate: 80,
      followed: { failures: 4, succeeded: 1, failed: 1, unknown: 1, none: 1, known: 2, share: 50 }, longestRun: 2, failedMs: 400, failedCalls: 4 },
    { name: 'view', server: '', mcpTool: '', calls: 2, successes: 1, failures: 1, unknown: 0, known: 2, failureRate: 50,
      followed: { failures: 1, succeeded: 0, failed: 0, unknown: 0, none: 1, known: 0, share: null }, longestRun: 1, failedMs: 100, failedCalls: 1 }]);
  // view has two known outcomes, below the minimum of five, so it is not ranked by rate.
  assert.deepEqual(result.operations.byRate.map(row => row.name), ['bash']);

  // Tool events are not time ordered: any arrival order gives the same measurements.
  assert.deepEqual(measure(shuffled(events), new Map([['s1', 'Named session']])), result);
  assert.deepEqual(measure(events.slice().reverse(), new Map([['s1', 'Named session']])), result);
});

test('a call that was already running beside a failure is not read as the next call', () => {
  const call = (ms, completedMs, outcome) => [{ sessionId: 's', ms, completedMs, name: 'bash' }, outcome];
  // The success started while the first failure was still running, so the first later call is the second failure.
  const beside = measure([call(1000, 5000, false), call(2000, 2500, true), call(6000, 6100, false)]);
  assert.deepEqual(beside.followed, { failures: 2, succeeded: 0, failed: 1, unknown: 0, none: 1, known: 1, share: 0 });
  // In start order the success separates the failures: no two failed in a row.
  assert.deepEqual(pick(beside.runs, ['longest', 'total', 'top']), { longest: 1, total: 0, top: [] });
  const after = measure([call(6000, 6100, false), call(5000, 5500, true), call(1000, 5000, false)]);
  assert.deepEqual(after.followed, { failures: 2, succeeded: 1, failed: 0, unknown: 0, none: 1, known: 1, share: 100 });
  // Calls that start in the same millisecond are ordered the same way however they arrive.
  const tie = [call(7000, 7000, false), call(7000, 7000, true), call(7000, 7400, null), call(7000, 7000, false)];
  assert.deepEqual(measure(tie), measure(tie.slice().reverse()));
  assert.equal(measure(tie).failures, 2);
});

test('runs of failures report the longest, the runs of three or more and a bounded top five', () => {
  const github = { name: 'github-search', server: 'github', mcpTool: 'search' };
  const events = [
    ...calls('FFFFS', { sessionId: 'a', start: base + 10 * MINUTE }),
    ...calls('FFF', { sessionId: 'b', start: base + DAY }),
    ...calls('FF?', { sessionId: 'c', name: 'view', start: base + 20 * MINUTE }),
    ...calls('FSF', { sessionId: 'd', name: 'view', start: base + 30 * MINUTE }),
    ...calls('FFFFFF', { sessionId: 'e', ...github, start: base + 40 * MINUTE }),
    ...calls('FFS', { sessionId: 'f', start: base + 50 * MINUTE }),
    ...calls('FFS', { sessionId: 'g', start: base }),
  ];
  const labels = new Map([['a', 'Alpha'], ['b', 'Beta'], ['c', 'Gamma'], ['e', 'Epsilon'], ['f', 'Zeta'], ['g', 'Eta']]);
  const result = measure(shuffled(events, 11), labels);
  assert.deepEqual(pick(result.runs, ['longest', 'repeated', 'repeatedFailures', 'total']), { longest: 6, repeated: 3, repeatedFailures: 13, total: 6 });
  // Longest first, then the most recent. The sixth run of two or more (session g, the oldest) is left out.
  assert.deepEqual(result.runs.top, [
    { ...github, sessionId: 'e', project: 'p', session: 'Epsilon', length: 6, day: '2026-06-01', then: 'none' },
    { name: 'bash', server: '', mcpTool: '', sessionId: 'a', project: 'p', session: 'Alpha', length: 4, day: '2026-06-01', then: 'succeeded' },
    { name: 'bash', server: '', mcpTool: '', sessionId: 'b', project: 'p', session: 'Beta', length: 3, day: '2026-06-02', then: 'none' },
    { name: 'bash', server: '', mcpTool: '', sessionId: 'f', project: 'p', session: 'Zeta', length: 2, day: '2026-06-01', then: 'succeeded' },
    { name: 'view', server: '', mcpTool: '', sessionId: 'c', project: 'p', session: 'Gamma', length: 2, day: '2026-06-01', then: 'unknown' }]);
  assert.deepEqual(result.operations.byFailures.map(row => [row.name, row.calls, row.failures, row.known, row.longestRun, row.followed]), [
    ['bash', 14, 11, 14, 4, { failures: 11, succeeded: 3, failed: 7, unknown: 0, none: 1, known: 10, share: 30 }],
    ['github-search', 6, 6, 6, 6, { failures: 6, succeeded: 0, failed: 5, unknown: 0, none: 1, known: 5, share: 0 }],
    ['view', 6, 4, 5, 2, { failures: 4, succeeded: 1, failed: 1, unknown: 1, none: 1, known: 2, share: 50 }]]);
  assert.deepEqual(result.operations.byRate.map(row => [row.name, row.failureRate]), [['github-search', 100], ['view', 80], ['bash', 11 / 14 * 100]]);
  // A session without a label is named as such, never left blank.
  assert.equal(measure(calls('FF', { sessionId: 'unlabelled' })).runs.top[0].session, 'Unnamed session');
});

test('failure rate is ranked only above five known outcomes and an unknown outcome is never a failure', () => {
  const events = [
    ...calls('FS', { name: 'rare' }),
    ...calls('FSSSSFSSSS', { name: 'steady' }),
    ...calls('??????', { name: 'silent' }),
    ...calls('FSSS???', { name: 'mixed' }),
    ...calls('SSSSSS', { name: 'reliable' }),
  ];
  const result = measure(events);
  assert.deepEqual(pick(result, ['calls', 'successes', 'failures', 'unknown', 'known', 'failureRate']),
    { calls: 31, successes: 18, failures: 4, unknown: 9, known: 22, failureRate: 4 / 22 * 100 });
  assert.deepEqual(pick(result.operations, ['called', 'failing', 'ranked']), { called: 5, failing: 3, ranked: 1 });
  // rare fails half the time but has two known outcomes; mixed has seven calls but four known outcomes.
  assert.deepEqual(result.operations.byRate.map(row => [row.name, row.known, row.failureRate]), [['steady', 10, 20]]);
  assert.deepEqual(result.operations.byFailures.map(row => [row.name, row.failures, row.failureRate]), [['steady', 2, 20], ['rare', 1, 50], ['mixed', 1, 25]]);
  assert.ok(!result.operations.byFailures.some(row => row.name === 'silent' || row.name === 'reliable'));
  // An unknown outcome ends a run and is reported as unknown, not as a failure or a success.
  const broken = measure(calls('FF?FF'));
  assert.deepEqual(pick(broken.runs, ['longest', 'repeated', 'total']), { longest: 2, repeated: 0, total: 2 });
  assert.deepEqual(broken.followed, { failures: 4, succeeded: 0, failed: 2, unknown: 1, none: 1, known: 2, share: 0 });
  // With no known outcome at all, a rate is unknown, not zero.
  const silent = measure(calls('???'));
  assert.deepEqual(pick(silent, ['calls', 'failures', 'unknown', 'known', 'failureRate']), { calls: 3, failures: 0, unknown: 3, known: 0, failureRate: null });
  assert.equal(silent.followed.share, null);
  assert.deepEqual(silent.time, { failedMs: null, failedCalls: 0, knownMs: null, knownCalls: 0, share: null });
});

test('time in failed calls needs both ends of the call and reports its coverage', () => {
  const call = (ms, completedMs, outcome, name = 'bash') => [{ sessionId: 's', ms, completedMs, name }, outcome];
  const result = measure([
    call(1000, 1600, false),
    call(2000, null, false),          // no completion time
    call(3000, 2900, false),          // completion before the start
    call(4000, 5000, true),
    call(6000, 9000, null),           // no recorded outcome: its time is not counted as known
    call(undefined, undefined, false), // no usable start time: counted, but not placed in order
  ]);
  assert.equal(result.failures, 4);
  assert.deepEqual(result.time, { failedMs: 600, failedCalls: 1, knownMs: 1600, knownCalls: 2, share: 37.5 });
  assert.equal(result.followed.failures, 3);
  assert.deepEqual(pick(result.operations.byFailures[0], ['failures', 'failedMs', 'failedCalls']), { failures: 4, failedMs: 600, failedCalls: 1 });
  const untimed = measure([call(1000, null, false), call(2000, null, true)]);
  assert.deepEqual(untimed.time, { failedMs: null, failedCalls: 0, knownMs: null, knownCalls: 0, share: null });
  assert.equal(untimed.operations.byFailures[0].failedMs, null);
  assert.deepEqual(untimed.followed, { failures: 1, succeeded: 1, failed: 0, unknown: 0, none: 0, known: 1, share: 100 });
});

test('an empty topic reports nothing measured and finishing twice gives the same result', () => {
  const empty = createRecoveryTopic().finish();
  assert.deepEqual(empty, { minimumKnown: 5, runLength: 3, calls: 0, successes: 0, failures: 0, unknown: 0, known: 0, failureRate: null,
    followed: { failures: 0, succeeded: 0, failed: 0, unknown: 0, none: 0, known: 0, share: null },
    runs: { longest: 0, repeated: 0, repeatedFailures: 0, total: 0, top: [] },
    time: { failedMs: null, failedCalls: 0, knownMs: null, knownCalls: 0, share: null },
    trend: { unit: 'day', points: [] },
    operations: { called: 0, failing: 0, ranked: 0, byFailures: [], byRate: [] } });
  const topic = createRecoveryTopic({ sessionLabels: new Map() });
  for (const [tool, outcome] of shuffled(calls('FFFSF?'))) topic.add(tool, outcome);
  assert.deepEqual(topic.finish(), topic.finish());
  assert.equal(topic.finish().runs.longest, 3);
  // The registry tolerates a sparse event and reports the topic under its key.
  const topics = createEfficiencyTopics();
  topics.addTool({ name: 'view' }, true);
  assert.equal(topics.finish().recovery.calls, 1);
});

test('the topic stays small and sees only in-range, attributed calls of the report', () => {
  const record = { key: 'r', ms: base, sessionId: 's', project: 'p', model: 'M', initiator: 'user', inputTotal: 1000, output: 100,
    cacheRead: 0, cacheWrite: 0, reasoning: 0, nanoAiu: 1e9, creditStatus: 'complete', sessionName: 'Fix the build' };
  const now = new Date(base + 2 * DAY);
  const late = calls('F', { sessionId: 's', name: 'late', start: base + 5 * MINUTE })[0][0];
  const tools = [
    ...calls('FFFS', { sessionId: 's' }),
    ...calls('FF', { sessionId: 's', start: base - 30 * DAY }),                     // before the selected dates
    ...calls('FFF', { sessionId: 'unattributed', start: base }),                    // no Copilot usage in that session
  ].map(([tool]) => tool).concat({ ...late, completedMs: now.getTime() + 1000 });   // completes after "now": outcome unknown
  const report = buildReport([record], { range: '7d' }, now, { tools });
  const recovery = report.efficiency.recovery;
  assert.deepEqual(pick(recovery, ['calls', 'successes', 'failures', 'unknown']), { calls: 5, successes: 1, failures: 3, unknown: 1 });
  assert.equal(recovery.calls, report.tools.calls);
  assert.equal(recovery.failures, report.tools.rows.reduce((sum, row) => sum + row.failures, 0));
  assert.deepEqual(recovery.runs.top, [{ name: 'bash', server: '', mcpTool: '', sessionId: 's', project: 'p', session: 'Fix the build', length: 3, day: '2026-06-01', then: 'succeeded' }]);
  assert.equal(report.tools.omitted, 3);

  // However long the history, the report carries five rows per list.
  const many = [];
  for (let op = 0; op < 40; op++) for (let session = 0; session < 30; session++) many.push(...calls('FFSFFF', { sessionId: `s${session}`, name: `tool-${op}`, start: base + op * MINUTE }));
  const large = measure(shuffled(many, 7));
  assert.equal(large.calls, 7200);
  assert.deepEqual([large.operations.byFailures.length, large.operations.byRate.length, large.runs.top.length], [5, 5, 5]);
  assert.deepEqual(pick(large.runs, ['longest', 'repeated', 'total']), { longest: 3, repeated: 1200, total: 2400 });
  assert.ok(JSON.stringify(large).length < 6000);
});

const number = (value, options = {}) => formatNumber(value, { simplify: true, ...options });
const render = report => renderRecovery(report, { number });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
// A report in the shape the panel receives, built from tool events by the real report builder.
function reportFor(events, { sessionName = 'Fix the build', query = { range: 'all' }, interactions } = {}) {
  const sessions = [...new Set(events.map(([tool]) => tool.sessionId))];
  const records = sessions.map((sessionId, index) => ({ key: `record-${sessionId}`, ms: base - 1000 + index, sessionId, project: 'p', model: 'M', initiator: 'user',
    inputTotal: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, nanoAiu: 1e9, creditStatus: 'complete', sessionName: `${sessionName}${index ? ' ' + index : ''}` }));
  return buildReport(records, query, new Date(base + 2 * DAY), { tools: events.map(([tool]) => tool), interactions });
}
async function card(report) {
  const { get } = await mountPanel({ ...report, sources: [], coverage: {} });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  return get('efficiency-reliability').innerHTML;
}

test('the card leads with failures, the next call and the longest run, then names operations', async () => {
  const playwright = { name: 'playwright-navigate', server: 'playwright', mcpTool: 'navigate' };
  const events = [
    ...calls('SSFFFFSSSS', { sessionId: 'a' }),
    ...calls('SSSSFS?S', { sessionId: 'b', name: 'view' }),
    ...calls('FSFFS', { sessionId: 'b', ...playwright, start: base + 30_000 }),
    ...calls('SSSSSSSSSS', { sessionId: 'a', name: 'edit', start: base + 15_000 }),
  ];
  const html = await card(reportFor(events, { interactions: [{ key: 'error-1', kind: 'error', sessionId: 'a', ms: base, project: 'p', chars: null }] }));
  const shown = text(html);
  // 8 failures among 32 known outcomes; one call has no recorded outcome.
  assert.match(shown, /Failed calls 8 25% of 32 calls with a known outcome\. 1 call had no recorded outcome/);
  // bash: three failures followed by a failure, one by a success. view: a success. playwright: success, failure, success.
  assert.match(shown, /Succeeded on the next call 50% 4 of 8 failed calls followed by a call with a known outcome/);
  assert.match(shown, /Longest run of failures 4 in a row bash · Fix the build · 2026-06-01/);
  assert.match(shown, /Time in failed calls 800 ms 8 of 8 failed calls with a recorded duration\. 25% of the time in calls with a known outcome/);
  assert.match(shown, /bash failed 4 times in a row in one conversation \(Fix the build, 2026-06-01\)\. The call after that succeeded\./);
  assert.match(shown, /Reproduce one failing bash call on its own\. Check its arguments, permissions and authentication before you start a larger task\./);
  assert.match(shown, /Compare afterward: how many times bash fails in a row/);
  assert.match(shown, /The next call succeeded 4 of 8 .*The next call failed too 4 of 8 .*The next call has no recorded outcome 0 of 8 .*No later call 0 of 8/);
  // Count and rate side by side, most failures first. A rate resting on incomplete outcomes may carry the coverage marker.
  assert.match(shown, /Operation Calls Failed Failure rate Next call succeeded Longest run Time in failed calls bash 10 4 40% 1 of 4 4 400 ms playwright \/ navigate 5 3 60% 2 of 3 2 300 ms view 8 1 14\.3%(?: \*)? 1 of 1 1 100 ms/);
  assert.match(shown, /Showing 3 of 3 operations with a recorded failure/);
  // Ranked by rate, the browser tool comes before the shell that failed more often.
  assert.match(shown, /Failure rate by operation playwright \/ navigate 60% 3 of 5 calls with a known outcome failed bash 40% 4 of 10 calls with a known outcome failed view 14\.3% 1 of 7 calls with a known outcome failed/);
  assert.match(shown, /An operation needs at least 5 known outcomes to be ranked by rate/);
  assert.match(shown, /Operation Conversation Failures in a row What came next First failure bash Fix the build 4 A successful call 2026-06-01 playwright \/ navigate Fix the build 1 2 A successful call 2026-06-01/);
  assert.match(shown, /1 run of 3 or more failures in a row, covering 4 of 8 failed calls\. Showing the 2 longest of 2 runs of two or more\./);
  // The table that was already there, and the session errors.
  assert.match(shown, /Tools Calls Succeeded Failed Unknown Success rate Other tools 28 22 5 1 81\.5%(?: \*)? MCP tools 5 2 3 0 40%/);
  assert.match(html, /Success rate uses only known outcomes\. Calls follow the date and usage filters\./);
  assert.match(shown, /1 recorded root-session error events\. These are incidents, not a count of failed model requests\./);
  // The main table is open: nothing is tucked behind a disclosure.
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /title="4 of 10 calls with a known outcome failed"/);
  assert.match(html, /width:60\.0%/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the card escapes operation, server and conversation names', async () => {
  const events = [
    ...calls('FFFS', { sessionId: 'x', name: '<img src=x>' }),
    ...calls('FFSSSS', { sessionId: 'x', name: 'mcp', server: '<b>srv</b>', mcpTool: '"tool"', start: base + 1000 }),
  ];
  const html = await card(reportFor(events, { sessionName: '<img src=x onerror=alert(1)>' }));
  assert.doesNotMatch(html, /<img|<b>srv|onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x&gt; failed 3 times in a row in one conversation \(&lt;img src=x onerror=alert\(1\)&gt;, 2026-06-01\)/);
  assert.match(html, /&lt;b&gt;srv&lt;\/b&gt; \/ &quot;tool&quot;/);
  assert.match(html, /data-efficiency-open-session="x" data-efficiency-open-project="p"[^>]*>&lt;img src=x onerror=alert\(1\)&gt;<\/button>/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the card keeps empty, unknown and unmeasured states distinct from zero', async () => {
  const empty = await card(buildReport([], {}));
  assert.match(empty, /No matching tool execution records\. Missing records do not mean no tools were used\./);
  assert.doesNotMatch(empty, /<table|Failed calls/);

  // Every outcome unknown: the count of failures is unavailable, not zero.
  const unknown = text(await card(reportFor(calls('????'))));
  assert.match(unknown, /Failed calls Unavailable None of 4 calls has a recorded outcome/);
  assert.match(unknown, /Calls with a known outcome 0 of 4 calls in the selected range/);
  assert.match(unknown, /No call in this range has a recorded outcome, so failures cannot be counted\./);
  assert.match(unknown, /Other tools 4 0 0 4 Unavailable/);
  assert.doesNotMatch(unknown, /0%|Succeeded on the next call|NaN|undefined|Infinity/);

  // No failures: nothing to follow, and no invented recovery numbers.
  const clean = text(await card(reportFor(calls('SSS?'))));
  assert.match(clean, /Failed calls 0 0% of 3 calls with a known outcome\. 1 call had no recorded outcome/);
  assert.match(clean, /None of the 3 calls with a known outcome failed\./);
  assert.doesNotMatch(clean, /Succeeded on the next call|Longest run|Time in failed calls|Reproduce one failing/);

  // One failure with nothing after it: the share is unavailable and no run is claimed.
  const single = text(render(reportFor(calls('SF'))));
  assert.match(single, /Succeeded on the next call Unavailable No failed call was followed by a call with a known outcome/);
  assert.match(single, /Longest run of failures 1 No operation failed twice in a row in one conversation/);
  assert.match(single, /1 call failed\. None was followed by a call with a known outcome\./);
  assert.match(single, /bash 2 1 50% No known next call 1 100 ms/);
  assert.match(single, /No operation with a recorded failure has enough known outcomes to be ranked by rate\./);
  assert.match(single, /No operation failed twice in a row in one conversation in this range\./);
  assert.match(single, /No later call 1 of 1/);
  assert.doesNotMatch(single, /NaN|undefined|Infinity/);

  // A failure without a recorded duration: the time is unavailable, not 0.
  const report = reportFor(calls('FS'));
  report.efficiency.recovery.time = { failedMs: null, failedCalls: 0, knownMs: null, knownCalls: 0, share: null };
  report.efficiency.recovery.operations.byFailures[0].failedMs = null;
  const untimed = text(render(report));
  assert.match(untimed, /Time in failed calls Unavailable No failed call has a recorded duration/);
  assert.match(untimed, /bash 2 1 50% 1 of 1 1 Unavailable/);
  assert.doesNotMatch(untimed, /NaN|undefined|Infinity/);
});

test('the card picks its insight from the evidence', () => {
  // No run of three, but one operation fails at more than twice the overall rate.
  const rate = text(render(reportFor([...calls('FSFSFS', { name: 'flaky' }), ...calls('SSSSSSSSSSSSSSSSSSSS', { name: 'view', start: base + 1000 })])));
  assert.match(rate, /flaky failed in 3 of 6 calls with a known outcome \(50%\)\. The rate across all operations was 11\.5%\./);
  assert.match(rate, /Reproduce one failing flaky call on its own/);
  assert.match(rate, /A higher rate can come from harder requests, not from a broken tool\./);
  // Neither: say what the next call did, and point at the operation with the most failures.
  const isolated = text(render(reportFor([...calls('FSSSSSFSSS'), ...calls('FSSSSSSS', { name: 'view', start: base + 1000 })])));
  assert.match(isolated, /After a failed call, the next call of the same operation succeeded 3 times out of 3\./);
  assert.match(isolated, /No operation failed 3 times in a row\. If one matters to you, start with bash, which has the most recorded failures \(2\)/);
  // A run that never recovered in the selected range says so.
  const stuck = text(render(reportFor(calls('SFFF'))));
  assert.match(stuck, /bash failed 3 times in a row in one conversation \(Fix the build, 2026-06-01\)\. No later call of that operation is recorded in that conversation for this range\./);
  assert.match(stuck, /bash Fix the build 3 No later call 2026-06-01/);
  for (const html of [rate, isolated, stuck]) assert.doesNotMatch(html, /NaN|undefined|Infinity|wast|saving/i);
});

test('a report without recovery measurements still shows counts, and filters keep their notes', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  report.tools.rows = [{ name: '<private tool>', calls: 4, successes: 2, failures: 1, unknown: 1 },
    { name: 'mcp-tool', server: '<server>', calls: 2, successes: 0, failures: 2, unknown: 0 }];
  report.efficiency.interactions = { reason: 'model-filter' };
  const { get } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const html = get('efficiency-reliability').innerHTML, shown = text(html);
  assert.match(shown, /Failed calls 3 60% of 5 calls with a known outcome\. 1 call had no recorded outcome/);
  assert.match(shown, /Operation Calls Failed Failure rate &lt;server&gt; \/ mcp-tool 2 2 100% &lt;private tool&gt; 4 1 33\.3%/);
  assert.match(shown, /What followed each failure is not measured in this report\./);
  assert.match(shown, /Session error counts are unavailable under a model filter\./);
  assert.doesNotMatch(html, /<private tool>|<server>|Succeeded on the next call|NaN|undefined|Infinity/);
  // The coverage marker follows the coverage banner, as it does for the other tables.
  assert.doesNotMatch(html, /33\.3% \*/);
  assert.match(renderRecovery(report, { number, showCoverage: true }), /33\.3% \*/);
  assert.doesNotMatch(renderRecovery(report, { number, showCoverage: false }), /% \*/);
});

test('failure-rate trend excludes unknown outcomes, buckets daily/weekly, and MCP live status badges appear when available', () => {
  const daily = [];
  for (let d = 0; d < 5; d++) daily.push(...calls(d < 2 ? 'FS?' : 'FFF?', { start: base + d * DAY }));
  const dailyResult = measure(daily);
  assert.equal(dailyResult.trend.unit, 'day');
  assert.equal(dailyResult.trend.points.length, 5);
  assert.deepEqual(dailyResult.trend.points.map(p => [p.known, p.failures, p.failureRate]), [
    [2, 1, 50], [2, 1, 50], [3, 3, 100], [3, 3, 100], [3, 3, 100],
  ]);
  const weekly = [];
  for (let d = 0; d < 75; d++) weekly.push(...calls('FS', { start: base + d * DAY }));
  const weeklyResult = measure(weekly);
  assert.equal(weeklyResult.trend.unit, 'week');
  assert.ok(weeklyResult.trend.points.length <= 62 && weeklyResult.trend.points.length >= 10);

  // Live MCP status badges render only when report.mcp.available === true
  const playwright = { name: 'playwright-navigate', server: 'playwright', mcpTool: 'navigate' };
  const github = { name: 'github-search', server: 'github', mcpTool: 'search' };
  const events = [
    ...calls('FSFFS', { sessionId: 'a', ...playwright, start: base }),
    ...calls('FFFS', { sessionId: 'a', ...github, start: base + DAY }),
    ...calls('FS', { sessionId: 'a', start: base + 2 * DAY }),
    ...calls('FS', { sessionId: 'a', start: base + 3 * DAY }),
  ];
  const rep = reportFor(events);
  // Move clock forward so day 3 is in range
  const rep4 = buildReport(
    [{ key: 'r1', ms: base, sessionId: 'a', project: 'p', model: 'M', initiator: 'user', inputTotal: 1000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, nanoAiu: 1e9, creditStatus: 'complete', sessionName: 'Fix' }],
    { range: 'all' }, new Date(base + 5 * DAY), { tools: events.map(([t]) => t) }
  );
  const withoutLive = render(rep4);
  assert.match(withoutLive, /Tool failure rate by day/);
  assert.doesNotMatch(withoutLive, /Needs sign-in|connection-status/);
  rep4.mcp = { available: true, rows: [
    { name: 'playwright', status: 'needs-auth', error: 'OAuth token <expired>' },
    { name: 'github', status: 'connected' },
  ] };
  const withLive = render(rep4);
  assert.match(withLive, /Needs sign-in/);
  assert.match(withLive, /Connected/);
  assert.match(withLive, /Current session: Needs sign-in — OAuth token &lt;expired&gt;/);
  assert.match(withLive, /reflect the current hosting session/);
  assert.doesNotMatch(withLive, /<expired>/);
});

test('the demo history gives the card repeated failures, a high-rate operation and unknown outcomes', () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now);
  const report = buildReport(data.records, { range: '30d' }, now, data), recovery = report.efficiency.recovery;
  assert.ok(recovery.runs.repeated > 0 && recovery.runs.longest >= 3);
  assert.ok(recovery.unknown > 0 && recovery.followed.failed > 0 && recovery.followed.none > 0);
  assert.ok(recovery.operations.byRate[0].failureRate > 2 * recovery.failureRate);
  assert.equal(recovery.calls, report.tools.calls);
  assert.equal(recovery.followed.failures, recovery.failures);
  const html = render(report);
  assert.match(html, /times in a row in one conversation/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  assert.ok(JSON.stringify(recovery).length < 9000);
});
