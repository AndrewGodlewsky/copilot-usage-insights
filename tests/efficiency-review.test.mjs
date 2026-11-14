import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEfficiencyReview } from '../src/panel/efficiency.mjs';

test('AI review exports bounded, aliased measurements with scope and no identifying payloads', () => {
  const report = { generatedAt: '2026-11-14T12:00:00Z', query: { range: '7d' },
    efficiency: { summary: { requests: 12, toolRequests: 10, toolShare: 20, private: 'SECRET' },
      models: Array.from({ length: 100 }, (_, i) => ({ name: 'SECRET-' + i, requests: 1, averageInput: 500, path: 'SECRET' })),
      insights: [{ kind: 'tools', model: 'SECRET-0', share: 20, samples: 10, sessionName: 'SECRET', project: 'SECRET' }] },
    mcp: { rows: [{ name: 'SECRET-server', calls: 3, failures: 2, successes: 1, unknown: 0, error: 'SECRET' }] },
    skills: { invocations: 2, rows: [{ name: 'SECRET' }] }, sources: ['SECRET'] };
  const context = { available: true, checkedAt: report.generatedAt, totalTokens: 1000, categories: { messages: 800, secret: 'SECRET' }, entries: [{ label: 'SECRET' }] };
  const result = buildEfficiencyReview(report, context, { models: ['SECRET-0'], project: 'SECRET', session: 'SECRET' });
  assert.doesNotMatch(result, /SECRET|sessionName|"path"/);
  assert.match(result, /Model 1|Server 1/);
  const data = JSON.parse(result.slice(result.indexOf('{')));
  assert.equal(data.history.models.length, 20);
  assert.equal(data.history.modelsOmitted, 80);
  assert.equal(data.scope.projectFiltered, true);
  assert.equal(data.history.summary.toolShare, 20);
  assert.equal(data.currentContext.totalTokens, 1000);
  report.efficiency.summary.requests = 100;
  assert.equal(data.history.summary.requests, 12, 'export is a frozen snapshot');
  assert.ok(result.length < 16000);
});
