import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransitionsTopic } from '../src/core/efficiency-transitions.mjs';
import { createEfficiencyTopics } from '../src/core/efficiency-topics.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderTransitionsTopic } from '../src/panel/transitions-topic.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { dayOfMs } from '../src/core/query.mjs';
import { formatNumber, formatCredits } from '../src/core/format.mjs';

const MINUTE = 60_000, DAY = 86_400_000;
const base = new Date(2026, 5, 10, 12).getTime(), now = new Date(base + DAY);
const formats = { number: formatNumber, credits: formatCredits };
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const call = (sessionId, minute, model, input, cacheRead, extra = {}) => ({ sessionId, ms: base + minute * MINUTE, model: model.toUpperCase(), modelId: model,
  initiator: 'agent', inputTotal: input, cacheRead, cacheWrite: 0, isAuto: false, ...extra });
const change = (sessionId, minute, fromModel, toModel, extra = {}) => ({ key: `${sessionId}-${minute}`, sessionId, project: 'p', ms: base + minute * MINUTE,
  fromModel, toModel, fromEffort: 'unknown', toEffort: 'unknown', modelChanged: fromModel !== toModel, effortChanged: false, source: 'model_picker', ...extra });
const run = (calls, modelChanges, extra = {}) => {
  const topic = createTransitionsTopic({ now, activity: { modelChanges }, sessionLabels: new Map([['s1', 'First conversation']]), ...extra });
  for (const r of calls) topic.add(r);
  return topic.finish();
};

test('pairs the last call before a model change with the first call after it, on matched samples', () => {
  const result = run([
    call('s1', 0, 'm1', 100, 80), call('s1', 2, 'm2', 200, 20), call('s1', 3, 'm2', 50, null, { cacheRead: undefined }),
    call('s2', 0, 'm1', 10, 0), call('s2', 5, 'm1', 10, 0),
    call('s3', 0, 'm1', 10, 0), call('s3', 1, 'm9', 10, 0, { initiator: 'sub-agent' }),
  ], [
    change('s1', 1, 'm1', 'm2', { fromEffort: 'high', toEffort: 'low', effortChanged: true, source: 'sdk' }),
    change('s2', 2, 'm1', 'm2'),
    change('s1', 1.5, 'm2', 'm2', { modelChanged: false, fromEffort: 'low', toEffort: 'medium', effortChanged: true }),
  ]);
  assert.equal(result.events, 3);
  assert.equal(result.sessions, 2);
  assert.equal(result.modelChanges, 2);
  assert.equal(result.effortChanges, 2);
  assert.deepEqual(result.models.map(r => [r.from, r.to, r.count]), [['m1', 'm2', 2]]);
  assert.deepEqual(result.efforts.map(r => [r.from, r.to, r.count]), [['high', 'low', 1], ['low', 'medium', 1]]);
  assert.deepEqual(result.sources, [{ id: 'model_picker', count: 2 }, { id: 'sdk', count: 1 }]);
  assert.deepEqual(result.next, { paired: 1, sameModel: 1, inputBefore: 100, inputAfter: 200, change: -100, cachePairs: 1, cacheBefore: 80, cacheAfter: 10, lower: 1, creditPairs: 0, creditsBefore: null, creditsAfter: null });
  // s1 uses two models; s2 and s3 use one (a subagent call does not count).
  assert.deepEqual(result.usage, { sessions: 3, severalModels: 1 });
  assert.deepEqual(result.chooser, { calls: 7, automatic: 0, selected: 7, unrecorded: 0, autoModelCount: 0, autoModels: [] });
  assert.deepEqual(result.conversations.map(r => [r.name, r.modelChanges, r.effortChanges]), [['First conversation', 1, 2], ['Unnamed session', 1, 0]]);
});

test('the choice recorded on each call is counted apart, and unknown stays unknown', () => {
  const result = run([call('s1', 0, 'm1', 1, 0, { isAuto: true }), call('s1', 1, 'm1', 1, 0, { isAuto: null }), call('s1', 2, 'm1', 1, 0, { isAuto: false })], []);
  assert.deepEqual(result.chooser, { calls: 3, automatic: 1, selected: 1, unrecorded: 1, autoModelCount: 1,
    autoModels: [{ name: 'M1', calls: 1, share: 100, creditCalls: 0, averageCredits: null }] });
  assert.equal(result.events, 0);
  assert.deepEqual(result.next.paired, 0);
  assert.equal(result.next.inputBefore, null);
});

