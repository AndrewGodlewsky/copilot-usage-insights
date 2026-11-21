import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelegationTopic } from '../src/core/efficiency-delegation.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { dayKey } from '../src/core/query.mjs';
import { formatNumber, formatCredits } from '../src/core/format.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { demoData } from '../scripts/demo-data.mjs';

// Locale-independent stand-ins for the panel formatters; they honour the requested precision.
const number = (value, options = {}) => Number.isFinite(value) ? String(Number(value.toFixed(options.maximumFractionDigits ?? 3))) : 'Unavailable';
const formats = { number, credits: number };
const render = (report, extra) => renderTokenTopic('delegation', report, { ...formats, ...extra });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const DAY = 86_400_000, base = Date.UTC(2026, 5, 1, 12), now = new Date(base + DAY);
let serial = 0;
const call = (extra = {}) => ({ key: `k${serial++}`, ms: base + serial * 1000, sessionId: 'alpha', sessionName: 'Alpha', project: 'p', model: 'Big', initiator: 'user',
  inputTotal: 4000, output: 400, cacheRead: 3000, cacheWrite: 0, reasoning: 0, nanoAiu: 1e9, creditStatus: 'complete', duration: 4000, ...extra });
const subCall = (extra = {}) => call({ model: 'Small', initiator: 'sub-agent', inputTotal: 1000, output: 100, cacheRead: 250, nanoAiu: 5e8, duration: 2000, ...extra });
// Ten calls: six in the main conversation, three by subagents, one with no recorded initiator.
const history = () => [
  call(), call({ initiator: 'agent' }), subCall(), subCall(),
  call({ sessionId: 'beta', sessionName: 'Beta' }), call({ sessionId: 'beta', sessionName: 'Beta', initiator: 'agent', model: 'Small' }),
  call({ sessionId: 'beta', sessionName: 'Beta', initiator: 'agent', model: 'Small' }), subCall({ sessionId: 'beta', sessionName: 'Beta' }),
  call({ sessionId: 'gamma', sessionName: 'Gamma', model: 'Small' }),
  call({ sessionId: 'gamma', sessionName: 'Gamma', initiator: '', model: 'Other', inputTotal: 3000, output: 300, nanoAiu: 5e8 }),
];
const report = (records, query = { range: 'all' }) => buildReport(records, query, now);

test('the delegation topic counts subagent calls per conversation, model and day and leaves unknown initiators on neither side', () => {
  const topic = createDelegationTopic({ sessionLabels: new Map([['a', 'Alpha'], ['b', 'Beta']]) });
  const add = (sessionId, model, initiator, day = 10) => topic.add({ sessionId, model, initiator }, day);
  add('a', 'Big', 'user'); add('a', 'Big', 'agent'); add('a', 'Small', 'sub-agent'); add('a', 'Small', 'sub-agent');
  add('b', 'Big', 'user'); add('b', 'Small', 'agent'); add('b', 'Big', 'agent'); add('b', 'Small', 'sub-agent', 11);
  add('c', 'Big', 'user', 11); add('c', 'Other', '', 11); add('c', 'Other', 'something-else', 12);
  assert.deepEqual(topic.finish(), {
    requests: 11, mainRequests: 6, delegatedRequests: 3, conversations: 3, delegatedConversations: 2,
    topConversations: [{ name: 'Alpha', requests: 4, delegated: 2, share: 50 }, { name: 'Beta', requests: 4, delegated: 1, share: 25 }],
    models: [{ name: 'Small', mainRequests: 1, delegatedRequests: 3 }, { name: 'Big', mainRequests: 5, delegatedRequests: 0 }],
    otherModels: { models: 0, mainRequests: 0, delegatedRequests: 0 },
    series: { unit: 'day', points: [{ day: dayKey(10), requests: 7, delegated: 2 }, { day: dayKey(11), requests: 3, delegated: 1 }, { day: dayKey(12), requests: 1, delegated: 0 }], earlier: 0 },
  });
  assert.deepEqual(createDelegationTopic().finish(), { requests: 0, mainRequests: 0, delegatedRequests: 0, conversations: 0, delegatedConversations: 0,
    topConversations: [], models: [], otherModels: { models: 0, mainRequests: 0, delegatedRequests: 0 }, series: { unit: 'day', points: [], earlier: 0 } });
});

