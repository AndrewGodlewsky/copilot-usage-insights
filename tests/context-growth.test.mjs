import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextGrowthAccumulator } from '../src/core/context-growth.mjs';
import { localDay } from '../src/core/query.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';
import { buildEfficiencyReview } from '../src/panel/efficiency.mjs';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';

const day = localDay(reviewNow), startMs = reviewNow.getTime() - 100000;
function addSeries(a, values, { id = 'session', project = 'project', modelId = 'raw-a', model = 'Model', ...extra } = {}) {
  values.forEach((input, i) => a.add({ identity: true, humanDelivery: true, provider: true, linksKnown: true, sessionId: id, project, day,
    sample: { ms: startMs + i, promptId: `${id}-${i}` }, contextRecord: { inputTotal: input, modelId, model, ms: startMs + i + 1,
      cacheRead: input == null ? null : input / 2, cacheWrite: 0 }, ...extra }));
}
const accumulator = (query = {}) => createContextGrowthAccumulator(query, day, day, reviewNow);
test('context patterns summarize all sessions and group exact ordinal medians and quartiles', () => {
  const a = accumulator();
  for (const [i, n] of [1, 2, 3, 4].entries()) addSeries(a, [10, 10, 10, 40, 40, 40].map(v => v * 1000 * n), { id: `s${i}` });
  addSeries(a, Array(8).fill(100000), { id: 'steady' });
  const r = a.finish();
  assert.equal(r.sessions, 5); assert.equal(r.patterns.growing.sessions, 4); assert.equal(r.patterns.steady.sessions, 1);
  assert.deepEqual(r.patterns.growing.curve[0], { turn: 1, sessions: 4, median: 25000, low: 17500, high: 32500, change: 0, changeLow: 0, changeHigh: 0 });
  assert.equal(r.patterns.growing.curve[5].change, 75000);
  assert.equal(r.patterns.steady.curve.length, 0, 'fewer than three sessions is not a grouped curve');
  assert.equal(r.cacheRead / r.cacheInput, .5);
});
test('spikes, reductions, unknown input, raw model collisions and partial model filters remain distinct', () => {
  const a = accumulator();
  addSeries(a, [10000, 10000, 10000, 100000, 10000, 10000, 10000], { id: 'spike' });
  addSeries(a, [100000, 100000, 100000, 20000, 20000, 20000], { id: 'fall' });
  addSeries(a, [10000, null, 10000, 40000, 40000, 40000], { id: 'missing' });
  addSeries(a, [10000, 10000, 10000], { id: 'switch' });
  addSeries(a, [40000, 40000, 40000], { id: 'switch', modelId: 'raw-b', sample: { ms: startMs + 10 } });
  const r = a.finish();
  assert.equal(r.patterns.spike.sessions, 1); assert.equal(r.patterns.falling.sessions, 1); assert.equal(r.patterns.mixed.sessions, 2);
  const f = accumulator({ models: ['Model'] });
  addSeries(f, [1, 2, 3, 4, 5, 6], { model: 'Other' }); addSeries(f, [1, 2, 3, 4, 5, 6], { id: 'kept' });
  assert.equal(f.finish().sessions, 1);
});
test('unknown and duplicate ordering, absent raw IDs and model changes inside a prompt are not classified', () => {
  for (const opts of [{ sample: { ms: startMs } }, { modelId: null }, { contextBoundary: true }]) {
    const a = accumulator(); addSeries(a, [10000,10000,10000,80000,80000,80000], opts);
    assert.equal(a.finish().patterns.mixed.sessions, 1);
  }
});
test('context series honor prompt date, project/session filters and keep missing cache unknown', () => {
  const a = accumulator({ project: 'keep', session: 'one' });
  addSeries(a, Array(6).fill(10000), { id: 'one', project: 'keep', contextRecord: { inputTotal: 10000, modelId: 'id', model: 'A', ms: startMs, cacheDetailsReported: false } });
  addSeries(a, Array(6).fill(20000), { project: 'other' });
  addSeries(a, Array(6).fill(20000), { id: 'two', project: 'keep' });
  addSeries(a, Array(6).fill(20000), { id: 'one', project: 'keep', day: day - 1 });
  const r = a.finish(); assert.equal(r.sessions, 1); assert.equal(r.prompts, 6); assert.equal(r.cacheRequests, 0);
});
test('one session is counted once across recorded project labels', () => {
  const a = accumulator(); addSeries(a, [10000, 10000, 10000], { project: 'first' });
  addSeries(a, [30000, 30000, 30000], { project: 'second', sample: { ms: startMs + 9 } });
  assert.equal(a.finish().sessions, 1);
});
test('large histories have bounded curves and diverse bounded local examples', () => {
  const a = accumulator();
  for (let s = 0; s < 100; s++) addSeries(a, Array.from({ length: 1000 }, (_, i) => (i + 1) * 1000), { id: String(s) });
  const r = a.finish(); assert.equal(r.prompts, 100000); assert.equal(r.sessions, 100);
  assert.equal(r.examples.length, 25); assert.equal(r.examplesOmitted, 75);
  assert.ok(r.examples.every(e => e.points.length <= 80)); assert.equal(r.patterns.growing.curve.length, 40);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 400000);
});
test('report attribution uses one first main call per human prompt, retains unbilled input and deduplicates', () => {
  const f = reviewFixture(); f.user('a'); f.call('a', 'initial', { inputTokens: 100 });
  f.call('a', 'followup', { inputTokens: 90000, initiator: 'agent' });
  f.user('b'); f.call('b', 'unbilled', { inputTokens: 200, copilotUsage: undefined });
  f.user('automatic', { source: 'automation' }); f.call('automatic', 'auto');
  f.events.push(...structuredClone(f.events)); const s = f.scan();
  const r = buildReport(s.records, { range: 'all' }, reviewNow, s);
  assert.equal(r.efficiency.contextGrowth.prompts, 2);
  assert.equal(r.efficiency.contextGrowth.examples[0].points.length, 2);
  assert.equal(r.efficiency.contextGrowth.examples[0].points[0].input, s.records.find(r => r.apiCallId === 'initial').inputTotal);
  assert.doesNotMatch(JSON.stringify(r.efficiency.contextGrowth), /PRIVATE PROMPT|PRIVATE RESPONSE/);
});
test('shared prompts, changed root models and missing calls cannot manufacture comparable growth', () => {
  const f = reviewFixture();
  for (let p = 0; p < 8; p++) { f.user(String(p)); f.call(String(p), `first-${p}`, { model: 'exact-a', inputTokens: (p + 1) * 10000 }); }
  f.call('7', 'other', { model: 'exact-b', initiator: 'agent' });
  const s = f.scan(), r = buildReport(s.records, { range: 'all' }, reviewNow, s);
  assert.equal(r.efficiency.contextGrowth.patterns.mixed.sessions, 1);
  const shared = reviewFixture(); shared.user('shared'); shared.user('shared', { messageId: 'other' }); shared.call('shared', 'call');
  const scan = shared.scan(), profile = buildReport(scan.records, { range: 'all' }, reviewNow, scan).efficiency.contextGrowth;
  assert.equal(profile.inputRequests, 0);
});

