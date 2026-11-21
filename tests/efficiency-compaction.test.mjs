import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { compactionEvent, createCompactionTopic } from '../src/core/efficiency-compaction.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { dayKey, dayOfMs } from '../src/core/query.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { renderCompactionTopic } from '../src/panel/compaction-topic.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const MINUTE = 60_000, DAY = 86_400_000;
// Local noon, so a whole fixture stays inside one calendar day in any time zone.
const base = new Date(2026, 5, 10, 12).getTime(), now = new Date(base + DAY);
const formats = { number: value => value == null ? 'Unavailable' : String(value), credits: value => `${value} credits` };
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const completed = (id, data = {}, envelope = {}) => ({ type: 'session.compaction_complete', id: `envelope-${id}`, timestamp: new Date(base).toISOString(),
  data: { compactionAttemptId: id, success: true, trigger: 'threshold', ...data }, ...envelope });
const usage = (extra = {}) => ({ provider: { kind: 'copilot' }, model: 'model-id', modelDisplayName: 'Model', inputTokens: 100, outputTokens: 20,
  cacheReadTokens: 60, cacheWriteTokens: 10, copilotUsage: { totalNanoAiu: 250000000 }, aiCreditsStatus: 'complete', ...extra });
const start = { type: 'session.start', data: { sessionId: 'session', context: { repository: 'project' } } };

test('the parser keeps the outcome, reason and counts of a compaction and none of its text', () => {
  const lines = [start,
    completed('a1', { trigger: 'manual', preCompactionTokens: 9000, postCompactionTokens: 3000, tokensRemoved: 6000, messagesRemoved: 40, preCompactionMessagesLength: 55, tokenLimit: 200000,
      tokenAccountingBasis: 'PRIVATE_BASIS', summaryContent: 'PRIVATE_SUMMARY', customInstructions: 'PRIVATE_FOCUS', error: 'PRIVATE_ERROR', checkpointPath: 'C:/PRIVATE_PATH',
      outcome: 'PRIVATE_OUTCOME', outcomeReason: 'PRIVATE_WHY', failureReason: 'PRIVATE_REASON', model: 'PRIVATE_MODEL', requestId: 'PRIVATE_REQUEST' }),
    // A replayed attempt under another envelope is the same compaction: the first record stands.
    completed('a1', { success: false, preCompactionTokens: 1 }, { id: 'another-envelope' }),
    // No attempt ID: the envelope ID identifies it. Malformed values stay unknown.
    completed('unused', { compactionAttemptId: undefined, success: 'yes', trigger: 'PRIVATE_TRIGGER', preCompactionTokens: -1, postCompactionTokens: 1.5, tokensRemoved: '12',
      messagesRemoved: null, preCompactionMessagesLength: 2 ** 53, tokenLimit: undefined }, { id: 'e3' }),
    completed('a4', { success: false, trigger: 'context_limit_retry', preCompactionTokens: 0 }, { agentId: 'agent-1' }),
    completed('ephemeral', {}, { ephemeral: true }),
    completed('bad-time', {}, { timestamp: 'invalid' }),
    completed('unused', { compactionAttemptId: undefined }, { id: undefined }),
    { type: 'session.compaction_complete', id: 'no-data', timestamp: new Date(base).toISOString() },
  ].map(line => JSON.stringify(line));
  for (const skipUnused of [false, true]) {
    const parser = createReceiptParser({ sessionId: 'session', source: 'fixture', skipUnused });
    for (const line of lines) parser.push(line);
    const snapshot = parser.snapshot(), events = snapshot.compactionEvents;
    const unknown = { preCompactionTokens: null, postCompactionTokens: null, tokensRemoved: null, messagesRemoved: null, preCompactionMessagesLength: null, tokenLimit: null };
    assert.deepEqual(events, [
      { key: JSON.stringify(['compaction-event', 'session', 'a1']), sessionId: 'session', project: 'project', ms: base, success: true, trigger: 'manual', subagent: false,
        preCompactionTokens: 9000, postCompactionTokens: 3000, tokensRemoved: 6000, messagesRemoved: 40, preCompactionMessagesLength: 55, tokenLimit: 200000 },
      { key: JSON.stringify(['compaction-event', 'session', 'e3']), sessionId: 'session', project: 'project', ms: base, success: null, trigger: 'unknown', subagent: false, ...unknown },
      { key: JSON.stringify(['compaction-event', 'session', 'a4']), sessionId: 'session', project: 'project', ms: base, success: false, trigger: 'context_limit_retry', subagent: true,
        ...unknown, preCompactionTokens: 0 },
    ]);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
    assert.deepEqual(snapshot.compactions, [], 'an outcome is kept even when the event carries no usage');
  }
});

