import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createRepetitionTopic, readsOrSearches, REPEAT_LIMITS } from '../src/core/efficiency-repetition.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { dayKey, dayOfMs } from '../src/core/query.mjs';
import { formatNumber } from '../src/core/format.mjs';
import { createCallFingerprint } from '../src/node/call-fingerprint.mjs';
import { renderRepetitionTopic } from '../src/panel/repetition-topic.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const MINUTE = 60_000, DAY = 86_400_000;
// Local noon, so a whole fixture stays inside one calendar day in any time zone.
const base = new Date(2026, 5, 10, 12).getTime(), now = new Date(base + DAY);
const formats = { number: value => value == null ? 'Unavailable' : String(value) };
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// One tool event as the parser leaves it. `at` and `earlier` are minutes after the fixture's
// start; `repeat` is how many identical calls came before, or null when the call was not compared.
let serial = 0;
const tool = (sessionId, at, name, repeat, earlier = null, extra = {}) => ({ key: `tool-${serial++}`, sessionId, ms: base + at * MINUTE, name, server: '', mcpTool: '', project: 'p', model: 'M',
  success: true, completedMs: base + at * MINUTE + 500, repeat, repeatOfMs: earlier === null ? null : base + earlier * MINUTE, ...extra });
const compaction = (sessionId, at, extra = {}) => ({ key: `compaction-${sessionId}-${at}`, sessionId, project: 'p', ms: base + at * MINUTE, success: true, trigger: 'threshold', subagent: false, ...extra });
const lookup = { name: 'docs-lookup', server: 'docs', mcpTool: 'lookup' };
function history() {
  const tools = [
    // s1 was compacted at minute 20.
    tool('s1', 0, 'view', 0), tool('s1', 2, 'view', 1, 0), tool('s1', 30, 'view', 2, 2), tool('s1', 100, 'view', 3, 30),
    tool('s1', 5, 'grep', 0), tool('s1', 65, 'grep', 1, 5),
    tool('s1', 6, 'bash', 0), tool('s1', 7, 'bash', 1, 6), tool('s1', 8, 'bash', 2, 7),
    // Not compared: an edit too large to compare and a read inside a subagent.
    tool('s1', 9, 'edit', null), tool('s1', 10, 'view', null),
    // Repeats with no usable time: the earlier start is missing, or later than the repeat.
    tool('s1', 11, 'view', 1), tool('s1', 12, 'view', 1, 13),
    tool('s2', 0, 'docs-lookup', 0, null, lookup), tool('s2', 1, 'docs-lookup', 1, 0, lookup),
    tool('s2', 2, 'read_bash', 0), tool('s2', 3, 'read_bash', 1, 2), tool('s2', 4, 'view', 0),
    // An event from before calls were compared carries no count at all.
    { ...tool('s3', 0, 'view', 0), repeat: undefined, repeatOfMs: undefined },
  ];
  const record = sessionId => ({ key: `r-${sessionId}`, ms: base, sessionId, project: 'p', model: 'M', initiator: 'agent', inputTotal: 100, input: null, output: 10,
    cacheRead: null, cacheWrite: null, reasoning: null, nanoAiu: 1e9, creditStatus: 'complete', sessionName: { s1: 'One', s2: 'Two', s3: 'Three' }[sessionId] });
  // Only the first is a boundary. The others sit between two identical calls and must not count:
  // one failed (between the reads at minutes 30 and 100), one has no recorded outcome (the same
  // pair), and one happened inside a subagent (between the commands at minutes 7 and 8).
  const compactionEvents = [compaction('s1', 20), compaction('s1', 50, { success: false }), compaction('s1', 90, { success: null }), compaction('s1', 7.5, { subagent: true })];
  return { records: ['s1', 's2', 's3'].map(record), activity: { tools, compactionEvents } };
}
const measure = (query = { range: 'all' }, at = now, change = h => h) => { const h = change(history()); return buildReport(h.records, query, at, h.activity).efficiency.repetition; };
const op = (name, calls, measured, repeated, share, extra = {}) => ({ name, server: '', mcpTool: '', calls, measured, repeated, share, ...extra });

