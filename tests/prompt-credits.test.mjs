import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

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