test('a compaction with usage yields one usage record and one activity event under separate keys', () => {
  const parser = createReceiptParser({ sessionId: 'session', source: 'fixture' });
  parser.push(JSON.stringify(start));
  const before = parser.revision();
  parser.push(JSON.stringify(completed('a1', { compactionTokensUsed: usage() })));
  const changed = parser.revision();
  assert.ok(changed > before, 'a new compaction makes an earlier snapshot stale');
  parser.push(JSON.stringify(completed('a1', { compactionTokensUsed: usage() }, { id: 'replayed' })));
  assert.equal(parser.revision(), changed, 'a replayed compaction changes nothing');
  const snapshot = parser.snapshot();
  assert.equal(snapshot.compactions.length, 1);
  assert.equal(snapshot.compactions[0].origin, 'compaction');
  assert.equal(snapshot.compactionEvents.length, 1);
  assert.notEqual(snapshot.compactions[0].key, snapshot.compactionEvents[0].key);
  assert.equal(compactionEvent({ timestamp: new Date(base).toISOString(), data: null }, 'id', 's', 'p'), null);
  assert.equal(compactionEvent({ timestamp: new Date(base).toISOString(), data: {} }, '', 's', 'p'), null);
});

async function home(t, name, events) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-compaction-events-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session-state', name);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  await fs.writeFile(file, [{ type: 'session.start', data: { sessionId: name, context: { repository: 'project' } } }, ...events].map(e => JSON.stringify(e)).join('\n') + '\n');
  return { root, file };
}

test('the scanner carries compaction events through merges, copies, appends and unchanged scans', async t => {
  const receipt = { type: 'session.usage_record', id: 'r1', timestamp: new Date(base - MINUTE).toISOString(), data: { usage: usage({ initiator: 'agent' }) } };
  const first = completed('c1', { preCompactionTokens: 9000, postCompactionTokens: 3000, summaryContent: 'PRIVATE_SUMMARY', compactionTokensUsed: usage() });
  const a = await home(t, 'session', [receipt, first]);
  // A second copy of the same session repeats the compaction and adds a later one.
  const b = await home(t, 'session', [first, completed('c2', { success: false })]);
  const other = await home(t, 'other', [{ ...receipt, id: 'r2' }, completed('c3', { trigger: 'manual' })]);
  const scanner = createScanner(), scan = () => scanner.scan([a.root, b.root, other.root]);
  const s = await scan();
  assert.deepEqual(s.compactionEvents.map(e => [e.sessionId, JSON.parse(e.key)[2], e.success, e.trigger]),
    [['session', 'c1', true, 'threshold'], ['session', 'c2', false, 'threshold'], ['other', 'c3', true, 'manual']]);
  assert.ok(s.compactionEvents.every(e => typeof e.environment === 'string' && e.environment), 'events carry their source environment like other activity');
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE_SUMMARY/);
  assert.equal(await scan(), s, 'an unchanged history returns the same result');
  await fs.appendFile(other.file, JSON.stringify(completed('c4')) + '\n');
  const grown = await scan();
  assert.notEqual(grown, s);
  assert.equal(grown.compactionEvents.length, 4);
  const report = buildReport(grown.records, { range: 'all' }, now, grown).efficiency.compaction;
  assert.deepEqual([report.compactions, report.sessions, report.succeeded, report.failed, report.cost.calls], [4, 2, 3, 1, 1]);
  const environment = grown.compactionEvents[0].environment;
  assert.equal(buildReport(grown.records, { range: 'all', environment }, now, grown).efficiency.compaction.compactions, 4);
  assert.equal(buildReport(grown.records, { range: 'all', environment: 'wsl:absent' }, now, grown).efficiency.compaction.compactions, 0);
});