test('the delegation topic keeps five conversations, orders ties predictably and names unlabelled sessions', () => {
  const topic = createDelegationTopic({ sessionLabels: new Map([['s1', 'One'], ['s2', 'Two'], ['s3', 'Three'], ['s4', 'Four'], ['s5', 'Five'], ['s6', 'Six']]) });
  const add = (sessionId, initiator, times) => { for (let i = 0; i < times; i++) topic.add({ sessionId, model: 'M', initiator }, 1); };
  // Records are not guaranteed to arrive grouped by session.
  add('s1', 'sub-agent', 2); add('s2', 'sub-agent', 3); add('s1', 'agent', 2); add('s3', 'sub-agent', 2); add('s3', 'user', 6); add('s2', 'user', 1);
  add('s4', 'sub-agent', 1); add('s5', 'sub-agent', 1); add('s6', 'sub-agent', 1); add('none', 'sub-agent', 5); add('main-only', 'user', 9);
  const result = topic.finish();
  assert.equal(result.conversations, 8);
  assert.equal(result.delegatedConversations, 7);
  assert.deepEqual(result.topConversations.map(row => [row.name, row.delegated, row.requests]), [
    ['Unnamed session', 5, 5], ['Two', 3, 4], ['Three', 2, 8], ['One', 2, 4], ['Five', 1, 1]]);
  assert.equal(result.topConversations[2].share, 25);
});

test('the model mix lists the leading subagent and main-conversation models and sums the rest', () => {
  const topic = createDelegationTopic();
  const add = (model, initiator, times) => { for (let i = 0; i < times; i++) topic.add({ sessionId: 's', model, initiator }, 1); };
  for (let i = 1; i <= 6; i++) add(`d${i}`, 'sub-agent', 7 - i);
  for (let i = 1; i <= 7; i++) add(`m${i}`, i % 2 ? 'user' : 'agent', (8 - i) * 10);
  add('d1', 'user', 5); add('unknown-only', '', 40);
  const result = topic.finish();
  assert.deepEqual(result.models.map(row => row.name), ['d1', 'd2', 'd3', 'd4', 'd5', 'm1', 'm2', 'm3', 'm4', 'm5']);
  assert.deepEqual(result.models[0], { name: 'd1', mainRequests: 5, delegatedRequests: 6 });
  assert.deepEqual(result.otherModels, { models: 3, mainRequests: 30, delegatedRequests: 1 });
  assert.equal(result.models.reduce((sum, row) => sum + row.delegatedRequests, 0) + result.otherModels.delegatedRequests, result.delegatedRequests);
  assert.equal(result.models.reduce((sum, row) => sum + row.mainRequests, 0) + result.otherModels.mainRequests, result.mainRequests);
  assert.equal(result.requests, result.mainRequests + result.delegatedRequests + 40);
});

test('the delegation series groups long spans into weeks, keeps the latest periods and skips untimed calls', () => {
  const weekly = createDelegationTopic();
  for (let day = 68; day >= 0; day -= 2) { weekly.add({ sessionId: 's', model: 'M', initiator: 'user' }, 100 + day); if (day % 4 === 0) weekly.add({ sessionId: 's', model: 'M', initiator: 'sub-agent' }, 100 + day); }
  const grouped = weekly.finish().series;
  assert.equal(grouped.unit, 'week');
  assert.equal(grouped.points.length, 10);
  assert.equal(grouped.earlier, 0);
  assert.deepEqual(grouped.points[0], { day: dayKey(100), requests: 6, delegated: 2 });
  assert.equal(grouped.points.reduce((sum, point) => sum + point.requests, 0), 53);
  assert.equal(grouped.points.reduce((sum, point) => sum + point.delegated, 0), 18);

  const long = createDelegationTopic();
  for (let week = 0; week < 71; week++) long.add({ sessionId: 's', model: 'M', initiator: week === 70 ? 'sub-agent' : 'user' }, 200 + week * 7);
  long.add({ sessionId: 's', model: 'M', initiator: 'sub-agent' }, NaN);
  long.add({ sessionId: 's', model: 'M', initiator: 'sub-agent' });
  const result = long.finish();
  assert.equal(result.requests, 73);
  assert.equal(result.delegatedRequests, 3);
  assert.equal(result.series.points.length, 62);
  assert.equal(result.series.earlier, 9);
  assert.equal(result.series.points[0].day, dayKey(200 + 9 * 7));
  assert.deepEqual(result.series.points.at(-1), { day: dayKey(200 + 70 * 7), requests: 1, delegated: 1 });
});

