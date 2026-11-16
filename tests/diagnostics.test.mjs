import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics, diagnosticError, parseRuntimeDiagnostics, loadTimingSummary } from '../src/core/diagnostics.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScanner } from '../src/node/copilot-source.mjs';

test('scan diagnostics separate source work and count cold, cached and appended journal reads without private data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-timing-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'usage-timing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session-state', 'PRIVATE_SESSION');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  const line = JSON.stringify({ type: 'session.start', data: { sessionId: 'PRIVATE_SESSION' } }) + '\n';
  await fs.writeFile(file, line);
  await fs.writeFile(path.join(root, 'session-store.db'), 'synthetic database');
  const diagnostics = createDiagnostics();
  let failDatabase = false;
  const scanner = createScanner({ diagnostics,
    discoverWsl: async () => ({ homes: [], sources: [] }),
    discoverVSCode: async () => ({ sources: [], snapshots: [], owners: [], files: [] }),
    readDatabase: async () => {
      if (failDatabase) throw Object.assign(new Error('SECRET_PATH PRIVATE_CONTENT'), { code: 'EIO' });
      return { records: [], sessionNames: new Map(), skillExcludedSessions: [], unclassified: 0, invalid: 0 };
    },
  });
  const latest = event => diagnostics.snapshot().entries.filter(e => e.event === event).at(-1);
  const cold = await scanner.scan([root]);
  assert.equal(latest('history.journals')?.filesRead, 1);
  assert.equal(latest('history.journals').bytesRead, Buffer.byteLength(line));
  assert.equal(latest('history.journals').filesReused, 0);
  assert.equal(latest('history.journals').folders, 1);
  assert.equal(latest('history.journals').environmentType, 'local');
  for (const event of ['history.discovery', 'history.vscode', 'history.merge', 'history.database', 'history.names', 'history.finalize']) {
    assert.equal(latest(event)?.phase, 'finished', event);
    assert.ok(Number.isFinite(latest(event).durationMs));
  }
  assert.equal(await scanner.scan([root]), cold, 'diagnostic counters do not invalidate snapshots');
  assert.equal(latest('history.journals').filesRead, 0);
  assert.equal(latest('history.journals').filesReused, 1);
  assert.equal(latest('history.journals').bytesRead, 0);
  assert.equal(latest('history.merge').cacheHit, true);
  const extra = JSON.stringify({ type: 'ignored', data: { text: 'PRIVATE_CONTENT' } }) + '\n';
  await fs.appendFile(file, extra);
  await scanner.scan([root]);
  assert.equal(latest('history.journals').filesAppended, 1);
  assert.equal(latest('history.journals').bytesRead, Buffer.byteLength(extra));
  assert.equal(latest('history.journals').bytesHashed, Buffer.byteLength(line));
  failDatabase = true;
  await scanner.scan([root], { force: true });
  assert.equal(latest('history.journals').filesRead, 1);
  assert.equal(latest('history.database').phase, 'failed');
  assert.equal(latest('history.database').errorCode, 'EIO');
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /PRIVATE|SECRET|usage-timing-|session-state/);
});

test('runtime file parsing rejects unknown events and redacts edited or malformed fields', () => {
  const at = '2026-11-15T21:00:00.000Z';
  const text = ['null', '{partial', JSON.stringify({ at, level: 'error', event: 'private.secret', durationMs: 1 }),
    JSON.stringify({ at: 'PRIVATE', level: 'error', event: 'extension.crash' }),
    JSON.stringify({ at, level: 'error', event: 'extension.crash', errorCode: 'EIO', processId: 42, pluginVersion: '0.1.82', message: '</script>PRIVATE',
      source: 'SECRET', path: 'PRIVATE', errorType: 'PRIVATE', method: 'SECRET', locations: ['PRIVATE', 'copilot-source.mjs:12:3'] })].join('\n');
  const parsed = parseRuntimeDiagnostics(text);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], { at, level: 'error', event: 'extension.crash', errorCode: 'EIO', processId: 42, pluginVersion: '0.1.82', locations: ['copilot-source.mjs:12:3'] });
  assert.doesNotMatch(JSON.stringify(parsed), /PRIVATE|SECRET|script/);
});

