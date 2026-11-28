import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenMix } from '../src/core/efficiency-overview.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { TOKEN_TOPICS, renderTokenTopic } from '../src/panel/token-topics.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const round = value => value == null ? 'Unavailable' : String(Math.round(value * 100) / 100);
const formats = { number: round, credits: round };
const render = (report = {}, extra = {}) => renderTokenTopic('overview', report, { ...formats, ...extra });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const others = TOKEN_TOPICS.filter(topic => topic.id !== 'overview');

const base = Date.UTC(2026, 5, 1, 12), DAY = 86_400_000;
const call = (ms, extra = {}) => ({ key: `k${ms}`, ms, sessionId: 's1', sessionName: 'First chat', project: 'one', model: 'Alpha', initiator: 'user',
  inputTotal: 1400, input: 200, cacheRead: 1000, cacheWrite: 200, output: 200, reasoning: 50, nanoAiu: 1e9, creditStatus: 'complete', ...extra });
// Two calls with a complete cache split and one without. Only the first two can join the mix.
const history = () => [
  call(base),
  call(base + 1000, { inputTotal: 2000, input: 800, output: 400, reasoning: null }),
  call(base + 2000, { sessionId: 's2', sessionName: 'Second chat', project: 'two', model: 'Beta', initiator: 'sub-agent', inputTotal: 800, input: null, cacheRead: null, cacheWrite: null, output: 200, reasoning: 20 }),
];
const built = (records = history(), query = { range: 'all' }) => buildReport(records, query, new Date(base + DAY));
// The smallest report in which input and output are both measured, so a sentence is chosen from evidence.
const paired = (efficiency = {}, rest = {}) => ({ efficiency: { summary: { requests: 4, pairedRequests: 4, pairedInput: 300, pairedOutput: 100 }, ...efficiency }, ...rest });
const mixOf = (uncachedInput, cacheRead, cacheWrite, output) => ({ requests: 4, mixRequests: 4, uncachedInput, cacheRead, cacheWrite, output, reasoningRequests: 0, reasoning: null, otherOutput: null });
const trendOf = (values, inputRequests = 10) => ({ unit: 'day', points: values.map((averageInput, index) => ({ day: `2026-06-0${index + 1}`, averageInput, inputRequests })) });

test('the token mix sums only calls with an output count and a complete cache split', () => {
  const mix = createTokenMix();
  mix.add({ inputTotal: 1000, cacheRead: 600, cacheWrite: 100, output: 200, reasoning: 50 });
  mix.add({ inputTotal: 500, cacheRead: 0, cacheWrite: 0, output: 100, reasoning: null });
  // Reasoning larger than output cannot be split from it, but the call still has a usable mix.
  mix.add({ inputTotal: 400, cacheRead: 100, cacheWrite: 50, output: 40, reasoning: 90 });
  mix.add({ inputTotal: 900, cacheRead: 100, cacheWrite: 100, output: null, reasoning: 5 });
  mix.add({ inputTotal: 900, cacheRead: null, cacheWrite: null, output: 70, reasoning: 5 });
  mix.add({ inputTotal: 300, cacheRead: 200, cacheWrite: 200, output: 10 });
  mix.add({ inputTotal: 300, cacheRead: 0, cacheWrite: 0, output: 10, cacheDetailsReported: false });
  mix.add({ inputTotal: -1, cacheRead: 0, cacheWrite: 0, output: 10 });
  mix.add({});
  assert.deepEqual(mix.finish(), { requests: 9, mixRequests: 3, uncachedInput: 1050, cacheRead: 700, cacheWrite: 150, output: 340, reasoningRequests: 1, reasoning: 50, otherOutput: 150 });
});

