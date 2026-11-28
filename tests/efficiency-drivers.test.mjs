import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { normalizeUsage } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { encodeReportWire, decodeReportWire } from '../src/core/report-wire.mjs';
import { formatNumber, formatCredits } from '../src/core/format.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const formats = { number: value => value == null ? 'Unavailable' : String(value), credits: value => value == null ? 'Unavailable' : String(value) };
const render = (report, options = {}) => renderTokenTopic('drivers', report, { ...formats, ...options });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const cards = html => html.split('<li>').slice(1).map(part => text(part.split('</li>')[0]));
const unescape = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const buttons = html => [...html.matchAll(/<button class="token-driver-open" data-token-session="([^"]*)" data-token-project="([^"]*)">Open in Breakdown<span class="sr-only">: ([^<]*)<\/span><\/button>/g)]
  .map(([, session, project, label]) => ({ session: unescape(session), project: unescape(project), label: unescape(label) }));
const group = (name, credits, requests, averageCredits, extra = {}) => ({ id: `id-${name}`, name, project: 'Project', credits, requests, averageCredits, completeCreditRequests: requests, ...extra });
const even = (count, credits = 1) => Array.from({ length: count }, (_, i) => group(`Session ${i}`, credits, 10, credits / 10));

// Ten groups with charges, 100 credits in all. Typical: 10 calls and 0.5 credits per call.
const measured = () => [
  group('Alpha', 40, 60, .6, { completeCreditRequests: 58, missingCredits: 2, inputTotal: 600000, input: 100000, cacheRead: 300000, cacheWrite: 100000,
    missing: { inputTotal: 10, input: 20, cacheRead: 20, cacheWrite: 20 } }),
  group('Bravo', 20, 10, 2),
  group('Charlie', 10, 20, .5, { inputTotal: 200000, input: 50000, cacheRead: 150000, cacheWrite: 0, missing: { inputTotal: 0, input: 0, cacheRead: 0, cacheWrite: 0 } }),
  group('Delta', 8, 8, 1, { inputTotal: 8000, input: 1000, cacheRead: 1000, cacheWrite: 0, missing: { inputTotal: 0, input: 3, cacheRead: 2, cacheWrite: 2 } }),
  group('Echo', 6, 12, .6, { inputTotal: 12000, input: 0, cacheRead: 0, cacheWrite: 0, missing: { inputTotal: 0, input: 12, cacheRead: 12, cacheWrite: 12 } }),
  group('Foxtrot', 5, 10, .5), group('Golf', 4, 10, .4), group('Hotel', 3, 10, .3), group('India', 2, 10, .2), group('Juliet', 2, 10, .2),
  group('Kilo', null, 7, null),
];

test('concentration counts the largest groups that reach half and 80% of recorded credits', () => {
  const html = render({ sessions: measured() }), shown = text(html);
  assert.match(shown, /Recorded AI credits 100 /);
  assert.match(shown, /Top five groups 84% 5 of 10 groups with charges/);
  assert.match(shown, /Groups making up half 2 Of 10 session groups with charges/);
  assert.match(shown, /Groups making up 80% 5 Of 10 session groups with charges/);
  assert.match(shown, /2 of 10 session groups with charges make up half of recorded credits, and 5 make up 80%\./);
  assert.match(shown, /1 with no recorded charge is not ranked\./, 'an unavailable charge is left out, not counted as zero');
  assert.match(shown, /Recorded credits are concentrated: 2 of 10 session groups make up half\./);
  assert.match(shown, /does not estimate waste, and partial charges can change it\./);
  assert.match(shown, /Unavailable charges are excluded; a session spanning projects can appear more than once\./);
  assert.equal((html.match(/<tr>/g) || []).length, 6);
  assert.doesNotMatch(html, /Foxtrot|Golf|Hotel|India|Juliet|Kilo|NaN|undefined|Infinity/);

  // One group that holds everything, and a single exact half.
  assert.match(text(render({ sessions: [group('Only', 4, 3, 1)] })), /One session group holds all recorded credits in this range\./);
  const pair = text(render({ sessions: [group('One', 5, 3, 1), group('Two', 5, 3, 1)] }));
  assert.match(pair, /1 of 2 session groups with charges makes up half of recorded credits, and 2 make up 80%\./);
});

