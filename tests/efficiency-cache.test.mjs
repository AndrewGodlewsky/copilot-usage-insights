import test from 'node:test';
import assert from 'node:assert/strict';
import { createCacheTiming } from '../src/core/efficiency-cache.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { mountPanel } from './fixtures/panel.mjs';
import { demoData } from '../scripts/demo-data.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR, base = new Date(2026, 5, 1, 9).getTime();
let serial = 0;
const call = (ms, extra = {}) => ({ key: `call-${serial++}`, ms, sessionId: 's', project: 'p', model: 'A', initiator: 'agent', inputTotal: 1000, output: 10, cacheRead: 0, cacheWrite: 0,
  reasoning: 0, nanoAiu: 1e9, creditStatus: 'complete', ...extra });
const measure = (records, context) => { const topic = createCacheTiming(context); for (const r of records) topic.add(r); return topic.finish(); };
const row = (result, id) => { const { id: _, ...rest } = result.situations.find(s => s.id === id); return rest; };
const formats = { number: value => value == null ? 'Unavailable' : String(value), credits: value => value == null ? 'Unavailable' : String(value) };
const render = (report = {}) => renderTokenTopic('cache', report, formats);
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('each measured main call lands in one situation by what came just before it', () => {
  const records = [
    call(base, { initiator: 'user' }),
    call(base + MINUTE, { cacheRead: 800 }),
    call(base + 6 * MINUTE, { cacheRead: 500 }),
    call(base + 66 * MINUTE, { cacheRead: 400 }),
    call(base + 126 * MINUTE + 1, { cacheRead: 100 }),
    call(base + 127 * MINUTE + 1, { model: 'B', inputTotal: 2000, cacheRead: 200 }),
    call(base + 128 * MINUTE + 1, { model: 'B', inputTotal: 2000, cacheRead: 1800 }),
    call(base + 133 * MINUTE, { model: 'B' }),
  ];
  const result = measure(records);
  assert.deepEqual(result.situations.map(s => s.id), ['under5', 'mid', 'over60', 'first', 'modelChange']);
  // One minute, then one minute, then one millisecond short of five minutes.
  assert.deepEqual(row(result, 'under5'), { calls: 3, input: 4000, cacheRead: 2600, share: 65 });
  // Exactly five minutes and exactly sixty minutes both belong to the middle row.
  assert.deepEqual(row(result, 'mid'), { calls: 2, input: 2000, cacheRead: 900, share: 45 });
  assert.deepEqual(row(result, 'over60'), { calls: 1, input: 1000, cacheRead: 100, share: 10 });
  assert.deepEqual(row(result, 'first'), { calls: 1, input: 1000, cacheRead: 0, share: 0 });
  assert.deepEqual(row(result, 'modelChange'), { calls: 1, input: 2000, cacheRead: 200, share: 10 });
  assert.equal(result.mainCalls, 8);
  assert.equal(result.measuredCalls, 8);
  assert.equal(result.situations.reduce((sum, s) => sum + s.calls, 0), result.measuredCalls);
  // Records are not guaranteed to arrive in time order.
  assert.deepEqual(measure(records.slice().reverse()), result);
  assert.deepEqual(measure([records[3], records[7], records[0], records[5], records[1], records[6], records[2], records[4]]), result);
});

test('a model change after a long pause is counted only as a model change', () => {
  const result = measure([call(base), call(base + 3 * HOUR, { model: 'B', cacheRead: 50 })]);
  assert.equal(row(result, 'modelChange').calls, 1);
  assert.equal(row(result, 'over60').calls, 0);
  assert.equal(row(result, 'over60').share, null);
});

