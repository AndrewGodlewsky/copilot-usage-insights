import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

const timestamp = new Date(2026, 10, 13, 10).toISOString();
const start = { type: 'session.start', data: { sessionId: 's1', context: { cwd: '/work/project', repository: 'example/project' } } };
const receipt = (over = {}, id = 'u1') => ({ id, timestamp, type: 'session.usage_record', data: { usage: {
  provider: { id: 'copilot', kind: 'copilot' }, model: 'test-model', inputTokens: 100,
  outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10, reasoningTokens: 5,
  accounting: { sourceSessionId: 's1', usageId: id, sequence: 1 },
  copilotUsage: { totalNanoAiu: 250000000 }, aiCreditsStatus: 'complete', ...over,
} } });
function parse(events) {
  const p = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  [start, ...events].forEach(e => p.push(JSON.stringify(e)));
  return p.snapshot();
}
test('Copilot receipts count inclusive input once and deduplicate replay, not checkpoints', () => {
  const result = parse([receipt(), receipt(), { type: 'session.usage_checkpoint', data: { totalNanoAiu: 250000000 } }]);
  assert.equal(result.records.length, 1);
  const r = result.records[0];
  assert.deepEqual([r.input, r.cacheRead, r.cacheWrite, r.output, r.total, r.reasoning], [30, 60, 10, 20, 120, 5]);
  assert.equal(r.nanoAiu, 250000000);
  assert.equal(r.project, 'example/project');
});
test('unknown charges remain null, partial amounts retain their status, custom providers are excluded', () => {
  const result = parse([
    receipt({ copilotUsage: undefined, aiCreditsStatus: undefined }, 'unknown'),
    receipt({ aiCreditsStatus: 'partial' }, 'partial'),
    receipt({ isByok: true }, 'byok'),
    receipt({ provider: { id: 'custom', kind: 'custom' } }, 'custom'),
    receipt({ provider: undefined, copilotUsage: undefined }, 'unclassified'),
  ]);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].nanoAiu, null);
  assert.equal(result.records[1].creditStatus, 'partial');
  assert.equal(result.excluded, 2);
  assert.equal(result.unclassified, 1);
});
test('malformed counts, missing counts and invalid timestamps are not invented', () => {
  const result = parse([receipt({ inputTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }),
    { ...receipt({}, 'bad-date'), timestamp: 'invalid' }, receipt({ inputTokens: -1 }, 'negative')]);
  assert.equal(result.records[0].total, null);
  assert.equal(result.records[0].input, null);
  assert.ok(result.invalid >= 1);
  assert.equal(result.records.find(r => r.key.includes('negative'))?.total, null);
});
test('reports sum actual credits, flag partial coverage, and respect local dates and model filters', () => {
  const records = parse([receipt(), receipt({ copilotUsage: undefined, aiCreditsStatus: undefined, model: 'second' }, 'u2')]).records;
  const now = new Date(2026, 10, 13, 12);
  const r = buildReport(records, { range: '1d' }, now);
  assert.equal(r.totals.total, 240);
  assert.equal(r.totals.credits, 0.25);
  assert.equal(r.totals.missingCredits, 1);
  assert.equal(r.totals.requests, 2);
  assert.equal(r.calendar.length, 182);
  assert.equal(r.rhythm.length, 168);
  assert.equal(buildReport(records, { range: '1d', models: ['second'] }, now).totals.credits, null);
  assert.equal(buildReport(records, { range: '1d', includeCache: false }, now).totals.total, 100);
  assert.equal(buildReport(records, { range: 'custom', startDate: '2026-11-12', endDate: '2026-11-12' }, now).totals.requests, 0);
});
test('incomplete token records use the same known subtotal across every report view', () => {
  const records = parse([receipt({ cacheReadTokens: undefined })]).records;
  const now = new Date(2026, 10, 13, 12);
  const r = buildReport(records, { range: '1d', includeCache: false }, now);
  assert.equal(r.totals.total, 20);
  assert.equal(r.totals.missingTokens, 1);
  assert.equal(r.totals.missing.input, 1);
  assert.equal(r.totals.missing.output, 0);
  assert.equal(r.daily[0].total, r.rhythm.reduce((sum, n) => sum + n, 0));
  assert.equal(r.models[0].total, 20);
  const missingOutput = buildReport(parse([receipt({ outputTokens: undefined })]).records, { range: '1d' }, now);
  assert.equal(missingOutput.totals.total, 100);
  assert.equal(missingOutput.totals.missing.output, 1);
  assert.equal(missingOutput.rhythm.reduce((sum, n) => sum + n, 0), 100);
});
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-insights-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'session-state', 's1');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  return { home, file };
}
test('scanner tails complete lines, handles truncation, deduplicates roots, and drops deleted logs', async t => {
  const { home, file } = await fixture(t);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt()));
  const scan = createScanner();
  assert.equal((await scan.scan([home, home])).records.length, 0);
  await fs.appendFile(file, '\n');
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.appendFile(file, JSON.stringify(receipt({}, 'u2')) + '\n');
  assert.equal((await scan.scan([home])).records.length, 2);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt({}, 'replacement')) + '\n');
  const replaced = await scan.scan([home], { force: true });
  assert.equal(replaced.records.length, 1);
  assert.match(replaced.records[0].key, /replacement/);
  await fs.unlink(file);
  assert.equal((await scan.scan([home])).records.length, 0);
});
test('scanner detects rewritten prefixes even when a growing log keeps the old suffix', async t => {
  const { home, file } = await fixture(t);
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  const finalMessage = { type: 'assistant.message', data: { content: 'private conversation content '.repeat(20) } };
  const scan = createScanner();
  await fs.writeFile(file, lines([start, receipt({}, 'old'), finalMessage]));
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.writeFile(file, lines([start, receipt({}, 'new'), finalMessage, receipt({}, 'add')]));
  const result = await scan.scan([home]);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.some(r => r.key.includes('new')));
  assert.ok(!result.records.some(r => r.key.includes('old')));
  assert.ok(!JSON.stringify(result).includes('private conversation content'));
});
function database(home) {
  const db = new DatabaseSync(path.join(home, 'session-store.db'));
  db.exec('CREATE TABLE sessions (id TEXT, cwd TEXT, repository TEXT); CREATE TABLE assistant_usage_events (id INTEGER, session_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_nano_aiu INTEGER, created_at TEXT)');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('s1', '/work/project', 'example/project');
  db.prepare('INSERT INTO assistant_usage_events VALUES (1, ?, ?, 100, 20, 60, 10, 250000000, ?)').run('s1', 'test-model', timestamp);
  db.close();
}
test('SQLite is fallback only; an excluded receipt never leaks back in through the fallback', async t => {
  const { home, file } = await fixture(t);
  database(home);
  const scan = createScanner();
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt()) + '\n');
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt({ isByok: true })) + '\n');
  assert.equal((await scan.scan([home], { force: true })).records.length, 0);
});
test('missing sources and unsupported SQLite schemas are visible', async t => {
  const { home } = await fixture(t);
  const db = new DatabaseSync(path.join(home, 'session-store.db')); db.exec('CREATE TABLE unrelated (id TEXT)'); db.close();
  const result = await createScanner().scan([home, path.join(home, 'missing')]);
  assert.ok(result.sources.some(s => /schema/i.test(s.message)));
  assert.ok(result.sources.some(s => s.state === 'missing'));
});
