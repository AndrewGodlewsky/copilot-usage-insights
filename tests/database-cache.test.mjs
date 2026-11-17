import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScanner } from '../src/node/copilot-source.mjs';
import { readUsageDatabase, readDesktopSessionNames } from '../src/node/copilot-db.mjs';

async function fixture(t, wal = false) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-database-cache-'));
  const file = path.join(home, 'session-store.db');
  const db = new DatabaseSync(file);
  t.after(async () => {
    db.close();
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('usage-database-cache-'));
    assert.equal((await fs.lstat(home)).isSymbolicLink(), false);
    await fs.rm(home, { recursive: true, force: true });
  });
  if (wal) db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
  db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY, summary TEXT); CREATE TABLE assistant_usage_events(id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, created_at TEXT, total_nano_aiu INTEGER)');
  db.prepare('INSERT INTO sessions VALUES (?, ?)').run('s1', 'First name');
  const insert = id => db.prepare('INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?)').run(id, 's1', 'Model', '2026-11-17T12:00:00Z', id);
  insert(1);
  let reads = 0;
  const scanner = createScanner({ readDatabase(file, receipts, source, options) { reads++; return readUsageDatabase(file, receipts, source, options); } });
  return { home, file, db, insert, scanner, reads: () => reads };
}

test('unchanged local databases are reused and force, source disabling, and row changes invalidate them', async t => {
  const f = await fixture(t);
  const first = await f.scanner.scan([f.home]);
  assert.equal(await f.scanner.scan([f.home]), first);
  assert.equal(f.reads(), 1, 'unchanged database rows must not be read and normalized again');
  f.insert(2);
  assert.equal((await f.scanner.scan([f.home])).records.length, 2);
  assert.equal(f.reads(), 2);
  f.db.exec("UPDATE sessions SET summary = 'Renamed'; DELETE FROM assistant_usage_events WHERE id = 1;");
  const changed = await f.scanner.scan([f.home]);
  assert.deepEqual(changed.records.map(r => [r.nanoAiu, r.sessionName]), [[2, 'Renamed']]);
  await f.scanner.scan([f.home], { force: true });
  assert.equal(f.reads(), 4);
  assert.equal((await f.scanner.scan([f.home], { disabled: [f.home] })).records.length, 0);
  assert.equal((await f.scanner.scan([f.home])).records.length, 1);
  assert.equal(f.reads(), 5, 'disabled source snapshots must be released');
});

test('active WAL reads bypass the cache and WAL creation and removal preserve all committed usage', async t => {
  const f = await fixture(t, true);
  const first = await f.scanner.scan([f.home]);
  assert.equal(first.records.length, 1);
  assert.equal(await f.scanner.scan([f.home]), first);
  assert.equal(f.reads(), 2, 'active WAL files are always reread');
  const before = await fs.stat(f.file);
  f.insert(2);
  const after = await fs.stat(f.file);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs, 'new usage exists only in the WAL');
  const appended = await f.scanner.scan([f.home]);
  assert.equal(appended.records.length, 2);
  assert.equal(f.reads(), 3);
  f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  assert.deepEqual((await f.scanner.scan([f.home])).records, appended.records);
  assert.equal(f.reads(), 4);
  f.db.exec('DELETE FROM assistant_usage_events WHERE id = 1');
  assert.deepEqual((await f.scanner.scan([f.home])).records.map(r => r.nanoAiu), [2]);
  f.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE');
  await assert.rejects(fs.access(f.file + '-wal'), { code: 'ENOENT' });
  const archived = await f.scanner.scan([f.home]);
  assert.equal(await f.scanner.scan([f.home]), archived);
  assert.equal(f.reads(), 6, 'the database becomes cacheable after the WAL is removed');
  f.db.exec('PRAGMA journal_mode = WAL');
  f.insert(3);
  assert.deepEqual((await f.scanner.scan([f.home])).records.map(r => r.nanoAiu), [2, 3]);
  await f.scanner.scan([f.home], { force: true });
  assert.equal(f.reads(), 8);
});

test('receipt precedence changes invalidate a database snapshot even without database writes', async t => {
  const f = await fixture(t);
  assert.equal((await f.scanner.scan([f.home])).records[0].nanoAiu, 1);
  const dir = path.join(f.home, 'session-state', 's1');
  await fs.mkdir(dir, { recursive: true });
  const journal = path.join(dir, 'events.jsonl');
  await fs.writeFile(journal, JSON.stringify({ type: 'session.usage_record', id: 'journal', timestamp: '2026-11-17T12:00:00Z', data: { usage: { provider: { kind: 'copilot' }, model: 'Model', copilotUsage: { totalNanoAiu: 100 } } } }) + '\n');
  assert.deepEqual((await f.scanner.scan([f.home])).records.map(r => r.nanoAiu), [100]);
  await fs.unlink(journal);
  assert.deepEqual((await f.scanner.scan([f.home])).records.map(r => r.nanoAiu), [1]);
  assert.equal(f.reads(), 3);
});

test('a database changed during a read is not cached under its later metadata', async t => {
  const f = await fixture(t);
  let reads = 0;
  const scanner = createScanner({ readDatabase(file, receipts, source, options) {
    reads++;
    const result = readUsageDatabase(file, receipts, source, options);
    if (reads === 1) f.insert(2);
    return result;
  } });
  assert.equal((await scanner.scan([f.home])).records.length, 1);
  assert.equal((await scanner.scan([f.home])).records.length, 2);
  assert.equal(reads, 2);
  await scanner.scan([f.home]);
  assert.equal(reads, 2);
});

test('desktop title lookups stay selective for a small subset of a large indexed table', async t => {
  const f = await fixture(t);
  const file = path.join(f.home, 'data.db'), db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT); BEGIN');
    const insert = db.prepare('INSERT INTO sessions VALUES (?, ?)');
    for (let i = 0; i < 10000; i++) insert.run(`s${i}`, `Title ${i}`);
    db.exec('COMMIT');
  } finally { db.close(); }
  const prepare = DatabaseSync.prototype.prepare, queries = [];
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) { queries.push(sql); return prepare.call(this, sql); });
  const ids = new Set(Array.from({ length: 33 }, (_, i) => `s${i}`));
  assert.deepEqual(readDesktopSessionNames(file, ids), new Map([...ids].map((id, i) => [id, `Title ${i}`])));
  assert.ok(!queries.includes('SELECT id, title FROM sessions'), '33 requested titles must not materialize every title');
  queries.length = 0;
  assert.equal(readDesktopSessionNames(file, new Set(Array.from({ length: 10000 }, (_, i) => `s${i}`))).size, 10000);
  assert.ok(queries.includes('SELECT id, title FROM sessions'), 'large requests retain the efficient whole-table path');
});
