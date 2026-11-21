import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputMix, OUTPUT_SIZE_LIMITS } from '../src/core/efficiency-output.mjs';
import { createEfficiencyTopics } from '../src/core/efficiency-topics.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { formatNumber, formatCredits } from '../src/core/format.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

// Rounds like the dashboard does, without depending on the machine's locale.
const number = (value, options = {}) => !Number.isFinite(value) ? 'Unavailable' : String(options.maximumFractionDigits == null ? value : Number(value.toFixed(options.maximumFractionDigits)));
const render = (report, extra = {}) => renderTokenTopic('output', report, { number, credits: number, ...extra });
const DAY = 86_400_000, base = Date.UTC(2026, 5, 1, 12);
let serial = 0;
const call = (extra = {}) => ({ key: `k${++serial}`, ms: base + serial * 1000, sessionId: 's', project: 'p', model: 'M', initiator: 'user', effort: 'medium',
  inputTotal: 1000, output: 100, reasoning: 20, cacheRead: 600, cacheWrite: 100, nanoAiu: 1e9, creditStatus: 'complete', ...extra });
const many = (count, extra) => Array.from({ length: count }, () => call(extra));
const reportOf = records => buildReport(records, { range: 'all' }, new Date(base + 40 * DAY));
const mixOf = outputs => { const mix = createOutputMix(); for (const output of outputs) mix.add({ output }); return mix.finish(); };
// One titled section of the view, without the sections that follow it.
const part = (html, title) => (html.split('<section class="token-insight-section">').find(text => text.startsWith(`<h3>${title}</h3>`)) || '').split('</section>')[0];
const clean = html => assert.doesNotMatch(html, /NaN|undefined|Infinity/);

test('output sizes land in four groups with exact call and token counts', () => {
  assert.deepEqual(OUTPUT_SIZE_LIMITS, [200, 1000, 4000]);
  const mix = mixOf([0, 200, 201, 1000, 1001, 4000, 4001, 10000, null, undefined, -5, NaN]);
  assert.equal(mix.requests, 12);
  assert.equal(mix.outputRequests, 8);
  assert.equal(mix.outputTokens, 20403);
  assert.deepEqual(mix.buckets.map(b => [b.min, b.max, b.calls, b.tokens, b.callShare]), [
    [0, 200, 2, 200, 25], [201, 1000, 2, 1201, 25], [1001, 4000, 2, 5001, 25], [4001, null, 2, 14001, 25]]);
  assert.equal(mix.buckets[0].tokenShare, 200 / 20403 * 100);
  assert.equal(mix.buckets.reduce((sum, b) => sum + b.tokens, 0), mix.outputTokens);
  assert.deepEqual(mix.concentration, { over: 4000, calls: 2, tokens: 14001, callShare: 25, tokenShare: 14001 / 20403 * 100 });
});

test('the largest groups are added until they hold half of the output', () => {
  // The top group alone holds 5,000 of 12,400 tokens; with the next one it is 11,000.
  assert.deepEqual(mixOf([5000, 3000, 3000, 500, 500, 100, 100, 100, 100]).concentration,
    { over: 1000, calls: 3, tokens: 11000, callShare: 3 / 9 * 100, tokenShare: 11000 / 12400 * 100 });
  assert.deepEqual(mixOf([150, 150, 300]).concentration, { over: 200, calls: 1, tokens: 300, callShare: 1 / 3 * 100, tokenShare: 50 });
  // When the smallest group is needed to reach half, no size separates the calls.
  assert.equal(mixOf([100, 100, 100, 250]).concentration, null);
  assert.equal(mixOf([100, 100]).concentration, null);
});

test('an unknown output count is never a zero and an empty history has no shares', () => {
  const none = createOutputMix().finish();
  assert.deepEqual([none.requests, none.outputRequests, none.outputTokens, none.concentration], [0, 0, 0, null]);
  assert.ok(none.buckets.every(b => b.calls === 0 && b.tokens === 0 && b.callShare === null && b.tokenShare === null));
  const unknown = mixOf([null, undefined, 'many']);
  assert.deepEqual([unknown.requests, unknown.outputRequests, unknown.outputTokens], [3, 0, 0]);
  assert.ok(unknown.buckets.every(b => b.callShare === null && b.tokenShare === null));
  // A recorded zero is a measurement: the calls are counted, but zero tokens have no shares.
  const zero = mixOf([0, 0]);
  assert.deepEqual(zero.buckets.map(b => b.callShare), [100, 0, 0, 0]);
  assert.ok(zero.buckets.every(b => b.tokenShare === null));
  assert.equal(zero.concentration, null);
});