test('each top group is compared with the typical group by calls and by credits per call', () => {
  const [alpha, bravo, charlie, delta, echo, ...rest] = cards(render({ sessions: measured() }));
  assert.equal(rest.length, 0);
  assert.match(alpha, /Alpha Project · 40 \* AI credits/);
  assert.match(alpha, /6 times the typical number of calls, 1\.2 times the typical credits per call\. Larger multiple: call count/);
  assert.match(alpha, /Calls 60 Typical: 10 /);
  assert.match(alpha, /Credits per call 0\.6 \* 58 of 60 model calls with a complete charge Typical: 0\.5 /);
  assert.match(bravo, /About the typical number of calls, 4 times the typical credits per call\. Larger multiple: credits per call/);
  assert.match(charlie, /2 times the typical number of calls, about the typical credits per call\. Larger multiple: call count/);
  assert.match(delta, /0\.8 times the typical number of calls, 2 times the typical credits per call\. Larger multiple: credits per call/);
  assert.match(echo, /1\.2 times the typical number of calls, 1\.2 times the typical credits per call\. The two multiples are similar/);
  const shown = text(render({ sessions: measured() }));
  assert.match(shown, /Typical is the middle value across the 10 session groups with charges: half are below it\./);
  assert.match(shown, /Multiples describe size, not a cause/);
});

test('input per call and cache-read share divide by the calls that recorded them', () => {
  const [alpha, bravo, charlie, delta, echo] = cards(render({ sessions: measured() }));
  assert.match(alpha, /Input per call 12000 \* 50 of 60 model calls with an input count/);
  assert.match(alpha, /Cache-read share 60% \* 40 of 60 model calls with a cache split/);
  assert.doesNotMatch(alpha, /50%|10000/, 'all input and all calls are not used as denominators');
  assert.match(bravo, /Input per call Unavailable Cache-read share Unavailable $/);
  assert.match(charlie, /Input per call 10000 20 of 20 model calls with an input count Cache-read share 75% 20 of 20 model calls with a cache split/);
  assert.match(delta, /Cache-read share Unavailable $/, 'a cache split that cannot be matched to its calls is not estimated');
  assert.match(echo, /Cache-read share Unavailable 0 of 12 model calls with a cache split/);
  assert.doesNotMatch(echo, /Cache-read share 0%/);
});

test('missing charges stay unavailable and coverage marks follow the notice', () => {
  const sessions = [...even(5), group('No complete charge', 3, 4, null, { completeCreditRequests: 0, partialCredits: 4 }), group('Unknown', null, 9, null)];
  const report = { sessions, totals: { partialCredits: 4 } };
  const html = render(report), [first] = cards(html);
  assert.match(first, /No complete charge Project · 3 \* AI credits/);
  assert.match(first, /Credits per call Unavailable 0 of 4 model calls with a complete charge/);
  assert.match(first, /^ No complete charge Project · 3 \* AI credits 0\.4 times the typical number of calls\. Calls 4 /, 'no multiple is invented for an unavailable rate');
  assert.match(text(html), /Groups making up half 2 \* Of 6 session groups with charges/);
  assert.doesNotMatch(html, /Unknown|NaN|undefined|Infinity/);
  const hidden = render(report, { showCoverage: false });
  assert.doesNotMatch(hidden, /\d%? \*/);
  assert.match(text(hidden), /Groups making up half 2 Of 6 session groups with charges/);

  const empty = render({ sessions: [group('Unknown', null, 9, null)] });
  assert.match(empty, /No session charges are recorded for these filters\. Unavailable charges are not zero\./);
  assert.doesNotMatch(empty, /token-driver|<table/);
  assert.match(render({}), /No session charges are recorded/);

  const zero = text(render({ sessions: even(6, 0) }));
  assert.match(zero, /The recorded charges in this range are zero\./);
  assert.match(zero, /Groups making up half Unavailable /);
  assert.doesNotMatch(zero, /make up half of recorded credits|concentrated|spread out|NaN|undefined|Infinity/);

  const few = text(render({ sessions: [group('One', 6, 3, 2), group('Two', 3, 3, 1), group('Three', 1, 1, 1)] }));
  assert.match(few, /The largest group accounts for 60% of recorded charges\./);
  assert.match(few, /A typical group is described from at least five session groups with charges; this range has 3/);
  assert.doesNotMatch(few, /times the typical|Typical:|concentrated|spread out/);
});

