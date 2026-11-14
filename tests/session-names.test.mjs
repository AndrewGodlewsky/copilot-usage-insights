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
  const desktop = new DatabaseSync(path.join(home, 'data.db'));
  try {
    desktop.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
    desktop.prepare('INSERT INTO sessions VALUES (?, ?)').run('s2', 'Renamed desktop-only session');
  } finally { desktop.close(); }
  result = await scan.scan([home]);
  assert.equal(result.records.find(r => r.sessionId === 's2').sessionName, 'Renamed desktop-only session');
  assert.equal(result.records.length, 2);
  assert.equal(result.coverage.fallbackRequests, 1);
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

test('desktop renames refresh without log changes and preserve usage, activity, and session IDs', async t => {
  let db;
  t.after(() => db?.close());
  const { home, metadata } = await fixture(t);
  await fs.writeFile(metadata, 'id: s1\nname: Hello test\n');
  const activity = [
    { type: 'skill.invoked', id: 'skill1', timestamp, data: { name: 'hello-test', trigger: 'user-invoked' } },
    { type: 'tool.execution_start', id: 'tool1', timestamp, data: { toolName: 'view', toolCallId: 'call1' } },
    { type: 'tool.execution_complete', id: 'tool2', timestamp, data: { toolCallId: 'call1', success: true } },
  ];
  await fs.appendFile(path.join(home, 'session-state', 's1', 'events.jsonl'), activity.map(e => JSON.stringify(e)).join('\n') + '\n');
  const scanner = createScanner();
  const before = await scanner.scan([home]);
  assert.equal(before.skills.length, 1);
  assert.equal(before.tools.length, 1);
  db = new DatabaseSync(path.join(home, 'data.db'));
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, title_source TEXT, total_input_tokens INTEGER, private_body TEXT)');
  const insert = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)');
  insert.run('s1', 'V12', 'user', 999999, 'PRIVATE BODY');
  insert.run('unrelated', 'Unrelated private title', 'user', 999999, 'PRIVATE BODY');
  let result = await scanner.scan([home]);
  assert.equal(result.records[0].sessionName, 'V12');
  const withoutNames = scan => ({ ...scan, records: scan.records.map(({ sessionName, ...record }) => record) });
  assert.deepEqual(withoutNames(result), withoutNames(before));
  assert.ok(!JSON.stringify(result).includes('PRIVATE BODY'));
  assert.ok(!JSON.stringify(result).includes('Unrelated private title'));
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run('Renamed again', 's1');
  result = await scanner.scan([home]);
  const report = buildReport(result.records, { range: 'all', session: 's1' }, now, result);
  assert.equal(report.sessions[0].name, 'Renamed again');
  assert.deepEqual(report.options.sessions, [{ id: 's1', name: 'Renamed again' }]);
  assert.equal(report.totals.total, 120);
  assert.equal(report.totals.requests, 1);
  assert.deepEqual(withoutNames(result), withoutNames(before));
  assert.equal((await scanner.scan([home], { force: true })).records[0].sessionName, 'Renamed again');
  db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');
  assert.equal((await scanner.scan([home])).records[0].sessionName, 'Hello test');
});

test('optional desktop metadata can be absent, unsupported, corrupt, or locked without hiding usage', async t => {
  let db;
  t.after(() => db?.close());
  const { home, metadata } = await fixture(t);
  await fs.writeFile(metadata, 'id: s1\nname: Workspace fallback\n');
  const file = path.join(home, 'data.db'), scanner = createScanner();
  const baseline = await scanner.scan([home]);
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  db = new DatabaseSync(file);
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, unsupported_name TEXT)');
  assert.deepEqual(await scanner.scan([home]), baseline);
  db.exec('ALTER TABLE sessions ADD COLUMN title;');
  db.prepare('INSERT INTO sessions (id, title) VALUES (?, ?)').run('s1', 'Desktop name');
  assert.equal((await scanner.scan([home])).records[0].sessionName, 'Desktop name');
  for (const invalid of [null, '', ' \n\t ', 42, Buffer.from('Not a string')]) {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(invalid, 's1');
    assert.deepEqual(await scanner.scan([home]), baseline);
  }
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run('  Clean\n\tname\0 ' + 'x'.repeat(300), 's1');
  const cleaned = (await scanner.scan([home])).records[0].sessionName;
  assert.equal(cleaned.length, 256);
  assert.ok(cleaned.startsWith('Clean name '));
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run('Recovered name', 's1');
  db.exec('BEGIN EXCLUSIVE');
  try { assert.deepEqual(await scanner.scan([home]), baseline); }
  finally { db.exec('ROLLBACK'); }
  assert.equal((await scanner.scan([home])).records[0].sessionName, 'Recovered name');
  db.close(); db = null;
  await fs.writeFile(file, 'not a SQLite database');
  assert.deepEqual(await scanner.scan([home]), baseline);
});

test('desktop titles stay with their Copilot home when copied or disabled sources share session IDs', async t => {
  const first = await fixture(t), second = await fixture(t);
  await fs.writeFile(first.metadata, 'id: s1\nname: Original name\n');
  const db = new DatabaseSync(path.join(second.home, 'data.db'));
  try {
    db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)');
    db.prepare('INSERT INTO sessions VALUES (?, ?)').run('s1', 'Backup title');
  } finally { db.close(); }
  const scanner = createScanner();
  const original = await scanner.scan([first.home, second.home]);
  assert.equal(original.records.length, 1);
  assert.equal(original.records[0].sessionName, 'Original name');
  const backup = await scanner.scan([first.home, second.home], { disabled: [await fs.realpath(first.home)] });
  assert.equal(backup.records.length, 1);
  assert.equal(backup.records[0].sessionName, 'Backup title');
  assert.equal(backup.records[0].total, original.records[0].total);
});
