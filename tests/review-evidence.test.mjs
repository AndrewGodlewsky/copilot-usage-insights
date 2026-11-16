import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';
import { reviewUsageHome } from '../src/node/settings.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';
import { analyzeInsights } from '../src/node/review-insights.mjs';

test('review evidence is frozen, numeric, aliased, with valid zero credits and all topic families', async () => {
  const f = reviewFixture(); f.user('one'); f.call('one', 'a');
  f.push('skill.invoked', { name: 'PRIVATE SKILL', path: 'PRIVATE PATH', trigger: 'user-invoked' });
  f.push('tool.execution_start', { toolCallId: 't', toolName: 'PRIVATE TOOL', mcpServerName: 'PRIVATE SERVER' });
  f.push('tool.execution_complete', { toolCallId: 't', success: false });
  const scan = f.scan(), s = await prepareInsightReview(scan, { range: '7d' }, reviewNow);
  assert.doesNotMatch(s.preview, /PRIVATE|fixture|session-a/);
  assert.equal(s.payload.evidence.find(e => e.id === 'credits').value, 0);
  assert.equal(s.payload.evidence.find(e => e.id === 'cache').value, 60);
  assert.equal(s.payload.evidence.find(e => e.id === 'cache').template, 'share');
  assert.equal(s.payload.evidence.find(e => e.id === 'credits').template, 'statistic');
  assert.equal(s.payload.evidence.find(e => e.id === 'mcp-1').template, 'share');
  assert.ok(s.payload.evidence.some(e => e.topic === 'skills-instructions'));
  assert.ok(s.payload.evidence.some(e => e.topic === 'tools-mcp'));
  assert.ok(s.payload.evidence.some(e => e.topic === 'delegation'));
  assert.ok(s.payload.evidence.some(e => e.topic === 'prompts-sessions'));
  assert.equal(s.candidates.length, 1);
  scan.records[0].inputTotal = 99999;
  assert.equal(s.payload.evidence.find(e => e.id === 'input').value, 100);
  assert.ok(Buffer.byteLength(s.preview) < 48 * 1024);
});

test('review receives bounded conversation distribution and joint work evidence with limitations and no names', async () => {
  const a = reviewFixture({ sessionId: 'PRIVATE SINGLE' }); a.user('one');
  for (let n = 0; n < 6; n++) a.call('one', `call${n}`, { initiator: n ? 'agent' : 'user' });
  const b = reviewFixture({ sessionId: 'PRIVATE MULTI' });
  b.time(new Date(2026, 10, 14, 10)); b.user('first'); b.call('first', 'first');
  b.time(new Date(2026, 10, 15, 10)); b.user('second'); b.call('second', 'second');
  const scans = [a.scan(), b.scan()];
  const scan = Object.fromEntries(['records', 'promptEvents', 'interactions', 'skills', 'tools', 'sources'].map(key => [key, scans.flatMap(s => s[key] || [])]));
  const result = await prepareInsightReview(scan, { range: '7d' }, reviewNow), evidence = result.payload.evidence;
  assert.deepEqual(evidence.find(e => e.id === 'conversation-depth').values.map(v => v.value), [1, 1, 0, 0]);
  assert.equal(evidence.find(e => e.id === 'conversation-median').value, 1.5);
  assert.equal(evidence.find(e => e.id === 'session-length').value, 1.5);
  assert.equal(evidence.find(e => e.id === 'conversation-multiday').value, 50);
  assert.deepEqual(evidence.find(e => e.id === 'conversation-work-1').values.map(v => v.value), [0, 0, 1]);
  assert.match(evidence.find(e => e.id === 'conversation-work-1').limitation, /not task duration/);
  assert.doesNotMatch(result.preview, /PRIVATE|call0|"id": "one"/);
  assert.ok(Buffer.byteLength(result.preview) < 38 * 1024);
  const filtered = await prepareInsightReview(scan, { range: '7d', models: ['PRIVATE MODEL'] }, reviewNow);
  assert.ok(!filtered.payload.evidence.some(e => e.id.startsWith('conversation-') || e.id === 'session-length'));
});

