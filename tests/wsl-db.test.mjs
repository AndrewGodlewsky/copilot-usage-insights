import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createUsageDatabaseReader, wslDatabaseLocation, WSL_USAGE_EXPORT } from '../src/node/wsl-db.mjs';
import { readUsageDatabase, normalizeDatabaseRows } from '../src/node/copilot-db.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { diagnosticError } from '../src/core/diagnostics.mjs';

const file = String.raw`\\wsl.localhost\Ubuntu\home\example\.copilot\session-store.db`;
const locked = () => Object.assign(new Error('PRIVATE database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
const row = { id: 1, session_id: 'old', model: 'model', created_at: '2026-11-01T12:00:00Z', input_tokens: 20, output_tokens: 5, cache_read_tokens: 10, cache_write_tokens: 0, total_nano_aiu: 1000000000 };
test('WSL probes do not wait on Windows SQLite locks before the native fallback', async () => {
  const waits = [];
  const read = createUsageDatabaseReader({ platform: 'win32', readLocal: (file, sessions, source, options) => {
    waits.push(options?.waitForLock);
    return { records: [] };
  } });
  await read(file, new Set(), 'source');
  await read('C:\\local\\session-store.db', new Set(), 'source');
  assert.deepEqual(waits, [false, true]);
});

test('database reads overlap in pairs and still reconcile copied rows in source order', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-db-parallel-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('usage-db-parallel-'));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const homes = [];
  for (let i = 0; i < 4; i++) {
    const home = path.join(temp, String(i)); homes.push(home);
    await fs.mkdir(home);
    await fs.writeFile(path.join(home, 'session-store.db'), '');
  }
  let active = 0, peak = 0;
  const scanner = createScanner({ readDatabase: async (file, receipts, source) => {
    peak = Math.max(peak, ++active);
    try {
      await new Promise(resolve => setTimeout(resolve, source === homes[0] ? 60 : 20));
      if (source === homes[2]) throw Object.assign(new Error('synthetic database failure'), { code: 'EIO' });
      return normalizeDatabaseRows([row], new Map([['old', { repository: source === homes[0] ? 'first' : 'copy' }]]), receipts, source, true);
    } finally { active--; }
  } });
  const first = await scanner.scan(homes);
  assert.equal(peak, 2, 'do not serialize WSL processes or start an unbounded number');
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0].project, 'first', 'completion order must not change duplicate ownership');
  assert.equal(first.records[0].nanoAiu, 1e9);
  assert.equal(first.sources[2].diagnostic.errorCode, 'EIO');
  assert.equal(await scanner.scan(homes), first, 'unchanged records and warnings keep cached reports valid');
});

test('locked WSL database usage is recovered without copying a database or counting receipt sessions twice', async () => {
  const calls = [];
  const read = createUsageDatabaseReader({ platform: 'win32', readLocal: () => { throw locked(); }, run: async (exe, args, options, input) => {
    calls.push({ exe, args, options, input });
    if (args.includes('--list')) return Buffer.from('Ubuntu\r\n', 'utf16le');
    return JSON.stringify({ rows: [row, { ...row, id: 2, session_id: 'journal' }], sessions: [{ id: 'old', repository: 'project', summary: 'Saved title' }], supported: true });
  } });
  const result = await read(file, new Set(['journal']), 'source');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].nanoAiu, 1e9);
  assert.equal(result.databaseRead, 'wsl');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.shell, false);
  assert.equal(calls[1].options.windowsHide, true);
  assert.ok(calls[1].args.includes('/usr/bin/python3'));
  assert.equal(calls[1].args.at(-1), '/home/example/.copilot/session-store.db');
  assert.deepEqual(JSON.parse(calls[1].input), ['journal']);
  assert.ok(calls[1].options.timeout > 0 && calls[1].options.maxBuffer > 0);
});