test('what the delegation topic adds to the report stays small for a large history', () => {
  const topic = createDelegationTopic({ sessionLabels: new Map(Array.from({ length: 3000 }, (_, i) => [`s${i}`, `Session ${i} with a fairly long descriptive name`])) });
  for (let i = 0; i < 60000; i++) topic.add({ sessionId: `s${i % 3000}`, model: `Model ${i % 40}`, initiator: i % 3 ? 'agent' : 'sub-agent' }, 1000 + i % 900);
  const result = topic.finish();
  assert.equal(result.requests, 60000);
  assert.equal(result.conversations, 3000);
  assert.equal(result.topConversations.length, 5);
  assert.ok(result.models.length <= 10);
  assert.equal(result.series.points.length, 62);
  assert.ok(JSON.stringify(result).length < 6000, `${JSON.stringify(result).length} bytes`);
});

test('the report carries the delegation topic for the selected dates and models with session labels', () => {
  const records = [...history(), subCall({ ms: base - 40 * DAY, sessionId: 'old', sessionName: 'Old' })];
  const all = report(records).efficiency.delegation;
  assert.equal(all.requests, 11);
  assert.equal(all.delegatedRequests, 4);
  const recent = report(records, { range: '7d' }).efficiency.delegation;
  assert.deepEqual([recent.requests, recent.mainRequests, recent.delegatedRequests, recent.conversations, recent.delegatedConversations], [10, 6, 3, 3, 2]);
  assert.deepEqual(recent.topConversations, [{ name: 'Alpha', requests: 4, delegated: 2, share: 50 }, { name: 'Beta', requests: 4, delegated: 1, share: 25 }]);
  assert.deepEqual(recent.models, [{ name: 'Small', mainRequests: 3, delegatedRequests: 3 }, { name: 'Big', mainRequests: 3, delegatedRequests: 0 }]);
  assert.equal(recent.series.points.length, 1);
  const big = report(records, { range: '7d', models: ['Big'] }).efficiency.delegation;
  assert.deepEqual([big.requests, big.mainRequests, big.delegatedRequests, big.delegatedConversations], [3, 3, 0, 0]);
  // The topic agrees with the initiator rows it is shown beside.
  const e = report(records, { range: '7d' }).efficiency;
  assert.equal(e.byInitiator.find(row => row.id === 'sub-agent').requests, recent.delegatedRequests);
  assert.equal(e.summary.requests, recent.requests);
});

