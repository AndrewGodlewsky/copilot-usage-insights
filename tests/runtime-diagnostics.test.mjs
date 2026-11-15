import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeDiagnostics } from '../src/node/runtime-diagnostics.mjs';
import { startServer } from '../src/node/canvas-server.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('lifecycle evidence survives reopening, stays bounded, and excludes unapproved fields', async t => {
  const directory = await fixture(t), diagnostics = createRuntimeDiagnostics({ directory, processId: 42 });
  diagnostics.record('info', 'extension.started', { pluginVersion: '0.1.73', path: 'PRIVATE_PATH', nodeVersion: 'v24.0.0' });
  diagnostics.record('info', 'history.scan', { records: 100 });
  diagnostics.record('info', 'extension.exit', { exitCode: 0, raw: 'SECRET' });
  let saved = createRuntimeDiagnostics({ directory }).readPersisted();
  assert.equal(saved.available, true);
  assert.deepEqual(saved.entries.map(e => e.event), ['extension.started', 'extension.exit']);
  assert.equal(saved.entries[0].processId, 42);
  assert.equal(saved.entries[0].pluginVersion, '0.1.73');
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE|SECRET/);
  const file = path.join(directory, 'diagnostics.jsonl');
  await fs.appendFile(file, 'malformed\n' + JSON.stringify({ at: new Date().toISOString(), level: 'info', event: 'extension.exit', exitCode: 1, message: 'PRIVATE', processId: 'SECRET' }) + '\n');
  saved = diagnostics.readPersisted();
  assert.equal(saved.entries.at(-1).exitCode, 1);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE|SECRET/);
  // A pre-existing oversized file is read with a bounded buffer and rotated on the next write.
  await fs.writeFile(file, 'x'.repeat(128 * 1024 + 10));
  assert.deepEqual(diagnostics.readPersisted().entries, []);
  diagnostics.record('info', 'extension.started');
  await fs.writeFile(file, 'x'.repeat(128 * 1024));
  diagnostics.record('info', 'extension.exit', { exitCode: 0 });
  for (const name of await fs.readdir(directory)) assert.ok((await fs.stat(path.join(directory, name))).size <= 128 * 1024);
  assert.equal(diagnostics.readPersisted().entries.at(-1).event, 'extension.exit');
});

test('unwritable lifecycle storage never breaks the application or its in-memory logs', async t => {
  const directory = await fixture(t), blocked = path.join(directory, 'not-a-directory');
  await fs.writeFile(blocked, 'test');
  const diagnostics = createRuntimeDiagnostics({ directory: blocked });
  assert.doesNotThrow(() => diagnostics.record('info', 'extension.started'));
  assert.equal(diagnostics.snapshot().entries[0].event, 'extension.started');
  assert.equal(diagnostics.readPersisted().available, false);
});

test('source discovery outcomes survive reopening without storing names, paths or error messages', async t => {
  const directory = await fixture(t), diagnostics = createRuntimeDiagnostics({ directory });
  diagnostics.record('info', 'wsl.discovery', { phase: 'finished', distributions: 3, running: 2, homes: 2, vscodeHomes: 1, unavailable: 1, durationMs: 15, name: 'PRIVATE_DISTRO' });
  diagnostics.record('info', 'history.scan', { phase: 'finished', records: 42, compactions: 3, fallbackRequests: 4, environments: 3, path: 'PRIVATE_PATH' });
  diagnostics.record('warn', 'history.source', { sourceIndex: 2, sourceState: 'warning', sourceKind: 'copilot', errorCode: 'ERR_SQLITE_ERROR', sqliteCode: 5, message: 'PRIVATE_LOCK_ERROR' });
  const saved = createRuntimeDiagnostics({ directory }).readPersisted();
  assert.deepEqual(saved.entries.map(e => e.event), ['wsl.discovery', 'history.scan', 'history.source']);
  assert.equal(saved.entries[0].vscodeHomes, 1);
  assert.equal(saved.entries[1].compactions, 3);
  assert.equal(saved.entries[1].fallbackRequests, 4);
  assert.equal(saved.entries[2].sqliteCode, 5);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE/);
});

test('server closure produces a fetch failure and leaves lifecycle evidence for the next canvas', async t => {
  const directory = await fixture(t), diagnostics = createRuntimeDiagnostics({ directory });
  const server = await startServer({ diagnostics, html: 'test', settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) }, scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) } });
  t.after(() => server.close());
  const call = method => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }) });
  assert.equal((await call('usage.report')).status, 200);
  const inventory = await (await call('usage.inventory')).json();
  assert.ok(inventory.diagnostics.capturedAt);
  assert.ok(inventory.diagnostics.entries.some(e => e.event === 'history.scan'));
  await server.close();
  await assert.rejects(call('usage.report'), { name: 'TypeError' });
  const next = await startServer({ diagnostics: createRuntimeDiagnostics({ directory }), html: 'test' });
  t.after(() => next.close());
  const response = await fetch(next.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'diagnostics.get' }) });
  const logs = await response.json();
  assert.equal(logs.persisted.available, true);
  assert.ok(logs.persisted.entries.some(e => e.event === 'server.closing'));
  assert.ok(logs.persisted.entries.some(e => e.event === 'server.closed'));
});

test('the served page carries saved runtime evidence before any usage request can fail', async t => {
  const directory = await fixture(t), diagnostics = createRuntimeDiagnostics({ directory });
  diagnostics.record('error', 'extension.crash', { errorType: 'Error', errorCode: 'EIO', message: 'PRIVATE' });
  diagnostics.record('info', 'history.scan', { phase: 'started' });
  let scans = 0;
  const server = await startServer({ diagnostics, scanner: { scan: async () => { scans++; throw new Error('Unavailable'); } } });
  t.after(() => server.close());
  const page = await (await fetch(server.url)).text();
  const payload = page.match(/<script type="application\/json" id="initial-diagnostics">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(payload, 'initial HTML includes a diagnostics snapshot');
  const snapshot = JSON.parse(payload);
  assert.ok(snapshot.persisted.entries.some(e => e.event === 'extension.crash'));
  assert.ok(snapshot.persisted.entries.some(e => e.event === 'history.scan' && e.phase === 'started'));
  assert.doesNotMatch(payload, /PRIVATE/);
  assert.ok(snapshot.runtime.node && snapshot.capturedAt);
  assert.equal(scans, 0, 'capturing logs never scans usage');
  await server.close();
  assert.ok(JSON.parse(payload).persisted.entries.length, 'page retains evidence after its server stops');
});