test('the insight follows the evidence: concentrated, a day standing out, spread out, or neither', () => {
  const day = (index, credits, requests = 5) => ({ day: `2026-06-0${index}`, credits, requests });
  const spread = text(render({ sessions: even(10) }));
  assert.match(spread, /Recorded credits are spread out: it takes 5 of 10 session groups to make up half\./);
  assert.match(spread, /No small set of sessions holds most of the charges\./);

  const daily = [day(1, 15), day(2, 3), day(3, 3), day(4, 3), day(5, 3), day(6, 3), day(7, 0, 0), day(8, null, 2)];
  const standout = text(render({ sessions: even(10, 3), daily }));
  assert.match(standout, /One day stands out: 2026-06-01 holds 50% of recorded credits, 5 times a typical day with usage\./);
  assert.match(standout, /Days Largest 5 of 6 with charges; 1 with no recorded charge is not ranked/);
  assert.doesNotMatch(standout, /2026-06-07|2026-06-08/, 'days without usage or without a recorded charge are not ranked');

  const concentrated = text(render({ sessions: measured(), daily }));
  assert.match(concentrated, /Recorded credits are concentrated: 2 of 10 session groups make up half\./, 'session concentration answers the topic first');
  assert.doesNotMatch(concentrated, /One day stands out/);

  const steady = [day(1, 4), day(2, 3), day(3, 3), day(4, 3), day(5, 3), day(6, 3)];
  assert.match(text(render({ sessions: even(10), daily: steady })), /Recorded credits are spread out/);
  assert.match(text(render({ sessions: even(10), daily: daily.slice(0, 4) })), /Recorded credits are spread out/, 'a typical day needs five days with usage');

  const between = text(render({ sessions: [20, 15, 15, 10, 10, 10, 5, 5, 5, 5].map((credits, i) => group(`Session ${i}`, credits, 10, 1)) }));
  assert.match(between, /Compare afterward/);
  assert.match(between, /3 of 10 session groups make up half of recorded credits\. Start with a high-spend session in Breakdown\./);
  assert.doesNotMatch(between, /concentrated:|spread out:/);
  for (const shown of [spread, standout, concentrated, between]) {
    assert.match(shown, /A costly session can still be valuable; this ranking does not estimate waste, and partial charges can change it\./);
    assert.doesNotMatch(shown, /NaN|undefined|Infinity|wast(?:ed|eful)|sav(?:e|ed|ings)/);
  }
});