test('repeats are counted against compared calls, by group, by gap, across a compaction and by conversation', () => {
  const r = measure();
  assert.deepEqual(r.limits, { ...REPEAT_LIMITS });
  assert.deepEqual([r.calls, r.measured, r.repeated, r.share, r.sessions, r.repeatSessions, r.modelFiltered], [19, 16, 10, 62.5, 2, 2, false]);
  // Reading and searching: view (9 calls, 7 compared, 5 repeated), grep and the docs lookup.
  assert.deepEqual(r.reading, { calls: 13, measured: 11, repeated: 7, share: 7 / 11 * 100, operations: 3,
    top: [op('view', 9, 7, 5, 5 / 7 * 100), { ...op('docs-lookup', 2, 2, 1, 50), server: 'docs', mcpTool: 'lookup' }, op('grep', 2, 2, 1, 50)],
    // Two minutes and one minute: under five. 28 and exactly 60 minutes: five to sixty. 70: over an hour.
    timing: { timed: 5, under5: 2, mid: 2, over60: 1 },
    // Four timed repeats sit in the compacted conversation. Two have the minute-20 compaction between the calls.
    compactable: 4, afterCompaction: 2 });
  // A shell tool with "read" in its name is not reading, and the edit that was not compared is still a call.
  assert.deepEqual(r.other, { calls: 6, measured: 5, repeated: 3, share: 60, operations: 2, top: [op('bash', 3, 3, 2, 2 / 3 * 100), op('read_bash', 2, 2, 1, 50)],
    timing: { timed: 3, under5: 3, mid: 0, over60: 0 }, compactable: 2, afterCompaction: 0 });
  assert.deepEqual(r.compaction, { sessions: 1, repeats: 6, after: 2, afterReading: 2 });
  assert.deepEqual(r.most, { times: 4, name: 'view', server: '', mcpTool: '', session: 'One' });
  assert.deepEqual(r.conversations, [{ id: 's1', project: 'p', name: 'One', measured: 11, repeated: 8, share: 8 / 11 * 100, times: 4 }, { id: 's2', project: 'p', name: 'Two', measured: 5, repeated: 2, share: 40, times: 2 }]);
  assert.ok(JSON.stringify(r).length < 2500);
});

test('the order tool events arrive in does not change the result', () => {
  const forward = measure(), backward = measure({ range: 'all' }, now, h => ({ ...h, activity: { ...h.activity, tools: h.activity.tools.slice().reverse(), compactionEvents: h.activity.compactionEvents.slice().reverse() } }));
  assert.deepEqual(backward, forward);
});

test('repeat measurements follow the date, project, session, model, environment and clock filters', () => {
  // The count belongs to the repeat: its earlier call can be outside the selected dates.
  const later = h => { h.activity.tools.push(tool('s2', 2 * 24 * 60, 'view', 1, 4)); return h; };
  const at = new Date(base + 3 * DAY), day = dayKey(dayOfMs(base + 2 * DAY));
  const onDay = measure({ range: 'custom', startDate: day, endDate: day }, at, later);
  assert.deepEqual([onDay.calls, onDay.measured, onDay.repeated, onDay.reading.timing.over60, onDay.conversations.map(row => row.name)], [1, 1, 1, 1, ['Two']]);
  assert.deepEqual([measure({ range: 'all' }, at, later).repeated, measure({ range: 'all' }, at).repeated], [11, 10]);
  assert.deepEqual([measure({ range: 'all', session: 's2' }).calls, measure({ range: 'all', session: 's2' }).repeated, measure({ range: 'all', session: 's2' }).compaction.sessions], [5, 2, 0]);
  const project = h => { for (const t of h.activity.tools) if (t.sessionId === 's2') t.project = 'q'; return h; };
  assert.deepEqual([measure({ range: 'all', project: 'q' }, now, project).measured, measure({ range: 'all', project: 'p' }, now, project).measured], [5, 11]);
  const model = h => { for (const t of h.activity.tools) if (t.name === 'grep') t.model = 'N'; return h; };
  const filtered = measure({ range: 'all', models: ['N'] }, now, model);
  assert.deepEqual([filtered.calls, filtered.repeated, filtered.modelFiltered], [2, 1, true]);
  const placed = h => { for (const list of [h.records, h.activity.tools, h.activity.compactionEvents]) for (const item of list) item.environment = item.sessionId === 's2' ? 'wsl:u' : 'windows'; return h; };
  assert.deepEqual([measure({ range: 'all', environment: 'wsl:u' }, now, placed).measured, measure({ range: 'all', environment: 'windows' }, now, placed).compaction.after], [5, 2]);
  // A call that has not started yet is not counted, and a compaction that has not finished is not a boundary.
  // Six minutes in: four calls in s1, five in s2 and one in s3 have started.
  assert.equal(measure({ range: 'all' }, new Date(base + 6 * MINUTE)).calls, 10);
  assert.equal(measure({ range: 'all' }, new Date(base + 6 * MINUTE)).compaction.sessions, 0);
  assert.equal(measure().compaction.sessions, 1);
  // A conversation with no Copilot usage is not attributed, so its 13 calls are not in this view.
  assert.equal(measure({ range: 'all' }, now, h => ({ ...h, records: h.records.slice(1) })).calls, 6);
});

