import test from 'node:test';
import assert from 'node:assert/strict';
import { createEfficiencyAccumulator } from '../src/core/efficiency.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

const now = new Date(2026, 10, 14, 12);
const record = (i, extra = {}) => ({ key: `r${i}`, sessionId: 's1', sessionName: 'Work', project: 'Project', model: 'Model A', initiator: 'user',
  ms: now.getTime() - (100 - i) * 1000, ts: new Date(now.getTime() - (100 - i) * 1000).toISOString(),
  inputTotal: 10000, input: 7000, cacheRead: 2000, cacheWrite: 1000, output: 100, reasoning: 20,
  nanoAiu: 1000000000, creditStatus: 'complete', ...extra });
function analyze(records) {
  const analysis = createEfficiencyAccumulator();
  for (const r of records) analysis.add(r);
  return analysis.finish(new Map([['s1', 'Work']]));
}

test('efficiency denominators match known measurements and exclude partial charges without losing zeros', () => {
  const { summary } = analyze([
    record(0, { inputTotal: 100, cacheRead: 50, cacheWrite: 0, nanoAiu: 0 }),
    record(1, { inputTotal: 900, cacheRead: 0, cacheWrite: 900, output: null, nanoAiu: null, creditStatus: 'unavailable' }),
    record(2, { inputTotal: null, cacheRead: null, cacheWrite: null, output: 200, nanoAiu: 5000000000, creditStatus: 'partial' }),
    record(3, { inputTotal: 2000, cacheRead: null, cacheWrite: null, output: null, nanoAiu: 2000000000 }),
  ]);
  assert.equal(summary.requests, 4);
  assert.equal(summary.averageInput, 1000);
  assert.equal(summary.averageOutput, 150);
  assert.equal(summary.cacheHitRate, 5, 'weighted cache percentage uses only paired cache/input values');
  assert.equal(summary.cacheInput, 1000);
  assert.equal(summary.cacheRequests, 2);
  assert.equal(summary.creditRequests, 2);
  assert.equal(summary.credits, 2);
  assert.equal(summary.averageCredits, 1);
  assert.equal(analyze([record(0, { inputTotal: 0, cacheRead: 0, cacheWrite: 0 })]).summary.cacheHitRate, null);
  assert.equal(analyze([]).summary.averageCredits, null);
  assert.equal(analyze([]).summary.averageInput, null);
  assert.deepEqual(analyze([]).insights, []);
  assert.doesNotThrow(() => JSON.stringify(analyze([record(0)])), 'internal BigInts do not leak to JSON');
});

test('growth direction uses chronological first/last medians and separates model, project, session, and initiator', () => {
  const records = Array.from({ length: 6 }, (_, i) => record(i, { inputTotal: i < 3 ? 10000 : 30000 }));
  const growth = analyze([...records].reverse()).insights.find(i => i.kind === 'growth');
  assert.deepEqual([growth.early, growth.late, growth.multiple, growth.samples], [10000, 30000, 3, 6]);
  assert.equal(growth.sessionName, 'Work');
  for (const [key, value] of [['model', 'Model B'], ['project', 'Other project'], ['sessionId', 's2'], ['initiator', 'agent']]) {
    const split = records.map((r, i) => i < 3 ? r : { ...r, [key]: value });
    assert.equal(analyze(split).insights.some(i => i.kind === 'growth'), false, key);
  }
  assert.equal(analyze(records.map(r => ({ ...r, initiator: 'sub-agent' }))).insights.some(i => i.kind === 'growth'), false);
  assert.equal(analyze(records.map(r => ({ ...r, initiator: '' }))).insights.some(i => i.kind === 'growth'), false);
  assert.equal(analyze(records.map(r => ({ ...r, ms: now.getTime() }))).insights.some(i => i.kind === 'growth'), false, 'ambiguous timestamps do not establish growth');
  assert.equal(analyze([...records, record(6, { inputTotal: null }), record(7, { inputTotal: null })]).insights.some(i => i.kind === 'growth'), false, 'insufficient coverage');
  assert.equal(analyze(records.slice(0, 5)).insights.some(i => i.kind === 'growth'), false);
  assert.equal(analyze(records.map((r, i) => ({ ...r, inputTotal: i < 3 ? 1000 : 5000 }))).insights.some(i => i.kind === 'growth'), false, 'small absolute growth is not flagged');
});

test('cache and credit directions require enough coverage and retain bounded evidence only', () => {
  const records = Array.from({ length: 10 }, (_, i) => record(i, { model: i < 5 ? 'Model A' : 'Model B', nanoAiu: i < 5 ? 3000000000 : 1000000000, privatePrompt: 'DO_NOT_EXPORT' }));
  const result = analyze(records);
  assert.equal(result.insights.find(i => i.kind === 'cache').model, 'Model A');
  assert.equal(result.insights.find(i => i.kind === 'spend').share, 75);
  assert.equal(result.insights.find(i => i.kind === 'spend').credits, 15);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPORT|privatePrompt|"first"|"last"/);
  assert.equal(analyze(records.map(r => ({ ...r, cacheRead: 8000 }))).insights.some(i => i.kind === 'cache'), false);
  assert.equal(analyze(records.slice(0, 4)).insights.length, 0, 'small samples are not interpreted');
  assert.equal(analyze(records.map((r, i) => i % 5 < 2 ? { ...r, cacheRead: null, creditStatus: 'partial' } : r)).insights.length, 0);
  assert.equal(analyze(records.map(r => ({ ...r, nanoAiu: 0 }))).insights.some(i => i.kind === 'spend'), false, 'zero spend has no concentration ratio');
});

test('efficiency follows report date/model/project/session scope and is unchanged by cache display preference', () => {
  const records = [record(1), record(2, { project: 'Other', model: 'Model B', sessionId: 's2' }),
    record(3, { ms: now.getTime() - 86400000, sessionId: 'old' }), record(4, { ms: now.getTime() + 86400000 })];
  for (const input of [{ range: '1d' }, { range: '7d', models: ['Model A'] }, { range: '7d', project: 'Other' }, { range: '7d', session: 's1' },
    { range: 'custom', startDate: '2026-11-13', endDate: '2026-11-13' }]) {
    const report = buildReport(records, input, now);
    assert.equal(report.efficiency.summary.requests, report.totals.requests);
    assert.deepEqual(report.efficiency.models.map(r => r.name).sort(), report.models.map(r => r.name).sort());
    assert.deepEqual(buildReport(records, { ...input, includeCache: false }, now).efficiency, report.efficiency);
  }
  assert.equal(buildReport(records, { range: '1d' }, now).efficiency.summary.requests, 2);
  assert.equal(buildReport(records, { range: '7d', session: 'old' }, now).efficiency.summary.requests, 1);
});
