import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport, buildModelProjectPage, buildModelSessionPage, buildSessionModels } from '../src/core/copilot-report.mjs';

const now = new Date(2026, 10, 14, 12);
function fixture(session = 's1', project = 'Project A') {
  const events = []; let serial = 0, ms = new Date(2026, 10, 14, 10).getTime();
  const push = (type, data, envelope = {}) => {
    const e = { type, id: `${session}-e${serial++}`, timestamp: new Date(ms++).toISOString(), data, ...envelope }; events.push(e); return e;
  };
  push('session.start', { sessionId: session, context: { repository: project } });
  const user = (interaction, data = {}, envelope = {}) => push('user.message', { interactionId: interaction, messageId: `${interaction}-prompt`, source: 'user', content: 'PRIVATE PROMPT', ...data }, envelope);
  const call = (interaction, api, nano, opts = {}) => {
    const { turn = '0', model = 'Model A', initiator = 'user', status = 'complete', agentId, parentToolCallId, terminal = true, tools = [], complete = true, receipt = true } = opts;
    const envelope = agentId ? { agentId } : {};
    const links = { interactionId: interaction, turnId: turn, ...(parentToolCallId ? { parentToolCallId } : {}) };
    push('assistant.turn_start', links, envelope);
    if (receipt) push('session.usage_record', { usage: { apiCallId: api, provider: { kind: 'copilot' }, model, initiator, parentToolCallId,
      accounting: { sourceSessionId: session, usageId: api }, copilotUsage: nano == null ? undefined : { totalNanoAiu: nano }, aiCreditsStatus: status,
      inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10 } }, envelope);
    push('assistant.message', { ...links, apiCallId: api, content: 'PRIVATE RESPONSE', phase: terminal ? 'final_answer' : 'commentary', toolRequests: tools.map(toolCallId => ({ toolCallId, arguments: 'PRIVATE TOOL' })) }, envelope);
    if (complete) push('assistant.turn_end', { turnId: turn, ...(parentToolCallId ? { parentToolCallId } : {}) }, envelope);
  };
  return { events, push, user, call, time(value) { ms = value.getTime(); } };
}
function snapshot(events) {
  const parser = createReceiptParser({ sessionId: 'fallback', source: 'fixture' });
  for (const e of events) parser.push(JSON.stringify(e));
  return parser.snapshot();
}
const report = (events, query = {}) => { const s = snapshot(events); return buildReport(s.records, { range: 'all', ...query }, now, s); };
const metrics = (events, query) => report(events, query).promptCredits;

function interrupted() {
  const f = fixture(); f.user('before', { source: undefined });
  f.call('before', 'first', 1e9, { complete: false, terminal: false, tools: ['ask'] });
  f.push('tool.execution_start', { toolCallId: 'ask', turnId: '0', toolName: 'ask_user' });
  f.push('session.resume', {});
  f.push('tool.execution_complete', { toolCallId: 'ask', interactionId: 'resume', success: false });
  f.user('after', { source: undefined }); f.call('after', 'second', 2e9, { terminal: false });
  f.call('after', 'third', 3e9, { turn: '1', initiator: 'agent' });
  return f;
}

test('an explicit resume separates repeated turn IDs and preserves interrupted spending', () => {
  const f = interrupted(), r = report([...f.events, ...f.events]);
  assert.equal(r.totals.credits, 6);
  assert.equal(r.promptCredits.prompts, 2);
  assert.equal(r.promptCredits.eligiblePrompts, 1);
  assert.equal(r.promptCredits.averageCredits, 5);
  assert.equal(r.promptCredits.coverage.interruptedPrompts, 1);
  assert.equal(r.promptCredits.coverage.unexpectedPrompts, 0);
  assert.equal(r.promptCredits.coverage.unexpectedCalls, 0);
  const unknown = metrics(f.events.filter(e => e.type !== 'session.resume'));
  assert.equal(unknown.eligiblePrompts, 0, 'missing resume evidence cannot disambiguate reused turns');
  assert.equal(unknown.coverage.unexpectedPrompts, 2);
});

test('explicit user cancellation is informational without inventing a zero charge', () => {
  const f = fixture(); f.user('cancelled', { source: undefined });
  f.push('assistant.turn_start', { interactionId: 'cancelled', turnId: '0' });
  f.push('abort', { reason: 'user_initiated' }); f.push('assistant.turn_end', { turnId: '0' });
  f.push('session.resume', {});
  f.user('done'); f.call('done', 'done', 2e9);
  const r = report(f.events), p = r.promptCredits;
  assert.equal(r.totals.credits, 2);
  assert.equal(p.prompts, 2); assert.equal(p.eligiblePrompts, 1); assert.equal(p.averageCredits, 2);
  assert.equal(p.coverage.cancelledPrompts, 1); assert.equal(p.coverage.unexpectedPrompts, 0);
  const unknown = structuredClone(f.events.filter(e => e.type !== 'session.resume')); unknown.find(e => e.type === 'abort').data.reason = 'unknown';
  assert.equal(metrics(unknown).coverage.cancelledPrompts, 0);
  assert.ok(metrics(unknown).coverage.unexpectedPrompts > 0);
  const serialized = JSON.stringify(snapshot(f.events).promptEvents);
  assert.ok(!serialized.includes('PRIVATE'));
  assert.ok(!serialized.includes('user_initiated'), 'retain a recognized boolean, not raw reasons');
});

