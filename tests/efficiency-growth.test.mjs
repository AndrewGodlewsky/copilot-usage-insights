import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrowthSummary } from '../src/core/efficiency-growth.mjs';
import { createEfficiencyTopics } from '../src/core/efficiency-topics.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderGrowthSummary } from '../src/panel/growth-summary.mjs';
import { demoData } from '../scripts/demo-data.mjs';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const formats = { number: (value, options) => options?.maximumFractionDigits ? String(Math.round(value * 10) / 10) : String(value), credits: value => `${value} credits` };
const call = (sessionId, ms, inputTotal, extra = {}) => ({ sessionId, ms, inputTotal, initiator: 'user', cacheRead: 0, cacheWrite: 0, nanoAiu: null, creditStatus: '', ...extra });
const run = records => { const topic = createGrowthSummary(); for (const r of records) topic.add(r); return topic.finish(); };

test('shares and growth counts are exact on a small history, whatever the arrival order', () => {
  const records = [
    call('a', 4, 600), call('a', 1, 100, { nanoAiu: 1e9, creditStatus: 'complete', cacheRead: 0, cacheWrite: 0 }),
    call('a', 3, 150, { initiator: 'agent', cacheRead: 100, cacheWrite: 0 }), call('a', 2, 200, { nanoAiu: 1e9, creditStatus: 'complete' }),
    call('b', 1, 100, { nanoAiu: 1e9, creditStatus: 'complete' }), call('b', 2, 120),
    call('c', 1, 50), call('d', 1, 9999, { initiator: 'sub-agent' }),
  ];
  const g = run(records);
  assert.equal(g.conversations, 3);
  assert.equal(g.mainCalls, 7);
  assert.equal(g.measuredConversations, 2);
  assert.deepEqual([g.grew2, g.grew5], [1, 1]);
  assert.equal(g.later.input, 950);
  assert.equal(g.later.totalInput, 1320);
  assert.equal(g.later.calls, 3);
  assert.equal(g.later.credits, 1);
  assert.equal(g.later.totalCredits, 3);
  assert.deepEqual([g.later.lateChargeCalls, g.later.chargeCalls], [1, 3]);
  assert.equal(g.later.splitCalls, 3);
  assert.equal(g.later.splitShare, 100 / 950 * 100);
  assert.deepEqual(g.positions[0], { prompt: 1, conversations: 3, input: 100, multiple: 1, multipleConversations: 3 });
  assert.equal(g.positions[1].input, null);
});

test('prompt positions use each conversation\'s own first prompt and need three conversations', () => {
  const build = (id, factor) => Array.from({ length: 5 }, (_, i) => call(id, i + 1, 100 * (i === 4 ? factor : 1)));
  const g = run([...build('a', 2), ...build('b', 4), ...build('c', 6)]);
  assert.deepEqual(g.positions[1], { prompt: 5, conversations: 3, input: 400, multiple: 4, multipleConversations: 3 });
  const two = run([...build('a', 2), ...build('b', 4)]);
  assert.equal(two.positions[1].input, null);
  assert.equal(two.positions[1].conversations, 2);
  assert.equal(two.positions[0].input, null);
});

test('unknown input stays unknown and does not count as zero', () => {
  const g = run([call('a', 1, null), call('a', 2, undefined), call('a', 3, NaN, { initiator: 'agent' }), call('b', 1, 0), call('b', 2, 5)]);
  assert.equal(g.measuredCalls, 2);
  assert.equal(g.measuredConversations, 0);
  assert.equal(g.later.credits, null);
  assert.equal(g.later.splitShare, null);
  const empty = run([]);
  assert.equal(empty.later.input, null);
  assert.equal(renderGrowthSummary(empty, formats, {}), '');
});

test('the summary is reported with the efficiency topics and stays small', () => {
  const topics = createEfficiencyTopics({});
  for (let i = 0; i < 5000; i++) topics.addRequest(call('s' + i % 50, i, 100 + i), '2026-06-10');
  const result = topics.finish().growthSummary;
  assert.ok(JSON.stringify(result).length < 3000);
  assert.equal(result.conversations, 50);
});

test('the view shows the measured numbers, points to Context reduction, and is clean', () => {
  const build = (id, factor) => Array.from({ length: 5 }, (_, i) => call(id, i + 1, 100 * (i === 4 ? factor : 1)));
  const g = run([...build('a', 2), ...build('b', 4), ...build('c', 6)]);
  const html = renderGrowthSummary(g, formats, { compaction: { compactions: 4, sessions: 2 } });
  const shown = text(html);
  assert.match(html, /data-efficiency-jump-section="patterns"/);
  assert.match(html, /data-efficiency-jump-topic="compaction"/);
  assert.match(shown, /User prompt Conversations Typical input Compared with prompt 1/);
  assert.match(shown, /5 3 400 4 times/);
  assert.match(shown, /Reached 2 times the start 3 of 3/);
  assert.match(shown, /2 of 3 conversations in these dates have a recorded compaction \(4 in total\)\. See Context reduction/);
  assert.match(shown, /Longer conversations are a different, smaller set at each position/);
  assert.match(shown, /Compare afterward/);
  assert.doesNotMatch(shown, /NaN|undefined|Infinity|—/);
  assert.match(text(renderGrowthSummary(g, formats, {})), /No compaction is recorded/);
});

test('the demo history produces a summary without invalid numbers', () => {
  const data = demoData(), report = buildReport(data.records, { range: '30d' }, new Date(), data);
  const shown = text(renderGrowthSummary(report.efficiency.growthSummary, formats, report.efficiency));
  assert.ok(report.efficiency.growthSummary.conversations > 0);
  assert.doesNotMatch(shown, /NaN|undefined|Infinity/);
});
