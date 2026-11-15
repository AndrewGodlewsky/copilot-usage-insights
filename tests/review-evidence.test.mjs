import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';
import { reviewUsageHome } from '../src/node/settings.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

test('review evidence is frozen, numeric, aliased, with valid zero credits and all topic families', async () => {
  const f = reviewFixture(); f.user('one'); f.call('one', 'a');
  f.push('skill.invoked', { name: 'PRIVATE SKILL', path: 'PRIVATE PATH', trigger: 'user-invoked' });
  f.push('tool.execution_start', { toolCallId: 't', toolName: 'PRIVATE TOOL', mcpServerName: 'PRIVATE SERVER' });
  f.push('tool.execution_complete', { toolCallId: 't', success: false });
  const scan = f.scan(), s = await prepareInsightReview(scan, { range: '7d' }, reviewNow);
  assert.doesNotMatch(s.preview, /PRIVATE|fixture|session-a/);
  assert.equal(s.payload.evidence.find(e => e.id === 'credits').value, 0);
  assert.equal(s.payload.evidence.find(e => e.id === 'cache').value, 60);
  assert.ok(s.payload.evidence.some(e => e.topic === 'skills-instructions'));
  assert.ok(s.payload.evidence.some(e => e.topic === 'tools-mcp'));
  assert.ok(s.payload.evidence.some(e => e.topic === 'delegation'));
  assert.ok(s.payload.evidence.some(e => e.topic === 'prompts-sessions'));
  assert.equal(s.candidates.length, 1);
  scan.records[0].inputTotal = 99999;
  assert.equal(s.payload.evidence.find(e => e.id === 'input').value, 100);
  assert.ok(Buffer.byteLength(s.preview) < 48 * 1024);
});

test('candidate selection uses originating human prompts, deduplicates calls, and respects filters', async () => {
  const f = reviewFixture(); f.time(new Date(2026, 10, 14, 23, 59)); f.user('yesterday'); f.call('yesterday', 'a');
  f.time(new Date(2026, 10, 15, 1)); f.call('yesterday', 'b', { initiator: 'agent' });
  f.user('human'); f.call('human', 'c'); f.call('human', 'd', { initiator: 'agent' });
  f.user('auto', { isAutopilotContinuation: true }); f.call('auto', 'e', { initiator: 'agent' });
  f.user('child', {}, { agentId: 'child' }); f.call('child', 'f', { initiator: 'sub-agent' });
  const today = await prepareInsightReview(f.scan(), { range: '1d' }, reviewNow);
  assert.equal(today.candidates.length, 1);
  assert.equal(today.candidates[0].promptId, 'human');
  assert.equal((await prepareInsightReview(f.scan(), { range: 'all', project: 'other' }, reviewNow)).candidates.length, 0);
  const model = await prepareInsightReview(f.scan(), { range: '1d', models: ['PRIVATE MODEL'] }, reviewNow);
  assert.ok(!model.payload.evidence.some(e => e.id === 'prompt-length'));
  assert.match(model.preview, /model filter/i);
});

test('own usage is excluded by source identity without hiding similarly named user projects', async () => {
  const own = reviewFixture({ source: reviewUsageHome(), project: 'different label' }); own.user('x'); own.call('x', 'a');
  assert.equal((await prepareInsightReview(own.scan(), { range: 'all' }, reviewNow)).payload.evidence.length, 0);
  const named = reviewFixture({ project: 'Usage Insights' }); named.user('x'); named.call('x', 'a');
  assert.ok((await prepareInsightReview(named.scan(), { range: 'all' }, reviewNow)).payload.evidence.length > 0);
});

test('missing measurements remain absent and preparations bound large data', async () => {
  const f = reviewFixture();
  for (let i = 0; i < 60; i++) { f.user(`p${i}`); f.call(`p${i}`, `a${i}`, { model: 'PRIVATE-' + i, inputTokens: undefined, copilotUsage: undefined }); }
  const s = await prepareInsightReview(f.scan(), { range: 'all' }, reviewNow);
  assert.ok(!s.payload.evidence.some(e => e.id === 'credits' || e.id === 'input'));
  assert.ok(s.candidates.length <= 24);
  assert.ok(Buffer.byteLength(s.preview) < 48 * 1024);
  assert.doesNotMatch(s.preview, /PRIVATE/);
});