test('recognized interruptions do not silence missing or conflicting charges or unknown links', () => {
  const f = interrupted();
  const missing = f.events.filter(e => e.data?.usage?.apiCallId !== 'first');
  assert.ok(metrics(missing).coverage.unexpectedPrompts > 0);
  const conflict = structuredClone(f.events.find(e => e.data?.usage?.apiCallId === 'first'));
  conflict.data.usage.copilotUsage.totalNanoAiu++;
  assert.ok(metrics([...f.events, conflict]).coverage.unexpectedPrompts > 0);
  const unowned = structuredClone(f.events.find(e => e.data?.usage?.apiCallId === 'first'));
  unowned.id = 'unowned'; unowned.data.usage.apiCallId = 'unowned'; unowned.data.usage.accounting.usageId = 'unowned';
  assert.ok(metrics([...f.events, unowned]).coverage.unexpectedCalls > 0);
  assert.ok(metrics([...f.events, unowned]).coverage.unexpectedPrompts > 0);
  const partial = structuredClone(f.events);
  partial.find(e => e.data?.usage?.apiCallId === 'first').data.usage.aiCreditsStatus = 'partial';
  assert.ok(metrics(partial).coverage.unexpectedPrompts > 0);
  const child = delegated();
  child.events = child.events.filter(e => e.type !== 'subagent.completed');
  child.push('session.resume', {});
  assert.ok(metrics(child.events).coverage.unexpectedPrompts > 0, 'resume cannot certify unfinished child work');
});

test('recovered tool completions must retain conflicting child scope evidence', () => {
  for (const scope of ['agent', 'parent']) {
    const f = fixture(); f.user('a'); f.call('a', 'first', 1e9, { terminal: false, tools: ['tool'] });
    f.push('session.resume', {});
    f.push('tool.execution_complete', { toolCallId: 'tool', interactionId: 'resume', ...(scope === 'parent' ? { parentToolCallId: 'unknown-parent' } : {}) },
      scope === 'agent' ? { agentId: 'unknown-child' } : {});
    f.call('a', 'last', 2e9, { turn: '1', initiator: 'agent' });
    const p = metrics(f.events);
    assert.equal(p.eligiblePrompts, 0);
    assert.equal(p.coverage.unexpectedPrompts, 1);
  }
});

test('copied Usage Insights markers identify helper calls without relying on their location', () => {
  const f = fixture('helper', 'Usage Insights');
  f.events[0].data.usageInsightsReview = 1;
  f.push('session.usage_record', { usage: { apiCallId: 'helper', provider: { kind: 'copilot' }, model: 'Model A',
    accounting: { sourceSessionId: 'helper', usageId: 'helper-call' }, inputTokens: 100, outputTokens: 20, copilotUsage: { totalNanoAiu: 1e9 } } });
  const r = report([...f.events, ...f.events]);
  assert.equal(r.totals.credits, 1);
  assert.equal(r.promptCredits.coverage.pluginCalls, 1);
  assert.equal(r.promptCredits.coverage.unexpectedCalls, 0);
  assert.equal(r.promptCredits.eligiblePrompts, 0);
  const conflicting = structuredClone(f.events.at(-1));
  conflicting.data.usage.copilotUsage.totalNanoAiu = 2e9;
  for (const eventId of [conflicting.id, 'copy-with-new-envelope']) {
    conflicting.id = eventId;
    const conflict = metrics([...f.events, conflicting]);
    assert.equal(conflict.coverage.pluginCalls, 0, 'provenance does not excuse conflicting charges');
    assert.equal(conflict.coverage.unexpectedCalls, 1);
  }
});

test('expected coverage counts follow prompt dates and all existing filters', () => {
  const f = interrupted();
  for (const e of f.events) if (e.data?.interactionId === 'before') e.timestamp = new Date(2026, 10, 13, 23, 59).toISOString();
  assert.equal(metrics(f.events, { range: '1d' }).coverage.interruptedPrompts, 0);
  assert.equal(metrics(f.events, { project: 'Other' }).coverage.interruptedPrompts, 0);
  assert.equal(metrics(f.events, { session: 'other' }).coverage.interruptedPrompts, 0);
  assert.equal(metrics(f.events, { models: ['Other'] }).coverage.interruptedPrompts, 0);
  assert.equal(metrics(f.events, { models: ['Model A'] }).coverage.interruptedPrompts, 1);
});

