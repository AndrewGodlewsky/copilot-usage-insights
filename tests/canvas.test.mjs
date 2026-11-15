import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { createSettings } from '../src/node/settings.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { registerCanvas } from '../src/node/canvas.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-canvas-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('settings validate paths, persist atomic changes, and never replace corrupt configuration', async t => {
  const dir = await fixture(t), settings = createSettings(dir);
  await settings.set({ extraHomes: [dir] });
  await Promise.all([settings.set({ disabledHomes: [dir] }), settings.set({ extraHomes: [] })]);
  assert.deepEqual(await createSettings(dir).get(), { extraHomes: [], disabledHomes: [dir], textSize: 'small', simplifyNumbers: true });
  await assert.rejects(settings.set({ extraHomes: ['relative'] }), /absolute/);
  await assert.rejects(settings.set({ unexpected: true }), /Unknown/);
  await fs.writeFile(path.join(dir, 'settings.json'), '{bad');
  await assert.rejects(settings.set({ extraHomes: [] }), /settings/i);
  assert.equal(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'), '{bad');
});

test('text size defaults to small and persists only supported choices without changing source settings', async t => {
  const dir = await fixture(t), settings = createSettings(dir);
  assert.equal((await settings.get()).textSize, 'small');
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ extraHomes: [dir], disabledHomes: [] }));
  assert.equal((await settings.get()).textSize, 'small');
  for (const textSize of ['large', 'medium', 'small']) {
    await settings.set({ textSize });
    assert.deepEqual(await createSettings(dir).get(), { extraHomes: [dir], disabledHomes: [], textSize, simplifyNumbers: true });
  }
  for (const textSize of ['huge', '', 1, null, {}]) await assert.rejects(settings.set({ textSize }), /textSize/);
  assert.equal((await settings.get()).textSize, 'small');
});
test('number simplification defaults on for existing settings, validates booleans and persists without changing sources', async t => {
  const dir = await fixture(t), settings = createSettings(dir);
  assert.equal((await settings.get()).simplifyNumbers, true);
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ extraHomes: [dir], textSize: 'large' }));
  assert.equal((await settings.get()).simplifyNumbers, true);
  await settings.set({ simplifyNumbers: false });
  const saved = await createSettings(dir).get();
  assert.equal(saved.simplifyNumbers, false);
  assert.equal(saved.textSize, 'large');
  assert.deepEqual(saved.extraHomes, [dir]);
  for (const simplifyNumbers of ['false', 0, 1, null, {}, []]) await assert.rejects(settings.set({ simplifyNumbers }), /simplifyNumbers/);
  assert.equal((await settings.get()).simplifyNumbers, false);
});

test('dashboard API requires the instance token and same origin, and validates requests', async t => {
  const dir = await fixture(t);
  const server = await startServer({ settings: createSettings(dir), defaultHome: dir, html: '<!doctype html><title>Usage Insights</title>', scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) } });
  t.after(() => server.close());
  const origin = new URL(server.url).origin;
  assert.equal((await fetch(server.url)).status, 200);
  assert.equal((await fetch(origin + '/')).status, 404);
  const request = (body, headers = {}) => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await request({ method: 'usage.report', input: { range: '7d' } })).status, 200);
  assert.equal((await (await request({ method: 'usage.report' })).json()).preferences.textSize, 'small');
  assert.equal((await (await request({ method: 'usage.report' })).json()).preferences.simplifyNumbers, true);
  assert.equal((await request({ method: 'settings.set', input: { simplifyNumbers: false } })).status, 200);
  assert.equal((await (await request({ method: 'usage.report' })).json()).preferences.simplifyNumbers, false);
  assert.equal((await request({ method: 'settings.set', input: { textSize: 'medium' } })).status, 200);
  assert.equal((await (await request({ method: 'usage.refresh' })).json()).preferences.textSize, 'medium');
  assert.equal((await request({ method: 'settings.set', input: { textSize: 'huge' } })).status, 400);
  assert.equal((await request({ method: 'settings.set', input: { extraHomes: [] } }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('{')).status, 400);
  assert.equal((await request({ method: 'usage.report', input: { range: 'bogus' } })).status, 400);
  assert.equal((await request({ method: 'settings.set', input: { extraHomes: ['relative'] } })).status, 400);
  assert.equal((await request({ method: 'arbitrary.file.read' })).status, 400);
  assert.equal((await request('x'.repeat(70_000))).status, 413);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(server.url, { headers: { Host: 'attacker.test' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(badHostStatus, 403);
  const response = await fetch(server.url);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('canvas instances isolate review ownership, reuse their own server, and dispose independently', async () => {
  let config, starts = 0, stops = 0, opened, serverOptions;
  const session = { sessionId: 'current-session', rpc: { canvas: { open: async input => { opened = input; } },
    mcp: { listConfigured: async () => ({ servers: [{ name: 'test', enabled: true, live: { status: 'connected' } }] }) },
    plugins: { list: async () => ({ plugins: [] }) },
    metadata: { getContextAttribution: async () => ({ contextAttribution: { totalTokens: 100, categories: {} } }) },
  } };
  const registration = await registerCanvas({
    createCanvas: c => c,
    joinSession: async c => { config = c; return session; },
    startServer: async options => { serverOptions = options; starts++; return { url: 'http://127.0.0.1:1/token/', close: async () => { stops++; } }; },
  });
  const canvas = config.canvases[0];
  await Promise.all([canvas.open({ instanceId: 'a' }), canvas.open({ instanceId: 'b' })]);
  assert.equal(starts, 2);
  await canvas.open({ instanceId: 'a' }); assert.equal(starts, 2);
  assert.equal(serverOptions.session, session);
  await assert.rejects(canvas.open({ instanceId: 'other', sessionId: 'other-session' }), /another session/);
  const inventory = await serverOptions.readIntegrations();
  assert.equal(inventory.mcp.sessionId, 'current-session');
  assert.equal(inventory.mcp.rows[0].status, 'connected');
  assert.equal((await serverOptions.readContext()).totalTokens, 100);
  await canvas.onClose({ instanceId: 'a' }); assert.equal(stops, 1);
  await canvas.onClose({ instanceId: 'b' }); assert.equal(stops, 2);
  await canvas.open({ instanceId: 'c' }); assert.equal(starts, 3);
  await config.tools[0].handler({}); assert.equal(opened.canvasId, 'usage-insights');
  await registration.dispose(); assert.equal(stops, 3);
});

test('context endpoint is protected, rejects arbitrary options and never scans history', async t => {
  let calls = 0;
  const server = await startServer({ html: '<title>Test</title>',
    scanner: { scan: async () => { throw new Error('Unexpected scan'); } },
    readContext: async () => { calls++; return { available: true, totalTokens: 100 }; } });
  t.after(() => server.close());
  const request = (input = {}, origin = new URL(server.url).origin) => fetch(server.url + 'api', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ method: 'efficiency.context', input }) });
  assert.equal((await request({}, 'https://example.com')).status, 403);
  assert.equal((await request({ sessionId: 'other-session' })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await (await request()).json()).totalTokens, 100);
  assert.equal(calls, 1);
});
