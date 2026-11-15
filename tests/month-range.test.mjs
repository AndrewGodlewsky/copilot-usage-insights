import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildSessionModels } from '../src/core/copilot-report.mjs';
import { dayKey, localDay } from '../src/core/query.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';
import { buildEfficiencyReview } from '../src/panel/efficiency.mjs';
import { startServer } from '../src/node/canvas-server.mjs';

function history(dates) {
  const parser = createReceiptParser({ sessionId: 'fixture-session', source: 'fixture' });
  parser.push(JSON.stringify({ type: 'session.start', data: { sessionId: 'fixture-session', context: { repository: 'fixture-project' } } }));
  dates.forEach((date, i) => {
    const push = (type, data) => parser.push(JSON.stringify({ type, id: `${type}-${i}`, timestamp: date.toISOString(), data }));
    push('session.usage_record', { usage: { apiCallId: `call-${i}`, model: 'fixture-model', provider: { kind: 'copilot' },
      inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10, copilotUsage: { totalNanoAiu: 250000000 }, aiCreditsStatus: 'complete' } });
    push('skill.invoked', { name: 'fixture-skill', trigger: 'user-invoked' });
    push('tool.execution_start', { toolCallId: `tool-${i}`, toolName: 'read', mcpServerName: 'fixture-server' });
    push('tool.execution_complete', { toolCallId: `tool-${i}`, success: true });
  });
  return { ...parser.snapshot(), sources: [], coverage: {} };
}

test('Rolling 30 starts at local month midnight and includes today across month lengths, DST and year boundaries', () => {
  for (const [year, month, day] of [[2026, 0, 1], [2026, 0, 31], [2026, 1, 28], [2024, 1, 29], [2026, 2, 9], [2026, 10, 15], [2026, 10, 30]]) {
    const now = new Date(year, month, day, 12), first = new Date(year, month, 1);
    const scan = history([new Date(first.getTime() - 1), first, now, new Date(now.getTime() + 1)]);
    const report = buildReport(scan.records, {}, now, scan);
    assert.equal(report.query.range, 'mtd');
    assert.equal(report.daily[0].day, dayKey(localDay(first)));
    assert.equal(report.daily.at(-1).day, dayKey(localDay(now)));
    assert.equal(report.daily.length, day);
    assert.equal(report.totals.requests, 2, 'exclude prior-month and future usage');
    assert.equal(report.totals.total, 240);
    assert.equal(report.totals.credits, .5);
    assert.equal(report.skills.invocations, 2);
    assert.equal(report.mcp.calls, 2);
    const custom = buildReport(scan.records, { range: 'custom', startDate: dayKey(localDay(first)), endDate: dayKey(localDay(now)) }, now, scan);
    for (const field of ['totals', 'models', 'projects', 'sessions', 'skills', 'mcp', 'efficiency', 'promptCredits']) assert.deepEqual(report[field], custom[field], field);
    assert.equal(buildRequestPage(scan.records, { range: 'mtd', model: 'fixture-model' }, now).total, 2);
    assert.equal(buildModelSessionPage(scan.records, { range: 'mtd', model: 'fixture-model' }, now).rows[0].requests, 2);
    assert.equal(buildSessionModels(scan.records, { range: 'mtd', project: 'fixture-project', session: 'fixture-session' }, now).rows[0].requests, 2);
    assert.match(buildEfficiencyReview(report), /"range": "mtd"/);
  }
  const logs = createDiagnostics();
  logs.record('info', 'api.request', { range: 'mtd' });
  assert.equal(logs.snapshot().entries[0].range, 'mtd');
});

test('Rolling 30 resets on month rollover even when the history snapshot is cached', async t => {
  let now = new Date(2026, 11, 31, 23, 59), scans = 0;
  const scan = history([now]);
  const server = await startServer({ html: '', now: () => now, defaultHome: 'fixture',
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => { scans++; return scan; } },
  });
  t.after(() => server.close());
  const report = async known => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'usage.report', input: { range: 'mtd' }, ...(known ? { known } : {}) }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const december = await report();
  assert.equal(december.totals.requests, 1);
  assert.equal((await report(december.revision)).unchanged, true);
  now = new Date(2027, 0, 1, 0, 0);
  const january = await report(december.revision);
  assert.equal(january.unchanged, undefined);
  assert.equal(january.totals.requests, 0);
  assert.equal(january.daily.length, 1);
  assert.equal(january.daily[0].day, '2027-01-01');
  assert.equal(scans, 1, 'new month recomputes from existing history without another scan');
});