test('unlinked compaction accounting does not invalidate otherwise complete prompt costs', () => {
  const f = fixture(); f.user('a'); f.call('a', 'call', 1e9);
  const s = snapshot(f.events), ordinary = s.records[0];
  s.records.push({ ...ordinary, key: 'compaction-charge', origin: 'compaction', apiCallId: '', nanoAiu: 2e9 });
  const r = buildReport(s.records, { range: 'all' }, now, s);
  assert.equal(r.totals.credits, 3);
  assert.equal(r.promptCredits.eligiblePrompts, 1);
  assert.equal(r.promptCredits.averageCredits, 1, 'unattributed compaction is not guessed onto a prompt');
  assert.equal(r.promptCredits.unlinkedRequests, 1, 'coverage still discloses the unlinked charge');
  assert.equal(r.promptCredits.coverage.compactionCalls, 1);
  assert.equal(r.promptCredits.coverage.unexpectedCalls, 0);
});

test('prompt work counts linked calls once and only averages fully measured prompt tokens', () => {
  const f = fixture(); f.user('a'); f.call('a', 'initial', 0, { terminal: false });
  f.call('a', 'followup', 0, { turn: '1', initiator: 'agent', model: 'Model B' });
  f.user('b'); f.call('b', 'single', 1);
  const all = metrics([...f.events, ...f.events]);
  assert.deepEqual(all.work, { requests: 3, averageRequests: 1.5, maxRequests: 2, tokenPrompts: 2, tokens: 360, averageTokens: 180 });
  assert.deepEqual(metrics(f.events, { models: ['Model B'] }).work, { requests: 1, averageRequests: 1, maxRequests: 1, tokenPrompts: 1, tokens: 120, averageTokens: 120 });
  const missing = structuredClone(f.events);
  delete missing.find(e => e.data?.usage?.apiCallId === 'initial').data.usage.outputTokens;
  const partialTokens = metrics(missing);
  assert.equal(partialTokens.eligiblePrompts, 2, 'missing tokens do not alter complete credit accounting');
  assert.equal(partialTokens.work.tokenPrompts, 1);
  assert.equal(partialTokens.work.averageTokens, 120, 'partial prompt token totals are excluded');
  assert.equal(metrics([]).work.averageRequests, null);
  assert.equal(metrics([]).work.averageTokens, null);
});

test('prompt work follows existing delegated, incomplete and date-boundary eligibility', () => {
  const delegatedWork = metrics(delegated().events);
  assert.equal(delegatedWork.work.requests, 3);
  assert.equal(delegatedWork.work.averageTokens, 360);
  const f = fixture(); f.time(new Date(2026, 10, 13, 23, 59)); f.user('a'); f.call('a', 'first', 1, { terminal: false });
  f.time(new Date(2026, 10, 14, 1)); f.call('a', 'second', 2, { turn: '1', initiator: 'agent' });
  assert.equal(metrics(f.events, { range: '1d' }).work.averageRequests, null);
  assert.equal(metrics(f.events, { range: 'custom', startDate: '2026-11-13', endDate: '2026-11-13' }).work.averageRequests, 2);
  f.user('unfinished'); f.call('unfinished', 'unfinished-call', 2, { complete: false });
  assert.equal(metrics(f.events).work.requests, 2);
});

test('Usage projects count human submissions independently of model turns and complete billing', () => {
  const f = fixture(); f.user('a'); f.call('a', 'initial', 1, { terminal: false });
  f.call('a', 'continuation', 2, { turn: '1', initiator: 'agent' });
  f.user('b'); f.call('b', 'unfinished', null, { complete: false });
  f.user('auto', { isAutopilotContinuation: true }); f.call('auto', 'auto', 3, { initiator: 'agent', turn: 'auto' });
  const r = report([...f.events, ...f.events]);
  assert.equal(r.projects[0].requests, 4);
  assert.equal(r.projects[0].userPrompts, 2);
  assert.equal(r.projects[0].uncertainPrompts, 0);
  assert.equal(r.promptCredits.eligiblePrompts, 1);
  assert.equal(report(delegated().events).projects[0].userPrompts, 1, 'subagents are work for one originating prompt');
  const unknown = fixture(); unknown.user('a', { source: undefined }); unknown.call('a', 'a', 1, { initiator: 'agent' });
  assert.equal(report(unknown.events).projects[0].userPrompts, null);
  assert.equal(report(unknown.events).projects[0].uncertainPrompts, 1);
  const legacy = fixture(); legacy.call('a', 'a', 1);
  assert.equal(report(legacy.events).projects[0].userPrompts, null, 'missing prompt metadata is not a zero count');
});