test('load timing summary distinguishes initial loads, partial stages and cached work without exposing names', () => {
  const logs = createDiagnostics({ clock: () => new Date('2026-11-15T12:00:00Z') });
  logs.record('info', 'ui.load', { loadKind: 'initial', phase: 'finished', durationMs: 1234 });
  logs.record('info', 'history.journals', { sourceIndex: 2, sourceKind: 'copilot', environmentType: 'wsl', phase: 'finished', durationMs: 1000, bytesRead: 2048, filesRead: 3, path: 'PRIVATE' });
  logs.record('info', 'history.journals', { sourceIndex: 2, sourceKind: 'copilot', environmentType: 'wsl', phase: 'started', filesReused: 3 });
  logs.record('info', 'report.build', { phase: 'finished', durationMs: 10, cacheHit: true });
  const summary = loadTimingSummary(logs.snapshot().entries);
  assert.match(summary, /Initial usage load.*1234 ms/);
  assert.match(summary, /Copilot journals.*source 2.*wsl.*no completion retained/);
  assert.match(summary, /Report calculations.*10 ms.*cacheHit=true/);
  assert.match(summary, /overlap/);
  assert.doesNotMatch(summary, /PRIVATE|1000 ms/);
  assert.match(loadTimingSummary([]), /No load timings retained/);
  const persisted = parseRuntimeDiagnostics(logs.snapshot().entries.map(e => JSON.stringify(e)).join('\n'));
  assert.ok(persisted.some(e => e.event === 'report.build' && e.cacheHit));
  assert.ok(persisted.some(e => e.event === 'history.journals' && e.environmentType === 'wsl'));
});

test('diagnostic sinks receive only approved metadata and cannot break logging', () => {
  const entries = [];
  const diagnostics = createDiagnostics({ onRecord(entry) { entries.push(entry); entry.event = 'tampered'; throw new Error('disk failed'); } });
  assert.doesNotThrow(() => diagnostics.record('info', 'server.closed', { signal: 'SIGTERM', exitCode: 0, requestStage: 'fetch', online: true, lastResponseAgeMs: 60000, raw: 'PRIVATE', pluginVersion: 'SECRET' }));
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE|SECRET/);
  const record = diagnostics.snapshot().entries[0];
  assert.equal(record.event, 'server.closed');
  assert.equal(record.requestStage, 'fetch');
  assert.equal(record.lastResponseAgeMs, 60000);
});

test('diagnostics retain bounded structured timings and safe error locations only', async () => {
  let tick = 0;
  const logs = createDiagnostics({ limit: 3, tick: () => tick, clock: () => new Date('2026-11-14T12:00:00Z') });
  const error = Object.assign(new TypeError('PRIVATE_PROMPT SECRET_TOKEN C:\\Users\\Private\\project'), { code: 'EACCES', stack:
    'TypeError: PRIVATE_PROMPT\n at scan (C:\\Users\\Private\\copilot-source.mjs:45:6)\n at handle (file:///private/canvas-server.mjs:12:3)\n at https://127.0.0.1:5555/' + 'a'.repeat(64) + '/:220:8' });
  assert.deepEqual(diagnosticError(error), { errorType: 'TypeError', errorCode: 'EACCES', locations: ['copilot-source.mjs:45:6', 'canvas-server.mjs:12:3', 'panel/index.html:220:8'] });
  assert.equal(logs.measure('report.build', {}, () => { tick = 12.34; return 7; }), 7);
  assert.equal(logs.snapshot().entries.at(-1).durationMs, 12.3);
  await assert.rejects(logs.measure('history.scan', { path: 'PRIVATE_PATH', range: 'PRIVATE_RANGE' }, async () => { tick = 20; throw error; }));
  logs.record('warn', 'history.source', { sourceState: 'warning', message: 'PRIVATE_MESSAGE', locations: ['PRIVATE:1:1'], errorCode: 'PRIVATE_CODE', errorType: 'PRIVATE_TYPE', toString: 'PRIVATE' });
  logs.record('info', 'api.request', { method: 'usage.requests', rows: 25, detail: true, durationMs: Infinity, session: 'PRIVATE_SESSION', model: 'PRIVATE_MODEL' });
  const snapshot = logs.snapshot();
  assert.equal(snapshot.entries.length, 3);
  assert.equal(snapshot.dropped, 3);
  assert.equal(snapshot.entries[0].level, 'error');
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|SECRET|Users|127\.0\.0\.1|aaaa|Infinity/);
  snapshot.entries[0].locations.push('changed'); snapshot.entries.length = 0;
  assert.equal(logs.snapshot().entries.length, 3);
  assert.ok(!logs.snapshot().entries[0].locations.includes('changed'));
});

