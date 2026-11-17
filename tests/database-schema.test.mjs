import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { readUsageDatabase, readDesktopSessionNames } from '../src/node/copilot-db.mjs';
import { WSL_USAGE_EXPORT } from '../src/node/wsl-db.mjs';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-database-schema-'));
  const file = path.join(home, 'session-store.db'), db = new DatabaseSync(file);
  t.after(async () => {
    db.close();
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('usage-database-schema-'));
    assert.equal((await fs.lstat(home)).isSymbolicLink(), false);
    await fs.rm(home, { recursive: true, force: true });
  });
  return { home, file, db };
}

test('usage accounting never executes a view masquerading as the expected table', async t => {
  const { home, file, db } = await fixture(t);
  db.exec("CREATE VIEW assistant_usage_events AS SELECT 1 AS id, 's' AS session_id, 'Model' AS model, '2026-11-17T12:00:00Z' AS created_at, 100 AS total_nano_aiu");
  const result = readUsageDatabase(file, new Set(), home);
  assert.equal(result.records.length, 0);
  assert.match(result.warning, /Unsupported/);
});

test('session metadata views do not execute, while real usage tables remain available', async t => {
  const { home, file, db } = await fixture(t);
  db.exec("CREATE VIEW sessions AS SELECT 's' AS id, 'View title' AS title, 'View summary' AS summary; CREATE TABLE assistant_usage_events(id INTEGER, session_id TEXT, model TEXT, created_at TEXT, total_nano_aiu INTEGER); INSERT INTO assistant_usage_events VALUES (1, 's', 'Model', '2026-11-17T12:00:00Z', 100)");
  assert.deepEqual(readDesktopSessionNames(file, new Set(['s'])), new Map());
  const result = readUsageDatabase(file, new Set(), home);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].nanoAiu, 100);
  assert.deepEqual(result.sessionNames, []);
});

test('virtual tables cannot masquerade as ordinary usage or metadata tables', async t => {
  const { home, file, db } = await fixture(t);
  db.exec("CREATE /* schema comment */ VIRTUAL TABLE assistant_usage_events USING fts5(id, session_id, model, created_at, total_nano_aiu); INSERT INTO assistant_usage_events VALUES (1, 's', 'Model', '2026-11-17T12:00:00Z', 100); CREATE VIRTUAL TABLE sessions USING fts5(id, title, summary); INSERT INTO sessions VALUES ('s', 'Virtual title', 'Virtual summary')");
  assert.deepEqual(readDesktopSessionNames(file, new Set(['s'])), new Map());
  const result = readUsageDatabase(file, new Set(), home);
  assert.equal(result.records.length, 0);
  assert.match(result.warning, /Unsupported/);
  assert.deepEqual(result.sessionNames, []);
});

test('native SQLite export also rejects accounting and metadata views or virtual tables', async t => {
  const { file, db } = await fixture(t);
  db.exec("CREATE VIEW assistant_usage_events AS SELECT 1 AS id, 's' AS session_id, 'Model' AS model, '2026-11-17T12:00:00Z' AS created_at, 100 AS total_nano_aiu; CREATE VIEW sessions AS SELECT 's' AS id, 'View title' AS summary");
  const run = (args, input = '') => new Promise((resolve, reject) => {
    const child = execFile('python3', args, { timeout: 5000, windowsHide: true, maxBuffer: 16384 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', reject); child.stdin.end(input);
  });
  try { await run(['--version']); } catch { t.skip('Python 3 unavailable'); return; }
  const exported = JSON.parse(await run(['-I', '-S', '-B', '-c', WSL_USAGE_EXPORT, file], '[]'));
  assert.deepEqual(exported, { supported: false, sessions: [], rows: [] });
  db.exec("DROP VIEW assistant_usage_events; DROP VIEW sessions; CREATE /* schema comment */ VIRTUAL TABLE assistant_usage_events USING fts5(id, session_id, model, created_at, total_nano_aiu); CREATE VIRTUAL TABLE sessions USING fts5(id, summary)");
  assert.deepEqual(JSON.parse(await run(['-I', '-S', '-B', '-c', WSL_USAGE_EXPORT, file], '[]')), { supported: false, sessions: [], rows: [] });
});

test('malformed optional project metadata cannot hide recorded charges', async t => {
  const { home, file, db } = await fixture(t);
  db.exec("CREATE TABLE sessions(id TEXT, repository, cwd); CREATE TABLE assistant_usage_events(id INTEGER, session_id TEXT, model TEXT, created_at TEXT, total_nano_aiu INTEGER); INSERT INTO assistant_usage_events VALUES (1, 's1', 'Model', '2026-11-17T12:00:00Z', 100), (2, 's2', 'Model', '2026-11-17T12:00:00Z', 200), (3, 'invalid', 'Model', 'bad timestamp', 300)");
  const insert = db.prepare('INSERT INTO sessions VALUES (?, ?, ?)');
  insert.run('s1', Buffer.from('not a repository string'), 42);
  insert.run('s2', 27, '/synthetic/known-project');
  insert.run('invalid', 42, Buffer.from('not a path string'));
  const result = readUsageDatabase(file, new Set(), home);
  assert.deepEqual(result.records.map(r => [r.nanoAiu, r.project, r.cwd]), [[100, 'Unknown project', ''], [200, 'known-project', '/synthetic/known-project']]);
  assert.equal(result.invalid, 1);
});
