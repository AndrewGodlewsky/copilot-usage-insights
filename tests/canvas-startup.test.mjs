import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerCanvas } from '../src/node/canvas.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { createRuntimeDiagnostics } from '../src/node/runtime-diagnostics.mjs';
import { createDiagnostics, loadTimingSummary } from '../src/core/diagnostics.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('fresh canvas loads no history, SQLite, YAML or AI-review modules until requested', () => {
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./fixtures/canvas-startup-host.mjs', import.meta.url))], { encoding: 'utf8' }));
  assert.equal(result.shellScans, 0);
  for (const modules of [result.shellModules, result.lightweightModules]) assert.doesNotMatch(modules.join('\n'), /copilot-source|copilot-db|copilot-report|js-yaml|ai-review|model-benchmarks/);
  assert.ok(result.usageModules.includes('core/copilot-report.mjs'));
  assert.doesNotMatch(result.usageModules.join('\n'), /ai-review|model-benchmarks/);
  assert.ok(result.reviewModules.includes('node/ai-review.mjs'));
  assert.equal(result.reportRequests, 0);
});

test('canvas opens and serves its shell without scanning history or contacting Copilot', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-startup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let canvas, scans = 0;
  const diagnostics = createRuntimeDiagnostics({ directory, processId: 123 });
  const extension = await registerCanvas({ createCanvas: x => x,
    joinSession: async config => { canvas = config.canvases[0]; return { sessionId: 'synthetic' }; },
    endpointDirectory: directory, diagnostics, serverOptions: { scanner: { scan() { scans++; throw new Error('Unexpected history scan'); } } },
  });
  t.after(() => extension.dispose());
  const view = await canvas.open({ sessionId: 'synthetic', instanceId: 'dashboard' });
  const response = await fetch(view.url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Usage Insights/);
  assert.equal(scans, 0);
  const entries = diagnostics.readPersisted().entries;
  for (const event of ['extension.join', 'canvas.open', 'canvas.queue', 'server.start', 'server.import', 'server.assets', 'server.endpointRead', 'server.bind', 'server.page']) {
    assert.ok(entries.some(e => e.event === event && e.phase === 'finished' && Number.isFinite(e.durationMs)), event);
  }
  assert.match(loadTimingSummary(entries), /Canvas lifecycle wait.*process 123/);
  assert.doesNotMatch(JSON.stringify(entries), /synthetic|dashboard|127\.0\.0\.1|[a-f0-9]{64}/);
});

test('cancelling the real scanner stops deferred history and rejects later scans', async () => {
  const lifetime = new AbortController(), events = [];
  const scanner = createScanner({ signal: lifetime.signal, diagnostics: {
    measure(event, fields, work) { events.push(event); return work(); },
  } });
  await assert.rejects(scanner.scan([], { recentSince: Date.now(), onRecent: () => lifetime.abort() }), { name: 'AbortError' });
  assert.ok(events.includes('history.recent'));
  assert.ok(!events.includes('history.background'));
  await assert.rejects(scanner.scan([]), { name: 'AbortError' });
});

test('fast shutdown still completes a settings write already in progress', async () => {
  const started = deferred(), release = deferred();
  let closed = false;
  const server = await startServer({ html: '<title>Fixture</title>', settings: { async set() { started.resolve(); await release.promise; return {}; } } });
  const request = fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'settings.set', input: {} }) }).catch(() => null);
  await started.promise;
  const closing = server.close().then(() => { closed = true; });
  try { await new Promise(setImmediate); assert.equal(closed, false); }
  finally { release.resolve(); await closing; await request; }
});

for (const [method, event] of [['usage.report', 'server.usageModules'], ['review.catalog', 'server.reviewModules']]) {
  test(`closing during lazy ${method} setup prevents late work`, async () => {
    const started = deferred();
    let server, closing, calls = 0;
    const diagnostics = createDiagnostics({ onRecord(entry) {
      if (entry.event === event && entry.phase === 'started') { closing = server.close(); started.resolve(); }
    } });
    server = await startServer({ diagnostics, html: '<title>Fixture</title>',
      scanner: { async scan() { calls++; throw new Error('Unexpected scan'); } },
      reviewService: { async catalog() { calls++; throw new Error('Unexpected Copilot request'); }, async close() {} },
    });
    const request = fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }) }).catch(() => null);
    await started.promise; await closing; await request;
    await new Promise(setImmediate);
    assert.equal(calls, 0);
  });
}

test('closing and reopening the canvas does not wait for an unfinished history scan', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-startup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const started = deferred(), release = deferred();
  let canvas, signal;
  const extension = await registerCanvas({ createCanvas: x => x,
    joinSession: async config => { canvas = config.canvases[0]; return { sessionId: 'synthetic' }; },
    endpointDirectory: directory, serverOptions: {
      settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
      scanner: { async scan(roots, options) { signal = options.signal; started.resolve(); await release.promise; return { records: [], sources: [], coverage: {} }; } },
    },
  });
  t.after(async () => { release.resolve(); await extension.dispose(); });
  const ctx = { sessionId: 'synthetic', instanceId: 'dashboard' };
  const original = await canvas.open(ctx);
  const request = fetch(original.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.report' }) }).catch(() => null);
  await started.promise;
  const closing = canvas.onClose(ctx);
  const opening = canvas.open(ctx);
  let timer;
  try {
    const next = await Promise.race([opening, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Reopening is blocked by the old history scan')), 1500); })]);
    assert.equal(signal?.aborted, true, 'the old scan receives cancellation');
    assert.equal((await fetch(next.url)).status, 200);
    assert.notEqual(next.url, original.url);
  } finally {
    clearTimeout(timer); release.resolve(); await closing; await opening; await request;
  }
});