test('an unmeasured mix stays null while a measured zero stays zero', () => {
  const none = { requests: 0, mixRequests: 0, uncachedInput: null, cacheRead: null, cacheWrite: null, output: null, reasoningRequests: 0, reasoning: null, otherOutput: null };
  assert.deepEqual(createTokenMix().finish(), none);
  const unsplit = createTokenMix();
  unsplit.add({ inputTotal: 900, output: 70 });
  assert.deepEqual(unsplit.finish(), { ...none, requests: 1 });
  const zero = createTokenMix();
  zero.add({ inputTotal: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 });
  assert.deepEqual(zero.finish(), { requests: 1, mixRequests: 1, uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoningRequests: 1, reasoning: 0, otherOutput: 0 });
  const silent = createTokenMix();
  silent.add({ inputTotal: 100, cacheRead: 40, cacheWrite: 10, output: 30 });
  assert.deepEqual(silent.finish(), { requests: 1, mixRequests: 1, uncachedInput: 50, cacheRead: 40, cacheWrite: 10, output: 30, reasoningRequests: 0, reasoning: null, otherOutput: null });
});

test('the report carries the token mix for the selected calls at a fixed size', () => {
  const report = built();
  assert.deepEqual(report.efficiency.tokenMix, { requests: 3, mixRequests: 2, uncachedInput: 1000, cacheRead: 2000, cacheWrite: 400, output: 600, reasoningRequests: 1, reasoning: 50, otherOutput: 150 });
  // The mix describes the calls themselves, so the cache display setting does not change it.
  assert.deepEqual(built(history(), { range: 'all', includeCache: false }).efficiency.tokenMix, report.efficiency.tokenMix);
  assert.deepEqual(built(history(), { range: 'all', models: ['Beta'] }).efficiency.tokenMix,
    { requests: 1, mixRequests: 0, uncachedInput: null, cacheRead: null, cacheWrite: null, output: null, reasoningRequests: 0, reasoning: null, otherOutput: null });
  const many = built(Array.from({ length: 500 }, (_, i) => call(base + i, { sessionId: `s${i % 40}` })));
  assert.equal(many.efficiency.tokenMix.mixRequests, 500);
  assert.equal(many.efficiency.tokenMix.cacheRead, 500000);
  assert.ok(JSON.stringify(many.efficiency.tokenMix).length < 300);
});