test('the delegated work view splits usage three ways with matched denominators and stated coverage', () => {
  const html = render(report(history())), plain = text(html);
  assert.match(plain, /Share of model calls 30% 3 of 10 model calls, counting calls with no recorded initiator in the total/);
  assert.match(plain, /Conversations with subagent calls 2 Of 3 conversations with model calls/);
  assert.match(plain, /Model calls All 10 model calls Main conversation 60% · 6 Subagents 30% · 3 Not recorded 10% · 1 /);
  // Tokens: 6 x 4400, 3 x 1100 and 3300 of 33000 measured.
  assert.match(plain, /Measured tokens Input, cached input included, plus output on 10 of 10 model calls Main conversation 80% · 26400 Subagents 10% · 3300 Not recorded 10% · 3300 /);
  // Credits: 6, 1.5 and 0.5 of 8 recorded, which is 75%, 18.75% and 6.25% before rounding to one decimal.
  assert.match(plain, /Recorded AI credits Complete charges on 10 of 10 model calls Main conversation 75% · 6 Subagents 18\.8% · 1\.5 Not recorded 6\.3% · 0\.5 /);
  assert.match(html, /role="img" aria-label="Model calls: Main conversation 60%; Subagents 30%; Not recorded 10%"/);
  assert.match(html, /<span style="width:60\.00%;background:var\(--s1\)"><\/span><span style="width:30\.00%;background:var\(--s2\)"><\/span><span style="width:10\.00%;background:var\(--muted-fg\)"><\/span>/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the delegated work view compares one subagent call with one main-conversation call', () => {
  const html = render(report(history())), plain = text(html);
  assert.match(plain, /A subagent call read 1000 input tokens on average, against 4000 in the main conversation\./);
  assert.match(plain, /Input tokens per call Subagents 1000 3 of 3 subagent calls Main conversation 4000 6 of 6 main-conversation calls/);
  assert.match(plain, /Output tokens per call Subagents 100 3 of 3 subagent calls Main conversation 400 6 of 6 main-conversation calls/);
  assert.match(plain, /AI credits per call Subagents 0\.5 3 of 3 subagent calls Main conversation 1 6 of 6 main-conversation calls/);
  assert.match(plain, /Input read from cache Subagents 25% 3 of 3 subagent calls Main conversation 75% 6 of 6 main-conversation calls/);
  assert.match(plain, /Time per call Subagents 2 s 3 of 3 subagent calls Main conversation 4 s 6 of 6 main-conversation calls/);
  // Each pair is drawn against the larger side, and a share against the whole.
  assert.match(html, /Input tokens per call<\/h4>.*?width:25\.0%;background:var\(--s2\).*?width:100\.0%;background:var\(--s1\)/);
  assert.match(html, /Input read from cache<\/h4>.*?width:25\.0%;background:var\(--s2\).*?width:75\.0%;background:var\(--s1\)/);
  assert.match(plain, /not a saving on its own/);
  assert.doesNotMatch(plain, /\bsaved\b|\bwaste|cheaper|more efficient/i);
  assert.match(plain, /Subagents made 30% of model calls and read 1000 input tokens per call, against 4000 in the main conversation\./);
  assert.match(plain, /give the subagent a bounded goal, the context it needs and a concise return format/);
  assert.match(plain, /Only calls with an explicit sub-agent initiator are counted, and calls with no recorded initiator may hide more\. Parent links and the value of delegation are not inferred\./);
});

test('the delegated work view shows model routing and where delegation happens', () => {
  const html = render(report(history())), plain = text(html);
  assert.match(plain, /100% of subagent calls ran on Small\. That model handled 50% of main-conversation calls\./);
  assert.match(plain, /Small Subagents 100% 3 of 3 subagent calls Main conversation 50% 3 of 6 main-conversation calls/);
  assert.match(plain, /Big Subagents 0% 0 of 3 subagent calls Main conversation 50% 3 of 6 main-conversation calls/);
  assert.doesNotMatch(plain, /Other Subagents|Other models/, 'a model with only unrecorded initiators is on neither side');
  assert.match(plain, /2 of 3 conversations with model calls had at least one subagent call\./);
  assert.match(plain, /Alpha 2 4 50% Beta 1 4 25% /);
  assert.match(plain, /The 2 conversations with the most subagent calls, of 2 that had any\. Together they made 100% of subagent calls\./);
  assert.doesNotMatch(plain, /Subagent share of model calls by/, 'one day is not a trend');
  const days = Array.from({ length: 5 }, (_, day) => [call({ ms: base - day * DAY }), call({ ms: base - day * DAY + 1 }), ...(day < 2 ? [subCall({ ms: base - day * DAY + 2 }), subCall({ ms: base - day * DAY + 3 })] : [])]).flat();
  assert.match(text(render(report(days))), /Subagent share of model calls by day 0% in the earlier days, 50% in the later days/);
});

test('the delegated work view handles an empty history and a history without subagent calls', () => {
  for (const empty of [render({}), render(report([]))]) {
    assert.match(empty, /Unavailable|0 of 0 model calls/);
    assert.match(empty, /No explicitly labelled subagent calls in this view\./);
    assert.match(empty, /Compare afterward:/);
    assert.doesNotMatch(empty, /NaN|undefined|Infinity|delegation-pair|delegation-split|role="img"/);
  }
  assert.match(text(render({})), /Conversations with subagent calls Unavailable Not measured in this report/);
  const mainOnly = render(report([call(), call({ initiator: 'agent' })])), plain = text(mainOnly);
  assert.match(plain, /Recorded subagent calls 0 /);
  assert.match(plain, /Share of model calls 0% 0 of 2 model calls/);
  assert.match(plain, /Conversations with subagent calls 0 Of 1 conversations with model calls/);
  assert.match(plain, /Model calls All 2 model calls Main conversation 100% · 2 Subagents 0% · 0 Not recorded 0% · 0 /);
  assert.match(plain, /No explicitly labelled subagent calls in this view\./);
  assert.doesNotMatch(mainOnly, /NaN|undefined|Infinity|delegation-pair|Where delegation happens|Which models did the work/);
});

test('missing delegated measurements stay unavailable and are never drawn as zero', () => {
  const records = [call(), call({ initiator: 'agent' }),
    subCall({ inputTotal: null, cacheRead: null, cacheWrite: null, nanoAiu: null, creditStatus: 'unavailable', duration: null }),
    subCall({ inputTotal: null, cacheRead: null, cacheWrite: null, nanoAiu: null, creditStatus: 'unavailable', duration: null })];
  const html = render(report(records)), plain = text(html);
  assert.match(plain, /Input per call is not recorded on both sides in these filters\./);
  assert.match(plain, /Input tokens per call Subagents Unavailable 0 of 2 subagent calls Main conversation 4000 2 of 2 main-conversation calls/);
  assert.match(plain, /AI credits per call Subagents Unavailable 0 of 2 subagent calls/);
  assert.match(plain, /Input read from cache Subagents Unavailable 0 of 2 subagent calls/);
  assert.match(plain, /Time per call Subagents Unavailable 0 of 2 subagent calls/);
  assert.match(plain, /Output tokens per call Subagents 100 2 of 2 subagent calls/);
  assert.match(html, /Input tokens per call<\/h4>.*?width:0\.0%;background:var\(--s2\)/);
  // Two of four calls have both token counts, and two have complete charges.
  assert.match(plain, /plus output on 2 of 4 model calls Main conversation 100% · 8800 Subagents Unavailable · Unavailable Not recorded 0% · 0 /);
  assert.match(plain, /Complete charges on 2 of 4 model calls Main conversation 100% · 2 Subagents Unavailable · Unavailable /);
  assert.match(plain, /50% of model calls \(2\) are explicitly labelled as subagent work\./);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);

  const partial = render(report([call(), subCall(), subCall({ inputTotal: null, cacheRead: null, cacheWrite: null })]));
  assert.match(text(partial), /Input tokens per call Subagents 1000 \* 1 of 2 subagent calls/);
  assert.match(text(partial), /Subagents 20% \* · 1100 /);
  const hidden = render(report([call(), subCall(), subCall({ inputTotal: null, cacheRead: null, cacheWrite: null })]), { showCoverage: false });
  assert.doesNotMatch(hidden, /\d%? \*/);
  assert.match(text(hidden), /Input tokens per call Subagents 1000 1 of 2 subagent calls/);

  const free = text(render(report([call({ nanoAiu: 0 }), subCall({ nanoAiu: 0 })])));
  assert.match(free, /Recorded AI credits Complete charges on 2 of 2 model calls The recorded total is 0, so there are no shares to show\./);
  assert.match(free, /AI credits per call Subagents 0 1 of 1 subagent calls Main conversation 0 1 of 1 main-conversation calls/);
  const unpriced = text(render(report([call({ nanoAiu: null, creditStatus: 'unavailable' }), subCall({ nanoAiu: null, creditStatus: 'unavailable' })])));
  assert.match(unpriced, /Recorded AI credits Complete charges on 0 of 2 model calls Not recorded on any call in these filters\./);
  assert.match(unpriced, /AI credits per call Subagents Unavailable 0 of 1 subagent calls Main conversation Unavailable 0 of 1 main-conversation calls/);
});