test('conflicting copied context measurements cannot establish a trend or alter recorded charges', () => {
  for (const conflict of [{ model: 'raw-b' }, { inputTokens: 900000 }, { cacheReadTokens: 500 }]) {
    for (const continuation of [false, true]) {
      const f = reviewFixture();
      [10000,10000,10000,50000,50000,50000].forEach((inputTokens, i) => {
        f.user(String(i)); f.call(String(i), `call-${i}`, { model: 'raw-a', modelDisplayName: 'Same label', inputTokens, copilotUsage: { totalNanoAiu: 1000000000 } });
      });
      if (continuation) f.call('0', 'followup', { model: 'raw-a', modelDisplayName: 'Same label', initiator: 'agent' });
      const run = () => { const scan = f.scan(); return buildReport(scan.records, { range: 'all' }, reviewNow, scan); };
      const before = run(), copy = structuredClone(f.events.find(e => e.type === 'session.usage_record' && e.data.usage.apiCallId === (continuation ? 'followup' : 'call-0')));
      Object.assign(copy.data.usage, conflict); f.events.push(copy);
      const after = run();
      assert.equal(after.efficiency.contextGrowth.patterns.mixed.sessions, 1);
      assert.equal(after.efficiency.contextGrowth.patterns.growing.sessions, 0);
      assert.deepEqual(after.totals, before.totals);
      assert.deepEqual(after.promptCredits, before.promptCredits);
    }
  }
});

