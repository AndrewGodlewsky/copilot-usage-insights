import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationAccumulator } from '../src/core/conversations.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { localDay } from '../src/core/query.mjs';
import { steeringFixture, reviewNow } from './fixtures/review.mjs';

const end = localDay(reviewNow), start = end - 6;
function prompt(sessionId, day, calls = 1, extra = {}) {
  return { sessionId, day, provider: true, identity: true, humanDelivery: true, delivery: 'idle',
    charges: Array.from({ length: calls }, () => ({})), sample: { ms: new Date(2026, 10, 15, 10).getTime() + (day - end) * 86400000 }, ...extra };
}
test('confirmed steering counts toward depth without changing shared prompt accounting', () => {
  const scan = steeringFixture().scan();
  const report = buildReport(scan.records, { range: '7d' }, reviewNow, scan), c = report.efficiency.conversations;
  assert.equal(c.countedSessions, 1); assert.equal(c.prompts, 3); assert.equal(c.medianPrompts, 3);
  assert.equal(c.promptWork.prompts, 0); assert.equal(c.workSessions, 0);
  assert.equal(report.promptCredits.eligiblePrompts, 0); assert.equal(report.totals.credits, 6);
  assert.equal(c.examples[0].events.filter(e => e.kind === 'prompt').length, 3);
  assert.ok(c.examples[0].events.every(e => e.calls === null));
});
test('prompt work has independent coverage and counts only complete work, including zero-charge prompts', () => {
  const a = createConversationAccumulator([], {}, start, end, reviewNow);
  a.add(prompt('a', end, 1), true); a.add(prompt('a', end, 99), false);
  a.add(prompt('b', end, 6), true); a.add(prompt('b', end, 16), true);
  const c = a.finish();
  assert.equal(c.prompts, 4); assert.equal(c.promptWork.prompts, 3);
  assert.deepEqual(c.promptWork.distribution.map(b => b.count), [1, 0, 1, 1]);
  assert.equal(c.promptWork.medianCalls, 6); assert.equal(c.promptWork.averageCalls, 23 / 3);
  assert.equal(c.workSessions, 1); assert.equal(c.workPrompts, 2);
});
test('returning distribution and steering concentration use selected dates and retain unknown coverage', () => {
  const a = createConversationAccumulator([], {}, start, end, reviewNow);
  for (let s = 0; s < 5; s++) for (let d = 0; d <= s; d++) a.add(prompt(`PRIVATE-${s}`, end - d, 1, { delivery: s ? 'steering' : 'unknown' }), true);
  a.add(prompt('PRIVATE-0', start - 1), true);
  const c = a.finish();
  assert.deepEqual(c.dayDistribution.map(b => b.count), [1, 2, 2]);
  assert.equal(c.priorSessions, 1); assert.equal(c.steering.topMessages, 12);
  assert.equal(c.steering.topSessions, 3); assert.equal(c.steering.sessions, 4);
  assert.equal(c.delivery.steering, 14); assert.equal(c.delivery.unknown, 1);
  assert.doesNotMatch(JSON.stringify(c), /PRIVATE/);
});
test('previous equal-length dates are aggregated from memory and respect project filters', () => {
  const a = createConversationAccumulator([], { project: 'included' }, start, end, reviewNow);
  for (let s = 0; s < 6; s++) {
    for (const day of [start - 1, start, start + 1]) a.add(prompt(`s${s}`, day, 2, { project: 'included' }), true);
    a.add(prompt('excluded', end, 999, { project: 'excluded' }), true);
  }
  const c = a.finish();
  assert.equal(c.medianPrompts, 2); assert.equal(c.comparison.previous.medianPrompts, 1);
  assert.equal(c.comparison.previous.countedSessions, 6);
  assert.equal(c.comparison.startDate, '2026-11-02'); assert.equal(c.comparison.endDate, '2026-11-08');
  assert.equal(createConversationAccumulator([], {}, -Infinity, end, reviewNow).finish().comparison, null);
});
test('local examples and event counts stay bounded and omit private identities', () => {
  const a = createConversationAccumulator([], {}, start, end, reviewNow);
  for (let s = 0; s < 50; s++) for (let i = 0; i < 100; i++) a.add(prompt(`SECRET SESSION ${s}`, end, 1, { project: 'SECRET PROJECT' }), true);
  const c = a.finish();
  assert.ok(c.examples.length <= 8); assert.ok(c.examples.every(e => e.events.length <= 16));
  assert.equal(c.examplesOmitted, 42); assert.ok(c.examples.every(e => e.eventsOmitted === 84));
  assert.doesNotMatch(JSON.stringify(c), /SECRET/); assert.ok(JSON.stringify(c).length < 24000);
});
