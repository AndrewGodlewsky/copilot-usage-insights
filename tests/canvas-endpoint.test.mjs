import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { startCanvasServer, validEndpoint } from '../src/node/canvas-endpoint.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-endpoint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const diagnostics = createDiagnostics();
  const options = { endpointDirectory: directory, session: { sessionId: 'synthetic-session' }, instanceId: 'dashboard', diagnostics,
    html: '<title>Test</title>', settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) } };
  const servers = [];
  t.after(() => Promise.all(servers.map(server => server.close())));
  return { directory, diagnostics, options, open: async () => { const server = await startCanvasServer(options); servers.push(server); return server; } };
}

test('overlapping host replacements wait for the old listener and retain the private address', async t => {
  const { open, diagnostics, directory } = await fixture(t);
  const original = await open();
  const replacement = open();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal((await fetch(original.url)).status, 200, 'replacement must not disrupt the old listener');
  await original.close();
  const next = await replacement;
  assert.equal(next.url, original.url);
  assert.equal((await fetch(next.url)).status, 200);
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  const stored = JSON.parse(await fs.readFile(path.join(directory, files[0]), 'utf8'));
  assert.deepEqual(Object.keys(stored).sort(), ['port', 'token', 'version']);
  const entries = diagnostics.snapshot().entries;
  assert.ok(entries.some(e => e.event === 'server.endpoint' && e.phase === 'started'));
  assert.ok(entries.some(e => e.event === 'server.endpoint' && e.phase === 'finished' && e.reused));
  assert.ok(!JSON.stringify(entries).includes(stored.token));
  assert.ok(!JSON.stringify(entries).includes('synthetic-session'));
});

test('saved endpoints reject invalid ports and tokens', () => {
  const endpoint = { version: 1, port: 12345, token: 'a'.repeat(64) };
  assert.ok(validEndpoint(endpoint));
  for (const port of [0, -1, 80, 65536, 123.5, '12345', NaN]) assert.equal(validEndpoint({ ...endpoint, port }), false);
  for (const token of ['', 'a'.repeat(63), '../outside', 'https://example.com', null]) assert.equal(validEndpoint({ ...endpoint, token }), false);
});

test('simultaneous first opens publish one complete address without overwriting it', async t => {
  const { open } = await fixture(t);
  const attempts = [open(), open()];
  const first = await Promise.race(attempts);
  await first.close();
  const [a, b] = await Promise.all(attempts);
  assert.equal(a.url, b.url);
  assert.equal((await fetch(a.url)).status, 200);
});

test('unavailable or corrupt recovery storage does not prevent a fresh dashboard from opening', async t => {
  const { directory, options, diagnostics } = await fixture(t);
  const blocked = path.join(directory, 'blocked');
  await fs.writeFile(blocked, 'fixture');
  const fallback = await startCanvasServer({ ...options, endpointDirectory: blocked });
  t.after(() => fallback.close());
  assert.equal((await fetch(fallback.url)).status, 200);
  const original = await startCanvasServer(options);
  await original.close();
  const [file] = (await fs.readdir(directory)).filter(name => name.endsWith('.json'));
  await fs.writeFile(path.join(directory, file), '{partial');
  const fresh = await startCanvasServer(options);
  t.after(() => fresh.close());
  assert.equal((await fetch(fresh.url)).status, 200);
  assert.equal(diagnostics.snapshot().entries.filter(e => e.event === 'server.endpoint' && e.phase === 'failed').length, 2);
});

test('an abruptly killed extension can be replaced without changing the open renderer URL', { timeout: 10_000 }, async t => {
  const { directory } = await fixture(t);
  const children = [];
  t.after(async () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } });
  async function launch() {
    const child = fork(new URL('./fixtures/canvas-host.mjs', import.meta.url), [directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
    children.push(child);
    const ready = once(child, 'message');
    const url = (await Promise.race([ready, once(child, 'exit').then(() => { throw new Error('Fixture host exited before listening'); })]))[0];
    return { child, url };
  }
  const original = await launch();
  const call = () => fetch(original.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.refresh' }) });
  assert.equal((await call()).status, 200);
  const exited = once(original.child, 'exit');
  original.child.kill('SIGKILL'); await exited;
  await assert.rejects(call(), { name: 'TypeError' });
  const next = await launch();
  assert.equal(next.url, original.url);
  assert.equal((await call()).status, 200);
});
