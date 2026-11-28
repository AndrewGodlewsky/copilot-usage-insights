import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readUsageDatabase, readDesktopSessionNames } from '../src/node/copilot-db.mjs';
import { readDesktopSessionNamesInProcess } from '../src/node/copilot-db-process-reader.mjs';
import { createUsageDatabaseReader } from '../src/node/wsl-db.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';

async function fixture(t, rows = 1) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-db-process-'));
  const file = path.join(home, 'session-store.db'), db = new DatabaseSync(file);
  t.after(async () => {
    db.close();
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('usage-db-process-'));
    assert.equal((await fs.lstat(home)).isSymbolicLink(), false);
    await fs.rm(home, { recursive: true, force: true });
  });
  db.exec(`CREATE TABLE assistant_usage_events(id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, created_at TEXT, input_tokens INTEGER, output_tokens INTEGER, total_nano_aiu INTEGER);
    WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<${rows})
    INSERT INTO assistant_usage_events SELECT x, 'session-' || (x % 1000), 'Model', '2026-11-17T12:00:00Z', 100, 20, 100 FROM n;`);
  return { home, file, db };
}

test('the isolated database reader preserves 100000 rows while the main event loop stays responsive', { timeout: 30000 }, async t => {
  const f = await fixture(t, 100000), receipts = new Set(['session-0']);
  const expected = readUsageDatabase(f.file, receipts, f.home);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const result = await createUsageDatabaseReader()(f.file, receipts, f.home);
    assert.ok(ticks >= 5, `the main loop ran ${ticks} times during the database read`);
    assert.equal(result.records.length, 99900);
    assert.deepEqual(result, expected);
  } finally { clearInterval(timer); }
});

test('cancellation kills a locked database child and releases the next queued read', async t => {
  const f = await fixture(t), reader = createUsageDatabaseReader(), controller = new AbortController();
  f.db.exec('BEGIN EXCLUSIVE');
  const pending = reader(f.file, new Set(), f.home, { signal: controller.signal });
  let abortedAt;
  const timer = setTimeout(() => { abortedAt = performance.now(); controller.abort(new Error('Synthetic cancellation')); }, 100);
  try {
    await assert.rejects(pending, error => error === controller.signal.reason);
    assert.ok(performance.now() - abortedAt < 2500, 'native SQLite lock waiting must not keep the child alive after cancellation');
  } finally { clearTimeout(timer); f.db.exec('ROLLBACK'); }
  assert.equal((await reader(f.file, new Set(), f.home)).records.length, 1);
});

test('a database child deadline is explicit and does not return partial accounting', async t => {
  const f = await fixture(t), reader = createUsageDatabaseReader({ localTimeoutMs: 100 });
  f.db.exec('BEGIN EXCLUSIVE');
  try { await assert.rejects(reader(f.file, new Set(), f.home), error => error.code === 'ETIMEDOUT' && /Journals remain included/.test(error.message)); }
  finally { f.db.exec('ROLLBACK'); }
});

test('database child entrypoints exit after flushing success or failure even with retained host handles', async t => {
  const f = await fixture(t);
  const run = file => new Promise(resolve => {
    const child = execFile(process.execPath, ['--input-type=module', '-e', 'setInterval(() => {}, 1000); await import(process.argv[1]);', new URL('../src/node/copilot-db-process.mjs', import.meta.url).href],
      { timeout: 2000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve({ error, messages: stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }));
    child.stdin.end(JSON.stringify({ file, receiptSessions: [], source: f.home, waitForLock: true }));
  });
  const success = await run(f.file);
  assert.equal(success.error, null);
  assert.deepEqual(success.messages.at(-1), { done: true });
  const failure = await run(path.join(f.home, 'missing.db'));
  assert.equal(failure.error.code, 1);
  assert.equal(failure.error.killed, false);
  assert.ok(failure.messages.at(-1).error);
});

test('local database children run one at a time and queued cancellation does not launch more work', async () => {
  let active = 0, peak = 0, reads = 0;
  const reader = createUsageDatabaseReader({ readLocal: async () => {
    reads++; peak = Math.max(peak, ++active);
    try { await new Promise(resolve => setTimeout(resolve, 20)); return { records: [] }; }
    finally { active--; }
  } });
  const controller = new AbortController();
  const first = reader('synthetic', new Set(), 'synthetic');
  const second = reader('synthetic', new Set(), 'synthetic', { signal: controller.signal });
  const rejected = assert.rejects(second, error => error === controller.signal.reason);
  controller.abort(new Error('Synthetic cancellation'));
  await first; await rejected;
  assert.equal(reads, 1); assert.equal(peak, 1);
});

test('desktop title children preserve all 100000 names and remain cancellable while SQLite is locked', async t => {
  const f = await fixture(t);
  const file = path.join(f.home, 'data.db'), db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000) INSERT INTO sessions SELECT 'session-' || x, 'Synthetic title ' || x FROM n");
    const ids = new Set(Array.from({ length: 100000 }, (_, i) => 'session-' + (i + 1)));
    const expected = readDesktopSessionNames(file, ids);
    let ticks = 0;
    const heartbeat = setInterval(() => ticks++, 5);
    try { assert.deepEqual(await readDesktopSessionNamesInProcess(file, ids), expected); }
    finally { clearInterval(heartbeat); }
    assert.ok(ticks >= 5, 'title lookup must allow the main event loop to run');
    const small = new Set(['session-1']);
    assert.deepEqual(await readDesktopSessionNamesInProcess(file, small), new Map([['session-1', 'Synthetic title 1']]));
    db.exec('BEGIN EXCLUSIVE');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Synthetic title cancellation')), 100);
    try { await assert.rejects(readDesktopSessionNamesInProcess(file, small, { signal: controller.signal }), error => error === controller.signal.reason); }
    finally { clearTimeout(timer); db.exec('ROLLBACK'); }
    db.exec("UPDATE sessions SET title = 'Renamed' WHERE id = 'session-1'");
    assert.deepEqual(await readDesktopSessionNamesInProcess(file, small), new Map([['session-1', 'Renamed']]));
    assert.deepEqual(await readDesktopSessionNamesInProcess(path.join(f.home, 'missing.db'), small, { timeoutMs: 1 }), new Map(), 'missing title files do not launch a child');
  } finally { db.close(); }
});

test('oversized database result chunks fail visibly instead of returning incomplete totals', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE assistant_usage_events SET model = ?').run('x'.repeat(9 * 1024 * 1024));
  await assert.rejects(createUsageDatabaseReader()(f.file, new Set(), f.home), error => error.code === 'EFBIG' && /Journals remain included/.test(error.message));
});

test('one failed database source preserves its journal receipts and other readable databases', async t => {
  const bad = await fixture(t), good = await fixture(t);
  bad.db.prepare('UPDATE assistant_usage_events SET model = ?').run('x'.repeat(9 * 1024 * 1024));
  const dir = path.join(bad.home, 'session-state', 'journal');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'events.jsonl'), JSON.stringify({ type: 'session.usage_record', id: 'receipt', timestamp: '2026-11-17T12:00:00Z', data: { usage: { provider: { kind: 'copilot' }, model: 'Model', copilotUsage: { totalNanoAiu: 25 } } } }) + '\n');
  const result = await createScanner().scan([bad.home, good.home]);
  assert.deepEqual(result.records.map(r => r.nanoAiu), [25, 100]);
  assert.equal(result.sources[0].state, 'warning');
  assert.match(result.sources[0].message, /reader limit/);
  assert.equal(result.sources[1].state, 'ok');
});