test('Breakdown counts distinct human prompts through models, projects and sessions', () => {
  const a = fixture('a', 'A'); a.user('one'); a.call('one', 'a-first', 1, { terminal: false });
  a.call('one', 'a-again', 2, { turn: '1', initiator: 'agent', terminal: false });
  a.call('one', 'b-model', 3, { turn: '2', initiator: 'agent', model: 'Model B' });
  a.user('two'); a.call('two', 'missing-bill', null, { complete: false });
  a.user('auto', { isAutopilotContinuation: true }); a.call('auto', 'auto-call', 1, { initiator: 'agent', turn: 'auto' });
  const b = fixture('b', 'B'); b.user('one'); b.call('one', 'b-first', 1);
  const s = snapshot([...a.events, ...b.events, ...a.events]);
  const r = buildReport(s.records, { range: 'all' }, now, s);
  assert.equal(r.models.find(m => m.name === 'Model A').userPrompts, 3);
  assert.equal(r.models.find(m => m.name === 'Model A').requests, 5);
  assert.equal(r.models.find(m => m.name === 'Model B').userPrompts, 1, 'same human prompt counts once for each linked model');
  const input = { range: 'all', model: 'Model A', sort: 'userPrompts' };
  const projects = buildModelProjectPage(s.records, input, now, s);
  assert.deepEqual(projects.rows.map(p => [p.name, p.userPrompts]), [['A', 2], ['B', 1]]);
  const sessions = buildModelSessionPage(s.records, { ...input, project: 'A' }, now, s);
  assert.deepEqual(sessions.rows.map(p => [p.id, p.userPrompts]), [['a', 2]]);
  assert.equal(r.sessions.find(p => p.id === 'a').userPrompts, 2);
  const models = buildSessionModels(s.records, { range: 'all', project: 'A', session: 'a' }, now, s);
  assert.deepEqual(models.rows.map(m => [m.name, m.userPrompts]), [['Model A', 2], ['Model B', 1]]);
  assert.equal(report(delegated().events).models[0].userPrompts, 1, 'delegated work does not add a human submission');
});

test('Breakdown prompt counts preserve date boundaries, ambiguity and missing history', () => {
  const f = fixture(); f.time(new Date(2026, 10, 13, 23, 59)); f.user('old'); f.call('old', 'first', 1, { terminal: false });
  f.time(new Date(2026, 10, 14, 1)); f.call('old', 'later', 1, { turn: '1', initiator: 'agent' });
  const s = snapshot(f.events), input = { range: '1d', model: 'Model A', project: 'Project A' };
  assert.equal(buildReport(s.records, input, now, s).models[0].userPrompts, 0);
  assert.equal(buildModelProjectPage(s.records, input, now, s).rows[0].userPrompts, 0);
  assert.equal(buildModelSessionPage(s.records, input, now, s).rows[0].userPrompts, 0);
  assert.equal(buildSessionModels(s.records, { range: '1d', project: 'Project A', session: 's1' }, now, s).rows[0].userPrompts, 0);
  const ambiguous = fixture(); ambiguous.user('a'); ambiguous.call('a', 'same', 1); ambiguous.user('b'); ambiguous.call('b', 'same', 1);
  assert.equal(report(ambiguous.events).models[0].userPrompts, null);
  assert.equal(report(ambiguous.events).models[0].uncertainPrompts, 2);
  const legacy = fixture(); legacy.call('a', 'a', 1);
  assert.equal(report(legacy.events).models[0].userPrompts, null);
  assert.equal(report(legacy.events).sessions[0].userPrompts, null);
});

test('Usage choices retain alternatives, intersect filters, and date prompts by submission', () => {
  const a = fixture('a', 'A'); a.time(new Date(2026, 10, 13, 23, 59)); a.user('old');
  a.time(new Date(2026, 10, 14, 1)); a.call('old', 'continued', 1, { model: 'Model B' });
  a.user('new'); a.call('new', 'initial', 2); a.call('new', 'next', 3, { model: 'Model B', turn: '1', initiator: 'agent' });
  const b = fixture('b', 'B'); b.user('new'); b.call('new', 'initial', 4);
  const events = [...a.events, ...b.events];
  const selected = report(events, { range: '1d', models: ['Model A'], project: 'A' });
  assert.equal(selected.totals.requests, 1);
  assert.deepEqual(selected.usageChoices.models.map(r => r.name).sort(), ['Model A', 'Model B']);
  assert.deepEqual(selected.usageChoices.projects.map(r => r.name).sort(), ['A', 'B']);
  assert.equal(selected.projects[0].userPrompts, 1);
  assert.equal(selected.usageChoices.projects.find(r => r.name === 'B').userPrompts, 1);
  const today = report(events, { range: '1d', models: ['Model B'] });
  assert.equal(today.totals.requests, 2);
  assert.equal(today.projects[0].userPrompts, 1, 'yesterday\'s prompt is not counted again for today\'s continuation');
  assert.equal(report(events, { range: 'all', models: ['Model B'] }).projects[0].userPrompts, 2);
  assert.deepEqual(report(events, { session: 'b', project: 'B' }).usageChoices.models.map(r => r.name), ['Model A']);
  const empty = report(events, { models: ['Missing'], project: 'A' });
  assert.equal(empty.totals.requests, 0);
  assert.equal(empty.usageChoices.models.length, 2);
  assert.equal(empty.usageChoices.projects.length, 0);
});