test('projects, models and days each list at most five rows with their own charge coverage', () => {
  const projects = Array.from({ length: 8 }, (_, i) => ({ name: `Repo ${i}`, credits: 8 - i, requests: 10 + i }));
  const models = [{ name: 'Model A', credits: 5, requests: 10, missingCredits: 1 }, { name: 'Model B', credits: 5, requests: 4 }, { name: 'Model C', credits: null, requests: 3, missingCredits: 3 }];
  const daily = [{ day: '2026-06-01', credits: 0, requests: 0 }, { day: '2026-06-02', credits: 6, requests: 5, partialCredits: 1 }, { day: '2026-06-03', credits: 2, requests: 2 }];
  const html = render({ sessions: even(6), projects, models, daily }), shown = text(html);
  assert.match(shown, /Where else recorded credits concentrate/);
  assert.match(shown, /Projects Largest 5 of 8 with charges Repo 0 : open in Breakdown 8 /);
  assert.equal((html.match(/class="token-bar-row"/g) || []).length, 9);
  assert.doesNotMatch(html, /Repo [567]|2026-06-01|NaN|undefined|Infinity/);
  assert.match(html, /<span class="token-bar-label"><button class="model-toggle token-bar-button" data-driver-project="Repo 0" title="Open in Breakdown">Repo 0<span class="sr-only">: open in Breakdown<\/span><\/button><\/span><span class="token-bar-track" aria-hidden="true"><i style="width:22\.2%"><\/i><\/span>/, 'the bar is the share of recorded credits');
  // Two models tie on credits; only the one with an incomplete charge is marked.
  assert.match(html, /<span class="token-bar-label"><button class="model-toggle token-bar-button" data-driver-model="Model A" title="Open in Breakdown">Model A<span class="sr-only">: open in Breakdown<\/span><\/button><\/span><span[^>]*><i[^>]*><\/i><\/span><span class="token-bar-value">5 \*<\/span><span class="token-bar-detail">50% of recorded credits · 10 calls<\/span>/);
  assert.match(html, /<span class="token-bar-label"><button class="model-toggle token-bar-button" data-driver-model="Model B" title="Open in Breakdown">Model B<span class="sr-only">: open in Breakdown<\/span><\/button><\/span><span[^>]*><i[^>]*><\/i><\/span><span class="token-bar-value">5<\/span><span class="token-bar-detail">50% of recorded credits · 4 calls<\/span>/);
  assert.match(shown, /Models All 2 with charges; 1 with no recorded charge is not ranked/);
  assert.doesNotMatch(html, /Model C/);
  assert.match(shown, /Days All 2 with charges 2026-06-02 6 \* 75% of recorded credits · 5 calls 2026-06-03 2 25% of recorded credits · 2 calls/);
  assert.match(text(render({ sessions: even(6), models: [{ name: 'Solo', credits: 2, requests: 1 }] })), /Models The only one with charges Solo : open in Breakdown 2 100% of recorded credits · 1 call /);
  assert.match(shown, /The same charges appear in all three lists; do not add them\./);
  const partial = render({ sessions: even(6), models, totals: { missingCredits: 1 } });
  assert.match(partial, /50% \* of recorded credits · 4 calls/, 'shares are marked when any charge in the range is incomplete');
  assert.doesNotMatch(render({ sessions: even(6), models, totals: { missingCredits: 1 } }, { showCoverage: false }), /\d%? \*/);
  assert.doesNotMatch(render({ sessions: even(6) }), /Where else|token-bar/);
  assert.doesNotMatch(render({ sessions: even(6), models: [{ name: 'Free model', credits: 0, requests: 3 }] }), /Where else|token-bar/);
});

test('names are escaped everywhere, including the Breakdown button', () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const sessions = [{ ...group(hostile, 9, 4, 1), id: `"><img src=x>`, project: hostile }, ...even(5)];
  const html = render({ sessions, projects: [{ name: hostile, credits: 9, requests: 4 }], models: [{ name: hostile, credits: 9, requests: 4 }], daily: [{ day: hostile, credits: 9, requests: 4 }] });
  assert.doesNotMatch(html, /<img|onerror="/);
  // Ranking row: name, project, button label twice and its project attribute. Card: name and project. Concentration lists: project (attr + text), model (attr + text), day.
  assert.equal((html.match(/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/g) || []).length, 12);
  const [first, ...others] = buttons(html);
  assert.deepEqual(first, { session: '"><img src=x>', project: hostile, label: `${hostile}, ${hostile}` });
  assert.equal(others.length, 4);
  assert.deepEqual(others[0], { session: 'id-Session 0', project: 'Project', label: 'Session 0, Project' });
  // A row that cannot be addressed gets no button instead of a broken one.
  assert.deepEqual(buttons(render({ sessions: [{ name: 'No id', project: 'Project', credits: 1, requests: 1 }] })), []);
  assert.doesNotMatch(render({ sessions: [{ name: 'No id', credits: 1 }] }), /<button|undefined/);
});