test('native WSL fallback is restricted to locked WSL database paths and can be disabled', async () => {
  assert.deepEqual(wslDatabaseLocation(file.replace('wsl.localhost', 'wsl$')), { distribution: 'Ubuntu', file: '/home/example/.copilot/session-store.db' });
  for (const bad of [String.raw`C:\data\session-store.db`, String.raw`\\server\share\session-store.db`, file.replace('session-store.db', 'other.db'),
    file.replace('.copilot', '..'), file.replace('Ubuntu', 'Ubuntu\n--user root'), file + '\u0000']) assert.equal(wslDatabaseLocation(bad), null);
  let calls = 0;
  const run = async () => { calls++; throw new Error('must not launch'); };
  const ok = { records: [] };
  assert.equal(await createUsageDatabaseReader({ readLocal: () => ok, run })(file, new Set(), 'source'), ok);
  for (const options of [{ platform: 'linux' }, { platform: 'win32' }]) {
    const read = createUsageDatabaseReader({ ...options, readLocal: () => { throw locked(); }, run });
    await assert.rejects(read('C:\\local\\session-store.db', new Set(), 'source'));
    await assert.rejects(read(file, new Set(), 'source', { readWslDatabases: false }));
  }
  for (const error of [Object.assign(new Error('corrupt'), { code: 'ERR_SQLITE_ERROR', errcode: 26 }), Object.assign(new Error('access'), { code: 'EACCES' }), new Error('busy in unrelated code')]) {
    await assert.rejects(createUsageDatabaseReader({ platform: 'win32', readLocal: () => { throw error; }, run })(file, new Set(), 'source'), e => e === error);
  }
  assert.equal(calls, 0);
});

test('stopped distributions, missing runtimes, bad output and timeouts remain bounded sanitized warnings', async () => {
  for (const scenario of ['stopped', 'missing', 'timeout', 'invalid', 'shape', 'sqlite']) {
    let calls = 0;
    const read = createUsageDatabaseReader({ platform: 'win32', readLocal: () => { throw locked(); }, run: async (exe, args, options) => {
      calls++;
      assert.equal(options.shell, false);
      assert.equal(options.env.WSLENV, undefined, 'do not propagate host credentials through WSLENV');
      if (args.includes('--list')) return scenario === 'stopped' ? 'Another distro' : 'Ubuntu';
      if (scenario === 'missing' || scenario === 'timeout') throw Object.assign(new Error('PRIVATE stderr and command'), { killed: scenario === 'timeout' });
      if (scenario === 'invalid') return 'PRIVATE not JSON';
      if (scenario === 'shape') return JSON.stringify({ supported: true, rows: [null], sessions: [] });
      return JSON.stringify({ error: true, sqliteCode: 5 });
    } });
    await assert.rejects(read(file, new Set(), 'source'), error => {
      assert.doesNotMatch(error.message + JSON.stringify(diagnosticError(error)), /PRIVATE|Ubuntu|example/);
      if (scenario === 'timeout') assert.equal(error.code, 'ETIMEDOUT');
      if (scenario === 'sqlite') assert.equal(diagnosticError(error).sqliteCode, 5);
      return true;
    });
    assert.equal(calls, scenario === 'stopped' ? 1 : 2);
  }
});

const python = (args, input = '') => new Promise((resolve, reject) => {
  const child = execFile('python3', args, { timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin.on('error', reject); child.stdin.end(input);
});

test('Linux export stops a deliberate stall independently of the Windows launcher timeout', async t => {
  let alarms;
  try { alarms = await python(['-c', 'import signal; print(hasattr(signal, "alarm"))']); }
  catch { t.skip('Python 3 unavailable'); return; }
  if (alarms.trim() !== 'True') { t.skip('Requires a POSIX Python runtime to verify SIGALRM'); return; }
  // Stall before the first filesystem read, using the production alarm setup.
  const script = WSL_USAGE_EXPORT.replace('signal.alarm(4)', 'signal.alarm(1)').replace('db = None', 'time.sleep(60)\ndb = None');
  await assert.rejects(python(['-I', '-S', '-B', '-c', script]), error => {
    assert.equal(error.signal, 'SIGALRM');
    assert.equal(error.killed, false, 'Linux deadline fires before the parent timeout');
    return true;
  });
});

test('failed native reads and opt-out preserve journal usage and report source warnings', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-db-warning-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const folder = path.join(home, 'session-state', 'journal');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(home, 'session-store.db'), '');
  await fs.writeFile(path.join(folder, 'events.jsonl'), JSON.stringify({ type: 'session.usage_record', id: 'receipt', timestamp: row.created_at,
    data: { usage: { provider: { kind: 'copilot' }, model: 'model', inputTokens: 10, outputTokens: 2, copilotUsage: { totalNanoAiu: 1e9 } } } }) + '\n');
  const options = [];
  const scanner = createScanner({ readDatabase: async (file, sessions, source, config) => {
    options.push(config);
    assert.ok(sessions.has('journal'));
    throw Object.assign(new Error('Native reader unavailable; journals remain included.'), { code: 'ETIMEDOUT' });
  } });
  for (const enabled of [true, false]) {
    const result = await scanner.scan([home], { readWslDatabases: enabled });
    assert.equal(options.at(-1).readWslDatabases, enabled);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].nanoAiu, 1e9);
    assert.equal(result.sources[0].state, 'warning');
    assert.equal(result.sources[0].diagnostic.errorCode, 'ETIMEDOUT');
  }
});