test('review receives delivery coverage, session steering and separate stops with bounded optional sample labels', async () => {
  const f = reviewFixture();
  ['idle', 'steering', 'queued'].forEach((delivery, n) => { f.user(`p${n}`, { delivery }); f.call(`p${n}`, `c${n}`); });
  f.push('abort', { reason: 'user_initiated' });
  const snapshot = await prepareInsightReview(f.scan(), { range: '7d' }, reviewNow);
  const byId = new Map(snapshot.payload.evidence.map(e => [e.id, e]));
  assert.deepEqual(byId.get('conversation-delivery').values.map(v => v.value), [1, 1, 1, 0]);
  assert.equal(byId.get('conversation-delivery').samples, 3);
  assert.equal(byId.get('conversation-steering-sessions').value, 100);
  assert.equal(byId.get('conversation-steering-average').value, 1);
  assert.equal(byId.get('conversation-user-stops').value, 1);
  assert.match(byId.get('conversation-delivery').limitation, /not.*quality/i);
  assert.match(byId.get('conversation-user-stops').limitation, /not.*wasted/i);
  assert.deepEqual(snapshot.payload.candidates.map(c => c.delivery), ['idle', 'steering', 'queued']);
  assert.doesNotMatch(snapshot.preview, /PRIVATE|session-a|messageId/);
  const missing = reviewFixture(); missing.user('x'); missing.call('x', 'a');
  const unknown = await prepareInsightReview(missing.scan(), { range: '7d' }, reviewNow);
  const d = unknown.payload.evidence.find(e => e.id === 'conversation-delivery');
  assert.equal(d.samples, 0); assert.equal(d.total, 1); assert.equal(d.values[3].value, 1);
  assert.ok(!unknown.payload.evidence.some(e => e.id === 'conversation-steering-sessions'));
  const filtered = await prepareInsightReview(f.scan(), { range: '7d', models: ['PRIVATE MODEL'] }, reviewNow);
  assert.ok(!filtered.payload.evidence.some(e => e.id === 'conversation-delivery' || e.id === 'conversation-user-stops'));
});

test('conversation evidence fits the existing submission budget alongside every other topic family', async () => {
  const fixtures = Array.from({ length: 6 }, (_, n) => {
    const f = reviewFixture({ sessionId: `PRIVATE SESSION ${n}` });
    for (let p = 0; p < [1, 3, 6][n % 3]; p++) {
      f.user(`prompt-${p}`, { delivery: ['idle', 'steering', 'queued'][p % 3] });
      for (let c = 0; c < n + 1; c++) f.call(`prompt-${p}`, `${p}-${c}`, { model: `PRIVATE MODEL ${n}`, initiator: c ? 'agent' : 'user' });
    }
    f.push('skill.invoked', { name: `PRIVATE SKILL ${n}`, path: `PRIVATE PATH ${n}`, trigger: 'user-invoked' });
    f.push('tool.execution_start', { toolCallId: `tool-${n}`, toolName: 'PRIVATE TOOL', mcpServerName: `PRIVATE SERVER ${n}` });
    f.push('tool.execution_complete', { toolCallId: `tool-${n}`, success: false });
    return f.scan();
  });
  const scan = Object.fromEntries(['records', 'promptEvents', 'interactions', 'skills', 'tools', 'sources'].map(key => [key, fixtures.flatMap(s => s[key] || [])]));
  const context = { available: true, checkedAt: reviewNow.toISOString(), categories: { systemPrompt: 10, customInstructions: 20, systemTools: 30, mcpTools: 40, messages: 50 } };
  const snapshot = await prepareInsightReview(scan, { range: '90d' }, reviewNow, context);
  assert.equal(new Set(snapshot.payload.evidence.map(e => e.topic)).size, 6);
  assert.ok(Buffer.byteLength(snapshot.preview) < 38 * 1024);
  let sends = 0;
  await analyzeInsights(snapshot, { send: async (prompt, schema) => {
    sends++;
    assert.ok(Buffer.byteLength(prompt) + Buffer.byteLength(JSON.stringify(schema)) <= 47 * 1024);
    return JSON.stringify({ cards: [], emptyReason: 'Synthetic budget verification', followUp: null });
  } });
  assert.equal(sends, 1, 'new evidence does not require an extra analysis pass');
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

test('long-range trend buckets normalize unequal periods by calendar days', async () => {
  const f = reviewFixture();
  for (let n = 0; n < 90; n++) {
    f.time(new Date(2026, 10, 15 - n, 10)); f.user(`p${n}`); f.call(`p${n}`, `a${n}`);
  }
  const s = await prepareInsightReview(f.scan(), { range: '90d' }, reviewNow);
  const trend = s.payload.evidence.find(e => e.id === 'token-trend');
  assert.equal(trend.unit, 'tokens/day');
  assert.ok(trend.values.every(v => v.value === 120), 'constant daily activity must produce a flat trend');
});

test('snapshot keeps readable filter labels locally without adding them to sent evidence', async () => {
  const f = reviewFixture(); f.user('p'); f.call('p', 'a');
  const s = await prepareInsightReview(f.scan(), { range: 'all', project: 'PRIVATE PROJECT', models: ['PRIVATE MODEL'], session: 'session-a', environment: 'local' }, reviewNow);
  assert.ok(s.filterLabels.includes('Project: PRIVATE PROJECT'));
  assert.ok(s.filterLabels.includes('Models: PRIVATE MODEL'));
  assert.ok(s.filterLabels.some(label => label.startsWith('Session: ')));
  assert.doesNotMatch(s.preview, /PRIVATE|filterLabels/);
});