// One main-conversation model call. `at` is minutes after the fixture's start.
const call = (sessionId, at, inputTotal, extra = {}) => ({ key: `${sessionId}-${at}`, ms: base + at * MINUTE, sessionId, project: 'p', model: 'M', initiator: 'agent',
  inputTotal, input: null, output: 10, cacheRead: null, cacheWrite: null, reasoning: null, nanoAiu: 1e9, creditStatus: 'complete', ...extra });
const cached = (read, write = 0) => ({ cacheRead: read, cacheWrite: write });
const event = (sessionId, id, at, extra = {}) => ({ key: `event-${id}`, sessionId, project: 'p', ms: base + at * MINUTE, success: true, trigger: 'threshold', subagent: false,
  preCompactionTokens: null, postCompactionTokens: null, tokensRemoved: null, messagesRemoved: null, preCompactionMessagesLength: null, tokenLimit: null, ...extra });
function history() {
  const records = [
    // s1: two compactions that worked, then one that failed.
    call('s1', 1, 1000, cached(800)), call('s1', 2, 2000, cached(1600)),
    call('s1', 4, 600, cached(60, 300)), call('s1', 5, 1200), call('s1', 6, 3000, cached(1500)),
    call('s1', 8, 1500), call('s1', 9, 1600),
    // A subagent call and an unlabelled call never stand in for the main conversation.
    call('s1', 3.5, 50000, { initiator: 'sub-agent' }), call('s1', 7.5, 70000, { initiator: '' }),
    { ...call('s1', 3, 2000, { initiator: '', output: 100, nanoAiu: 5e8, duration: 4000 }), key: 'summary-1', origin: 'compaction' },
    // s2: a second compaction arrives before input is back.
    call('s2', 1, 4000, { project: 'q', model: 'N', ...cached(2000) }), call('s2', 3, 1000, { project: 'q', model: 'N', ...cached(500) }), call('s2', 5, 900, { project: 'q', model: 'N' }),
    { ...call('s2', 2, 4000, { project: 'q', model: 'N', initiator: '', output: null, nanoAiu: null, creditStatus: 'unavailable' }), key: 'summary-2', origin: 'compaction' },
    call('s3', 1, 500), call('s4', 1, 500),
    // s6 was last used the day before its compaction.
    call('s6', -24 * 60, 500),
  ];
  const compactionEvents = [
    event('s1', 'E1', 3, { preCompactionTokens: 2000, postCompactionTokens: 500, tokenLimit: 4000, messagesRemoved: 30, preCompactionMessagesLength: 40 }),
    event('s1', 'E2', 7, { trigger: 'manual', preCompactionTokens: 2400, postCompactionTokens: 1200, tokenLimit: 4000 }),
    event('s1', 'E3', 10, { success: false, preCompactionTokens: 1600 }),
    event('s2', 'F1', 2, { project: 'q', preCompactionTokens: 4000, postCompactionTokens: 1000 }),
    event('s2', 'F2', 4, { project: 'q', trigger: 'context_limit_retry' }),
    event('s2', 'F3', 6, { project: 'q', success: null, trigger: 'unknown' }),
    event('s3', 'G1', 2, { subagent: true, preCompactionTokens: 800, postCompactionTokens: 100 }),
    event('s4', 'H1', 2), event('s5', 'I1', 2),
    event('s6', 'J1', 2, { trigger: 'model_switch' }),
  ];
  // A scan can list the same event twice; it is counted once.
  compactionEvents.push({ ...compactionEvents[0] });
  return { records, activity: { compactionEvents, skillExcludedSessions: ['s4'] } };
}
const measure = (query = { range: 'all' }, at = now) => { const h = history(); return buildReport(h.records, query, at, h.activity).efficiency.compaction; };