const now = new Date(2026, 10, 14, 12);
function history(project = 'P & "Q" <one>') {
  const usage = (extra = {}) => ({ provider: { kind: 'copilot' }, model: 'Model A', inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0, copilotUsage: { totalNanoAiu: 5e8 }, ...extra });
  const record = (sessionId, index, data) => ({ ...normalizeUsage(data, { key: `${sessionId}-${index}`, timestamp: new Date(now.getTime() - index * 1000).toISOString(), sessionId, project }).record,
    sessionName: sessionId === 'big' ? '<Big session>' : `Small ${sessionId}` });
  return [
    record('big', 0, usage({ cacheReadTokens: 600, cacheWriteTokens: 100, copilotUsage: { totalNanoAiu: 1e9 } })),
    record('big', 1, usage({ inputTokens: 3000, cacheReadTokens: undefined, cacheWriteTokens: undefined, copilotUsage: { totalNanoAiu: 2e9 }, aiCreditsStatus: 'partial' })),
    record('big', 2, usage({ inputTokens: undefined, copilotUsage: { totalNanoAiu: 7e9 }, aiCreditsStatus: 'unavailable' })),
    ...['s1', 's2', 's3', 's4', 's5'].map(id => record(id, 0, usage())),
  ];
}

test('a built report feeds the view with matched measures, also after the compact wire format', () => {
  const report = buildReport(history(), {}, now), html = render(report), [big] = cards(html);
  assert.match(big, /&lt;Big session&gt; P &amp; &quot;Q&quot; &lt;one&gt; · 3 \* AI credits/);
  assert.match(big, /3 times the typical number of calls, 2 times the typical credits per call\. Larger multiple: call count/);
  assert.match(big, /Credits per call 1 \* 1 of 3 model calls with a complete charge Typical: 0\.5 /);
  assert.match(big, /Input per call 2000 \* 2 of 3 model calls with an input count/);
  assert.match(big, /Cache-read share 60% \* 1 of 3 model calls with a cache split/);
  assert.match(text(html), /Recorded credits are concentrated: 1 of 6 session groups makes up half\./);
  assert.deepEqual(buttons(html)[0], { session: 'big', project: 'P & "Q" <one>', label: '<Big session>, P & "Q" <one>' });
  const received = decodeReportWire(JSON.parse(JSON.stringify(encodeReportWire(report))));
  assert.equal(render(received), html);
});

test('the demo history renders bounded, well-formed evidence in every range', () => {
  const data = demoData(now), real = { number: formatNumber, credits: formatCredits };
  for (const range of ['7d', '30d', 'all']) {
    const report = buildReport(data.records, { range }, now, data), html = renderTokenTopic('drivers', report, real);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/, range);
    assert.equal(cards(html).length, 5, range);
    assert.ok((html.match(/class="token-bar-row"/g) || []).length <= 15, range);
    const sessions = new Set(report.options.sessions.map(option => option.id)), projects = new Set(report.options.projects);
    const opened = buttons(html);
    assert.equal(opened.length, 5, range);
    for (const button of opened) assert.ok(sessions.has(button.session) && projects.has(button.project), range);
    assert.match(text(html), /\d+ of \d+ session groups with charges make up half of recorded credits, and \d+ make up 80%\./, range);
    if (range !== 'all') continue;
    // The cache-read share of the largest group, recomputed from its calls with a complete cache split.
    const top = report.sessions.filter(row => row.credits != null).sort((a, b) => b.credits - a.credits)[0];
    const split = data.records.filter(r => r.sessionId === top.id && r.project === top.project && r.ms <= now.getTime() && r.input !== null);
    const expected = split.reduce((sum, r) => sum + r.cacheRead, 0) / split.reduce((sum, r) => sum + r.inputTotal, 0) * 100;
    assert.equal(split.length, top.requests - top.missing.cacheRead);
    assert.ok(cards(html)[0].includes(`Cache-read share ${formatNumber(expected, { maximumFractionDigits: 1 })}%`), cards(html)[0]);
  }
});