test('the overview shows what the tokens were made of, who used them and each other section', () => {
  const html = render(built()), shown = text(html);
  assert.match(shown, /Uncached input 1000 \* · 25% \*/);
  assert.match(shown, /Cache read 2000 \* · 50% \*/);
  assert.match(shown, /Cache write 400 \* · 10% \*/);
  assert.match(shown, /Output 600 \* · 15% \*/);
  assert.match(html, /role="img" aria-label="Uncached input: 25%; Cache read: 50%; Cache write: 10%; Output: 15%"/);
  assert.match(shown, /Covers 2 of 3 model calls: the calls that record an output count and a complete cache split/);
  assert.match(shown, /1 of these calls report it, and there it was 25% of output/);
  assert.match(shown, /Largest model 80% Alpha · 4000 of 5000 measured tokens · largest of 2 models/);
  assert.match(shown, /Largest project 80% one · 4000 of 5000 measured tokens · largest of 2 projects/);
  assert.match(shown, /Largest conversation 80% First chat · 4000 of 5000 measured tokens · largest of 2 conversations/);
  assert.equal((html.match(/width:80\.0%/g) || []).length, 3);
  assert.match(shown, /including cached input/);
  assert.match(shown, /A trend needs at least four days with measurements/);
  assert.match(shown, /Cache reads were the largest part of measured tokens, at 50% \*\./);
  assert.match(shown, /Compare afterward: the same mix and tokens per call on similar tasks/);
  assert.match(shown, /Tool and MCP footprint Unavailable of measured input described the available tools · 0 of 3 model calls/);
  assert.match(shown, /Cache reuse 58\.82% \* of measured input was read from cache · 2 of 3 model calls/);
  assert.match(shown, /Work behind each prompt Unavailable model calls followed one submitted prompt on average · 0 of 0 prompts eligible/);
  assert.match(shown, /Delegated work 33\.33% of model calls were labelled as subagent work · 1 of 3 model calls/);
  assert.match(shown, /Reasoning and generated output 17\.5% \* of matched output was reported reasoning · 2 of 3 model calls/);
  assert.match(shown, /Biggest spend drivers 66\.67% of recorded AI credits were in the largest conversation · 2 conversations with charges/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  // Hiding the coverage notice removes the markers and keeps the sample counts.
  const plain = text(render(built(), { showCoverage: false }));
  assert.doesNotMatch(plain, /\d%? \*/);
  assert.match(plain, /Covers 2 of 3 model calls/);
  assert.match(text(render(built(history(), { range: 'all', includeCache: false }))), /excluding cached input/);
});

test('the index lists the other nine sections once each, in catalog order, under their catalog labels', () => {
  for (const report of [{}, built()]) {
    const html = render(report);
    assert.deepEqual([...html.matchAll(/<button data-token-jump="([^"]+)">([^<]*)<\/button>/g)].map(([, id, label]) => [id, label.replaceAll('&amp;', '&')]), others.map(topic => [topic.id, topic.label]));
    assert.equal((html.match(/<li>/g) || []).length, 9);
    assert.doesNotMatch(html, /Inspect context overhead|See work per prompt|Explore output/);
  }
});

test('an empty history shows unavailable measurements, not zeros', () => {
  for (const [report, needsInspect] of [[{}, 3], [built([]), 1]]) {
    const html = render(report), shown = text(html);
    assert.match(shown, /the mix is unavailable\. Missing counts are not zero/);
    assert.match(shown, /Measured token totals are unavailable/);
    assert.match(shown, /A trend needs at least four days/);
    assert.match(shown, /Start with measurement coverage/);
    assert.match(shown, /Compare afterward:/);
    assert.equal((shown.match(/Needs Inspect context/g) || []).length, needsInspect);
    // Tools, cache, prompts, delegation, output and spend have no number to show.
    assert.equal((html.match(/<strong class="token-index-value">Unavailable<\/strong>/g) || []).length, 6);
    assert.match(shown, /No conversation charges are recorded in these filters/);
    assert.doesNotMatch(html, /role="img"|token-bar-row|token-trend|NaN|undefined|Infinity|\d%/);
  }
});

test('partial measurements keep their coverage and leave out what was not measured', () => {
  // No call has a cache split: there is no mix, but the token shares are still measured.
  const unsplit = text(render(built(history().map(record => ({ ...record, input: null, cacheRead: null, cacheWrite: null })))));
  assert.match(unsplit, /the mix is unavailable/);
  assert.doesNotMatch(unsplit, /Uncached input \d|Cache read \d/);
  assert.match(unsplit, /Largest model 80% Alpha/);
  // 4200 input and 800 output across the three calls.
  assert.match(unsplit, /84% of matched token volume was input/);
  assert.match(unsplit, /Cache reuse Unavailable of measured input was read from cache · 0 of 3 model calls/);

  // A model whose calls record no token counts is unavailable. It is not a 0% bar.
  const models = [{ name: 'Counted', total: 600, requests: 2, knownTokenRequests: 2, missingTokens: 1 }, { name: 'Uncounted', total: 0, requests: 3, knownTokenRequests: 0, missingTokens: 3 }];
  const partial = render({ totals: { total: 600, requests: 5, knownTokenRequests: 2, missingTokens: 4 }, models });
  assert.match(text(partial), /Largest model 100% \* Counted · 600 \* of 600 \* measured tokens · largest of 2 models/);
  assert.equal((partial.match(/token-bar-row/g) || []).length, 1);
  assert.doesNotMatch(partial, /Uncounted/);
  assert.match(text(render({ totals: { total: 0, requests: 5, knownTokenRequests: 0, missingTokens: 5 }, models })), /Measured token totals are unavailable/);
  // A row larger than the stated total is not turned into a share.
  assert.match(text(render({ totals: { total: 100, requests: 1, knownTokenRequests: 1 }, models })), /Measured token totals are unavailable/);

  // Reasoning is split only when a call in the mix reports it.
  assert.match(text(render(paired({ tokenMix: mixOf(10, 60, 10, 20) }))), /None of these calls report a reasoning count, so output is not split further/);
  assert.match(text(render(paired({ tokenMix: { ...mixOf(10, 60, 10, 20), reasoningRequests: 4, reasoning: 5, otherOutput: 15 } }))), /All of these calls report it, and there it was 25% of output/);
  const zeroOutput = text(render(paired({ tokenMix: { ...mixOf(10, 60, 10, 0), reasoningRequests: 4, reasoning: 0, otherOutput: 0 } })));
  assert.match(zeroOutput, /Output 0 · 0%/);
  assert.doesNotMatch(zeroOutput, /NaN|there it was/);

  // Charges: unavailable is not zero, and a recorded zero is not a share.
  const sessions = credits => credits.map((value, index) => ({ name: `c${index}`, credits: value }));
  assert.match(text(render({ sessions: sessions([null, null]) })), /Biggest spend drivers Unavailable No conversation charges are recorded/);
  assert.match(text(render({ sessions: sessions([0, 0]) })), /Biggest spend drivers Unavailable The recorded charges in these filters are zero/);
  assert.match(text(render({ sessions: sessions([3, null, 1]), totals: { missingCredits: 1 } })), /Biggest spend drivers 75% \* of recorded AI credits were in the largest conversation · 2 conversations with charges/);
  assert.match(text(render({ promptCredits: { prompts: 4, eligiblePrompts: 3, modelFiltered: true, work: { averageRequests: 2.5 } } })), /Work behind each prompt 2\.5 \* model calls followed one submitted prompt on average · 3 of 4 prompts eligible · selected models only/);
  assert.match(text(render({ tools: { calls: 7 }, skills: { invocations: 0 } })), /Files, searches, and tool results 7 tool calls Recorded in the selected history\..*Skills and instruction footprint 0 uses Recorded in the selected history\./);
  assert.match(text(render({ tools: { calls: 1 }, skills: { invocations: 3, failures: 2 } })), /Files, searches, and tool results 1 tool call.*Skills and instruction footprint 3 uses · 2 failed/);
});

test('names from the history are escaped wherever the overview shows them', () => {
  const hostile = '<img src=x>';
  const records = history().map(record => ({ ...record, model: hostile, project: hostile, sessionName: hostile }));
  const html = render(built(records));
  assert.equal((html.match(/&lt;img src=x&gt;/g) || []).length, 3);
  assert.doesNotMatch(html, /<img|undefined|NaN|Infinity/);
  // Six conversations bring the five-largest row, which names the largest one.
  const six = render(built(Array.from({ length: 6 }, (_, i) => call(base + i, { sessionId: `s${i}`, sessionName: i ? `Chat ${i}` : hostile, output: 1200 - i * 100 }))));
  assert.match(text(six), /Five largest conversations/);
  assert.match(six, /Largest: &lt;img src=x&gt;, /);
  assert.doesNotMatch(six, /<img/);
  assert.match(text(render({ totals: { total: 10, requests: 1, knownTokenRequests: 1 }, sessions: [{ total: 10, requests: 1, knownTokenRequests: 1 }] })), /Largest conversation 100% Unnamed conversation/);
});

test('conversation shares use the five largest groups however many there are', () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ name: `Chat ${index}`, project: 'p', id: `s${index}`, requests: 1, knownTokenRequests: 1, missingTokens: 0, total: (index * 37) % 1000 + 1 }));
  const total = rows.reduce((sum, row) => sum + row.total, 0), report = { totals: { total, requests: 1000, knownTokenRequests: 1000, missingTokens: 0 }, sessions: rows };
  const before = JSON.stringify(report), html = render(report), shown = text(html);
  // 1000 + 999 + 998 + 997 + 996 of 500500.
  assert.match(shown, /Five largest conversations 1% 4990 of 500500 measured tokens · 5 of 1000 conversations\. Largest: Chat 27, 0\.2%\./);
  assert.equal((html.match(/token-bar-row/g) || []).length, 1);
  assert.ok(html.length < 8000);
  assert.equal(JSON.stringify(report), before, 'rendering does not reorder or change the report');
});