test('the report carries the output mix for the selected range and stays small', () => {
  assert.ok('outputMix' in createEfficiencyTopics().finish());
  const records = [call({ output: 100 }), call({ output: 5000 }), call({ output: null }), call({ output: 300, ms: base - 400 * DAY })];
  const all = buildReport(records, { range: 'all' }, new Date(base + DAY)).efficiency;
  assert.deepEqual([all.outputMix.requests, all.outputMix.outputRequests, all.outputMix.outputTokens], [4, 3, 5400]);
  assert.equal(all.outputMix.outputRequests, all.summary.outputRequests);
  assert.equal(all.outputMix.outputTokens, all.summary.outputTokens);
  const recent = buildReport(records, { range: '30d' }, new Date(base + DAY)).efficiency.outputMix;
  assert.deepEqual([recent.requests, recent.outputRequests, recent.outputTokens], [3, 2, 5100]);
  assert.deepEqual(recent.buckets.map(b => b.calls), [1, 0, 0, 1]);
  const large = createOutputMix();
  for (let i = 0; i < 200_000; i++) large.add({ output: i % 9000 });
  assert.ok(JSON.stringify(large.finish()).length < 1000);
});

test('effort levels are compared inside one model, with unknown effort and thin levels left out', () => {
  const report = reportOf([
    ...many(30, { output: 1000, reasoning: 100, duration: 2000 }),
    ...many(30, { effort: 'high', output: 2000, reasoning: 800, duration: 6000 }),
    ...many(5, { effort: '', output: 500, reasoning: 50 }),
    ...many(29, { effort: 'low', output: 100, reasoning: 90 }),
    ...many(40, { model: 'Solo', effort: 'high', output: 300, reasoning: 30 }),
  ]);
  const before = JSON.stringify(report), html = render(report), efforts = part(html, 'Reasoning by effort level');
  assert.equal(JSON.stringify(report), before, 'rendering leaves the report as it was');
  assert.equal((efforts.match(/<tr>/g) || []).length, 3, 'a header and the two comparable levels of M');
  assert.ok(efforts.indexOf('>medium<') < efforts.indexOf('>high<'), 'lower level first');
  assert.match(efforts, />10% \(30 of 30 model calls\)</);
  assert.match(efforts, />40% \(30 of 30 model calls\)</);
  assert.match(efforts, />1000 \(30 of 30 model calls\)</);
  assert.match(efforts, />2 s \(30 of 30 model calls\)</);
  assert.match(efforts, />6 s \(30 of 30 model calls\)</);
  assert.doesNotMatch(efforts, /Solo|>low<|>unknown<|90%/);
  assert.match(efforts, /at least 30 of its calls report both reasoning and output/);
  assert.match(efforts, /unknown is not a level: 5 of 94 calls on the models shown/);
  assert.match(efforts, /not the effect of effort alone/);
  assert.match(html, /On M, 40% of matched output was reported reasoning at effort level high and 10% at effort level medium\./);
  assert.match(html, /Run one routine task you know well at each of these two levels/);
  assert.match(html, /Less reasoning is not automatically more efficient if it leads to rework\./);
  assert.match(html, /Reasoning is part of output\..*Other output can include tool-call arguments and is not an answer-length estimate\./);
  clean(html);

  // The sentence names the higher level first even when it reasoned less.
  const reversed = render(reportOf([...many(30, { output: 1000, reasoning: 400 }), ...many(30, { effort: 'high', output: 1000, reasoning: 100 })]));
  assert.match(reversed, /On M, 10% of matched output was reported reasoning at effort level high and 40% at effort level medium\./);
  // A gap under ten points is not presented as a finding.
  const close = render(reportOf([...many(30, { output: 1000, reasoning: 200 }), ...many(30, { effort: 'high', output: 1000, reasoning: 290 })]));
  assert.doesNotMatch(close, /On M,/);
  assert.match(part(close, 'Reasoning by effort level'), />29% \(30 of 30 model calls\)</);
});

test('the effort comparison is bounded to five models and says how many it left out', () => {
  const records = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].flatMap((model, index) => [...many(30 + index, { model, output: 1000, reasoning: 100 }), ...many(30, { model, effort: 'xhigh', output: 1000, reasoning: 300 })]);
  const efforts = part(render(reportOf(records)), 'Reasoning by effort level');
  assert.equal((efforts.match(/<tr>/g) || []).length, 11);
  assert.match(efforts, /Showing 5 of 7 models with comparable levels\./);
  assert.doesNotMatch(efforts, /class="cell-text">[AB]</, 'the models with the fewest measured calls are the ones left out');
});