test('explicit human counts survive ambiguous billing links but model attribution stays conservative', () => {
  const f = fixture(); f.user('a'); f.call('a', 'same-call', 1);
  f.user('b'); f.call('b', 'same-call', 1);
  assert.equal(report(f.events).projects[0].userPrompts, 2);
  assert.equal(report(f.events).promptCredits.eligiblePrompts, 0);
  const model = report(f.events, { models: ['Model A'] }).projects[0];
  assert.equal(model.userPrompts, null); assert.equal(model.uncertainPrompts, 2);
  const replay = f.events.filter(e => e.type === 'user.message').map(e => ({ ...e, id: e.id + '-replay' }));
  assert.equal(report([...f.events, ...replay]).projects[0].userPrompts, 2);
  const conflict = structuredClone(f.events.find(e => e.type === 'user.message'));
  conflict.id += '-conflict'; conflict.data.source = undefined;
  const r = report([...f.events, conflict]).projects[0];
  assert.equal(r.userPrompts, 1); assert.equal(r.uncertainPrompts, 1);
  conflict.data.source = 'agent-worker';
  const automated = report([...f.events, conflict]).projects[0];
  assert.equal(automated.userPrompts, 1); assert.equal(automated.uncertainPrompts, 1, 'conflicting automatic provenance cannot certify a human');
});

test('Usage projects show pending submissions and zero new prompts for later continuations', () => {
  const f = fixture(); f.time(new Date(2026, 10, 13, 10)); f.user('yesterday'); f.call('yesterday', 'initial', 1);
  f.time(new Date(2026, 10, 14, 1)); f.call('yesterday', 'later', 2, { turn: '1', initiator: 'agent' });
  for (const models of [undefined, ['Model A']]) {
    const today = report(f.events, { range: '1d', models });
    assert.equal(today.projects[0].userPrompts, 0);
    assert.equal(today.usageChoices.projects[0].userPrompts, 0);
    assert.equal(today.projects[0].requests, 1);
  }
  const pending = fixture('pending', 'Pending project');
  pending.time(new Date(2026, 10, 13, 10)); pending.user('old'); pending.call('old', 'old-call', 1);
  pending.time(new Date(2026, 10, 14, 1)); pending.user('waiting');
  const today = report(pending.events, { range: '1d' });
  assert.equal(today.projects.length, 0, 'Breakdown remains based on usage receipts');
  assert.equal(today.usageChoices.projects[0].userPrompts, 1);
  assert.equal(today.usageChoices.projects[0].requests, 0);
  assert.equal(report(pending.events, { range: '1d', models: ['Model A'] }).usageChoices.projects.length, 0, 'pending work has no confirmed model');
  pending.push('session.context_changed', { repository: 'New project' }); pending.user('new-project-prompt');
  const changed = report(pending.events, { range: '1d' });
  assert.equal(changed.usageChoices.projects.find(p => p.name === 'New project').userPrompts, 1);
  assert.ok(changed.options.projects.includes('New project'), 'a prompt-only project must be a valid select option so its filter button works');
});

test('prompt credits include initial and continuation calls once, using recorded nanounits', () => {
  const f = fixture(); f.user('hello', { source: undefined, parentAgentTaskId: 'telemetry' });
  f.call('hello', 'initial', 33747350, { terminal: false });
  f.call('hello', 'continuation', 34130250, { turn: '1', initiator: 'agent' });
  const r = report(f.events);
  assert.equal(r.promptCredits.eligiblePrompts, 1);
  assert.equal(r.promptCredits.prompts, 1);
  assert.equal(r.promptCredits.credits, 0.0678776);
  assert.equal(r.promptCredits.averageCredits, 0.0678776);
  assert.equal(r.totals.averageCredits, 0.0339388, 'per-request accounting stays unchanged elsewhere');
  assert.doesNotMatch(JSON.stringify(snapshot(f.events)), /PRIVATE|telemetry|content|arguments/);
});

test('multiple prompts and complete zero charges use the number of distinct originating prompts', () => {
  const f = fixture(); f.user('a'); f.call('a', 'a1', 200000000, { terminal: false }); f.call('a', 'a2', 800000000, { turn: '1', initiator: 'agent' });
  f.user('b'); f.call('b', 'b1', 3000000000);
  f.user('free'); f.call('free', 'c1', 0);
  const r = metrics(f.events);
  assert.equal(r.prompts, 3); assert.equal(r.eligiblePrompts, 3);
  assert.equal(r.credits, 4); assert.equal(r.averageCredits, 4 / 3);
  const z = fixture(); z.user('free'); z.call('free', 'free', 0);
  assert.equal(metrics(z.events).averageCredits, 0);
  assert.equal(metrics([]).averageCredits, null);
});