test('the sentence follows the evidence: change over time, then concentration, then the largest part', () => {
  const said = report => text(render(report)).match(/Is usage per call changing\?.*?(?=Explore the other sections)/)[0];
  const rising = said(paired({ tokenMix: mixOf(10, 60, 10, 20), trend: trendOf([10, 10, 20, 20]) }));
  assert.match(rising, /Input per call by day 10 in the earlier days, 20 in the later days/);
  assert.match(rising, /Input per call rose from 10 in the earlier days to 20 in the later days\./);
  assert.match(rising, /Each day counts equally in these averages/);
  assert.doesNotMatch(rising, /largest part/);
  assert.match(said(paired({ trend: { ...trendOf([30, 30, null, 10, 10]), unit: 'week' } })), /Input per call fell from 30 in the earlier weeks to 10 in the later weeks\./);
  // A smaller change, too few periods, or halves resting on fewer than 20 calls is not called a change.
  assert.match(said(paired({ tokenMix: mixOf(10, 60, 10, 20), trend: trendOf([10, 10, 14, 14]) })), /Cache reads were the largest part of measured tokens, at 60%\./);
  assert.match(said(paired({ tokenMix: mixOf(10, 60, 10, 20), trend: trendOf([10, 10, 40]) })), /Cache reads were the largest part/);
  const thin = said(paired({ tokenMix: mixOf(10, 60, 10, 20), trend: trendOf([10, 10, 20, 20], 9) }));
  assert.match(thin, /Input per call by day 10 in the earlier days, 20 in the later days/);
  assert.match(thin, /Cache reads were the largest part/);
  assert.doesNotMatch(thin, /rose/);

  const group = (count, each) => Array.from({ length: count }, (_, index) => ({ name: `Chat ${each}-${index}`, total: each, requests: 1, knownTokenRequests: 1 }));
  const held = (sessions, total) => paired({ tokenMix: mixOf(10, 60, 10, 20) }, { totals: { total, requests: sessions.length, knownTokenRequests: sessions.length }, sessions });
  assert.match(said(held([...group(5, 140), ...group(6, 50)], 1000)), /Five conversations hold 70% of measured tokens\./);
  // Five of ten is half the conversations, and 40% is not most of the tokens.
  assert.match(said(held([...group(5, 140), ...group(5, 60)], 1000)), /Cache reads were the largest part/);
  assert.match(said(held(group(11, 80), 1000)), /Cache reads were the largest part/);

  assert.match(said(paired({ tokenMix: mixOf(70, 10, 10, 10) })), /Uncached input was the largest part of measured tokens, at 70%\..*processed fresh/);
  assert.match(said(paired({ tokenMix: mixOf(10, 10, 70, 10) })), /Cache writes were the largest part of measured tokens, at 70%\..*read back/);
  assert.match(said(paired({ tokenMix: mixOf(10, 10, 10, 70) })), /Output was the largest part of measured tokens, at 70%\..*Long output can be exactly what the task needed/);
  assert.match(said(paired({ tokenMix: { ...mixOf(10, 10, 10, 70), requests: 8 } })), /at 70% \*\./);
  // Without a mix the sentence falls back to the input and output balance.
  assert.match(said(paired()), /75% of matched token volume was input\./);
  assert.match(said({ efficiency: { tokenMix: mixOf(10, 60, 10, 20), trend: trendOf([10, 10, 20, 20]) } }), /Start with measurement coverage\./);
});