test('diagnostics API stays available after a data failure and records scan/cache/API stages without usage text', async t => {
  let fail = false, scans = 0;
  const parser = createReceiptParser({ sessionId: 'PRIVATE_SESSION', source: 'PRIVATE_PATH' });
  parser.push(JSON.stringify({ type: 'session.usage_record', id: 'PRIVATE_ID', timestamp: '2026-11-14T12:00:00Z', data: { usage: { model: 'PRIVATE_MODEL', provider: { kind: 'copilot' }, inputTokens: 10, outputTokens: 5 } } }));
  const server = await startServer({ html: 'test', defaultHome: 'PRIVATE_HOME', now: () => new Date('2026-11-14T13:00:00Z'),
    settings: { get: async () => { if (fail) throw Object.assign(new Error('SECRET_TOKEN PRIVATE_PATH'), { code: 'EACCES' }); return { extraHomes: [], disabledHomes: [] }; } },
    scanner: { scan: async () => { scans++; return { ...parser.snapshot(), sources: [{ path: 'PRIVATE_PATH', state: 'warning', files: 1, message: 'SECRET_TOKEN', diagnostic: { errorType: 'Error', errorCode: 'EIO' } }], coverage: { invalid: 2 } }; } },
  });
  t.after(() => server.close());
  const call = (method, input = {}, headers = {}) => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ method, input }) });
  assert.equal((await call('usage.report', { range: '1d' })).status, 200);
  assert.equal((await call('usage.inventory')).status, 200);
  assert.equal((await call('usage.requests', { model: 'PRIVATE_MODEL' })).status, 200);
  fail = true;
  assert.equal((await call('usage.refresh')).status, 500);
  const response = await call('diagnostics.get'), report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(scans, 1);
  assert.ok(report.version);
  assert.equal(report.runtime.platform, process.platform);
  for (const event of ['history.scan', 'history.cache', 'report.build', 'report.serialize', 'skills.versions', 'inventory.read', 'history.source']) assert.ok(report.entries.some(e => e.event === event), event);
  assert.ok(report.entries.some(e => e.event === 'report.serialize' && e.responseBytes > 0));
  assert.ok(report.entries.some(e => e.event === 'report.build' && e.cacheHit === false));
  assert.ok(report.entries.some(e => e.event === 'api.request' && e.level === 'error' && e.httpStatus === 500 && e.errorCode === 'EACCES'));
  assert.ok(report.entries.some(e => e.event === 'history.scan' && e.records === 1 && e.files === 1 && e.invalid === 2 && Number.isFinite(e.durationMs)));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|SECRET|sourceSessionId|apiCallId/);
  assert.equal((await (await call('diagnostics.get')).json()).entries.length, report.entries.length, 'reading logs does not log itself');
  assert.equal((await call('diagnostics.get', { path: 'PRIVATE' })).status, 400);
  assert.equal((await call('diagnostics.get', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await fetch(new URL('/api', server.url))).status, 404);
});