test('logical originating-message links retain continuations across interaction changes', () => {
  const f = fixture(); f.user('a'); f.call('a', 'initial', 1000000000, { terminal: false });
  f.call('correction', 'continuation', 3000000000, { initiator: 'agent' });
  for (const e of f.events) if (e.type === 'assistant.message') e.data.originatingMessageId = 'a-prompt';
  assert.equal(metrics(f.events).eligiblePrompts, 1);
  assert.equal(metrics(f.events).averageCredits, 4);
  const partial = structuredClone(f.events);
  partial.find(e => e.type === 'session.usage_record').data.usage.aiCreditsStatus = 'partial';
  assert.equal(metrics(partial).eligiblePrompts, 0);
  const unknown = structuredClone(f.events);
  unknown.findLast(e => e.type === 'assistant.message').data.originatingMessageId = 'missing-prompt';
  assert.equal(metrics(unknown).excluded.attribution, 1);
  f.user('b'); f.call('b', 'another', 1);
  f.events.findLast(e => e.type === 'assistant.message').data.originatingMessageId = 'a-prompt';
  assert.equal(metrics(f.events).eligiblePrompts, 0, 'contradictory origins cannot merge two user prompts into one');
});

test('unowned root interactions are not silently omitted from otherwise complete prompt costs', () => {
  const f = fixture(); f.user('a'); f.call('a', 'first', 1000000000);
  f.call('unowned', 'orphan', 3000000000, { initiator: 'agent' });
  assert.equal(metrics(f.events).eligiblePrompts, 0);
  assert.equal(metrics(f.events).excluded.attribution, 1);
  assert.equal(metrics(f.events).unlinkedRequests, 1);
  const automated = fixture(); automated.user('a'); automated.call('a', 'first', 1000000000);
  automated.user('auto', { source: 'skill-injection' }); automated.call('auto', 'auto', 3000000000, { initiator: 'agent' });
  assert.equal(metrics(automated.events).averageCredits, 1, 'explicit independent automated work is excluded intentionally');
});

test('missing or partial accounting and unfinished work exclude the whole prompt', () => {
  for (const opts of [{ status: 'partial' }, { status: 'unavailable' }, { receipt: false }, { complete: false }, { terminal: false }]) {
    const f = fixture(); f.user('a'); f.call('a', 'first', 1000000000);
    f.call('a', 'next', 2000000000, { turn: '1', initiator: 'agent', ...opts });
    const r = metrics(f.events);
    assert.equal(r.prompts, 1); assert.equal(r.eligiblePrompts, 0, JSON.stringify(opts));
    assert.equal(r.averageCredits, null);
    assert.equal(Object.values(r.excluded).reduce((a, b) => a + b, 0), 1);
  }
  const f = fixture(); f.user('a'); f.call('a', 'missing', null);
  assert.equal(metrics(f.events).excluded.accounting, 1);
});

test('replayed events, checkpoints, long call IDs, and session-scoped IDs do not duplicate prompt costs', () => {
  const f = fixture(); f.user('a'); f.call('a', 'x'.repeat(496) + '1', 1000000000);
  f.user('b'); f.call('b', 'x'.repeat(496) + '2', 2000000000);
  const copy = f.events.map(e => ({ ...e, checkpoint: true }));
  const r = metrics([...f.events, ...f.events, ...copy]);
  assert.equal(r.eligiblePrompts, 2); assert.equal(r.credits, 3);
  const second = fixture('s2'); second.user('a'); second.call('a', 'x'.repeat(496) + '1', 4000000000);
  assert.equal(metrics([...f.events, ...second.events]).eligiblePrompts, 3);
  assert.equal(metrics([...f.events, ...second.events]).credits, 7);
});

test('ambiguous call links, conflicting receipts, and shared interactions never fabricate a prompt average', () => {
  const f = fixture(); f.user('a'); f.call('a', 'same', 1000000000); f.user('b'); f.call('b', 'same', 1000000000);
  assert.equal(metrics(f.events).eligiblePrompts, 0);
  assert.equal(metrics(f.events).excluded.attribution, 2);
  const g = fixture(); g.user('a'); g.call('a', 'call', 1000000000);
  const charge = structuredClone(g.events.find(e => e.type === 'session.usage_record'));
  charge.data.usage.copilotUsage.totalNanoAiu = 2000000000; g.events.push(charge);
  assert.equal(metrics(g.events).excluded.attribution, 1);
  const h = fixture(); h.user('a'); h.user('a', { messageId: 'different-prompt' }); h.call('a', 'call', 1);
  assert.equal(metrics(h.events).prompts, 2); assert.equal(metrics(h.events).eligiblePrompts, 0);
});