test('nothing compared is reported as unknown, not as no repeats', () => {
  const none = createRepetitionTopic().finish();
  assert.deepEqual([none.calls, none.measured, none.repeated, none.share, none.sessions, none.repeatSessions, none.most, none.conversations], [0, 0, 0, null, 0, 0, null, []]);
  assert.deepEqual([none.reading.share, none.other.share, none.reading.top, none.compaction], [null, null, [], { sessions: 0, repeats: 0, after: 0, afterReading: 0 }]);
  const topic = createRepetitionTopic({ now });
  for (const repeat of [null, undefined, -1, 1.5, '2', NaN]) topic.add(tool('s', 0, 'view', repeat));
  const unknown = topic.finish();
  assert.deepEqual([unknown.calls, unknown.measured, unknown.repeated, unknown.share, unknown.sessions, unknown.reading.calls, unknown.reading.measured, unknown.reading.share], [6, 0, 0, null, 0, 6, 0, null]);
  // Compared calls with no repeat are a measured zero.
  const clean = createRepetitionTopic({ now });
  clean.add(tool('s', 0, 'view', 0)); clean.add(tool('s', 1, 'bash', 0));
  assert.deepEqual([clean.finish().measured, clean.finish().repeated, clean.finish().share, clean.finish().most, clean.finish().sessions], [2, 0, 0, null, 1]);
  // An unlabelled conversation still gets a name, and finishing twice gives the same answer.
  const unnamed = createRepetitionTopic({ now });
  unnamed.add(tool('x', 0, 'view', 0)); unnamed.add(tool('x', 1, 'view', 1, 0));
  assert.equal(unnamed.finish().conversations[0].name, 'Unnamed session');
  assert.deepEqual(unnamed.finish(), unnamed.finish());
});

test('the two groups are told apart by the recorded tool name alone', () => {
  for (const name of ['view', 'grep', 'glob', 'read_file', 'web_fetch', 'WebSearch', 'file-search', 'list_dir', 'ls', 'getFileContents', 'docs.lookup', 'query-docs']) assert.equal(readsOrSearches(name), true, name);
  for (const name of ['bash', 'powershell', 'read_bash', 'list_powershell', 'get_terminal_output', 'edit', 'create', 'task', 'skill', 'navigate', 'listen', 'getaway', 'reader', '']) assert.equal(readsOrSearches(name), false, name);
  // For an MCP call the MCP tool name decides, not the server in front of it.
  assert.equal(readsOrSearches('search-create_issue', 'create_issue'), false);
  assert.equal(readsOrSearches('github-search_issues', 'search_issues'), true);
});