test('credits per call are drawn only when charges are recorded', () => {
  const trend = { unit: 'day', points: [1, 2, 3, 4].map((value, index) => ({ day: `2026-06-0${index + 1}`, averageInput: value * 100, averageCredits: value })) };
  // No call in the summary records a complete charge.
  const uncharged = text(render(paired({ trend })));
  assert.match(uncharged, /Input per call by day 150 in the earlier days, 350 in the later days/);
  assert.doesNotMatch(uncharged, /Credits per call/);
  const summary = { requests: 4, pairedRequests: 4, pairedInput: 300, pairedOutput: 100, creditRequests: 4 };
  assert.match(text(render({ efficiency: { summary, trend } })), /Credits per call by day 1\.5 in the earlier days, 3\.5 in the later days/);
  // Charges exist, but no period has a per-call average to draw.
  const flat = { unit: 'day', points: trend.points.map(point => ({ ...point, averageCredits: null })) };
  assert.doesNotMatch(text(render({ efficiency: { summary, trend: flat } })), /Credits per call/);
});

test('credit share appears beside token share and names a different credit leader when one leads', () => {
  // Alpha holds more tokens (75%) while Beta holds more credits (80%).
  const records = [
    call(base, { model: 'Alpha', project: 'one', sessionId: 's1', sessionName: 'Chat 1', inputTotal: 2500, output: 500, nanoAiu: 1e9 }),
    call(base + 1000, { model: '<Beta>', project: 'two', sessionId: 's2', sessionName: 'Chat 2', inputTotal: 800, output: 200, nanoAiu: 4e9 }),
  ];
  const html = render(built(records)), shown = text(html);
  assert.match(shown, /Largest model 75% Alpha · 3000 of 4000 measured tokens · largest of 2 models · 20% of recorded credits · Largest by credits: &lt;Beta&gt;, 80%/);
  assert.match(shown, /Largest project 75% one · 3000 of 4000 measured tokens · largest of 2 projects · 20% of recorded credits · Largest by credits: two, 80%/);
  assert.doesNotMatch(html, /<Beta>/);
  assert.match(html, /&lt;Beta&gt;/);
  // Partial credit coverage marks the credit share, and zero/missing credits stay out.
  const partial = text(render({
    totals: { total: 1000, requests: 2, knownTokenRequests: 2, missingCredits: 1 },
    models: [
      { name: 'Alpha', total: 700, requests: 1, knownTokenRequests: 1, credits: 2 },
      { name: 'Beta', total: 300, requests: 1, knownTokenRequests: 1, credits: 8 },
    ],
  }));
  assert.match(partial, /20% \* of recorded credits · Largest by credits: Beta, 80% \*/);
  const uncharged = text(render({
    totals: { total: 1000, requests: 2, knownTokenRequests: 2 },
    models: [{ name: 'Alpha', total: 1000, requests: 2, knownTokenRequests: 2, credits: null }],
  }));
  assert.doesNotMatch(uncharged, /of recorded credits|Largest by credits/);
  // Five largest conversations also display their combined credit share when charges exist.
  const six = Array.from({ length: 6 }, (_, i) => call(base + i, { sessionId: `s${i}`, sessionName: `Chat ${i}`, inputTotal: 1000 - i * 100, output: 100, nanoAiu: 1e9 }));
  assert.match(text(render(built(six))), /Five largest conversations .* of recorded credits\./);
});