test('subagent and unlabelled calls are left out, and unmeasured main calls still set the order', () => {
  const result = measure([
    call(base, { initiator: 'user' }),
    call(base + MINUTE, { initiator: 'sub-agent', model: 'B', cacheRead: 999 }),
    call(base + 2 * MINUTE, { initiator: '', cacheRead: 999 }),
    call(base + 3 * MINUTE, { cacheRead: 700 }),
    // No cache split: not measured, but it is still the previous main call for the next one.
    call(base + 4 * MINUTE, { model: 'B', cacheRead: null, cacheWrite: null }),
    call(base + 5 * MINUTE, { cacheRead: 100 }),
    call(base + 64 * MINUTE, { cacheDetailsReported: false, cacheRead: 900 }),
    call(base + 66 * MINUTE, { cacheRead: 600 }),
    call(base + 67 * MINUTE, { cacheRead: 900, cacheWrite: 200 }),
    // A second conversation whose first main call has no cache split.
    call(base, { sessionId: 't', cacheRead: null, cacheWrite: null }),
    call(base + MINUTE, { sessionId: 't', cacheRead: 300 }),
  ]);
  assert.equal(result.mainCalls, 9);
  assert.equal(result.measuredCalls, 5);
  assert.deepEqual(row(result, 'first'), { calls: 1, input: 1000, cacheRead: 0, share: 0 });
  // Three minutes after the first call, two minutes after an unmeasured call, and one minute after
  // the other conversation's unmeasured first call.
  assert.deepEqual(row(result, 'under5'), { calls: 3, input: 3000, cacheRead: 1600, share: 1600 / 3000 * 100 });
  assert.deepEqual(row(result, 'modelChange'), { calls: 1, input: 1000, cacheRead: 100, share: 10 });
  assert.equal(row(result, 'mid').calls, 0);
  assert.equal(row(result, 'over60').calls, 0);
});

test('calls at the same instant keep their recorded order and separate conversations do not mix', () => {
  const result = measure([
    call(base, { sessionId: 'a' }), call(base, { sessionId: 'a', cacheRead: 400 }),
    call(base + 10 * MINUTE, { sessionId: 'b' }), call(base + 20 * MINUTE, { sessionId: 'a', cacheRead: 250 }),
    call(base + 11 * MINUTE, { sessionId: 'b', cacheRead: 900 }),
    // Recorded out of order: the later call arrives first, then two calls at the same instant.
    call(base + 5 * MINUTE, { sessionId: 'c', cacheRead: 100 }), call(base, { sessionId: 'c' }), call(base, { sessionId: 'c', cacheRead: 400 }),
  ]);
  assert.deepEqual(row(result, 'first'), { calls: 3, input: 3000, cacheRead: 0, share: 0 });
  assert.deepEqual(row(result, 'under5'), { calls: 3, input: 3000, cacheRead: 1700, share: 1700 / 3000 * 100 });
  assert.deepEqual(row(result, 'mid'), { calls: 2, input: 2000, cacheRead: 350, share: 17.5 });
});

test('an empty or unplaceable history reports unknown shares, never zero', () => {
  const none = { calls: 0, input: 0, cacheRead: 0, share: null };
  assert.deepEqual(createCacheTiming().finish(), { mainCalls: 0, measuredCalls: 0, modelFiltered: false, minimumSessionCalls: 5, listedSessions: 0,
    situations: ['under5', 'mid', 'over60', 'first', 'modelChange'].map(id => ({ id, ...none })), sessions: [] });
  const result = measure([call(NaN), call(base, { sessionId: '' }), call(base, { sessionId: undefined }), call(base, { inputTotal: 0 })]);
  assert.equal(result.mainCalls, 4);
  assert.equal(result.measuredCalls, 1);
  // A call with no input tokens is counted, but a share of nothing is not 0%.
  assert.deepEqual(row(result, 'first'), { calls: 1, input: 0, cacheRead: 0, share: null });
});

test('the conversation list keeps five rows, needs five measured calls and uses session labels', () => {
  const records = [];
  const session = (id, calls, cacheRead) => { for (let i = 0; i < calls; i++) records.push(call(base + i * MINUTE, { sessionId: id, cacheRead })); };
  session('s1', 5, 900); session('s2', 5, 100); session('s3', 6, 500); session('s4', 5, 700); session('s5', 5, 300); session('s6', 5, 700);
  // Four calls are too few, however much of their input was not read from cache.
  session('few', 4, 0);
  const sessionLabels = new Map([['s2', 'Second'], ['s3', 'Third'], ['s4', 'Fourth'], ['s5', '<img src=x>'], ['few', 'Too few']]);
  const result = measure(records, { sessionLabels });
  assert.equal(result.minimumSessionCalls, 5);
  assert.equal(result.listedSessions, 6);
  assert.deepEqual(result.sessions, [
    { name: 'Second', calls: 5, input: 5000, cacheRead: 500, notRead: 4500, share: 10 },
    { name: '<img src=x>', calls: 5, input: 5000, cacheRead: 1500, notRead: 3500, share: 30 },
    { name: 'Third', calls: 6, input: 6000, cacheRead: 3000, notRead: 3000, share: 50 },
    // Equal amounts fall back to the session id, so the order never depends on arrival.
    { name: 'Fourth', calls: 5, input: 5000, cacheRead: 3500, notRead: 1500, share: 70 },
    { name: 'Unnamed session', calls: 5, input: 5000, cacheRead: 3500, notRead: 1500, share: 70 },
  ]);
  assert.deepEqual(measure(records.slice().reverse(), { sessionLabels }).sessions, result.sessions);
});