test('credits before/after a model change and Auto-picked model breakdown exclude partial/missing charges', () => {
  const calls = [
    call('s1', 0, 'm1', 100, 80, { nanoAiu: 2e9, creditStatus: 'complete' }),
    call('s1', 2, 'm2', 200, 20, { nanoAiu: 5e8, creditStatus: 'complete' }),
    call('s2', 0, 'm1', 100, 80, { nanoAiu: 1e9, creditStatus: 'partial' }),
    call('s2', 2, 'm2', 200, 20, { nanoAiu: 3e9, creditStatus: 'complete' }),
    // 6 distinct auto-picked models (capped at top 5)
    call('s3', 0, 'a1', 10, 0, { isAuto: true, nanoAiu: 1e9, creditStatus: 'complete' }),
    call('s3', 1, 'a1', 10, 0, { isAuto: true, nanoAiu: 3e9, creditStatus: 'complete' }),
    call('s3', 2, 'a2', 10, 0, { isAuto: true, nanoAiu: 2e9, creditStatus: 'partial' }),
    call('s3', 3, 'a3', 10, 0, { isAuto: true, nanoAiu: 5e8, creditStatus: 'complete' }),
    call('s3', 4, 'a4', 10, 0, { isAuto: true, nanoAiu: 5e8, creditStatus: 'complete' }),
    call('s3', 5, 'a5', 10, 0, { isAuto: true, nanoAiu: 5e8, creditStatus: 'complete' }),
    call('s3', 6, 'a6', 10, 0, { isAuto: true, nanoAiu: 5e8, creditStatus: 'complete' }),
  ];
  const result = run(calls, [change('s1', 1, 'm1', 'm2'), change('s2', 1, 'm1', 'm2')]);
  assert.equal(result.next.paired, 2);
  assert.equal(result.next.creditPairs, 1);
  assert.equal(result.next.creditsBefore, 2);
  assert.equal(result.next.creditsAfter, 0.5);
  assert.equal(result.chooser.automatic, 7);
  assert.equal(result.chooser.autoModelCount, 6);
  assert.equal(result.chooser.autoModels.length, 5);
  assert.deepEqual(result.chooser.autoModels[0], { name: 'A1', calls: 2, share: 2 / 7 * 100, creditCalls: 2, averageCredits: 2 });
  assert.equal(result.chooser.autoModels[1].averageCredits, null);
  const html = renderTransitionsTopic(result, [], formats), out = text(html);
  assert.match(out, /AI credits of one model call/);
  assert.match(out, /1 of 2 pairs have complete charges on both calls/);
  assert.match(out, /Models Copilot picked/);
  assert.match(out, /Showing 5 of 6 models picked by Copilot/);
  assert.match(out, /Credits unavailable \(0 of 1 calls with complete charges\)/);
  assert.doesNotMatch(out, /NaN|undefined|Infinity/);
});

test('missing input or an incomplete cache split leaves the measure out instead of using zero', () => {
  const result = run([call('s1', 0, 'm1', 100, 50), call('s1', 2, 'm2', null, null)], [change('s1', 1, 'm1', 'm2')]);
  assert.equal(result.next.paired, 0);
  const partial = run([call('s1', 0, 'm1', 100, null, { cacheRead: undefined }), call('s1', 2, 'm2', 100, 10)], [change('s1', 1, 'm1', 'm2')]);
  assert.equal(partial.next.paired, 1);
  assert.equal(partial.next.cachePairs, 0);
  assert.equal(partial.next.cacheBefore, null);
});

test('events with no call on one side, outside the dates, or in an excluded session are not paired', () => {
  const result = run([call('s1', 5, 'm2', 100, 0), call('s2', 0, 'm1', 1, 0), call('s2', 2, 'm2', 1, 0)],
    [change('s1', 1, 'm1', 'm2'), change('s2', 1, 'm1', 'm2')], { activity: { modelChanges: [change('s1', 1, 'm1', 'm2'), change('s2', 1, 'm1', 'm2'), change('s3', 1, 'm1', 'm2', { ms: base - 5 * DAY })], skillExcludedSessions: ['s2'] }, start: dayOfMs(base), end: Infinity });
  assert.equal(result.next.paired, 0);
  assert.equal(result.omitted, 1);
  assert.equal(result.events, 1);
});

test('a model filter keeps the changes that touch a selected model and hides what needs every model', () => {
  const result = run([call('s1', 0, 'm1', 1, 0), call('s1', 2, 'm1', 1, 0)], [change('s1', 1, 'm1', 'm2'), change('s1', 1.1, 'm8', 'm9')], { query: { models: ['M1'] } });
  assert.equal(result.modelFiltered, true);
  assert.equal(result.events, 1);
  assert.deepEqual(result.usage, { sessions: null, severalModels: null });
  assert.equal(result.next.paired, 0);
});

