import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelMix, MODEL_MIX_LIMIT } from '../src/core/efficiency-models.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderModelMix } from '../src/panel/model-mix.mjs';
import { formatNumber } from '../src/core/format.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const base = new Date(2026, 5, 1, 12).getTime(), DAY = 86_400_000;
const number = (value, options = {}) => formatNumber(value, { simplify: false, ...options });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
let serial = 0;
// `count` calls of one model. credits are per call, null leaves the charge unrecorded.
function calls(model, count, { initiator = 'user', credits = 1, input = 1000, output = 100, cacheRead = 500, reasoning = 10, duration = 2000, status = 'complete' } = {}) {
  return Array.from({ length: count }, () => ({ key: `r-${serial++}`, ms: base + serial * 1000, sessionId: 's1', project: 'p', model, modelId: model, initiator,
    inputTotal: input, output, cacheRead, cacheWrite: 0, reasoning, duration, nanoAiu: credits === null ? null : credits * 1e9, creditStatus: credits === null ? 'unavailable' : status }));
}
const build = records => buildReport(records, { range: 'all' }, new Date(base + 2 * DAY), {});
const render = report => renderModelMix(report, { number });

test('who started each model call is counted exactly, with unknown kept apart', () => {
  const topic = createModelMix();
  for (const r of [...calls('A', 3, { initiator: 'user' }), ...calls('A', 2, { initiator: 'agent' }), ...calls('A', 4, { initiator: 'sub-agent' }), ...calls('A', 1, { initiator: '' }), ...calls('B', 2, { initiator: 'sub-agent' })]) topic.add(r);
  const result = topic.finish();
  assert.equal(result.requests, 12);
  assert.deepEqual(result.rows, [{ name: 'A', calls: 10, main: 5, subagent: 4, unrecorded: 1 }, { name: 'B', calls: 2, main: 0, subagent: 2, unrecorded: 0 }]);
});

test('the mix stays small however many models are recorded and records can arrive interleaved', () => {
  const topic = createModelMix();
  for (let i = 0; i < 40; i++) for (let k = 0; k <= i; k++) topic.add({ model: `m${i}`, initiator: 'user' });
  const result = topic.finish();
  assert.equal(result.rows.length, MODEL_MIX_LIMIT);
  assert.equal(result.models, 40);
  assert.equal(result.rows[0].name, 'm39');
  assert.ok(JSON.stringify(result).length < 2000);
});

test('the report carries the mix and the view shows shares, multiples, columns and who started calls', () => {
  const report = build([...calls('Small', 30, { credits: 1, input: 1000, output: 100, duration: 1000 }), ...calls('Big', 30, { credits: 4, input: 3000, output: 300, duration: 3000, initiator: 'sub-agent' }),
    ...calls('Big', 10, { credits: 4, input: 3000, output: 300, duration: 3000 })]);
  assert.deepEqual(report.efficiency.modelMix.rows.map(r => [r.name, r.main, r.subagent]), [['Big', 10, 30], ['Small', 30, 0]]);
  const shown = text(render(report));
  assert.match(shown, /not a like-for-like benchmark/);
  // 70 charged calls: Small 30 (42.9%) and 30 credits of 190 (15.8%); Big 40 (57.1%) and 160 credits (84.2%).
  assert.match(shown, /Big 57\.1% 84\.2% \(160\) \+27\.1 points/);
  assert.match(shown, /Small 42\.9% 15\.8% \(30\) -27\.1 points/);
  assert.match(shown, /70 of 70 model calls have a complete recorded charge/);
  // Small is the lowest-credit model, so it is the baseline; Big is 4x on credits, 3x on input and output.
  assert.match(shown, /Small 1 · baseline · 30 calls 1,000 · 30 calls 100 · 30 calls/);
  assert.match(shown, /Big 4 · 4x · 40 calls 3,000 · 3x · 40 calls 300 · 3x · 40 calls/);
  assert.match(shown, /Big 16\.7% · 40 calls 3\.3% · 40 calls 3 s · 40 calls 100 tokens\/s · 40 calls/);
  assert.match(shown, /Big 25% \(10\) 75% \(30\) 0% \(0\)/);
  assert.match(shown, /Big made 57\.1% of charged calls and 84\.2% of recorded credits\./);
  assert.match(shown, /Compare afterward/);
});

test('a model with too few calls gets no multiple and an unrecorded charge is not zero', () => {
  const report = build([...calls('Big', 25, { credits: 4 }), ...calls('Small', 25, { credits: 1 }), ...calls('Tiny', 5, { credits: 2 }), ...calls('Free', 10, { credits: null, duration: null, reasoning: null })]);
  const shown = text(render(report));
  assert.match(shown, /Tiny Too few calls \(5\)/);
  assert.match(shown, /Free Too few calls \(10\) Unavailable Unavailable Unavailable/);
  assert.doesNotMatch(shown, /Free 0%/);
  assert.match(shown, /55 of 65 model calls have a complete recorded charge/);
  assert.doesNotMatch(shown, /NaN|undefined|Infinity/);
});

test('one model with enough calls cannot be compared, and no charges reads as unavailable', () => {
  const one = text(render(build(calls('Only', 30))));
  assert.match(one, /needs at least two models with 20 or more complete-charge calls each\. Only Only has enough/);
  const none = text(render(build(calls('Free', 30, { credits: null }))));
  assert.match(none, /No model has a complete recorded charge, so credit shares are unavailable\. That is not zero credits/);
  assert.doesNotMatch(none, /NaN|undefined|Infinity/);
  assert.equal(render({}), '');
  assert.equal(render({ efficiency: { models: [] } }), '');
});

test('when shares match no model is named', () => {
  const shown = text(render(build([...calls('A', 30), ...calls('B', 30)])));
  assert.match(shown, /within 10 points of its share of calls/);
});

test('model names are escaped', () => {
  const html = render(build([...calls('<img src=x>', 30, { credits: 1 }), ...calls('<b>y</b>', 30, { credits: 3, initiator: 'sub-agent' })]));
  assert.doesNotMatch(html, /<img|<b>/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('the Efficiency panel mounts the comparison above the model table', async () => {
  const report = { ...build([...calls('Big', 30, { credits: 4 }), ...calls('Small', 30, { credits: 1 })]), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const html = get('efficiency-model-mix').innerHTML;
  assert.match(text(html), /Share of calls and share of credits/);
  assert.match(get('efficiency-models').innerHTML, /Big/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the demo history yields a mix with subagent use and a credit share gap', () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now);
  const report = buildReport(data.records, { range: '30d' }, now, data);
  const mix = report.efficiency.modelMix;
  assert.equal(mix.requests, report.efficiency.summary.requests);
  assert.ok(mix.rows.some(r => r.subagent > 0) && mix.rows.some(r => r.main > 0));
  const shown = text(render(report));
  assert.match(shown, /Per call, against the lowest-credit model/);
  assert.doesNotMatch(shown, /NaN|undefined|Infinity/);
});