test('the report stays small however many conversations there are', () => {
  const records = [];
  for (let s = 0; s < 400; s++) for (let i = 0; i < 5; i++) records.push(call(base + i * MINUTE, { sessionId: `session-${s}`, cacheRead: s }));
  const result = measure(records);
  assert.equal(result.listedSessions, 400);
  assert.equal(result.sessions.length, 5);
  assert.equal(result.sessions[0].notRead, 5000);
  assert.ok(JSON.stringify(result).length < 2000);
});

test('the report measures inside the selected range and flags a model filter', () => {
  const now = new Date(2026, 5, 10, 12), late = new Date(2026, 5, 9, 10).getTime();
  const records = [call(base, { sessionName: 'Named' }), call(late, { cacheRead: 500 }), call(late + MINUTE, { model: 'B', cacheRead: 200 }), call(late + 2 * MINUTE, { cacheRead: 800 })];
  const all = buildReport(records, { range: 'all' }, now).efficiency.cacheTiming;
  assert.equal(all.modelFiltered, false);
  assert.deepEqual(all.situations.map(s => s.calls), [0, 0, 1, 1, 2]);
  // The same call is "first" once the earlier day is outside the range: not the true start.
  const day = buildReport(records, { range: 'custom', startDate: '2026-06-09', endDate: '2026-06-09' }, now).efficiency.cacheTiming;
  assert.deepEqual(day.situations.map(s => s.calls), [0, 0, 0, 1, 2]);
  assert.deepEqual(day.situations.find(s => s.id === 'first'), { id: 'first', calls: 1, input: 1000, cacheRead: 500, share: 50 });
  // With a model filter the call on the other model is not seen at all.
  const filtered = buildReport(records, { range: 'all', models: ['A'] }, now).efficiency.cacheTiming;
  assert.equal(filtered.modelFiltered, true);
  assert.deepEqual(filtered.situations.map(s => s.calls), [1, 0, 1, 1, 0]);
  const five = buildReport(Array.from({ length: 5 }, (_, i) => call(base + i * MINUTE, { sessionName: 'Named' })), { range: 'all' }, now).efficiency.cacheTiming;
  assert.equal(five.sessions[0].name, 'Named');
});

// Five days, one conversation a day: a first call, quick follow-ups, and two returns after two hours.
function pausedHistory(extra = {}) {
  const records = [];
  for (let d = 0; d < 5; d++) {
    const start = base + d * DAY, at = (ms, cacheRead, more = {}) => records.push(call(start + ms, { sessionId: `s${d}`, cacheRead, ...extra, ...more }));
    at(0, 0, { initiator: 'user' });
    for (let i = 1; i <= 4; i++) at(i * MINUTE, 800);
    at(2 * HOUR + 4 * MINUTE, 100, { initiator: 'user' }); at(2 * HOUR + 5 * MINUTE, 800);
    at(4 * HOUR + 5 * MINUTE, 100, { initiator: 'user' }); at(4 * HOUR + 6 * MINUTE, 800);
  }
  return records;
}
const pausedReport = extra => buildReport(pausedHistory(extra), { range: 'all' }, new Date(base + 6 * DAY));