test('the result stays small and registers as report.efficiency.changeDetail', () => {
  const modelChanges = [];
  for (let i = 0; i < 400; i++) modelChanges.push(change(`s${i}`, 1, `a${i}`, `b${i}`));
  const topics = createEfficiencyTopics({ now, activity: { modelChanges }, sessionLabels: new Map() });
  for (let i = 0; i < 400; i++) { topics.addRequest(call(`s${i}`, 0, `a${i}`, 5, 0), 0); topics.addRequest(call(`s${i}`, 2, `b${i}`, 5, 0), 0); }
  const detail = topics.finish().changeDetail;
  assert.equal(detail.events, 400);
  assert.equal(detail.models.length, 5);
  assert.equal(detail.conversations.length, 5);
  assert.ok(JSON.stringify(detail).length < 4000);
});

test('the view shows what changed, the pair of calls, effort levels within a model, and one experiment', () => {
  const detail = run([call('s1', 0, 'm1', 100, 80), call('s1', 2, 'm2', 200, 20)], [change('s1', 1, 'm1', 'm2', { fromEffort: 'high', toEffort: 'low', effortChanged: true })]);
  const levels = [{ name: 'Model', effort: 'medium', requests: 40, creditRequests: 40, averageCredits: 0.5 }, { name: 'Model', effort: 'high', requests: 12, creditRequests: 10, averageCredits: 0.9 },
    { name: 'Model', effort: 'low', requests: 3, creditRequests: 3, averageCredits: 0.1 }, { name: 'Model', effort: 'unknown', requests: 20, creditRequests: 20, averageCredits: 0.2 }];
  const html = renderTransitionsTopic(detail, levels, formats), out = text(html);
  assert.match(html, /data-efficiency-open-session="s1"/);
  assert.match(html, /data-efficiency-jump-section="tokens" data-efficiency-jump-topic="cache"/);
  assert.match(html, /data-efficiency-jump-section="tokens" data-efficiency-jump-topic="output"/);
  assert.match(out, /Which models changed m1 → m2 1/);
  assert.match(out, /high → low/);
  assert.match(out, /Last call before 100/);
  assert.match(out, /First call after 200/);
  assert.match(out, /Last call before 80%/);
  assert.match(out, /Model medium 40 72.7%/);
  assert.match(out, /Model high 12 21.8%/);
  assert.doesNotMatch(out, /Model low/);
  assert.doesNotMatch(out, /Model unknown/);
  assert.match(out, /at least 10 calls/);
  assert.match(out, /Compare afterward/);
  assert.match(out, /See Cache reuse/);
  assert.match(out, /Reasoning and generated output/);
  assert.doesNotMatch(out, /NaN|undefined|Infinity|—/);
});

test('the view is honest when nothing is recorded or the data is partial', () => {
  assert.match(renderTokenTopic('transitions', { efficiency: {} }, formats), /No recorded model or effort measurements/);
  const none = text(renderTransitionsTopic(run([call('s1', 0, 'm1', 1, 0)], []), [{ name: 'Model', effort: 'high', requests: 20, creditRequests: 20, averageCredits: 1 }], formats));
  assert.match(none, /No model or effort change is recorded/);
  assert.match(none, /No model has two recorded effort levels/);
  assert.match(none, /1 model has a single level/);
  assert.doesNotMatch(none, /NaN|undefined|Infinity/);
  const filtered = text(renderTransitionsTopic(run([call('s1', 0, 'm1', 1, 0), call('s1', 2, 'm1', 1, 0)], [change('s1', 1, 'm1', 'm2')], { query: { models: ['M1'] } }), [], formats));
  assert.match(filtered, /Used more than one model Unavailable/);
  assert.match(filtered, /unavailable while a model filter is on/);
});

test('model, session and effort names are escaped', () => {
  const evil = '<img src=x>';
  const detail = run([call('s1', 0, evil, 100, 0), call('s1', 2, 'm2', 100, 0)], [change('s1', 1, evil, 'm2')], { sessionLabels: new Map([['s1', evil]]) });
  const html = renderTransitionsTopic(detail, [{ name: evil, effort: 'high', requests: 20, creditRequests: 0, averageCredits: null }, { name: evil, effort: 'low', requests: 20, creditRequests: 0, averageCredits: null }], formats);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(text(html), /Unavailable \(0 of 20\)/);
});

test('the demo history renders a complete view with no placeholder values', () => {
  const data = demoData(), report = buildReport(data.records, { range: '30d' }, new Date(), data);
  const detail = report.efficiency.changeDetail;
  assert.ok(detail.events > 0);
  assert.ok(detail.next.paired > 0);
  const out = text(renderTokenTopic('transitions', report, formats));
  assert.match(out, /Conversations with the most changes/);
  assert.doesNotMatch(out, /NaN|undefined|Infinity|\[object/);
});