test('the delegated work view escapes model and session names', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const html = render(report([call({ model: hostile, sessionName: hostile }), subCall({ model: hostile, sessionName: hostile }), subCall({ model: `${hostile}2`, sessionName: hostile })]));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<h4>&lt;img src=x onerror=alert\(1\)&gt;<\/h4>/);
  assert.match(html, /ran on &lt;img src=x onerror=alert\(1\)&gt;\./);
  assert.match(html, /<span class="cell-text">&lt;img src=x onerror=alert\(1\)&gt;<\/span>/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the delegated work view leads with unknown initiators when they outnumber subagent calls', () => {
  const plain = text(render(report([call(), subCall(), call({ initiator: '' }), call({ initiator: '' })])));
  assert.match(plain, /2 calls have no recorded initiator, more than the 1 labelled as subagent work\./);
  assert.match(plain, /Unknown initiator 2 May contain additional delegated work/);
  const subagentsOnly = text(render(report([subCall(), subCall()])));
  assert.match(subagentsOnly, /No main-conversation calls are in these filters, so subagent calls have nothing to be compared with\./);
  assert.match(subagentsOnly, /100% of subagent calls ran on Small\. Small Subagents 100% 2 of 2 subagent calls Main conversation Unavailable 0 of 0 main-conversation calls/);
  assert.doesNotMatch(subagentsOnly, /NaN|undefined|Infinity/);
});

test('the delegated work view renders the demo history with the panel formatters', () => {
  const at = new Date(2026, 10, 20, 12), data = demoData(at);
  for (const range of ['7d', '30d', 'all']) {
    const built = buildReport(data.records, { range }, at, data);
    const html = renderTokenTopic('delegation', built, { number: (value, options) => formatNumber(value, { simplify: false, ...options }), credits: value => formatCredits(value, { simplify: false }) });
    assert.doesNotMatch(html, /NaN|undefined|Infinity/, range);
    assert.match(html, /A subagent call read \d[^<]*? input tokens on average, against \d[^<]*? in the main conversation\./, range);
    assert.ok(JSON.stringify(built.efficiency.delegation).length < 6000, range);
    const sub = built.efficiency.byInitiator.find(row => row.id === 'sub-agent'), main = ['user', 'agent'].map(id => built.efficiency.byInitiator.find(row => row.id === id));
    // A demo subagent starts from its own short context, so the comparison has something to show.
    assert.ok(sub.averageInput < (main[0].inputTokens + main[1].inputTokens) / (main[0].inputRequests + main[1].inputRequests), range);
  }
});