test('the view shows when input is reused, with shares, calls, tokens, a trend and conversations', () => {
  const html = render(pausedReport()), shown = text(html);
  assert.match(html, /<h3>When is input reused\?<\/h3>/);
  assert.match(shown, /Compares calls in the main conversation: 45 of 45 have a complete cache split\. Subagent calls/);
  assert.match(html, /token-bar-label">Under 5 minutes<\/span>.*?token-bar-value">80%<\/span><span class="token-bar-detail">30 calls · 24000 of 30000 input tokens read from cache</);
  assert.match(html, /token-bar-label">Over 60 minutes<\/span>.*?width:10\.0%.*?token-bar-value">10%<\/span><span class="token-bar-detail">10 calls · 1000 of 10000 input tokens read from cache</);
  assert.match(html, /token-bar-label">First call of a conversation in the selected range<\/span>.*?token-bar-value">0%<\/span><span class="token-bar-detail">5 calls · 0 of 5000 input tokens read from cache</);
  // Rows with nothing measured are named, not drawn as zero.
  assert.doesNotMatch(html, /token-bar-label">5 to 60 minutes|token-bar-label">First call after a model change/);
  assert.match(shown, /Nothing measured in this selection for: 5 to 60 minutes since the previous call; first call after a model change\. That is not zero reuse\./);
  assert.match(shown, /A conversation&#39;s first call in the selected range is not necessarily its true start/);
  assert.match(shown, /left out, as are calls with no recorded initiator\./);
  assert.match(shown, /at least 10 calls and the shares differ by at least 20 percentage points/);
  assert.match(shown, /Share of input read from cache by day .* in the earlier days, .* in the later days · 2026-06-01 to 2026-06-05, 5 days with measurements/);
  assert.match(html, /<h3>Conversations with the most input not read from cache<\/h3>/);
  assert.match(html, /<td><span class="cell-text">9<\/span><\/td><td><span class="cell-text">9000<\/span><\/td><td><span class="cell-text">4000<\/span><\/td><td><span class="cell-text">55\.5\d+%<\/span><\/td>/);
  assert.match(shown, /Showing 5 of 5 conversations with at least 5 measured main-conversation calls/);
  assert.match(shown, /After a pause of over 60 minutes, calls read 10% of their input from cache\. With under 5 minutes since the previous call, they read 80%\./);
  assert.match(shown, /consistent with a cache that expired, but the data does not record why/);
  assert.match(shown, /Compare afterward: input tokens and actual credits/);
  // The totals, the stacked bar and the per-model table are still there.
  assert.match(shown, /Uncached input 20000/);
  assert.match(html, /aria-label="Uncached: 44\.4\d+%; Cache read: 55\.5\d+%; Cache write: 0%"/);
  assert.match(html, /<h3>Cache reuse by model<\/h3>/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('session and model names are escaped in the cache view', () => {
  const html = render(pausedReport({ sessionName: '<img src=x>', model: '<img src=x>' }));
  assert.doesNotMatch(html, /<img/);
  assert.ok(html.split('&lt;img src=x&gt;').length > 6, 'conversation rows and the model row are escaped');
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

const summary = { requests: 100, cacheRequests: 100, cacheInput: 1000, cacheRead: 500, cacheWrite: 0, uncachedInput: 500, cacheHitRate: 50 };
const situations = values => Object.entries({ under5: [50, 50000, 40000], mid: [0, 0, 0], over60: [0, 0, 0], first: [5, 5000, 0], modelChange: [0, 0, 0], ...values })
  .map(([id, [calls, input, cacheRead]]) => ({ id, calls, input, cacheRead, share: input > 0 ? cacheRead / input * 100 : null }));
const timed = (values, extra = {}) => ({ efficiency: { summary, cacheTiming: { mainCalls: 120, measuredCalls: 100, modelFiltered: false, minimumSessionCalls: 5, listedSessions: 0, situations: situations(values), sessions: [], ...extra } } });

test('the summary sentence needs enough calls and a clear difference, and otherwise stays general', () => {
  const general = /50% of measured input came from cache\./;
  // Nine calls after a long pause are too few, whatever their share.
  assert.match(text(render(timed({ over60: [9, 9000, 0] }))), general);
  // Enough calls, but a difference of 19 points is not far below 80%.
  assert.match(text(render(timed({ over60: [10, 10000, 6100] }))), general);
  assert.match(text(render(timed({ over60: [10, 10000, 6000] }))), /After a pause of over 60 minutes, calls read 60% of their input from cache\. With under 5 minutes since the previous call, they read 80%\./);
  // Too few quick calls to compare against.
  assert.match(text(render(timed({ under5: [9, 9000, 7200], over60: [40, 40000, 0] }))), general);
  // The shorter pause is named when the longer one does not qualify.
  assert.match(text(render(timed({ mid: [12, 12000, 3000], over60: [3, 3000, 0] }))), /After a pause of 5 to 60 minutes, calls read 25% of their input from cache\. With under 5 minutes since the previous call, they read 80%\./);
  // The longest qualifying pause leads when both do.
  assert.match(text(render(timed({ mid: [40, 40000, 10000], over60: [10, 10000, 1000] }))), /After a pause of over 60 minutes, calls read 10%/);
  // A model change leads only when it holds more input not read from cache than the pauses.
  const switched = text(render(timed({ over60: [10, 10000, 1000], modelChange: [20, 20000, 2000] })));
  assert.match(switched, /Right after a model change, calls read 10% of their input from cache\. With no model change and under 5 minutes since the previous call, they read 80%\./);
  assert.match(switched, /consistent with a cache that is not shared between models, but the data does not record why/);
  assert.match(text(render(timed({ over60: [30, 30000, 3000], modelChange: [20, 20000, 2000] }))), /After a pause of over 60 minutes/);
  assert.match(text(render(timed({ modelChange: [20, 20000, 2000] }))), /Right after a model change/);
  for (const values of [{}, { over60: [10, 10000, 6000] }, { modelChange: [20, 20000, 2000] }]) assert.doesNotMatch(render(timed(values)), /NaN|undefined|Infinity/);
});

test('missing or partial timing data is stated, not shown as zero reuse', () => {
  const empty = render();
  assert.match(empty, /<h3>When is input reused\?<\/h3>/);
  assert.match(empty, /No main-conversation calls with a complete cache split match these filters/);
  assert.match(empty, /Missing cache data is not zero reuse\./);
  assert.doesNotMatch(empty, /Conversations with the most input|token-bar-row|NaN|undefined|Infinity/);
  // Main calls exist but none has a cache split.
  const unmeasured = render(buildReport([call(base, { cacheRead: null, cacheWrite: null })], { range: 'all' }, new Date(base + DAY)));
  assert.match(unmeasured, /No main-conversation calls with a complete cache split match these filters/);
  assert.doesNotMatch(unmeasured, /token-bar-row|NaN|undefined|Infinity/);
  const partial = text(render(timed({ over60: [1, 1000, 100] }, { modelFiltered: true })));
  assert.match(partial, /100 of 120 have a complete cache split\. The other 20 are not compared\./);
  assert.match(partial, /Over 60 minutes 10% 1 call · 100 of 1000 input tokens read from cache/);
  assert.match(partial, /Nothing measured in this selection for: 5 to 60 minutes since the previous call; first call after a model change\./);
  assert.match(partial, /A model filter is on, so calls on other models are not seen/);
  assert.match(partial, /No conversation has at least 5 measured main-conversation calls in this selection\./);
  assert.doesNotMatch(text(render(timed({}))), /A model filter is on/);
  assert.match(text(render(timed({}, { mainCalls: 101 }))), /The other one is not compared\./);
  assert.doesNotMatch(text(render(timed({}, { mainCalls: 100 }))), /not compared/);
});

test('the cache panel renders the timing view inside the built dashboard', async () => {
  const report = { ...pausedReport({ sessionName: '<img src=x>', model: '<img src=x>' }), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: 'cache' } }) } });
  const html = get('token-cache-detail').innerHTML;
  assert.match(html, /When is input reused\?/);
  assert.match(html, /After a pause of over 60 minutes, calls read 10% of their input from cache/);
  assert.match(html, /Conversations with the most input not read from cache/);
  assert.match(get('efficiency-cache').innerHTML, /of measured input was reused from cache/);
  assert.doesNotMatch(html, /<img|NaN|undefined|Infinity/);
});

test('the demo history has pauses and model changes for the cache view to compare', () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now);
  assert.ok(data.records.every(record => record.ms <= now.getTime()));
  const timing = buildReport(data.records, { range: '30d' }, now, data).efficiency.cacheTiming;
  for (const s of timing.situations) assert.ok(s.calls >= 10 && s.share !== null, s.id);
  const share = id => timing.situations.find(s => s.id === id).share;
  assert.ok(share('under5') - share('over60') >= 20);
  assert.equal(timing.sessions.length, 5);
  assert.match(text(render({ efficiency: { summary: {}, cacheTiming: timing } })), /After a pause of over 60 minutes/);
});
