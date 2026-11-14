import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const now = new Date(2026, 10, 14, 12);
const timestamp = now.toISOString();
function fixture() {
  const parser = createReceiptParser({ sessionId: 's', source: 'fixture' });
  const push = (type, id, data, extra = {}) => parser.push(JSON.stringify({ type, id, timestamp, data, ...extra }));
  push('session.start', 'start', { context: { repository: 'Project' } });
  push('session.usage_record', 'usage', { usage: { provider: { kind: 'copilot' }, model: 'Model A', inputTokens: 100, outputTokens: 10 } });
  return { parser, push };
}

test('interaction metadata excludes injected/subagent messages, deduplicates and discards text', () => {
  const { parser, push } = fixture();
  push('user.message', 'u1', { content: 'PRIVATE prompt', messageId: 'm1' });
  push('user.message', 'u2', { content: 'PRIVATE prompt', messageId: 'm1' });
  push('user.message', 'u3', { content: 'PRIVATE injection', source: 'skill-test' });
  push('user.message', 'u4', { content: 'PRIVATE autopilot', isAutopilotContinuation: true });
  push('user.message', 'u5', { content: 'PRIVATE agent' }, { agentId: 'agent' });
  push('user.message', 'u6', { content: 'PRIVATE checkpoint' }, { checkpoint: true });
  push('user.message', 'u7', { content: 'PRIVATE parent', parentAgentTaskId: 'agent' });
  push('assistant.turn_start', 't1', { turnId: '1' });
  push('assistant.turn_start', 't2', { turnId: '1' });
  push('assistant.turn_start', 't3', { turnId: '2', parentToolCallId: 'child' });
  push('session.error', 'e1', { message: 'PRIVATE error', stack: 'SECRET' });
  const snapshot = parser.snapshot();
  assert.equal(snapshot.interactions.length, 4);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|SECRET|content|stack|messageId/);
  const result = buildReport(snapshot.records, { range: '1d' }, now, snapshot).efficiency.interactions;
  assert.equal(result.prompts, 2);
  assert.equal(result.averagePromptChars, 14);
  assert.equal(result.averagePromptsPerSession, 2);
  assert.equal(result.turns, 1);
  assert.equal(result.sessionErrors, 1);
});

test('scanner tails interaction metadata, deduplicates copied journals and drops deleted history', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-interactions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homes = ['a', 'b'].map(name => path.join(root, name));
  const files = homes.map(home => path.join(home, 'session-state', 's', 'events.jsonl'));
  const line = (type, id, data) => JSON.stringify({ type, id, data, timestamp }) + '\n';
  const initial = line('session.usage_record', 'usage', { usage: { provider: { kind: 'copilot' }, model: 'Model A', inputTokens: 10, outputTokens: 1 } })
    + line('user.message', 'u1', { content: 'PRIVATE', parentAgentTaskId: 'background-telemetry' });
  for (const file of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, initial); }
  const scanner = createScanner();
  const scan = () => scanner.scan(homes);
  let snapshot = await scan();
  assert.equal(snapshot.interactions.length, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|background-telemetry/);
  await fs.appendFile(files[1], line('user.message', 'u2', { content: '1234' }));
  snapshot = await scan();
  assert.equal(buildReport(snapshot.records, {}, now, snapshot).efficiency.interactions.averagePromptsPerSession, 2);
  await fs.unlink(files[1]);
  assert.equal((await scan()).interactions.length, 1);
  await fs.writeFile(files[0], initial.split('\n')[0] + '\n');
  assert.equal((await scan()).interactions.length, 0);
});

test('interaction averages use observed sessions and date/project scope with honest model and provider gaps', () => {
  const { parser, push } = fixture();
  push('user.message', 'u1', { content: '1234' });
  push('user.message', 'u2', { content: '12345678' });
  push('assistant.turn_start', 't1', { turnId: '1' });
  push('assistant.turn_start', 't2', { turnId: '2' });
  const snapshot = parser.snapshot();
  const report = input => buildReport(snapshot.records, input, now, snapshot).efficiency.interactions;
  assert.equal(report({}).averagePromptChars, 6);
  assert.equal(report({}).averagePromptsPerSession, 2);
  assert.equal(report({}).averageTurnsPerSession, 2);
  assert.equal(report({ models: ['Model A'] }).reason, 'model-filter');
  assert.equal(report({ models: ['Model A'] }).averagePromptChars, null);
  assert.equal(report({ models: [] }).reason, 'model-filter');
  assert.equal(report({ project: 'Other' }).averagePromptChars, null);
  assert.equal(report({ range: 'custom', startDate: '2026-11-13', endDate: '2026-11-13' }).prompts, 0);
  assert.equal(buildReport(snapshot.records, {}, now, { ...snapshot, skillExcludedSessions: ['s'] }).efficiency.interactions.prompts, 0);
  assert.equal(buildReport(snapshot.records, {}, now).efficiency.interactions.averagePromptsPerSession, null);
});

test('future usage receipts cannot establish attribution for recorded interaction metadata', () => {
  const { parser, push } = fixture();
  push('user.message', 'u1', { content: '1234' });
  const snapshot = parser.snapshot();
  const futureRecords = snapshot.records.map(record => ({ ...record, ms: now.getTime() + 86400000 }));
  const report = buildReport(futureRecords, { range: '1d' }, now, snapshot);
  assert.equal(report.totals.requests, 0);
  assert.equal(report.efficiency.interactions.prompts, 0);
  assert.equal(report.efficiency.interactions.omitted, 1);
});