test('the snapshot sections show historical counts before a snapshot and switch to tokens once supplied', () => {
  const before = text(render(built()));
  assert.match(before, /Always-loaded context Needs Inspect context Instructions and tool definitions in the current conversation\. History does not record them\./);
  assert.match(before, /Files, searches, and tool results 0 tool calls Recorded in the selected history\./);
  assert.match(before, /Skills and instruction footprint 0 uses Recorded in the selected history\./);
  const context = { available: true, totalTokens: 1000, categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 750 } };
  const after = text(render(built(), { context }));
  assert.match(after, /Always-loaded context 250 tokens Instructions and tool definitions in the current conversation snapshot\./);
  assert.match(after, /Files, searches, and tool results 750 tokens/);
  assert.match(after, /Skills and instruction footprint 50 tokens/);
  assert.doesNotMatch(after, /Needs Inspect context/);
  // A category the snapshot does not report, or one larger than the snapshot, stays unavailable.
  const sparse = text(render({}, { context: { available: true, totalTokens: 100, categories: { systemPrompt: 80, customInstructions: 80, systemTools: 0, mcpTools: 0 } } }));
  assert.match(sparse, /Always-loaded context Unavailable/);
  assert.match(sparse, /Files, searches, and tool results Unavailable/);
  assert.match(sparse, /Skills and instruction footprint 80 tokens/);
  assert.match(text(render({}, { context: { available: false, reason: 'empty' } })), /Always-loaded context Needs Inspect context/);
});