test('the view shows counts with their coverage, both groups, gaps, compactions, conversations and one experiment', () => {
  const html = renderTokenTopic('repetition', { efficiency: { repetition: measure() } }, formats), shown = text(html);
  assert.match(html, /<span class="label">Repeated calls<\/span><strong class="value">10<\/strong><span class="sub">62\.5% of 16 compared calls repeated an identical earlier call<\/span>/);
  assert.match(html, /<span class="label">Calls compared<\/span><strong class="value">16 of 19<\/strong>/);
  assert.match(html, /<span class="label">Conversations with a repeat<\/span><strong class="value">2 of 2<\/strong>/);
  assert.match(html, /<span class="label">Most times one call was made<\/span><strong class="value">4 times<\/strong><span class="sub">view · One<\/span>/);
  assert.match(shown, /Reading and searching view 5 5 of 7 compared calls repeated an earlier one \(71\.4\d*%\)\. 2 more not compared docs \/ lookup 1 1 of 2 compared calls repeated an earlier one \(50%\) grep 1 /);
  assert.match(shown, /7 of 11 compared calls in this group repeated an identical earlier call \(63\.6\d*%\)\. 11 of 13 calls in this group could be compared\. Showing 3 of 3 operations with a repeat\./);
  assert.match(shown, /chosen from the recorded tool name alone: a name with one of the words view, read, get, list, ls, grep, glob, search, find, fetch, lookup, query counts as reading or searching, unless it also names a shell \(bash, powershell, pwsh, shell, terminal\)/);
  assert.match(shown, /Everything else bash 2 2 of 3 compared calls repeated an earlier one \(66\.6\d*%\) read_bash 1 /);
  assert.match(shown, /3 of 5 compared calls in this group repeated an identical earlier call \(60%\)\. 5 of 6 calls in this group could be compared\. Showing 2 of 2 operations with a repeat\./);
  assert.match(shown, /Running a command or a test again after a change is normal/);
  assert.match(shown, /How soon the same call came back Reading and searching Under 5 minutes 2 \(40%\) 5 to 60 minutes 2 \(40%\) Over an hour 1 \(20%\) Everything else Under 5 minutes 3 \(100%\) 5 to 60 minutes 0 \(0%\) Over an hour 0 \(0%\)/);
  assert.match(shown, /8 of 10 repeated calls have a usable time on both calls\./);
  assert.match(shown, /Repeats after a compaction 2 2 of 6 repeated calls in 1 conversation with a compaction Reading and searching among them 2 0 were other calls/);
  assert.match(shown, /1 conversation with compared calls in this view has such a compaction\. It holds 6 of the 8 repeated calls with a usable time\. A compaction is one explanation, not a proven cause/);
  assert.match(html, /data-efficiency-jump-section="patterns" data-efficiency-jump-topic="compaction"/);
  assert.match(html, /<td class="text-cell"><button class="model-toggle cell-text" data-efficiency-open-session="s1" data-efficiency-open-project="p"[^>]*>One<\/button><\/td><td><span class="cell-text">11<\/span><\/td><td><span class="cell-text">8<\/span><\/td><td><span class="cell-text">72\.7\d*%<\/span><\/td><td><span class="cell-text">4<\/span><\/td>/);
  assert.match(shown, /Showing 2 of 2 conversations with a repeated call, most repeats first\./);
  // Seven reading repeats out of eleven compared, and only two across a compaction: the share leads.
  assert.match(shown, /7 of 11 compared reading and searching calls \(63\.6\d*%\) repeated an identical earlier call in the same conversation\. The most repeated was view, 5 times\./);
  assert.match(shown, /Compare afterward: the share of reading and searching calls that repeat, on similar work\./);
  // The limits are stated once.
  for (const limit of [/Only a call with the same tool name and exactly the same arguments counts\./, /Reading the same file with a different line range, or searching for the same thing in other words, is not counted\./,
    /A repeat can be needed: the file changed, or the context no longer held it\./, /No tokens or credits are attributed to repeats\./, /The earlier call can be before the selected dates\./,
    /made inside a subagent, when no arguments are recorded for it, when the journal line that records it is longer than 4096 characters \(writing a whole file, for example\), after the first 20000 compared calls of one conversation, or when copied journals each hold only part of a conversation\./,
    /Their arguments are not kept, stored or shown\./]) assert.equal(shown.match(new RegExp(limit.source, 'g'))?.length, 1, limit.source);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|Not measured yet|—/);
  assert.doesNotMatch(shown, /\b(waste|wasted|saved|savings|inefficient|unnecessary)\b/i, 'the view never gives a verdict');
});