test('compaction measurements count outcomes, reasons, sizes, cost and the calls on either side', () => {
  const c = measure();
  assert.deepEqual([c.compactions, c.sessions, c.succeeded, c.failed, c.unknownOutcome], [7, 3, 5, 1, 1]);
  // s3's subagent compaction is set apart; s4 has rejected provider evidence and s5 no Copilot usage.
  assert.deepEqual([c.subagent, c.omitted, c.modelFiltered], [1, 2, false]);
  assert.deepEqual([c.repeatSessions, c.repeatCompactions], [2, 6]);
  assert.deepEqual(c.triggers, [{ id: 'threshold', count: 3 }, { id: 'context_limit_retry', count: 1 }, { id: 'manual', count: 1 }, { id: 'model_switch', count: 1 }, { id: 'unknown', count: 1 }]);
  // Three successful compactions record both sizes: 2000 to 500, 2400 to 1200 and 4000 to 1000.
  assert.deepEqual(c.tokens, { pairs: 3, before: 2400, after: 1000, reduction: 75, removed: 5700, larger: 0, limitPairs: 2, fillBefore: 55, fillAfter: 21.25 });
  assert.deepEqual(c.messages, { samples: 1, removed: 30, before: 40 });
  assert.deepEqual(c.cost, { calls: 2, inputCalls: 2, inputTokens: 6000, outputCalls: 1, outputTokens: 100, creditCalls: 1, durationCalls: 1, credits: .5, averageDuration: 4000 });
  // Pairs: 2000 to 600, 3000 to 1500, 4000 to 1000 and 1000 to 900. Two of them have cache splits on both calls.
  assert.deepEqual(c.next, { paired: 4, inputBefore: 2500, inputAfter: 950, change: 60, smaller: 4, cachePairs: 2, cacheBefore: 65, cacheAfter: 30,
    regained: 1, regainCalls: 3, compactedAgain: 2, ended: 1 });
  assert.deepEqual(c.conversations.map(row => [row.compactions, row.pairs, row.removed]), [[3, 1, 3000], [3, 2, 2700], [1, 0, null]]);
  assert.ok(c.conversations.every(row => typeof row.name === 'string' && row.name && !('id' in row)));
  assert.ok(JSON.stringify(c).length < 2000);
});

test('compaction measurements follow date, project, session, model, environment and clock filters', () => {
  const day = dayKey(dayOfMs(base)), dayBefore = dayKey(dayOfMs(base - DAY));
  // s6 has no call on the day of its compaction, yet it has Copilot usage, so it still counts.
  const sameDay = measure({ range: 'custom', startDate: day, endDate: day });
  assert.deepEqual([sameDay.compactions, sameDay.sessions, sameDay.omitted], [7, 3, 2]);
  assert.deepEqual(sameDay.next, measure().next);
  const earlier = measure({ range: 'custom', startDate: dayBefore, endDate: dayBefore });
  assert.deepEqual([earlier.compactions, earlier.omitted, earlier.cost.calls, earlier.tokens.pairs], [0, 0, 0, 0]);
  assert.equal(earlier.tokens.reduction, null);
  assert.equal(earlier.cost.credits, null);
  const project = measure({ range: 'all', project: 'q' });
  assert.deepEqual([project.compactions, project.sessions, project.succeeded, project.unknownOutcome, project.omitted], [3, 1, 2, 1, 0]);
  assert.deepEqual([project.next.paired, project.next.compactedAgain, project.cost.calls], [2, 2, 1]);
  const session = measure({ range: 'all', session: 's1' });
  assert.deepEqual([session.compactions, session.failed, session.next.regained, session.next.ended], [3, 1, 1, 1]);
  // A model filter keeps conversations with calls on that model. Others are not relevant, so they are not "left out".
  const model = measure({ range: 'all', models: ['N'] });
  assert.deepEqual([model.compactions, model.sessions, model.omitted, model.subagent, model.modelFiltered], [3, 1, 0, 0, true]);
  assert.deepEqual([model.cost.calls, model.cost.inputTokens, model.cost.credits], [1, 4000, null]);
  // An environment keeps its own compactions; another environment's are neither counted nor "left out".
  const h = history(), place = item => ({ ...item, environment: item.sessionId === 's2' ? 'wsl:u' : 'windows' });
  const scoped = { records: h.records.map(place), activity: { ...h.activity, compactionEvents: h.activity.compactionEvents.map(place) } };
  const inEnvironment = environment => buildReport(scoped.records, { range: 'all', environment }, now, scoped.activity).efficiency.compaction;
  assert.deepEqual([inEnvironment('wsl:u').compactions, inEnvironment('wsl:u').sessions, inEnvironment('wsl:u').omitted, inEnvironment('wsl:u').subagent], [3, 1, 0, 0]);
  assert.deepEqual([inEnvironment('windows').compactions, inEnvironment('windows').sessions, inEnvironment('windows').omitted, inEnvironment('windows').subagent], [4, 2, 2, 1]);
  // Before the first compaction finishes, nothing is counted; one minute later, exactly one is.
  assert.equal(measure({ range: 'all' }, new Date(base + 2 * MINUTE - 1)).compactions, 0);
  const early = measure({ range: 'all' }, new Date(base + 2 * MINUTE));
  assert.deepEqual([early.compactions, early.succeeded, early.next.paired], [2, 2, 0]);
});