test('automatic, inter-agent, and unknown-origin messages are not assumed human submissions', () => {
  for (const data of [{ source: 'agent-worker' }, { isAutopilotContinuation: true }, { source: 'skill-injection' }, { causalDependencies: ['reply'] }]) {
    const f = fixture(); f.user('a', data); f.call('a', 'call', 1000000000);
    assert.equal(metrics(f.events).prompts, 0, JSON.stringify(data));
  }
  const unknown = fixture(); unknown.user('a', { source: undefined }); unknown.call('a', 'call', 1, { initiator: 'agent' });
  assert.equal(metrics(unknown.events).excluded.attribution, 1);
});

function delegated({ complete = true, parent = 'task', childReceipt = true } = {}) {
  const f = fixture(); f.user('root'); f.call('root', 'root-initial', 1000000000, { terminal: false, tools: ['task'] });
  f.push('tool.execution_start', { toolCallId: 'task', toolName: 'task', arguments: 'PRIVATE TASK' });
  f.push('subagent.started', { toolCallId: 'task' }, { agentId: 'worker' });
  f.user('child', { source: 'agent-root', parentToolCallId: parent }, { agentId: 'worker' });
  f.call('child', 'child-call', 2000000000, { agentId: 'worker', parentToolCallId: parent, initiator: 'sub-agent', model: 'Model B', receipt: childReceipt });
  if (complete) f.push('subagent.completed', { toolCallId: 'task' }, { agentId: 'worker' });
  f.push('tool.execution_complete', { toolCallId: 'task', success: true });
  f.call('root', 'root-final', 3000000000, { turn: '1', initiator: 'agent' });
  return f;
}
test('reliably parent-linked subagent charges belong to one root prompt, including model contributions', () => {
  const f = delegated(), r = metrics(f.events);
  assert.equal(r.prompts, 1); assert.equal(r.eligiblePrompts, 1); assert.equal(r.averageCredits, 6);
  const conversations = report(f.events).efficiency.conversations;
  assert.equal(conversations.prompts, 1); assert.equal(conversations.modelCalls, 3); assert.equal(conversations.workSessions, 1);
  const unfinished = report(delegated({ complete: false }).events).efficiency.conversations;
  assert.equal(unfinished.prompts, 1); assert.equal(unfinished.workSessions, 0);
  const filtered = metrics(f.events, { models: ['Model B'], project: 'Project A', session: 's1' });
  assert.equal(filtered.averageCredits, 2); assert.equal(filtered.eligiblePrompts, 1); assert.equal(filtered.modelFiltered, true);
  assert.equal(metrics(delegated({ complete: false }).events).eligiblePrompts, 0);
  assert.equal(metrics(delegated({ parent: 'unknown' }).events).eligiblePrompts, 0);
  assert.equal(metrics(delegated({ childReceipt: false }).events, { models: ['Model A'] }).eligiblePrompts, 0, 'hidden child accounting still disqualifies the entire prompt');
});

test('every spawned agent needs its own accounting and completion evidence', () => {
  const f = delegated();
  const start = f.events.find(e => e.type === 'subagent.started');
  const end = f.events.find(e => e.type === 'subagent.completed');
  f.events.push({ ...start, id: 'second-start', agentId: 'second' }, { ...end, id: 'second-end', agentId: 'second' });
  assert.equal(metrics(f.events).eligiblePrompts, 0, 'a second empty child cannot borrow the first child\'s accounting');
  const early = delegated();
  early.events.find(e => e.type === 'subagent.completed').timestamp = early.events.find(e => e.type === 'subagent.started').timestamp;
  assert.equal(metrics(early.events).eligiblePrompts, 0, 'child completion cannot precede its linked work');
  const background = delegated();
  const launched = background.events.find(e => e.type === 'subagent.started');
  launched.data.executionMode = 'background';
  background.events.find(e => e.type === 'tool.execution_complete').timestamp = launched.timestamp;
  assert.equal(metrics(background.events).averageCredits, 6, 'a background task tool may finish before its child finishes');
});

test('filters anchor to submission, grouping all linked work before dates and models', () => {
  const f = fixture(); f.time(new Date(2026, 10, 13, 23, 59)); f.user('a'); f.call('a', 'first', 1000000000, { terminal: false });
  f.time(new Date(2026, 10, 14, 0, 1)); f.call('a', 'next', 2000000000, { turn: '1', initiator: 'agent', model: 'Model B' });
  assert.equal(metrics(f.events, { range: '1d' }).prompts, 0);
  assert.equal(metrics(f.events, { range: 'custom', startDate: '2026-11-13', endDate: '2026-11-13' }).averageCredits, 3);
  assert.equal(metrics(f.events, { models: ['Model A'] }).averageCredits, 1);
  assert.equal(metrics(f.events, { models: ['Model B'] }).averageCredits, 2);
  assert.equal(metrics(f.events, { project: 'other' }).prompts, 0);
  assert.equal(metrics(f.events, { session: 'other' }).prompts, 0);
  const later = f.events.find(e => e.type === 'session.usage_record' && e.data.usage.apiCallId === 'next');
  later.data.usage.aiCreditsStatus = 'partial';
  assert.equal(metrics(f.events, { range: 'custom', startDate: '2026-11-13', endDate: '2026-11-13', models: ['Model A'] }).eligiblePrompts, 0);
});

