import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScanner } from '../src/node/copilot-source.mjs';
import { normalizeUsage } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

const now = new Date(2026, 10, 14, 12);
const timestamp = new Date(2026, 10, 13, 10).toISOString();
const usage = { provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20 };
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-session-names-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'session-state', 's1');
  await fs.mkdir(dir, { recursive: true });
  const event = { type: 'session.usage_record', id: 'u1', timestamp, data: { usage } };
  await fs.writeFile(path.join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
  return { home, metadata: path.join(dir, 'workspace.yaml') };
}

test('workspace names refresh independently of usage logs and malformed metadata cannot hide usage', async t => {
  const { home, metadata } = await fixture(t);
  const scan = createScanner();
  await fs.writeFile(metadata, 'id: s1\nname: "First name"\nprivate: PRIVATE BODY\n');
  let result = await scan.scan([home]);
  assert.equal(result.records[0].sessionName, 'First name');
  assert.ok(!JSON.stringify(result).includes('PRIVATE BODY'));
  await fs.writeFile(metadata, 'id: s1\nname: Renamed session\n');
  assert.equal((await scan.scan([home])).records[0].sessionName, 'Renamed session');
  for (const text of ['name: [invalid', 'name: 42', 'id: other\nname: Wrong session', 'name: Too large\n#' + 'x'.repeat(65536)]) {
    await fs.writeFile(metadata, text);
    result = await scan.scan([home]);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].sessionName, '');
  }
  await fs.unlink(metadata);
  assert.equal((await scan.scan([home])).records[0].sessionName, '');
});

test('database summaries label receipt and database-only sessions without changing accounting precedence', async t => {
  let db;
  t.after(() => db?.close());
  const { home, metadata } = await fixture(t);
  db = new DatabaseSync(path.join(home, 'session-store.db'));
  db.exec('CREATE TABLE sessions (id TEXT, summary TEXT); CREATE TABLE assistant_usage_events (id INTEGER, session_id TEXT, model TEXT, created_at TEXT, total_nano_aiu INTEGER)');
  db.prepare('INSERT INTO sessions VALUES (?, ?)').run('s1', 'Stored name');
  db.prepare('INSERT INTO sessions VALUES (?, ?)').run('s2', 'Database only');
  const insert = db.prepare('INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?)');
  insert.run(1, 's1', 'model-a', timestamp, 100);
  insert.run(2, 's2', 'model-a', timestamp, 200);
  const scan = createScanner();
  let result = await scan.scan([home]);
  assert.deepEqual(result.records.map(r => [r.sessionId, r.sessionName]), [['s1', 'Stored name'], ['s2', 'Database only']]);
  assert.equal(result.records[0].total, 120);
  const databaseOnlyDir = path.join(home, 'session-state', 's2');
  await fs.mkdir(databaseOnlyDir);
  await fs.writeFile(path.join(databaseOnlyDir, 'workspace.yaml'), 'id: s2\nname: Current database-only name\n');
  assert.equal((await scan.scan([home])).records.find(r => r.sessionId === 's2').sessionName, 'Current database-only name');
  await fs.writeFile(metadata, 'id: s1\nname: Current name\n');
  assert.equal((await scan.scan([home])).records[0].sessionName, 'Current name');
  await fs.unlink(metadata);
  db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('Renamed in database', 's1');
  assert.equal((await scan.scan([home])).records[0].sessionName, 'Renamed in database');
});

test('session labels keep duplicate names separate and unnamed labels stable across date filters', () => {
  const records = [
    { id: 's1', name: 'Hello test', time: timestamp },
    { id: 's2', name: 'Hello test', time: new Date(2026, 10, 14, 10).toISOString() },
    { id: 's3', name: '', time: timestamp },
    { id: 's3', name: '', time: new Date(2026, 10, 14, 11).toISOString() },
  ].map((s, i) => ({ ...normalizeUsage(usage, { key: String(i), timestamp: s.time, sessionId: s.id, project: 'website' }).record, sessionName: s.name }));
  const report = buildReport(records, { range: 'all' }, now);
  const sessions = new Map(report.sessions.map(s => [s.id, s]));
  assert.equal(sessions.size, 3);
  assert.match(sessions.get('s1').name, /^Hello test/);
  assert.notEqual(sessions.get('s1').name, sessions.get('s2').name);
  assert.match(sessions.get('s3').name, /^website/);
  assert.equal(sessions.get('s1').total, 120);
  assert.equal(sessions.get('s3').total, 240);
  assert.equal(buildReport(records, { range: '1d' }, now).sessions.find(s => s.id === 's3').name, sessions.get('s3').name);
  const filtered = buildReport(records, { range: 'all', session: 's2' }, now);
  assert.equal(filtered.totals.requests, 1);
  assert.equal(filtered.sessions[0].id, 's2');
  assert.equal(filtered.options.sessions.find(s => s.id === 's1').name, sessions.get('s1').name);
});

test('receipt session names remain available when the database usage schema is unsupported', async t => {
  const { home } = await fixture(t);
  const db = new DatabaseSync(path.join(home, 'session-store.db'));
  db.exec('CREATE TABLE sessions (id TEXT, summary TEXT)');
  db.prepare('INSERT INTO sessions VALUES (?, ?)').run('s1', 'Available name');
  db.close();
  const result = await createScanner().scan([home]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sessionName, 'Available name');
  assert.equal(result.records[0].total, 120);
  assert.match(result.sources[0].message, /Unsupported Copilot usage database schema/);
});
