import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEfficiencyReview, toolOutcomeSummary } from '../src/panel/efficiency.mjs';

test('AI review exports bounded, aliased measurements with scope and no identifying payloads', () => {
  const report = { generatedAt: '2026-11-14T12:00:00Z', query: { range: '7d' },
    efficiency: { summary: { requests: 12, toolRequests: 10, toolShare: 20, private: 'SECRET' },
      models: Array.from({ length: 100 }, (_, i) => ({ name: 'SECRET-' + i, requests: 1, averageInput: 500, path: 'SECRET' })),
      insights: [{ kind: 'tools', model: 'SECRET-0', share: 20, samples: 10, sessionName: 'SECRET', project: 'SECRET' }] },
    mcp: { rows: [{ name: 'SECRET-server', calls: 3, failures: 2, successes: 1, unknown: 0, error: 'SECRET' }] },
    skills: { invocations: 2, rows: [{ name: 'SECRET' }] }, sources: ['SECRET'] };
  const context = { available: true, checkedAt: report.generatedAt, totalTokens: 1000, categories: { messages: 800, secret: 'SECRET' }, entries: [{ label: 'SECRET' }] };
  report.efficiency.interactions = { prompts: 5, averagePromptChars: 500, content: 'SECRET', sessionId: 'SECRET' };
  report.efficiency.conversations = { sessions: 4, countedSessions: 3, medianPrompts: 2, distribution: [{ label: 'SECRET', count: 3 }],
    dayDistribution: [{ label: 'SECRET', count: 1 }], promptWork: { prompts: 5, totalPrompts: 6, medianCalls: 2, distribution: [{ label: 'SECRET', count: 5 }] },
    examples: [{ sessionId: 'SECRET', events: [{ ms: 123456789, delivery: 'SECRET' }] }], comparison: { private: 'SECRET' },
    delivery: { idle: 3, steering: 2, unknown: 1 }, steering: { topMessages: 2, sessions: 1 } };
  report.tools = { rows: [{ name: 'SECRET', calls: 5, successes: 3, failures: 1, unknown: 1, arguments: 'SECRET' }] };
  const result = buildEfficiencyReview(report, context, { models: ['SECRET-0'], project: 'SECRET', session: 'SECRET' });
  assert.doesNotMatch(result, /SECRET|sessionName|"path"/);
  assert.match(result, /Model 1|Server 1/);
  const data = JSON.parse(result.slice(result.indexOf('{')));
  assert.equal(data.history.models.length, 20);
  assert.equal(data.history.modelsOmitted, 80);
  assert.equal(data.scope.projectFiltered, true);
  assert.equal(data.history.summary.toolShare, 20);
  assert.equal(data.currentContext.totalTokens, 1000);
  assert.equal(data.history.interactions.averagePromptChars, 500);
  assert.equal(data.history.tools[0].successRate, 75);
  assert.equal(data.history.conversations.medianPrompts, 2);
  assert.equal(data.history.conversations.promptWork.medianCalls, 2);
  assert.doesNotMatch(result, /"examples"|"events"|123456789/);
  report.efficiency.summary.requests = 100;
  assert.equal(data.history.summary.requests, 12, 'export is a frozen snapshot');
  assert.ok(Buffer.byteLength(result) < 48 * 1024);
});

test('tool outcome summaries distinguish unknown results and preserve zero success rates', () => {
  const rows = toolOutcomeSummary({ rows: [{ calls: 2, successes: 0, failures: 0, unknown: 2 },
    { server: 'private-server', calls: 1, successes: 0, failures: 1, unknown: 0 }] });
  assert.equal(rows[0].successRate, null);
  assert.equal(rows[1].successRate, 0);
  assert.doesNotMatch(JSON.stringify(rows), /private-server/);
});
