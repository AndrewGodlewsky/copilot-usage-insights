import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/core/copilot-report.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';
import { createConversationAccumulator } from '../src/core/conversations.mjs';
import { localDay } from '../src/core/query.mjs';

function combined(fixtures) {
  const scans = fixtures.map(f => f.scan());
  return Object.fromEntries(['records', 'promptEvents', 'interactions', 'skills', 'tools', 'sources', 'skillExcludedSessions'].map(k => [k, scans.flatMap(s => s[k] || [])]));
}
function conversations(fixtures, filters = {}) {
  const scan = combined(fixtures);
  return buildReport(scan.records, { range: 'all', ...filters }, reviewNow, scan).efficiency.conversations;
}
function session(id, count, calls = 1) {
  const f = reviewFixture({ sessionId: id, project: id });
  for (let p = 0; p < count; p++) {
    f.user(`p${p}`);
    for (let c = 0; c < calls; c++) f.call(`p${p}`, `${p}-${c}`, { initiator: c ? 'agent' : 'user' });
  }
  return f;
}

test('conversation depth counts distinct sessions and prompts, with descriptive boundary buckets and median', () => {
  const fixtures = [1, 2, 5, 6, 15, 16].map((count, n) => session(`s${n}`, count));
  fixtures[0].events.push(...structuredClone(fixtures[0].events));
  const c = conversations(fixtures);
  assert.equal(c.sessions, 6); assert.equal(c.countedSessions, 6); assert.equal(c.prompts, 45);
  assert.deepEqual(c.distribution.map(b => b.count), [1, 2, 2, 1]);
  assert.equal(c.medianPrompts, 5.5); assert.equal(c.averagePrompts, 7.5);
  assert.equal(c.workSessions, 6); assert.equal(c.workPrompts, 45); assert.equal(c.modelCalls, 45);
  assert.deepEqual(c.workMatrix, [[1, 2, 3], [0, 0, 0], [0, 0, 0]]);
  assert.doesNotMatch(JSON.stringify(c), /PRIVATE|s0|p0/);
});

test('work grid distinguishes human interaction from calls between prompts without treating calls as tasks', () => {
  const c = conversations([session('one', 1, 6), session('few', 3, 3), session('many', 7, 6)]);
  assert.deepEqual(c.workMatrix, [[0, 0, 0], [0, 1, 0], [1, 0, 1]]);
  assert.equal(c.workPrompts, 11); assert.equal(c.modelCalls, 57);
  assert.equal(c.averageCallsPerPrompt, 57 / 11);
});

test('missing billing retains known prompts but excludes that session from the complete-work grid', () => {
  const f = session('partial', 1);
  f.user('unbilled'); f.call('unbilled', 'unbilled', { copilotUsage: undefined });
  const c = conversations([f]);
  assert.equal(c.prompts, 2); assert.equal(c.countedSessions, 1); assert.equal(c.workSessions, 0);
  assert.equal(c.averageCallsPerPrompt, null);
  assert.deepEqual(c.workMatrix.flat(), Array(9).fill(0));
});

test('unknown human identity and accounting-only sources are separate coverage, not zero-depth sessions', () => {
  const ambiguous = reviewFixture({ sessionId: 'ambiguous' });
  ambiguous.user('maybe', { source: undefined }); ambiguous.call('maybe', 'a', { initiator: 'agent' });
  const onlyCalls = reviewFixture({ sessionId: 'accounting' }); onlyCalls.call('unknown', 'b');
  const good = session('human', 1);
  good.user('automatic', { source: 'automation' }); good.call('automatic', 'auto', { initiator: 'agent' });
  const c = conversations([good, ambiguous, onlyCalls]);
  assert.equal(c.sessions, 3); assert.equal(c.countedSessions, 1); assert.equal(c.prompts, 1);
  assert.equal(c.uncertainSessions, 1); assert.equal(c.withoutPrompts, 1);
  assert.deepEqual(c.distribution.map(b => b.count), [1, 0, 0, 0]);
});

test('date filters count submissions in range and preserve whole-prompt work across midnight', () => {
  const f = reviewFixture({ sessionId: 'returning' });
  f.time(new Date(2026, 10, 13, 10)); f.user('earlier'); f.call('earlier', 'before');
  f.time(new Date(2026, 10, 14, 23, 59)); f.user('yesterday'); f.call('yesterday', 'initial');
  f.time(new Date(2026, 10, 15, 1)); f.call('yesterday', 'continuation', { initiator: 'agent' });
  f.user('today'); f.call('today', 'current');
  const today = conversations([f], { range: '1d' });
  assert.equal(today.prompts, 1); assert.equal(today.priorSessions, 1); assert.equal(today.multiDaySessions, 0);
  const yesterday = conversations([f], { range: 'custom', startDate: '2026-11-14', endDate: '2026-11-14' });
  assert.equal(yesterday.prompts, 1); assert.equal(yesterday.modelCalls, 2);
  assert.equal(yesterday.priorSessions, 1);
  const all = conversations([f]);
  assert.equal(all.prompts, 3); assert.equal(all.multiDaySessions, 1); assert.equal(all.priorSessions, 0);
});