test('a spend-driver row opens its session in Breakdown and leaves the model filter alone', async () => {
  const records = history(), report = { ...buildReport(records, {}, now), sources: [], coverage: {} };
  const { get, requests, document } = await mountPanel(report);
  const press = dataset => get('token-detail-panel').onclick({ target: { closest: selector => selector === '[data-token-session]' ? { dataset } : null } });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: 'drivers' } }) } });
  assert.equal(get('token-detail-panel').hidden, false);
  const [first] = buttons(get('token-topic-body').innerHTML);
  assert.deepEqual(first, { session: 'big', project: 'P & "Q" <one>', label: '<Big session>, P & "Q" <one>' });
  assert.doesNotMatch(get('token-topic-body').innerHTML, /<Big session>|<one>/);

  await press({ tokenSession: first.session, tokenProject: first.project });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(get('efficiency-view').hidden, true);
  assert.equal(get('group').value, 'models');
  assert.equal(document.activeElement, get('group'), 'focus lands on the Breakdown control');
  assert.equal(requests.at(-1).method, 'usage.report');
  assert.equal(requests.at(-1).input.project, 'P & "Q" <one>');
  assert.equal(requests.at(-1).input.session, 'big');
  assert.equal('models' in requests.at(-1).input, false, 'no model filter is added');
  assert.equal(get('session').value, 'big');
  assert.equal(requests.filter(r => r.method === 'usage.requests').length, 0, 'opening a session does not read prompts');

  // A model filter the user already chose stays in place.
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('model').value = 'Model A';
  await get('model').onchange();
  await press({ tokenSession: 's1', tokenProject: first.project });
  assert.equal(get('breakdown-view').hidden, false);
  assert.deepEqual(requests.at(-1).input.models, ['Model A']);
  assert.equal(requests.at(-1).input.session, 's1');

  // An incomplete row target does nothing; the context inspector entry point keeps working.
  const before = requests.length;
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await press({ tokenSession: 's2' });
  assert.equal(get('efficiency-view').hidden, false);
  assert.equal(requests.length, before);
  get('token-detail-panel').onclick({ target: { closest: () => ({ dataset: { tokenContext: 'true' } }) } });
  assert.equal(document.activeElement, get('efficiency-context-read'));
});

test('driver cards show user prompts and credits per 1M tokens, and project/model concentration bars open Breakdown', async () => {
  const sessions = [
    group('Rich', 40, 20, 2, { userPrompts: 4, uncertainPrompts: 0, creditsPerMillionTokens: 12.5, creditTokenRequests: 20 }),
    group('Uncertain', 20, 10, 2, { userPrompts: 2, uncertainPrompts: 1, creditsPerMillionTokens: 8, creditTokenRequests: 5 }),
    ...even(5),
  ];
  const [rich, uncertain] = cards(render({ sessions }));
  assert.match(rich, /User prompts 4 5 calls \/ prompt/);
  assert.match(rich, /Credits \/ 1M tokens 12\.5 20 of 20 model calls with complete charge &amp; tokens/);
  assert.match(uncertain, /User prompts 2 \* 1 uncertain/);
  assert.match(uncertain, /Credits \/ 1M tokens 8 \* 5 of 10 model calls with complete charge &amp; tokens/);

  const records = history(), report = { ...buildReport(records, {}, now), sources: [], coverage: {} };
  const { get, requests } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: 'drivers' } }) } });
  await get('token-detail-panel').onclick({ target: { closest: selector => selector === '[data-driver-project]' ? { dataset: { driverProject: 'P & "Q" <one>' } } : null } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(requests.at(-1).input.project, 'P & "Q" <one>');
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await get('token-detail-panel').onclick({ target: { closest: selector => selector === '[data-driver-model]' ? { dataset: { driverModel: 'Model A' } } : null } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.deepEqual(requests.at(-1).input.models, ['Model A']);
});
