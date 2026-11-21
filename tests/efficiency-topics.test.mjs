import test from 'node:test';
import assert from 'node:assert/strict';
import { createEfficiencyAccumulator } from '../src/core/efficiency.mjs';
import { createEfficiencyTopics } from '../src/core/efficiency-topics.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { dayOfMs, dayKey } from '../src/core/query.mjs';
import { trendRow, barList } from '../src/panel/token-insights.mjs';
import { demoData, demoContext } from '../scripts/demo-data.mjs';

const call = (ms, extra = {}) => ({ key: `k${ms}`, ms, sessionId: 's', project: 'p', model: 'M', initiator: 'user', inputTotal: 1000, output: 100,
  cacheRead: 600, cacheWrite: 100, reasoning: 20, nanoAiu: 1e9, creditStatus: 'complete', ...extra });
const DAY = 86_400_000, base = Date.UTC(2026, 5, 1, 12);

test('call duration and output speed use only calls that record them', () => {
  const a = createEfficiencyAccumulator();
  a.add(call(base, { duration: 2000, output: 100 }));
  a.add(call(base + 1, { duration: 4000, output: 500 }));
  a.add(call(base + 2, { duration: 0, output: 50 }));
  a.add(call(base + 3, { duration: null }));
  a.add(call(base + 4, { duration: 1000, output: null }));
  const { summary, efforts } = a.finish();
  assert.equal(summary.durationRequests, 4);
  assert.equal(summary.averageDuration, 1750);
  // A zero-length call and a call without output cannot contribute to speed.
  assert.equal(summary.paceRequests, 2);
  assert.equal(summary.outputPerSecond, 100);
  assert.equal(efforts[0].averageDuration, 1750);
  const none = createEfficiencyAccumulator();
  none.add(call(base, { duration: null }));
  assert.equal(none.finish().summary.averageDuration, null);
  assert.equal(none.finish().summary.outputPerSecond, null);
});

test('the efficiency trend has one point per active day and groups long spans into weeks', () => {
  const a = createEfficiencyAccumulator();
  a.add(call(base, { inputTotal: 1000 }));
  a.add(call(base + 60_000, { inputTotal: 3000 }));
  a.add(call(base + 2 * DAY, { inputTotal: 5000, cacheRead: null, cacheWrite: null }));
  const { trend } = a.finish();
  assert.equal(trend.unit, 'day');
  assert.deepEqual(trend.points.map(p => [p.day, p.requests, p.averageInput, p.cacheRequests]), [
    [dayKey(dayOfMs(base)), 2, 2000, 2], [dayKey(dayOfMs(base + 2 * DAY)), 1, 5000, 0]]);
  assert.equal(trend.points[1].cacheHitRate, null);
  assert.equal(trend.points[0].credits, 2);

  const long = createEfficiencyAccumulator();
  for (let day = 0; day < 70; day += 2) long.add(call(base + day * DAY, { inputTotal: 1000 + day }));
  const weekly = long.finish().trend;
  assert.equal(weekly.unit, 'week');
  assert.equal(weekly.points.length, 10);
  assert.equal(weekly.points.reduce((sum, p) => sum + p.requests, 0), 35);
  assert.equal(weekly.points[0].day, dayKey(dayOfMs(base)));
  assert.deepEqual(createEfficiencyAccumulator().finish().trend, { unit: 'day', points: [] });
  const untimed = createEfficiencyAccumulator();
  untimed.add({ model: 'M', inputTotal: 10, output: 1 });
  assert.equal(untimed.finish().summary.requests, 1);
  assert.deepEqual(untimed.finish().trend.points, []);
});

test('the topic registry is inert until a topic registers and the report carries its additions', () => {
  const topics = createEfficiencyTopics();
  topics.addRequest(call(base), 1); topics.addTool({ name: 'view' }, true);
  assert.deepEqual(topics.finish(), {});
  const report = buildReport([call(base, { duration: 1500 })], { range: 'all' }, new Date(base + DAY));
  assert.equal(report.efficiency.trend.points.length, 1);
  assert.equal(report.efficiency.summary.averageDuration, 1500);
});

test('trend rows need four measured periods and describe earlier against later', () => {
  const trend = { unit: 'day', points: [1, 2, null, 4, 9].map((value, index) => ({ day: `2026-06-0${index + 1}`, value })) };
  assert.equal(trendRow({ unit: 'day', points: trend.points.slice(0, 4) }, p => p.value, { label: 'Input per call' }), '');
  assert.equal(trendRow(undefined, p => p.value, { label: 'x' }), '');
  const html = trendRow(trend, p => p.value, { label: 'Input <per> call', format: value => `${value}t` });
  assert.match(html, /Input &lt;per&gt; call by day/);
  assert.match(html, /1\.5t in the earlier days, 6\.5t in the later days/);
  assert.match(html, /2026-06-01 to 2026-06-05, 4 days with measurements/);
  assert.match(html, /role="img" aria-label="/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  const flat = trendRow({ unit: 'week', points: [5, 5, 5, 5].map((value, i) => ({ day: `2026-06-0${i + 1}`, value })) }, p => p.value, { label: 'Flat' });
  assert.match(flat, /by week/);
  assert.doesNotMatch(flat, /NaN|Infinity/);
});

test('bar lists scale to the largest row or a stated total and escape labels', () => {
  assert.equal(barList([]), '');
  assert.equal(barList([{ label: 'a', value: 0 }]), '');
  assert.equal(barList([{ label: 'a', value: null }]), '');
  const html = barList([{ label: '<b>one</b>', value: 50, detail: '5 calls' }, { label: 'two', value: 25 }, { label: 'skip', value: NaN }], { format: value => `${value}!` });
  assert.match(html, /&lt;b&gt;one&lt;\/b&gt;/);
  assert.match(html, /width:100\.0%/);
  assert.match(html, /width:50\.0%/);
  assert.match(html, /50!/);
  assert.match(html, /5 calls/);
  assert.doesNotMatch(html, /skip/);
  assert.match(barList([{ label: 'a', value: 50 }], { total: 200 }), /width:25\.0%/);
  assert.match(barList([{ label: 'a', value: 500 }], { total: 200 }), /width:100\.0%/);
});

test('the demo history exercises every Efficiency measurement without reading a Copilot home', () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now), again = demoData(now);
  assert.equal(data.records.length, again.records.length);
  assert.ok(data.records.length > 2000);
  const report = buildReport(data.records, { range: '30d' }, now, data), e = report.efficiency;
  assert.ok(e.summary.toolRequests > 0 && e.summary.reasoningRequests > 0 && e.summary.durationRequests > 0);
  assert.ok(e.byInitiator.find(row => row.id === 'sub-agent').requests > 0);
  assert.ok(e.switches.modelChanges > 0 && e.switches.effortChanges > 0);
  assert.ok(e.efforts.some(row => row.effort === 'high') && e.efforts.some(row => row.effort === 'unknown'));
  assert.ok(e.conversations.sessions > 0 && e.contextGrowth.sessions > 0);
  assert.ok(report.tools.calls > 0 && report.mcp.rows.length > 0 && report.skills.invocations > 0);
  assert.ok(report.promptCredits.eligiblePrompts > 0);
  assert.ok(data.records.some(record => record.origin === 'compaction'));
  assert.ok(e.trend.points.length >= 4);
  const context = demoContext(now);
  assert.equal(context.available, true);
  assert.ok(Object.values(context.categories).reduce((sum, value) => sum + value, 0) <= context.totalTokens);
});