test('unlinked receipts conservatively exclude candidate prompts in that journal session', () => {
  const f = fixture(); f.user('a'); f.call('a', 'first', 1000000000);
  const orphan = structuredClone(f.events.find(e => e.type === 'session.usage_record'));
  orphan.id = 'orphan'; orphan.data.usage.apiCallId = 'orphan'; orphan.data.usage.accounting.usageId = 'orphan'; f.events.push(orphan);
  const r = metrics(f.events); assert.equal(r.eligiblePrompts, 0); assert.equal(r.unlinkedRequests, 1);
});

test('tool work needs completion, but a recorded tool failure does not erase a complete prompt cost', () => {
  const f = fixture(); f.user('a'); f.call('a', 'first', 33747350, { terminal: false, tools: ['skill-call'] });
  f.push('tool.execution_start', { toolCallId: 'skill-call', toolName: 'skill', arguments: { skill: 'test' } });
  const done = f.push('tool.execution_complete', { toolCallId: 'skill-call', success: false, error: { message: 'PRIVATE ERROR' } });
  f.call('a', 'next', 34130250, { turn: '1', initiator: 'agent' });
  assert.equal(metrics(f.events).averageCredits, 0.0678776);
  assert.equal(metrics(f.events.filter(e => e !== done)).excluded.unfinished, 1);
  assert.doesNotMatch(JSON.stringify(snapshot(f.events)), /PRIVATE ERROR/);
});

test('subagent links can come from the receipt or agent lifecycle, never from guessed timing', () => {
  for (const mode of ['receipt', 'agent']) {
    const f = delegated();
    for (const e of f.events) if (e.agentId === 'worker' && e.type !== 'session.usage_record') delete e.data.parentToolCallId;
    if (mode === 'receipt') for (const e of f.events) if (e.agentId === 'worker' && !e.type.startsWith('subagent.')) delete e.agentId;
    // Without an envelope agent, the root-origin tag still identifies the injected child message.
    const r = metrics(f.events);
    assert.equal(r.eligiblePrompts, 1, mode); assert.equal(r.averageCredits, 6, mode);
  }
});

test('source evidence, provider gaps, and future work do not silently certify a prompt', () => {
  const f = fixture(); f.user('a'); f.call('a', 'first', 1000000000);
  const future = fixture('s1'); future.time(new Date(2026, 10, 14, 13)); future.user('future'); future.call('future', 'future', 1);
  assert.equal(metrics([...f.events, ...future.events.slice(1)]).eligiblePrompts, 1);
  assert.equal(metrics([...f.events, ...future.events.slice(1)]).unlinkedRequests, 0);
  const mixed = fixture(); mixed.user('a'); mixed.call('a', 'first', 1000000000, { terminal: false });
  mixed.call('a', 'custom', 1, { turn: '1', initiator: 'agent' });
  mixed.events.find(e => e.type === 'session.usage_record' && e.data.usage.apiCallId === 'custom').data.usage.provider.kind = 'custom';
  assert.equal(metrics(mixed.events).eligiblePrompts, 0);
  const unknown = delegated();
  const rootUser = unknown.events.find(e => e.type === 'user.message'); delete rootUser.data.source;
  for (const e of unknown.events) if (e.type === 'session.usage_record') e.data.usage.initiator = e.agentId ? 'user' : 'agent';
  assert.equal(metrics(unknown.events).excluded.attribution, 1, 'a child call cannot certify the root as a human submission');
});

test('scanner merges copied and split journals, tails completion, and rebuilds after deletion', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-prompt-credits-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const homes = ['a', 'b'].map(n => path.join(temp, n));
  const files = homes.map(h => path.join(h, 'session-state', 's1', 'events.jsonl'));
  const f = fixture(); f.user('a'); f.call('a', 'call', 1000000000);
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  for (const file of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, lines(f.events.slice(0, -1))); }
  const scanner = createScanner();
  const scan = async () => { const s = await scanner.scan(homes); return buildReport(s.records, { range: 'all' }, now, s).promptCredits; };
  assert.equal((await scan()).eligiblePrompts, 0);
  await fs.appendFile(files[1], lines(f.events.slice(-1)));
  assert.equal((await scan()).averageCredits, 1);
  assert.equal((await scan()).eligiblePrompts, 1);
  await fs.writeFile(files[0], lines(f.events));
  assert.equal((await scan()).averageCredits, 1);
  await fs.unlink(files[1]); assert.equal((await scan()).averageCredits, 1);
  await fs.writeFile(files[0], lines(f.events.slice(0, -1)));
  assert.equal((await scan()).eligiblePrompts, 0);
});