test('native export sees committed WAL rows, matches local accounting, excludes conversation text and cannot write', async t => {
  try { await python(['--version']); } catch { t.skip('Python 3 unavailable for native SQLite export integration test'); return; }
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-db-fixture-'));
  const dbFile = path.join(home, 'session-store.db'), db = new DatabaseSync(dbFile);
  t.after(async () => { db.close(); await fs.rm(home, { recursive: true, force: true }); });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE sessions(id TEXT, repository TEXT, cwd TEXT, summary TEXT, prompt TEXT);
    INSERT INTO sessions VALUES ('old', 'project', '', 'Saved title', 'PRIVATE conversation');
    CREATE TABLE assistant_usage_events(id INTEGER, session_id TEXT, model TEXT, created_at TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_nano_aiu INTEGER);
    INSERT INTO assistant_usage_events VALUES (1, 'old', 'model', '2026-11-01 12:00:00', 20, 5, 10, 0, 1000000000), (2, 'old', 'model', '2026-11-01 12:01:00', 10, 2, 0, 0, 0), (3, 'journal', 'model', '2026-11-01 12:02:00', 10, 2, 0, 0, 9000000000);`);
  const before = await Promise.all([fs.readFile(dbFile), fs.readFile(dbFile + '-wal')]);
  assert.ok(before[1].length > 0);
  const runExport = (script, input = '["journal"]') => python(['-I', '-S', '-B', '-c', script, dbFile], input);
  const read = createUsageDatabaseReader({ platform: 'win32', readLocal: () => { throw locked(); }, run: async (exe, args, options, input) => args.includes('--list') ? 'Ubuntu' : runExport(args.at(-2), input) });
  const result = await read(file, new Set(['journal']), home);
  const expected = readUsageDatabase(dbFile, new Set(['journal']), home);
  assert.deepEqual(result, { ...expected, databaseRead: 'wsl' });
  assert.deepEqual(result.records.map(r => r.nanoAiu), [1e9, 0]);
  assert.doesNotMatch(await runExport(WSL_USAGE_EXPORT), /PRIVATE/);
  const denied = JSON.parse(await runExport(WSL_USAGE_EXPORT.replace("db.execute('BEGIN')", "db.execute('CREATE TABLE forbidden(id)')")));
  assert.equal(denied.error, true); assert.equal(denied.sqliteCode & 255, 8);
  const interrupted = JSON.parse(await runExport(WSL_USAGE_EXPORT.replace('deadline = time.monotonic() + 4', 'deadline = time.monotonic() - 1')
    .replace("db.execute('BEGIN')", "db.execute('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n').fetchone()")));
  assert.equal(interrupted.error, true); assert.equal(interrupted.sqliteCode, 9); assert.equal(interrupted.timeout, true);
  assert.deepEqual(await Promise.all([fs.readFile(dbFile), fs.readFile(dbFile + '-wal')]), before);
  assert.deepEqual((await fs.readdir(home)).sort(), ['session-store.db', 'session-store.db-shm', 'session-store.db-wal']);
  // A real scanner run exercises merge/dedup behavior through the injected native reader.
  const native = createScanner({ readDatabase: async (unused, sessions, source) => read(String.raw`\\wsl.localhost\Ubuntu\home\example\.copilot\session-store.db`, sessions, source) });
  const a = await native.scan([home]), b = await native.scan([home]);
  assert.equal(a.records.length, 3);
  assert.equal(b.records.length, 3);
  assert.equal(b.coverage.wslDatabases, 1);
  assert.match(b.sources[0].message, /inside WSL/);
  assert.equal((await native.scan([home], { disabled: [home] })).records.length, 0);
});