test('the observation follows the evidence: long calls first when no effort gap is recorded', () => {
  const long = render(reportOf([...many(9, { effort: '', output: 100, reasoning: 0 }), call({ effort: '', output: 5000, reasoning: 0 })]));
  const sentence = /Calls over 4000 output tokens were 10% of measured calls and produced 84\.7% of output\./;
  assert.match(part(long, 'How output is spread across calls'), sentence);
  assert.match(long.split('<aside class="token-insight">')[1], sentence);
  assert.match(long, /share of output from calls over 4000 tokens on similar work/);
  assert.match(long, /Less reasoning is not automatically more efficient/);
  assert.match(part(long, 'Reasoning by effort level'), /No model has two recorded effort levels with at least 30 calls each/);

  // Half the calls holding two thirds of the output is described, but is not the headline.
  const even = render(reportOf([...many(5, { output: 150, reasoning: 30 }), ...many(5, { output: 300, reasoning: 60 })]));
  assert.match(part(even, 'How output is spread across calls'), /Calls over 200 output tokens were 50% of measured calls and produced 66\.7% of output\./);
  assert.match(even.split('<aside class="token-insight">')[1], /<strong>20% of matched output was reported reasoning\.<\/strong>/);

  const flat = render(reportOf(many(4)));
  assert.doesNotMatch(part(flat, 'How output is spread across calls'), /Calls over/);
  assert.match(flat, /<strong>20% of matched output was reported reasoning\.<\/strong>/);
  assert.match(flat, /Compare afterward:/);
});

test('the spread shows each group share of output beside its share of calls', () => {
  const spread = part(render(reportOf([...many(3, { output: 100 }), call({ output: 700 }), call({ output: 3000 }), call({ output: 6000 })])), 'How output is spread across calls');
  assert.deepEqual([...spread.matchAll(/class="token-bar-label">([^<]+)</g)].map(match => match[1]), ['Up to 200 tokens', '201 to 1000 tokens', '1001 to 4000 tokens', 'Over 4000 tokens']);
  assert.deepEqual([...spread.matchAll(/class="token-bar-value">([^<]+)</g)].map(match => match[1]), ['3%', '7%', '30%', '60%']);
  assert.match(spread, /3 calls, 50% of measured calls · 300 output tokens/);
  assert.match(spread, /1 call, 16\.7% of measured calls · 6000 output tokens/);
  assert.match(spread, /width:60\.0%/);
  assert.match(spread, /Every model call in these filters has a known output count\./);
});

test('missing output, reasoning and duration stay unavailable instead of becoming zero', () => {
  const partial = reportOf([...many(10), ...many(3, { output: null })]);
  const shown = render(partial), hidden = render(partial, { showCoverage: false });
  assert.match(part(shown, 'How output is spread across calls'), /3 of 13 model calls have no known output count and are in no group\./);
  assert.match(part(shown, 'How output is spread across calls'), /class="token-bar-value">100% \*</);
  assert.match(part(hidden, 'How output is spread across calls'), /class="token-bar-value">100%</);
  assert.doesNotMatch(hidden, /\d%? \*/);
  assert.match(part(shown, 'Speed and call duration by model'), /No call durations were recorded for these filters, so speed is unavailable\./);
  assert.doesNotMatch(shown, />0 m?s\b/);

  const untimed = part(render(reportOf([...many(30, { output: 1000, reasoning: 100 }), ...many(30, { effort: 'high', output: 1000, reasoning: 500 })])), 'Reasoning by effort level');
  assert.equal((untimed.match(/>Unavailable \(0 of 30 model calls\)</g) || []).length, 2);

  const unreasoned = render(reportOf([...many(30, { reasoning: null }), ...many(30, { effort: 'high', reasoning: null })]));
  assert.match(part(unreasoned, 'Reasoning by effort level'), /No model has two recorded effort levels/);
  assert.match(unreasoned, /Reasoning share<\/span><strong class="value">Unavailable</);
  assert.match(unreasoned, /Reasoning share needs matched output measurements\./);
  assert.match(part(unreasoned, 'Output by model'), />Unavailable<.*>0 of 60 model calls</);
  assert.doesNotMatch(part(unreasoned, 'Output by model'), /0%/);

  const silent = render(reportOf(many(3, { output: null, reasoning: null })));
  assert.equal(part(silent, 'How output is spread across calls'), '');
  assert.equal(part(silent, 'Speed and call duration by model'), '');
  assert.match(silent, /No output measurements were recorded for these filters\./);

  const zero = render(reportOf(many(3, { output: 0, reasoning: 0 })));
  assert.match(part(zero, 'How output is spread across calls'), /Every call with a known output count reported zero output tokens/);
  for (const html of [shown, hidden, unreasoned, silent, zero, render({}), render({ efficiency: {} })]) clean(html);
});

