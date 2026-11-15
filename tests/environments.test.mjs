import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, createReceiptParser } from '../src/core/copilot.mjs';
import { createPromptEventSet } from '../src/core/prompt-credits.mjs';
import { normalizeQuery } from '../src/core/query.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildSessionModels } from '../src/core/copilot-report.mjs';

const now = new Date('2026-11-15T18:00:00Z');
const record = (id, environment, tokens) => ({ ...normalizeUsage({ provider: { kind: 'copilot' }, model: 'model', inputTokens: tokens, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, copilotUsage: { totalNanoAiu: tokens * 1e7 } },
  { key: id, timestamp: '2026-11-15T12:00:00Z', sessionId: id, project: 'project' }).record, environment });

test('environment filters affect every usage aggregation and request drill-down', () => {
  const records = [record('windows-session', 'windows', 100), record('linux-session', 'wsl:ubuntu', 200)];
  const input = { range: 'all', environment: 'wsl:ubuntu' };
  const report = buildReport(records, input, now);
  assert.equal(report.totals.total, 210);
  assert.equal(report.totals.credits, 2);
  assert.equal(report.daily.reduce((n, r) => n + r.total, 0), 210);
  assert.equal(report.models[0].requests, 1);
  assert.equal(report.projects[0].requests, 1);
  assert.equal(report.sessions[0].id, 'linux-session');
  assert.deepEqual(report.options.environments.map(e => e.id).sort(), ['windows', 'wsl:ubuntu']);
  assert.equal(report.usageChoices.models[0].total, 210);
  assert.equal(buildRequestPage(records, { ...input, model: 'model' }, now).total, 1);
  assert.equal(buildModelSessionPage(records, { ...input, model: 'model' }, now).rows[0].id, 'linux-session');
  assert.equal(buildSessionModels(records, { ...input, project: 'project', session: 'windows-session' }, now).rows.length, 0);
  assert.equal(buildReport(records, { range: 'all' }, now).totals.total, 320);
  assert.equal(buildReport(records, { range: 'all', environment: 'missing' }, now).totals.requests, 0);
});

test('environment input is optional, bounded and type checked', () => {
  assert.equal(normalizeQuery({ environment: 'windows' }).environment, 'windows');
  for (const environment of [[], {}, 1, 'a'.repeat(513), 'bad\nvalue']) assert.throws(() => normalizeQuery({ environment }));
});

test('environment scopes include prompts, skills and tool failures while preserving whole-prompt accounting', () => {
  function activity(id, environment, nano) {
    const p = createReceiptParser({ sessionId: id, source: 'fixture' });
    let n = 0;
    const push = (type, data) => p.push(JSON.stringify({ type, id: `${id}-${++n}`, timestamp: new Date(Date.parse('2026-11-15T12:00:00Z') + n).toISOString(), data }));
    push('session.start', { sessionId: id, context: { repository: 'project' } });
    push('user.message', { interactionId: 'interaction', source: 'user', content: 'PRIVATE' });
    push('assistant.turn_start', { interactionId: 'interaction', turnId: 'turn' });
    const charge = (call, initiator) => push('session.usage_record', { usage: { provider: { kind: 'copilot' }, model: 'model', apiCallId: call, initiator, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, copilotUsage: { totalNanoAiu: nano / 2 } } });
    charge('initial', 'user');
    push('assistant.message', { interactionId: 'interaction', turnId: 'turn', apiCallId: 'initial', phase: 'commentary', toolRequests: [{ toolCallId: 'tool' }] });
    push('assistant.turn_end', { turnId: 'turn' });
    push('skill.invoked', { name: id, trigger: 'user-invoked', path: `/skills/${id}/SKILL.md` });
    push('tool.execution_start', { toolCallId: 'tool', toolName: 'skill', arguments: { skill: id } });
    push('tool.execution_complete', { toolCallId: 'tool', success: false });
    push('assistant.turn_start', { interactionId: 'interaction', turnId: 'final' });
    charge('continuation', 'agent');
    push('assistant.message', { interactionId: 'interaction', turnId: 'final', apiCallId: 'continuation', phase: 'final_answer', toolRequests: [] });
    push('assistant.turn_end', { turnId: 'final' });
    const snapshot = p.snapshot();
    for (const key of ['records', 'skills', 'promptEvents', 'interactions', 'tools']) for (const e of snapshot[key]) e.environment = environment;
    return snapshot;
  }
  const windows = activity('win', 'windows', 1e9), linux = activity('wsl', 'wsl:ubuntu', 2e9), all = { cache: { uniquePromptEvents: true } };
  for (const key of ['records', 'skills', 'promptEvents', 'interactions', 'tools']) all[key] = [...windows[key], ...linux[key]];
  for (const [environment, credits, name] of [['windows', 1, 'win'], ['wsl:ubuntu', 2, 'wsl'], ['windows', 1, 'win']]) {
    const r = buildReport(all.records, { range: 'all', environment }, now, all);
    assert.equal(r.promptCredits.eligiblePrompts, 1, JSON.stringify(r.promptCredits));
    assert.equal(r.promptCredits.averageCredits, credits);
    assert.equal(r.projects[0].userPrompts, 1);
    assert.equal(r.skills.rows.length, 1);
    assert.equal(r.skills.rows[0].name, name);
    assert.equal(r.skills.rows[0].failures, 1);
    assert.equal(r.tools.calls, 1);
  }
  const dedup = createPromptEventSet(), original = windows.promptEvents[0];
  dedup.add(original); dedup.add({ ...original, environment: 'wsl:ubuntu' });
  assert.equal(dedup.events.length, 1, 'a copied event remains one event regardless of source environment');
});
