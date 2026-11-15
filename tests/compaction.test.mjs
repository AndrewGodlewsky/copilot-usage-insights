import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScanner } from '../src/node/copilot-source.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

const timestamp = '2026-11-15T12:00:00Z', now = new Date('2026-11-15T18:00:00Z');
const usage = (nano, extra = {}) => ({ provider: { kind: 'copilot' }, model: 'model-id', modelDisplayName: 'Model Name', inputTokens: 100, outputTokens: 20,
  cacheReadTokens: 60, cacheWriteTokens: 10, copilotUsage: { totalNanoAiu: nano }, aiCreditsStatus: 'complete', ...extra });
const receipt = { type: 'session.usage_record', id: 'r1', timestamp, data: { usage: usage(250000000) } };
const compaction = (id = 'c1', data = {}, u = {}) => ({ type: 'session.compaction_complete', id, timestamp,
  data: { success: true, outcome: 'applied', compactionAttemptId: id, compactionTokensUsed: usage(400000000, u), ...data } });
async function fixture(t, events, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-compaction-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'session-state', 'session');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  await fs.writeFile(file, [JSON.stringify({ type: 'session.start', data: { sessionId: 'session', context: { repository: 'project' } } }), ...events.map(e => JSON.stringify(e)), ''].join('\n'));
  const scanner = createScanner(options);
  return { home, file, scanner, scan: () => scanner.scan([home]) };
}

test('compaction charges are included once alongside receipts, including the fast parser path', async t => {
  for (const skipUnused of [false, true]) {
    const f = await fixture(t, [receipt, compaction(), compaction()], { skipUnused });
    const s = await f.scan(), report = buildReport(s.records, { range: 'all' }, now, s);
    assert.equal(report.totals.credits, .65);
    assert.equal(s.records.filter(r => r.origin === 'compaction').length, 1);
    assert.equal(report.totals.total, 240);
  }
});

test('compaction accounting preserves zero, partial and unknown amounts and discards payloads', async t => {
  const f = await fixture(t, [receipt,
    compaction('zero', {}, { copilotUsage: { totalNanoAiu: 0 }, aiCreditsStatus: undefined }),
    compaction('partial', {}, { aiCreditsStatus: 'partial' }),
    compaction('unknown', {}, { copilotUsage: undefined }),
    compaction('failed-but-billed', { success: false, outcome: 'failed', summaryContent: 'PRIVATE_SUMMARY' }),
    compaction('missing', { compactionTokensUsed: undefined }),
    compaction('custom', {}, { provider: { kind: 'custom' } }),
    compaction('byok', {}, { isByok: true }),
    compaction('legacy', { compactionTokensUsed: { input: 100, output: 20, cachedInput: 60 } }),
    { ...compaction('ephemeral'), ephemeral: true }, { ...compaction('bad-time'), timestamp: 'invalid' },
  ]);
  const s = await f.scan(), rows = s.records.filter(r => r.origin === 'compaction');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(r => [r.nanoAiu, r.creditStatus]), [[0, 'complete'], [400000000, 'partial'], [null, 'unavailable'], [400000000, 'complete']]);
  assert.deepEqual([s.coverage.excluded, s.coverage.unclassified, s.coverage.invalid], [2, 1, 1]);
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE_SUMMARY/);
  const p = createReceiptParser({ sessionId: 'session', source: 'fixture' });
  p.push(JSON.stringify(compaction()));
  assert.deepEqual(p.snapshot().receiptSessions, [], 'a compaction never disables ordinary database fallback');
});

function database(home, rows) {
  const db = new DatabaseSync(path.join(home, 'session-store.db'));
  try {
    db.exec('CREATE TABLE sessions (id TEXT, repository TEXT); CREATE TABLE assistant_usage_events (id INTEGER, session_id TEXT, model TEXT, created_at TEXT, total_nano_aiu INTEGER, initiator TEXT)');
    db.prepare('INSERT INTO sessions VALUES (?, ?)').run('session', 'project');
    const insert = db.prepare('INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?)');
    for (const [i, [nano, initiator]] of rows.entries()) insert.run(i, 'session', 'model-id', timestamp, nano, initiator);
  } finally { db.close(); }
}

test('compactions do not double-count database fallback or erase older sessions', async t => {
  for (const hasReceipt of [false, true]) {
    const f = await fixture(t, [...(hasReceipt ? [receipt] : []), compaction()]);
    database(f.home, [[250000000, 'user'], [400000000, 'compaction']]);
    const s = await f.scan();
    assert.equal(s.records.reduce((sum, r) => sum + r.nanoAiu, 0), 650000000);
    assert.equal(s.records.length, 2);
    assert.equal(s.coverage.fallbackRequests, hasReceipt ? 0 : 2);
    assert.equal(s.records.filter(r => r.origin === 'compaction').length, hasReceipt ? 1 : 0);
    assert.equal(await f.scan(), s, 'unchanged accounting reuses the snapshot');
  }
  const f = await fixture(t, [compaction()]);
  assert.equal((await f.scan()).records[0].nanoAiu, 400000000, 'an absent database does not discard an explicit charge');
  await fs.writeFile(path.join(f.home, 'session-store.db'), 'not a database');
  const s = await f.scan();
  assert.equal(s.records[0].nanoAiu, 400000000, 'an unreadable database does not discard the journal charge');
  assert.equal(s.sources[0].state, 'warning');
  assert.equal(s.sources[0].diagnostic.sqliteCode, 26, 'SQLite NOTADB code survives without the error message');
});

test('copied and split compaction histories reconcile across refresh, tails, replacement and deletion', async t => {
  const f = await fixture(t, [receipt]);
  const copy = path.join(f.home, 'copy'), dir = path.join(copy, 'session-state', 'session'), copyFile = path.join(dir, 'events.jsonl');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(copyFile, JSON.stringify(compaction()) + '\n');
  const scan = () => f.scanner.scan([f.home, copy]);
  assert.equal((await scan()).records.length, 2, 'receipts and compactions may be in different copies');
  await fs.appendFile(f.file, JSON.stringify(compaction()) + '\n');
  assert.equal((await scan()).records.length, 2);
  const renamedEnvelope = { ...compaction(), id: 'another-envelope' };
  await fs.appendFile(f.file, JSON.stringify(renamedEnvelope) + '\n' + JSON.stringify(compaction('c2')) + '\n');
  assert.equal((await scan()).records.length, 3, 'stable attempt IDs deduplicate re-logged envelopes');
  await fs.writeFile(f.file, JSON.stringify(receipt) + '\n');
  assert.equal((await scan()).records.length, 2);
  await fs.unlink(copyFile);
  assert.equal((await scan()).records.length, 1);
});

test('compaction records follow the existing date, model, project, session and environment filters', async t => {
  const f = await fixture(t, [receipt, compaction()]), s = await f.scan();
  const c = s.records.find(r => r.origin === 'compaction');
  Object.assign(c, { environment: 'wsl:test', project: 'remote', sessionId: 'remote-session' });
  for (const input of [{ models: ['Model Name'], environment: 'wsl:test' }, { project: 'remote' }, { session: 'remote-session' }, { startDate: '2026-11-15', endDate: '2026-11-15', range: 'custom', environment: 'wsl:test' }]) {
    const r = buildReport(s.records, { range: 'all', ...input }, now, s);
    assert.equal(r.totals.credits, .4);
  }
  assert.equal(buildReport(s.records, { range: 'custom', startDate: '2026-11-14', endDate: '2026-11-14' }, now, s).totals.requests, 0);
});