test('the compaction topic reports nothing measured as unknown, not zero, and tolerates a bare context', () => {
  const none = createCompactionTopic();
  none.add(call('s', 1, 100));
  const empty = none.finish();
  assert.deepEqual([empty.compactions, empty.sessions, empty.omitted, empty.triggers, empty.conversations], [0, 0, 0, [], []]);
  for (const value of [empty.tokens.before, empty.tokens.after, empty.tokens.reduction, empty.tokens.removed, empty.tokens.fillBefore, empty.messages.removed,
    empty.cost.credits, empty.cost.averageDuration, empty.next.inputBefore, empty.next.change, empty.next.cacheAfter, empty.next.regainCalls]) assert.equal(value, null);
  // Calls without token counts cannot be compared, and a size that grew is not a reduction.
  const topic = createCompactionTopic({ query: { range: 'all' }, now, activity: { compactionEvents: [
    event('a', 'A1', 2, { preCompactionTokens: 1000, postCompactionTokens: 1500 }), event('b', 'B1', 2, { preCompactionTokens: 0, postCompactionTokens: 0 }), event('c', 'C1', 2) ] } });
  for (const r of [call('a', 1, null), call('a', 3, 400), call('b', 1, 300), call('b', 3, null), call('c', 1, 500), call('c', 3, 800, cached(100)), call('c', 4, 900)]) topic.add(r);
  const partial = topic.finish();
  assert.deepEqual([partial.compactions, partial.succeeded], [3, 3]);
  assert.deepEqual(partial.tokens, { pairs: 1, before: 1000, after: 1500, reduction: -50, removed: -500, larger: 1, limitPairs: 0, fillBefore: null, fillAfter: null });
  // Only conversation c has a measured call on both sides, and its input did not drop.
  assert.deepEqual(partial.next, { paired: 1, inputBefore: 500, inputAfter: 800, change: -60, smaller: 0, cachePairs: 0, cacheBefore: null, cacheAfter: null,
    regained: 0, regainCalls: null, compactedAgain: 0, ended: 0 });
  assert.equal(partial.cost.calls, 0);
  assert.equal(partial.cost.credits, null);
});

test('calls are paired in time order however they arrive, and a failed compaction does not end a stretch', () => {
  const events = [event('s', 'X1', 10), event('s', 'X2', 20, { success: false }), event('s', 'X3', 40)];
  const calls = [call('s', 45, 700), call('s', 30, 950), call('s', 5, 1000), call('s', 15, 400), call('s', 25, 600), call('s', 35, 1100)];
  const topic = createCompactionTopic({ query: { range: 'all' }, now, activity: { compactionEvents: events } });
  for (const r of calls) topic.add(r);
  const { next, failed } = topic.finish();
  assert.equal(failed, 1);
  // X1: 1000 before, 400 after, and the fourth call after it (1100) is back. X3: 1100 before, 700 after, then the calls end.
  assert.deepEqual([next.paired, next.inputBefore, next.inputAfter, next.smaller, next.regained, next.regainCalls, next.compactedAgain, next.ended], [2, 1050, 550, 2, 1, 4, 0, 1]);
  // Two compactions with no call between them share no pair.
  const adjacent = createCompactionTopic({ query: { range: 'all' }, now, activity: { compactionEvents: [event('s', 'Y1', 10), event('s', 'Y2', 11)] } });
  for (const r of [call('s', 5, 1000), call('s', 15, 400)]) adjacent.add(r);
  const paired = adjacent.finish().next;
  assert.deepEqual([paired.paired, paired.inputBefore, paired.inputAfter], [0, null, null]);
});