test('counts are written in full and tool, server and conversation names are escaped', () => {
  const h = history();
  h.records[0].sessionName = '<img src=x>';
  h.activity.tools.push(tool('s1', 200, '<img src=x>', 0, null, { server: '<b>srv</b>', mcpTool: 'get_<i>' }), tool('s1', 201, '<img src=x>', 1, 200, { server: '<b>srv</b>', mcpTool: 'get_<i>' }));
  for (let i = 0; i < 6; i++) h.activity.tools.push(tool('s1', 300 + i, '<script>alert(1)</script>', i, i ? 299 + i : null));
  const r = buildReport(h.records, { range: 'all' }, now, h.activity).efficiency.repetition;
  const html = renderRepetitionTopic({ ...r, calls: 1234567, measured: 1234000 }, { number: formatNumber });
  assert.match(html, /1,234,000 of 1,234,567/);
  assert.doesNotMatch(html, /1\.2M/);
  assert.match(html, /&lt;b&gt;srv&lt;\/b&gt; \/ get_&lt;i&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; · &lt;img src=x&gt;/);
  assert.match(html, /data-efficiency-open-session="s1" data-efficiency-open-project="p"[^>]*>&lt;img src=x&gt;<\/button>/);
  assert.doesNotMatch(html, /<img|<script|<b>|<i>/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the empty and the not-compared views never show a zero that was not measured', () => {
  for (const report of [{}, { efficiency: {} }, buildReport([], { range: 'all' }, now)]) {
    const shown = text(renderTokenTopic('repetition', report, formats));
    assert.match(shown, /No tool call is recorded for these dates and filters\./);
    assert.match(shown, /the same tool with exactly the same arguments, for example reading one file twice/);
    assert.match(shown, /Try a wider date range/);
    assert.doesNotMatch(shown, /NaN|undefined|Infinity|Not measured yet|Unavailable|Compare afterward/);
  }
  // Tool calls from a history read before calls were compared.
  const old = measure({ range: 'all' }, now, h => { for (const t of h.activity.tools) { t.repeat = null; t.repeatOfMs = null; } return h; });
  const html = renderRepetitionTopic(old, formats), shown = text(html);
  assert.match(html, /<span class="label">Repeated calls<\/span><strong class="value">Unavailable<\/strong><span class="sub">None of the 19 tool calls in this view could be compared<\/span>/);
  assert.match(html, /<span class="label">Calls compared<\/span><strong class="value">0 of 19<\/strong>/);
  assert.match(shown, /Unavailable is not zero\. Whether these calls repeated an earlier one was not measured\./);
  assert.match(shown, /A call is not compared when it was made inside a subagent/);
  assert.doesNotMatch(shown, /Compare afterward|Reading and searching|NaN|undefined|Infinity/);
  // One group compared and the other not: the group that was not compared says so.
  const partial = measure({ range: 'all' }, now, h => { for (const t of h.activity.tools) if (readsOrSearches(t.name, t.mcpTool)) { t.repeat = null; t.repeatOfMs = null; } return h; });
  const partialShown = text(renderRepetitionTopic(partial, formats));
  assert.match(partialShown, /Reading and searching None of the 13 calls in this group could be compared\. That is not zero repeats\./);
  assert.match(partialShown, /3 of 5 compared calls \(60%\) repeated an identical earlier call\. None of them was reading or searching\./);
  // Nothing repeated, no compaction, no usable time, and a report from a build without limits.
  const clean = createRepetitionTopic({ now });
  clean.add(tool('s', 0, 'view', 0)); clean.add(tool('s', 1, 'bash', 0));
  const { limits, readingWords, shellWords, ...bare } = clean.finish();
  const cleanShown = text(renderRepetitionTopic(bare, formats));
  assert.match(cleanShown, /Repeated calls 0 0% of 2 compared calls/);
  assert.match(cleanShown, /Most times one call was made Once No compared call was made twice in one conversation/);
  assert.match(cleanShown, /Reading and searching None of the 1 compared call in this group repeated an identical earlier call\. 1 of 1 calls in this group could be compared\./);
  assert.match(cleanShown, /No compared call repeated an earlier one, so there is no time between calls to show\./);
  assert.match(cleanShown, /No conversation with compared calls in this view has a recorded successful compaction/);
  assert.match(cleanShown, /None of the 2 compared calls repeated an identical earlier call\. There is no repeat to review in this range\./);
  assert.match(cleanShown, /when the journal line that records it is very long, or when copied journals/);
  assert.doesNotMatch(cleanShown, /Conversations with the most repeated calls|Compare afterward|NaN|undefined|Infinity/);
  const untimed = createRepetitionTopic({ now });
  untimed.add(tool('s', 0, 'view', 0)); untimed.add(tool('s', 1, 'view', 1));
  assert.match(text(renderRepetitionTopic(untimed.finish(), formats)), /No repeated call has a usable start time on both calls, so the time between them is unavailable\..* 0 of 1 repeated calls have a usable time on both calls\./);
});

test('the observation follows the evidence: reading after a compaction, frequent rereading, any repeat, none', () => {
  const data = extra => { const r = measure(); return { ...r, ...extra(r) }; };
  const observed = extra => text(renderRepetitionTopic(data(extra), formats).match(/<aside class="token-insight">[\s\S]*<\/aside>/)[0]);
  const after = observed(r => ({ compaction: { ...r.compaction, after: 4, afterReading: 3 } }));
  assert.match(after, /3 reading or searching calls repeated a call first made before a compaction of the same conversation\./);
  assert.match(after, /ask Copilot to keep short notes on the files it reads and what it found, and to read a file again only when it has changed\. This view cannot see what a compaction kept/);
  assert.match(after, /Compare afterward: reading and searching repeats after a compaction, over a similar amount of work\./);
  assert.match(observed(() => ({})), /7 of 11 compared reading and searching calls/, 'two repeats across a compaction are too few to lead with');
  const few = observed(r => ({ reading: { ...r.reading, repeated: 4, share: 36 } }));
  assert.match(few, /10 of 16 compared calls \(62\.5%\) repeated an identical earlier call\. 4 of them were reading or searching\./);
  assert.match(few, /Reading and searching repeats are few here\. If a conversation in the table matters to you, try this there: in the next long conversation, ask Copilot/);
  assert.match(observed(r => ({ reading: { ...r.reading, repeated: 6, share: 9 } })), /6 of them were reading or searching\./, 'a small share is not the observation');
  assert.match(observed(r => ({ reading: { ...r.reading, repeated: 1, share: 9 } })), /1 of them was reading or searching\./);
  for (const extra of [() => ({}), r => ({ compaction: { ...r.compaction, afterReading: 3 } }), r => ({ reading: { ...r.reading, repeated: 4, share: 36 } })]) {
    const shown = observed(extra);
    assert.match(shown, /Compare afterward: /);
    assert.doesNotMatch(shown, /NaN|undefined|Infinity/);
    assert.doesNotMatch(shown, /\b(waste|wasted|saved|savings|inefficient|unnecessary)\b/i, 'an observation is never a verdict');
  }
});

// Journal lines with arguments worth hiding, read by the real parser with a real fingerprint.
const SECRET = /PRIVATE|hunter2|secret-plans/;
function parsed() {
  const prints = [], at = minute => new Date(base + minute * MINUTE).toISOString();
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture', createFingerprint: () => { const print = createCallFingerprint(); return value => { const made = print(value); prints.push(made); return made; }; } });
  const asks = (id, minute, toolName, args) => ({ id: `start-${id}`, type: 'tool.execution_start', timestamp: at(minute), data: { toolCallId: id, toolName, model: 'model-a', arguments: args } });
  const path = 'C:/Users/PRIVATE_OWNER/secret-plans/PRIVATE_FILE.md', events = [
    { type: 'session.start', data: { sessionId: 's1', context: { repository: 'project-one' } } },
    { id: 'usage', type: 'session.usage_record', timestamp: at(0), data: { usage: { provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20 } } },
    asks('a', 0, 'view', { path }), asks('b', 1, 'view', { path }),
    { id: 'compacted', type: 'session.compaction_complete', timestamp: at(5), data: { compactionAttemptId: 'c1', success: true, trigger: 'threshold', summaryContent: 'PRIVATE_SUMMARY' } },
    asks('c', 9, 'view', { path }), asks('d', 10, 'bash', { command: 'curl -H "Authorization: PRIVATE_TOKEN hunter2"' }), asks('e', 11, 'bash', { command: 'curl -H "Authorization: PRIVATE_TOKEN hunter2"' }),
    asks('f', 12, 'create', { path, file_text: 'PRIVATE_BODY '.repeat(400) })];
  for (const event of events) parser.push(JSON.stringify(event));
  return { snapshot: parser.snapshot(), prints };
}

test('a report built from real journal lines counts the repeats and carries no argument or fingerprint', () => {
  const { snapshot, prints } = parsed(), report = buildReport(snapshot.records, { range: 'all' }, now, snapshot), r = report.efficiency.repetition;
  assert.deepEqual([r.calls, r.measured, r.repeated, r.reading.repeated, r.other.repeated, r.compaction.after, r.compaction.afterReading, r.most.times], [6, 5, 3, 2, 1, 1, 1, 3]);
  assert.equal(prints.length, 5);
  const html = renderTokenTopic('repetition', report, formats);
  for (const [what, value] of [['the snapshot', JSON.stringify(snapshot)], ['the report', JSON.stringify(report)], ['the view', html]]) {
    assert.doesNotMatch(value, SECRET, `${what} holds argument text`);
    for (const print of prints) assert.ok(!value.includes(print), `${what} holds a fingerprint`);
  }
  // What the report adds is counts, names the tool report already shows, and conversation names.
  const strings = (value, found = []) => { if (typeof value === 'string') found.push(value); else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { found.push(key); strings(item, found); } return found; };
  for (const value of strings(r)) for (const [run] of value.matchAll(/[A-Za-z0-9+/_-]{16,}/g)) assert.ok(!/^[0-9a-f]+$/i.test(run) && !(run.length >= 20 && /\d/.test(run)), `digest-like run: ${run}`);
  assert.deepEqual(new Set(strings(r).filter(value => SECRET.test(value))), new Set());
});

test('repeated call durations and per-model repeat comparison enforce thresholds and handle missing metadata', () => {
  const events = [];
  // Model A: 20 reading calls (5 repeated), all timed at 250ms except one future completion ignored
  for (let i = 0; i < 20; i++) {
    const rep = i < 5 ? 1 : 0;
    events.push(tool('s1', i, 'view', rep, rep ? 0 : null, { model: 'raw-a', completedMs: i === 0 ? now.getTime() + 5000 : base + i * MINUTE + 250 }));
  }
  // Model B: 20 reading calls (2 repeated), untimed
  for (let i = 0; i < 20; i++) {
    const rep = i < 2 ? 1 : 0;
    events.push(tool('s1', 30 + i, 'grep', rep, rep ? 30 : null, { model: 'raw-b', completedMs: null }));
  }
  // Model C: only 10 reading calls (below minimumModelCalls = 20)
  for (let i = 0; i < 10; i++) events.push(tool('s1', 60 + i, 'view', i < 5 ? 1 : 0, i < 5 ? 60 : null, { model: 'raw-c', completedMs: base + (60 + i) * MINUTE + 100 }));
  // Unattributed model call (missing model) + non-reading timed repeat
  events.push(tool('s1', 80, 'view', 0, null, { model: '' }));
  events.push(tool('s1', 81, 'bash', 1, 80, { model: 'raw-a', completedMs: base + 81 * MINUTE + 400 }));
  const records = [{ modelId: 'raw-a', model: 'Model <A>' }, { modelId: 'raw-b', model: 'Model B' }];
  const topic = createRepetitionTopic({ now, records });
  for (const e of events) topic.add(e);
  const res = topic.finish();
  // Timed repeats: 4 from Model A (i=1..4 -> 1000ms), 5 from Model C (500ms), 1 bash (400ms) -> 10 timed, 1900ms total, 9 reading -> 1500ms
  assert.deepEqual(res.time, { repeatedMs: 1900, timedCalls: 10, readingMs: 1500, readingTimedCalls: 9 });
  assert.equal(res.modelsMeasured, 3);
  assert.equal(res.unattributedModelCalls, 1);
  assert.deepEqual(res.byModel.map(m => [m.name, m.readingMeasured, m.readingRepeated, m.readingShare]), [
    ['Model <A>', 20, 5, 25],
    ['Model B', 20, 2, 10],
  ]);
  const html = renderRepetitionTopic(res, formats), shown = text(html);
  assert.match(shown, /Time in repeated calls/);
  assert.match(shown, /10 of 13 repeated calls with a recorded duration/);
  assert.match(shown, /Repeated reading and searching by model/);
  assert.match(html, /Model &lt;A&gt;/);
  assert.doesNotMatch(html, /Model <A>|raw-c/);
  assert.match(shown, /1 compared call had no recorded model/);
  // Missing completedMs on all repeats renders Unavailable gracefully
  const untimed = createRepetitionTopic({ now });
  untimed.add(tool('s', 0, 'view', 0, null, { completedMs: null }));
  untimed.add(tool('s', 1, 'view', 1, 0, { completedMs: null }));
  const untimedRes = untimed.finish();
  assert.equal(untimedRes.time.repeatedMs, null);
  assert.match(text(renderRepetitionTopic(untimedRes, formats)), /Time in repeated calls Unavailable No repeated call has a recorded duration/);
});

test('the demo history renders a complete, bounded view of repeated calls', () => {
  const at = new Date(2026, 10, 20, 12), demo = demoData(at), again = demoData(at);
  const report = buildReport(demo.records, { range: '30d' }, at, demo), r = report.efficiency.repetition;
  // Each call is decided from its own random stream, so two builds agree.
  assert.deepEqual(demo.tools.map(t => t.repeat), again.tools.map(t => t.repeat));
  assert.ok(r.measured > 1000 && r.measured < r.calls, 'some calls are too large to compare');
  assert.ok(r.reading.repeated > 20 && r.other.repeated > 20 && r.reading.share > 3 && r.reading.share < 30);
  assert.ok(r.reading.timing.under5 > 0 && r.reading.timing.mid > 0 && r.reading.timing.over60 > 0);
  assert.ok(r.compaction.sessions > 0 && r.compaction.afterReading >= 3 && r.compaction.afterReading < r.reading.repeated / 2, 'a few rereads follow a compaction');
  assert.ok(r.reading.top.length <= 5 && r.other.top.length <= 5 && r.conversations.length === 5);
  assert.ok(JSON.stringify(r).length < 4096, 'the report addition stays small');
  const html = renderTokenTopic('repetition', report, { number: formatNumber });
  for (const heading of ['Reading and searching', 'Everything else', 'How soon the same call came back', 'After a compaction', 'Conversations with the most repeated calls']) assert.match(html, new RegExp(`<h3>${heading}</h3>`));
  assert.match(html, /Compare afterward: /);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|Not measured yet|Unavailable/);
});

test('the panel labels Repeated exploration as measured history', async () => {
  const h = history(), report = { ...buildReport(h.records, { range: 'all' }, now, h.activity), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  get('pattern-topic-stops').onclick({ target: { closest: () => ({ dataset: { patternStop: 'repetition' } }) } });
  assert.equal(get('pattern-topic-title').textContent, 'Repeated exploration');
  assert.equal(get('pattern-topic-question').textContent, 'Is the agent repeatedly searching or reading the same material?');
  assert.equal(get('pattern-topic-scope').textContent, 'Selected history · current filters');
  assert.match(get('pattern-topic-body').innerHTML, /<span class="label">Repeated calls<\/span><strong class="value">10<\/strong>/);
  assert.doesNotMatch(get('pattern-topic-body').innerHTML, /NaN|undefined|Infinity|Not measured yet/);
});