test('conversation scope respects project, session, environment and model filters and omits future events', () => {
  const a = session('windows', 2), b = session('linux', 6);
  const scan = combined([a, b]);
  for (const key of ['records', 'promptEvents', 'interactions']) for (const item of scan[key]) item.environment = item.sessionId;
  const build = filters => buildReport(scan.records, { range: 'all', ...filters }, reviewNow, scan).efficiency.conversations;
  assert.equal(build({ project: 'windows' }).prompts, 2);
  assert.equal(build({ session: 'linux' }).prompts, 6);
  assert.equal(build({ environment: 'windows' }).prompts, 2);
  assert.equal(build({ project: 'absent' }).sessions, 0);
  assert.equal(build({ models: ['PRIVATE MODEL'] }).reason, 'model-filter');
  a.time(new Date(2026, 10, 16)); a.user('future'); a.call('future', 'later');
  assert.equal(conversations([a]).prompts, 2);
});

test('one session remains one across project labels, and ambiguous submissions exclude its depth sample', () => {
  const day = localDay(reviewNow);
  const a = createConversationAccumulator([], {}, day, day, reviewNow);
  const prompt = { sessionId: 'same', day, provider: true, identity: true, charges: [{}] };
  a.add({ ...prompt, project: 'A' }, true); a.add({ ...prompt, project: 'B' }, true);
  assert.equal(a.finish().countedSessions, 1); assert.equal(a.finish().prompts, 2);
  a.add({ ...prompt, project: 'B', identity: false }, false);
  assert.equal(a.finish().countedSessions, 0); assert.equal(a.finish().uncertainSessions, 1);
  const byProject = createConversationAccumulator([], { project: 'A' }, day, day, reviewNow);
  byProject.add({ ...prompt, project: 'A' }, true); byProject.add({ ...prompt, project: 'B' }, true);
  assert.equal(byProject.finish().prompts, 1);
});

test('non-Copilot messages are not counted as Copilot conversation depth', () => {
  const f = reviewFixture(); f.user('external'); f.call('external', 'external', { provider: { kind: 'byok' } });
  const c = conversations([f]);
  assert.equal(c.sessions, 0); assert.equal(c.prompts, 0); assert.equal(c.medianPrompts, null);
});

function delivered(id, modes) {
  const f = reviewFixture({ sessionId: id, project: id });
  modes.forEach((delivery, n) => { f.user(`p${n}`, { delivery }); f.call(`p${n}`, `${id}-${n}`); });
  return f;
}

test('delivery counts distinct human prompts and uses fully classified sessions for steering rates', () => {
  const a = delivered('a', ['idle', 'steering', 'steering', 'queued']);
  const b = delivered('b', ['idle', undefined, 'unsupported']);
  const c = delivered('c', ['queued']);
  a.events.push(...structuredClone(a.events));
  const d = conversations([a, b, c]).delivery;
  assert.deepEqual(d, { idle: 2, steering: 2, queued: 2, unknown: 2, known: 6,
    classifiedSessions: 2, steeredSessions: 1, averageSteering: 1, userStops: 0, stopSessions: 0 });
  assert.doesNotMatch(JSON.stringify(d), /PRIVATE|p0|interaction/);
});

test('delivery-only conflicts become unknown without changing prompt charges', () => {
  const f = delivered('conflict', ['steering']);
  const before = f.scan();
  const copy = structuredClone(f.events.find(e => e.type === 'user.message'));
  copy.data.delivery = 'queued'; f.events.push(copy);
  const scan = f.scan();
  const report = buildReport(scan.records, { range: 'all' }, reviewNow, scan);
  assert.equal(report.efficiency.conversations.delivery.unknown, 1);
  assert.equal(report.efficiency.conversations.delivery.classifiedSessions, 0);
  assert.equal(report.efficiency.conversations.delivery.averageSteering, null);
  assert.deepEqual(report.promptCredits, buildReport(before.records, { range: 'all' }, reviewNow, before).promptCredits);
});