test('speed is output over the whole call duration, with its own coverage', () => {
  const speed = part(render(reportOf([call({ duration: 2000, output: 100 }), call({ duration: 4000, output: 500 }), call({ duration: 0, output: 50 })])), 'Speed and call duration by model');
  assert.match(speed, /Output tokens per second of call time<\/span><strong class="value">100 \*<\/strong><span class="sub">2 of 3 model calls</);
  assert.match(speed, /Average call duration<\/span><strong class="value">2 s<\/strong><span class="sub">3 of 3 model calls</);
  assert.match(speed, /<td class="text-cell"><span class="cell-text">M<\/span><\/td><td><span class="cell-text">100 \*<\/span><\/td><td><span class="cell-text">2 of 3 model calls<\/span><\/td><td><span class="cell-text">2 s<\/span><\/td>/);
  assert.match(speed, /whole recorded duration of the call, which includes the wait before the first token/);
  const brief = part(render(reportOf([call({ duration: 400, output: 10 })])), 'Speed and call duration by model');
  assert.match(brief, />400 ms</);
  assert.match(brief, />25</);
});

test('trend lines need four measured days', () => {
  const days = count => Array.from({ length: count }, (_, day) => call({ ms: base + day * DAY, output: 100 * (day + 1), reasoning: 10 * (day + 1) }));
  const trend = part(render(reportOf(days(5))), 'Output and reasoning over time');
  assert.match(trend, /Output per call by day/);
  assert.match(trend, /150 in the earlier days, 450 in the later days/);
  assert.match(trend, /Reasoning share of output by day/);
  assert.match(part(render(reportOf(days(3))), 'Output and reasoning over time'), /A trend line needs at least four days or weeks/);
});

test('model names are escaped in every part of the view', () => {
  const html = render(reportOf([...many(30, { model: '<img src=x>', output: 1000, reasoning: 100, duration: 1000 }), ...many(30, { model: '<img src=x>', effort: 'high', output: 1000, reasoning: 600, duration: 1000 })]));
  assert.doesNotMatch(html, /<img/);
  for (const title of ['Output by model', 'Reasoning by effort level', 'Speed and call duration by model']) assert.match(part(html, title), /&lt;img src=x&gt;/, title);
  assert.match(html.split('<aside class="token-insight">')[1], /On &lt;img src=x&gt;, 60% of matched output was reported reasoning at effort level high/);
  clean(html);
});

test('the demo history fills every part of the view', async () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now), report = buildReport(data.records, { range: '30d' }, now, data), e = report.efficiency;
  assert.ok(e.outputMix.buckets.every(b => b.calls > 0));
  assert.ok(e.outputMix.concentration);
  const levels = e.efforts.filter(row => row.name === 'Claude Sonnet 4.5');
  assert.ok(levels.find(row => row.effort === 'high').reasoningShare > levels.find(row => row.effort === 'medium').reasoningShare);
  const html = renderTokenTopic('output', report, { number: formatNumber, credits: formatCredits });
  for (const title of ['Output and reasoning over time', 'How output is spread across calls', 'Output by model', 'Reasoning by effort level', 'Speed and call duration by model']) assert.ok(part(html, title), title);
  assert.ok((part(html, 'Reasoning by effort level').match(/<tr>/g) || []).length > 2);
  assert.match(html, /Compare afterward:/);
  assert.doesNotMatch(html, /data-token-context/);
  clean(html);

  // The same view through the built panel, where every module shares one scope.
  const { get } = await mountPanel({ ...report, sources: data.sources, coverage: data.coverage });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: 'output' } }) } });
  const shown = get('token-topic-body').innerHTML;
  for (const title of ['Output and reasoning over time', 'How output is spread across calls', 'Reasoning by effort level', 'Speed and call duration by model']) assert.ok(part(shown, title), title);
  assert.match(part(shown, 'How output is spread across calls'), /Calls over \S+ output tokens were \S+% of measured calls and produced \S+% of output\./);
  clean(shown);
});