test('receipts before submission remain gaps and cannot establish context growth', () => {
  const f = reviewFixture();
  [10000,10000,10000,50000,50000,50000].forEach((inputTokens, i) => { f.user(String(i)); f.call(String(i), String(i), { inputTokens }); });
  for (const e of f.events) if (e.type === 'session.usage_record') e.timestamp = new Date(Date.parse(f.events[0].timestamp) - 1).toISOString();
  const scan = f.scan(), profile = buildReport(scan.records, { range: 'all' }, reviewNow, scan).efficiency.contextGrowth;
  assert.equal(profile.patterns.mixed.sessions, 1); assert.equal(profile.inputRequests, 0);
});

test('an unconfirmed submission breaks continuity without inflating confirmed prompt counts', () => {
  const f = reviewFixture();
  [10000,10000,10000,null,50000,50000,50000].forEach((inputTokens, i) => { f.user(String(i)); if (inputTokens != null) f.call(String(i), String(i), { inputTokens }); });
  const scan = f.scan(), profile = buildReport(scan.records, { range: 'all' }, reviewNow, scan).efficiency.contextGrowth;
  assert.equal(profile.prompts, 6); assert.equal(profile.unconfirmedPrompts, 1);
  assert.equal(profile.patterns.mixed.sessions, 1);
  assert.equal(profile.examples[0].points[3].breakBefore, true);
});
test('context observations use submission dates, preserve model-filter gaps and honor environments', () => {
  const f = reviewFixture({ sessionId: 'windows' });
  f.time(new Date(2026, 10, 14, 23, 59)); f.user('previous');
  f.time(new Date(2026, 10, 15, 0, 1)); f.call('previous', 'initial', { model: 'exact-a' });
  for (let i = 0; i < 8; i++) { f.user(`p${i}`); f.call(`p${i}`, `r${i}`, { model: i === 2 ? 'exact-b' : 'exact-a', inputTokens: (i + 1) * 10000 }); }
  const scan = f.scan(); for (const key of ['records', 'promptEvents']) for (const r of scan[key]) r.environment = 'windows';
  const run = query => buildReport(scan.records, { range: 'all', ...query }, reviewNow, scan).efficiency.contextGrowth;
  assert.equal(run({ range: 'custom', startDate: '2026-11-14', endDate: '2026-11-14' }).prompts, 1);
  const filtered = run({ models: ['exact-a'] });
  assert.equal(filtered.patterns.mixed.sessions, 1); assert.equal(filtered.examples[0].points[3].visible, false);
  assert.equal(run({ environment: 'missing' }).sessions, 0);
});
test('AI review receives bounded aggregate context patterns without local examples or private names', async () => {
  const f = reviewFixture({ project: 'SECRET PROJECT', sessionId: 'SECRET SESSION' });
  for (let p = 0; p < 8; p++) { f.user(String(p)); f.call(String(p), String(p), { inputTokens: (p + 1) * 10000 }); }
  const scan = f.scan(), report = buildReport(scan.records, { range: 'all' }, reviewNow, scan);
  const text = buildEfficiencyReview(report);
  assert.match(text, /contextGrowth/); assert.doesNotMatch(text, /SECRET|PRIVATE|examples|pointsOmitted/);
  const prepared = await prepareInsightReview(scan, { range: 'all' }, reviewNow);
  assert.ok(prepared.payload.evidence.some(e => e.id === 'context-growth-shapes'));
  assert.doesNotMatch(prepared.preview, /SECRET|PRIVATE|pointsOmitted/);
});