test('replayed stops under conflicting project contexts do not invalidate recorded prompt costs', () => {
  const f = reviewFixture({ project: 'A' });
  f.user('p', { delivery: 'idle' }); f.call('p', 'call', { copilotUsage: { totalNanoAiu: 2500000000 } });
  const stop = f.push('abort', { reason: 'user_initiated' });
  const build = () => { const scan = f.scan(); return buildReport(scan.records, { range: 'all' }, reviewNow, scan); };
  const before = build();
  assert.equal(before.promptCredits.credits, 2.5);
  f.push('session.context_changed', { repository: 'B' }); f.events.push(structuredClone(stop));
  const after = build();
  assert.equal(after.efficiency.conversations.delivery.userStops, 0, 'the stop project is ambiguous');
  assert.deepEqual(after.promptCredits, before.promptCredits, 'stop location metadata must not change financial accounting');
});

test('steering sharing a run remains multiple submissions, and automated or ambiguous origins are excluded', () => {
  const f = reviewFixture();
  f.user('run', { delivery: 'idle', messageId: 'first' });
  f.user('run', { delivery: 'steering', messageId: 'second' }); f.call('run', 'run');
  f.user('auto', { source: 'schedule', delivery: 'steering' }); f.call('auto', 'auto', { initiator: 'agent' });
  f.user('child', { delivery: 'queued' }, { agentId: 'child' }); f.call('child', 'child', { initiator: 'sub-agent' });
  const d = conversations([f]).delivery;
  assert.equal(d.idle, 1); assert.equal(d.steering, 1); assert.equal(d.queued, 0);
  const unknown = reviewFixture({ sessionId: 'unknown' });
  unknown.user('x', { source: undefined, delivery: 'steering' }); unknown.call('x', 'x', { initiator: 'agent' });
  assert.equal(conversations([unknown]).delivery.known, 0);
});

test('recorded user stops are deduplicated and scoped independently from prompts and other abort reasons', () => {
  const f = delivered('stops', ['idle']);
  f.time(new Date(2026, 10, 14, 10)); f.push('abort', { reason: 'user_initiated' });
  f.time(new Date(2026, 10, 15, 11));
  const stop = f.push('abort', { reason: 'user_initiated' }); f.events.push(structuredClone(stop));
  for (const reason of ['remote_command', 'user_abort', 'autopilot_credit_limit', 'unknown']) f.push('abort', { reason });
  f.push('abort', { reason: 'user_initiated' }, { agentId: 'child' });
  f.push('abort', { reason: 'user_initiated' }, { ephemeral: true });
  const other = delivered('other', ['steering']); other.push('abort', { reason: 'user_initiated' });
  assert.equal(conversations([f, other], { range: '1d', project: 'stops' }).delivery.userStops, 1);
  assert.equal(conversations([f, other], { session: 'stops' }).delivery.userStops, 2);
  assert.equal(conversations([f, other]).delivery.stopSessions, 2);
  f.time(new Date(2026, 10, 16)); f.push('abort', { reason: 'user_initiated' });
  assert.equal(conversations([f], { range: 'all' }).delivery.userStops, 2);
  const byok = reviewFixture({ sessionId: 'byok' });
  byok.user('x', { delivery: 'steering' }); byok.call('x', 'x', { provider: { kind: 'byok' } }); byok.push('abort', { reason: 'user_initiated' });
  assert.equal(conversations([byok]).delivery.userStops, 0);
});

test('delivery respects submission dates, environment filters and refresh memoization', () => {
  const f = delivered('native', ['idle']);
  f.time(new Date(2026, 10, 14, 23, 59)); f.user('prior', { delivery: 'queued' });
  f.time(new Date(2026, 10, 15, 1)); f.call('prior', 'prior');
  const other = delivered('wsl', ['steering']);
  const scan = combined([f, other]); scan.cache = {};
  for (const key of ['records', 'promptEvents', 'interactions']) for (const e of scan[key]) e.environment = e.sessionId;
  const build = filters => buildReport(scan.records, { range: '1d', ...filters }, reviewNow, scan).efficiency.conversations;
  assert.equal(build({ environment: 'native' }).delivery.idle, 1);
  assert.equal(build({ environment: 'native' }).delivery.queued, 0);
  assert.equal(build({ environment: 'wsl' }).delivery.steering, 1);
  assert.equal(build({ models: ['PRIVATE MODEL'] }).reason, 'model-filter');
  assert.deepEqual(build({}), build({}));
  const event = scan.promptEvents.find(e => e.kind === 'user' && e.sessionId === 'native' && e.promptId === 'p0');
  const refreshed = { ...scan, promptEvents: scan.promptEvents.map(e => e === event ? { ...e, delivery: 'steering' } : e) };
  assert.equal(buildReport(refreshed.records, { range: '1d', environment: 'native' }, reviewNow, refreshed).efficiency.conversations.delivery.steering, 1);
});