test('a future compaction refreshes a cached report once the clock reaches it', async t => {
  let clock = new Date(2026, 10, 17, 12, 0);
  const at = clock.getTime();
  const scan = { records: [{ ...call('s', 0, 100), ms: at - MINUTE, ts: new Date(at - MINUTE).toISOString(), source: 'fixture', cwd: '' }],
    compactionEvents: [{ ...event('s', 'Z1', 0), ms: at + 5 * MINUTE }], sources: [], coverage: {} };
  const server = await startServer({ html: '<title>Fixture</title>', defaultHome: '/synthetic', settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => scan }, now: () => clock });
  t.after(() => server.close());
  const compactions = async () => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.report', input: { range: '30d' } }) });
    assert.equal(response.status, 200);
    return (await response.json()).efficiency.compaction.compactions;
  };
  assert.equal(await compactions(), 0);
  clock = new Date(at + 10 * MINUTE);
  assert.equal(await compactions(), 1);
});

test('the view shows counts, comparisons, cost, coverage and one experiment', () => {
  const h = history();
  h.records.push({ ...h.records[0], key: 'named', sessionName: '<img src=x>' });
  const report = buildReport(h.records, { range: 'all' }, now, h.activity);
  const html = renderTokenTopic('compaction', report, formats), shown = text(html);
  assert.match(html, /<span class="label">Compactions<\/span><strong class="value">7<\/strong><span class="sub">In 3 conversations<\/span>/);
  assert.match(html, /<strong class="value">5<\/strong><span class="sub">1 failed · 1 with no recorded outcome<\/span>/);
  assert.match(html, /Typical reduction<\/span><strong class="value">75%<\/strong><span class="sub">Copilot&#39;s estimate; 3 of 5 successful compactions record both sizes/);
  assert.match(html, /Removed from context<\/span><strong class="value">5700<\/strong>/);
  assert.match(shown, /Before 2400 Typically 55% of the model&#39;s context limit After 1000 Typically 21\.25% of the model&#39;s context limit/);
  assert.match(shown, /2 of 3 of those also record the model&#39;s limit\./);
  assert.match(shown, /Where message counts are recorded \(1 compaction\), the middle values were 30 messages removed out of 40\./);
  assert.match(shown, /Automatic: context passed Copilot&#39;s threshold 3 \(42\.857\d*%\)/);
  for (const reason of ['Automatic: a model reported its context limit', 'Requested, for example with \\/compact', 'Switch to a model with a smaller context window', 'Reason not recorded']) assert.match(shown, new RegExp(reason + ' 1 \\('));
  assert.match(shown, /Summary calls 2 .* Input they read 6000 2 of 2 calls Output they wrote 100 1 of 2 calls AI credits 0\.5 credits 1 of 2 calls with complete charges/);
  assert.match(shown, /A summary call took 4 seconds on average \(1 of 2 calls\)\./);
  assert.match(shown, /Last call before 2500 First call after 950 In 4 of 4 compactions the first call after read less input than the last call before\. The middle drop was 60%\./);
  assert.match(shown, /Share of that input read from cache Last call before 65% First call after 30%/);
  assert.match(shown, /4 of 5 successful compactions have a measured call on both sides, and 2 of 4 of those have a complete cache split on both calls\./);
  assert.match(shown, /Back to the earlier size 1 of 4 .* Calls it took 3 .* Compacted again first 2 .* Still smaller at the end 1 /);
  assert.match(shown, /Showing 3 of 3 conversations with a compaction\..* 6 of 7 compactions happened in 2 conversations compacted more than once\./);
  assert.match(html, /<td class="text-cell"><span class="cell-text">&lt;img src=x&gt;<\/span><\/td><td><span class="cell-text">3<\/span><\/td><td><span class="cell-text">2700<\/span>/);
  assert.match(html, /<span class="cell-text">Unavailable<\/span><\/td><\/tr><\/tbody>/, 'a conversation with no recorded sizes has no removed total');
  assert.doesNotMatch(html, /<img/);
  // Two compactions have cache splits on both sides: too few to lead with, so the reduction is the observation.
  assert.match(shown, /A typical compaction took Copilot&#39;s context estimate from 2400 to 1000 tokens\./);
  assert.match(shown, /Compare afterward: whether later answers still use earlier decisions/);
  assert.match(shown, /They are not credits returned\. A smaller context does not show what information was kept\. Sizes before and after are Copilot&#39;s own estimate, not billed tokens\./);
  assert.match(shown, /1 compaction inside subagents is not counted here\. 2 compactions left out because provider attribution is missing or mixed\./);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|Not measured yet|—/);
});

test('the empty view says what would make a compaction appear', () => {
  for (const report of [{}, { efficiency: {} }, buildReport([], { range: 'all' }, now)]) {
    const shown = text(renderTokenTopic('compaction', report, formats));
    assert.match(shown, /No compaction is recorded for these dates and filters\./);
    assert.match(shown, /when the context passes its threshold or a model reports its context limit/);
    assert.match(shown, /\/compact/);
    assert.match(shown, /Try a wider date range/);
    assert.doesNotMatch(shown, /NaN|undefined|Infinity|Not measured yet|Unavailable|Compare afterward/);
  }
  const filtered = text(renderCompactionTopic({ compactions: 0, omitted: 1, subagent: 2, modelFiltered: true }, formats));
  assert.match(filtered, /Model filter: this view keeps compactions from conversations with calls on a selected model/);
  assert.match(filtered, /2 compactions inside subagents are not counted here\. 1 compaction left out because provider attribution is missing or mixed\./);
});

test('missing sizes, cost and neighbouring calls stay unavailable in the view', () => {
  const bare = { compactions: 2, sessions: 1, succeeded: 1, failed: 0, unknownOutcome: 1, subagent: 0, omitted: 0, modelFiltered: false, repeatSessions: 1, repeatCompactions: 2,
    triggers: [{ id: 'constructor', count: 2 }], tokens: { pairs: 0, before: null, after: null, reduction: null, removed: null, larger: 0, limitPairs: 0, fillBefore: null, fillAfter: null },
    messages: { samples: 0, removed: null, before: null }, cost: { calls: 0, inputCalls: 0, inputTokens: 0, outputCalls: 0, outputTokens: 0, creditCalls: 0, durationCalls: 0, credits: null, averageDuration: null },
    next: { paired: 0, inputBefore: null, inputAfter: null, change: null, smaller: 0, cachePairs: 0, cacheBefore: null, cacheAfter: null, regained: 0, regainCalls: null, compactedAgain: 0, ended: 0 },
    conversations: [{ name: 'Only <one>', compactions: 2, pairs: 0, removed: null }] };
  const html = renderCompactionTopic(bare, formats), shown = text(html);
  assert.match(html, /Typical reduction<\/span><strong class="value">Unavailable<\/strong><span class="sub">No successful compaction records both sizes/);
  assert.match(html, /Removed from context<\/span><strong class="value">Unavailable<\/strong><span class="sub">Unavailable is not zero/);
  assert.match(shown, /That is not a reduction of zero\./);
  assert.match(shown, /Reason not recorded 2 \(100%\)/, 'an unrecognised reason is never looked up as text');
  assert.match(shown, /No summary call with recorded usage matches these filters\. Unavailable is not zero/);
  assert.match(shown, /No successful compaction in this view has a measured main-conversation call both before and after it/);
  assert.doesNotMatch(shown, /How soon input grew back/);
  assert.match(shown, /These compactions are recorded without a size before and after\./);
  assert.match(html, /Only &lt;one&gt;/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|<one>|>0%?<\/strong>/);
  // Partial coverage keeps its own counts: sizes for one compaction, a cost with no charge, a pair with no cache split.
  const partial = { ...bare, succeeded: 2, unknownOutcome: 0, tokens: { ...bare.tokens, pairs: 1, before: 1000, after: 1500, reduction: -50, removed: -500, larger: 1 },
    cost: { ...bare.cost, calls: 3, inputCalls: 2, inputTokens: 0 }, next: { ...bare.next, paired: 1, inputBefore: 500, inputAfter: 800, change: -60 } };
  const partialHtml = renderCompactionTopic(partial, formats, { credits: 10 }), partialShown = text(partialHtml);
  assert.match(partialHtml, /Typical reduction<\/span><strong class="value">None<\/strong>/);
  assert.match(partialHtml, /Removed from context<\/span><strong class="value">None<\/strong>/);
  assert.match(partialShown, /1 compaction recorded a larger size after than before\./);
  assert.match(partialShown, /Input they read 0 2 of 3 calls Output they wrote Unavailable 0 of 3 calls AI credits Unavailable 0 of 3 calls with complete charges/);
  assert.doesNotMatch(partialShown, /of the complete charges recorded|seconds on average|The middle drop/);
  assert.match(partialShown, /In 0 of 1 compactions the first call after read less input than the last call before\./);
  assert.match(partialShown, /Neither call has a complete cache split/);
  assert.doesNotMatch(partialHtml, /NaN|undefined|Infinity/);
});

test('the observation follows the evidence: failures, input that grows back, colder cache, then the reduction', () => {
  const data = extra => { const h = history(), c = buildReport(h.records, { range: 'all' }, now, h.activity).efficiency.compaction; return { ...c, ...extra(c) }; };
  const observed = extra => text(renderCompactionTopic(data(extra), formats).match(/<aside class="token-insight">[\s\S]*<\/aside>/)[0]);
  assert.match(observed(() => ({ failed: 3 })), /3 of 8 compactions with a recorded outcome failed\. This view does not record why\./);
  assert.match(observed(() => ({ failed: 2 })), /A typical compaction/, 'two failures are too few to lead with');
  assert.match(observed(c => ({ next: { ...c.next, regained: 2 } })), /After 2 of 4 compactions, input was back to its earlier size\. Half of those took 3 calls or fewer\./);
  const cold = observed(c => ({ next: { ...c.next, cachePairs: 3 } }));
  assert.match(cold, /The first call after a compaction read 30% of its input from cache\. The last call before read 65%\./);
  assert.match(cold, /Compare afterward: input per call, cache share and credits per prompt on similar work\./);
  assert.match(observed(c => ({ next: { ...c.next, cachePairs: 3, cacheAfter: 50 } })), /A typical compaction/, 'a small difference in cache share is not the observation');
  for (const extra of [() => ({}), () => ({ failed: 3 }), c => ({ next: { ...c.next, regained: 2 } }), c => ({ next: { ...c.next, cachePairs: 3 } })]) {
    const shown = observed(extra);
    assert.match(shown, /Compare afterward: /);
    assert.doesNotMatch(shown, /NaN|undefined|Infinity/);
    assert.doesNotMatch(shown, /\b(waste|wasted|saved|savings|inefficient)\b/i, 'an observation is never a verdict');
  }
});

test('the demo history renders a complete, bounded compaction view', () => {
  const at = new Date(2026, 10, 20, 12), demo = demoData(at), report = buildReport(demo.records, { range: '30d' }, at, demo), c = report.efficiency.compaction;
  assert.ok(demo.compactionEvents.length > 0 && c.compactions > 0 && c.tokens.pairs > 0 && c.cost.calls > 0 && c.next.paired > 0 && c.next.cachePairs > 0);
  assert.ok(c.conversations.length <= 5 && c.triggers.length <= 6);
  assert.ok(JSON.stringify(c).length < 4096, 'the report addition stays small');
  assert.doesNotMatch(JSON.stringify(demo.compactionEvents), /summary|instructions|checkpoint/i);
  const html = renderTokenTopic('compaction', report, formats);
  for (const heading of ['Context before and after a compaction', 'Why compactions started', 'What the summaries cost', 'The call before and the call after', 'Conversations compacted most']) assert.match(html, new RegExp(`<h3>${heading}</h3>`));
  assert.match(html, /Compare afterward: /);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|Not measured yet/);
});

test('the panel labels Context reduction as measured history', async () => {
  const h = history(), report = { ...buildReport(h.records, { range: 'all' }, now, h.activity), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  get('pattern-topic-stops').onclick({ target: { closest: () => ({ dataset: { patternStop: 'compaction' } }) } });
  assert.equal(get('pattern-topic-title').textContent, 'Context reduction');
  assert.equal(get('pattern-topic-scope').textContent, 'Selected history · current filters');
  assert.match(get('pattern-topic-body').innerHTML, /<span class="label">Compactions<\/span><strong class="value">7<\/strong>/);
  assert.doesNotMatch(get('pattern-topic-body').innerHTML, /NaN|undefined|Infinity|Not measured yet/);
});