test('every index button opens its section in the panel and keeps keyboard focus across a refresh', async () => {
  const report = { ...built(), sources: [], coverage: {} };
  const { get, requests, server, document } = await mountPanel(report);
  const overview = () => get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: 'overview' } }) } });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const index = get('token-overview-insight');
  assert.match(index.innerHTML, /What the tokens were made of/);
  assert.match(index.innerHTML, /role="img" aria-label="Uncached input: 25%; Cache read: 50%; Cache write: 10%; Output: 15%"/);
  assert.match(get('efficiency-flow').innerHTML, /of measured tokens were input/);
  assert.equal((get('efficiency-summary').innerHTML.match(/<span class="sub">\d of 3 requests<\/span>/g) || []).length, 4);
  assert.deepEqual(index.querySelectorAll('[data-token-jump]').map(button => button.dataset.tokenJump), others.map(topic => topic.id));
  for (const topic of others) {
    overview();
    assert.equal(get('token-overview-panel').hidden, false);
    get('token-overview-panel').onclick({ target: { closest: () => ({ dataset: { tokenJump: topic.id } }) } });
    assert.equal(get('token-selected-title').textContent, topic.label);
    assert.equal(get('token-overview-panel').hidden, true);
    assert.equal(document.activeElement, get('efficiency-topic'));
  }
  // A click elsewhere on the card is not a jump.
  overview();
  get('token-overview-panel').onclick({ target: { closest: () => null } });
  assert.equal(get('token-selected-title').textContent, 'Overview');
  // A refresh redraws the index, so focus has to move to the new button for the same section.
  for (const id of ['cache', 'drivers']) {
    const stale = index.querySelector(`[data-token-jump="${id}"]`);
    stale.focus();
    await get('refresh').onclick();
    assert.notEqual(document.activeElement, stale);
    assert.equal(document.activeElement, index.querySelector(`[data-token-jump="${id}"]`));
  }
  // The overview never inspects context by itself, and reuses a snapshot once one was asked for.
  assert.equal((index.innerHTML.match(/Needs Inspect context/g) || []).length, 1);
  assert.equal(requests.filter(request => request.method === 'efficiency.context').length, 0);
  server.contextSnapshot = { available: true, checkedAt: '2026-11-14T12:00:00Z', totalTokens: 1000, limit: 10000,
    categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 750 }, entries: [], omitted: 0 };
  await get('efficiency-context-read').onclick();
  overview();
  assert.doesNotMatch(index.innerHTML, /Needs Inspect context/);
  assert.match(index.innerHTML, />250 tokens<\/strong>/);
  assert.equal(requests.filter(request => request.method === 'efficiency.context').length, 1);
});

test('the overview shows historical starting context for Always-loaded context before a live snapshot', () => {
  const withStart = text(render({
    efficiency: {
      summary: { requests: 10, toolRequests: 8, averageToolTokens: 1200 },
      growthSummary: { positions: [{ prompt: 1, conversations: 5, input: 14000 }] },
    },
  }));
  assert.match(withStart, /Always-loaded context 14000 tokens at start Typical Prompt 1 input across 5 conversations/);
  assert.doesNotMatch(withStart, /Always-loaded context Needs Inspect context/);
  const toolOnly = text(render({ efficiency: { summary: { requests: 10, toolRequests: 8, averageToolTokens: 1200 } } }));
  assert.match(toolOnly, /Always-loaded context 1200 tool-def tokens Average tool definitions per call/);
});
