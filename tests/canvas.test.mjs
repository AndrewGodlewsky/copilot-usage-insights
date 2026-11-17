import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest, createServer } from 'node:http';
import { createSettings } from '../src/node/settings.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { registerCanvas } from '../src/node/canvas.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-canvas-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('AI review defaults to Sonnet 5.5 and High without replacing saved preferences', async t => {
  const dir = await fixture(t), settings = createSettings(dir);
  const expected = { reviewModel: 'claude-sonnet-5.5', reviewReasoning: 'high' };
  const preferences = config => Object.fromEntries(['reviewModel', 'reviewReasoning'].filter(key => key in config).map(key => [key, config[key]]));
  assert.deepEqual(preferences(await settings.get()), expected);
  for (const saved of [{ textSize: 'large' }, { reviewModel: '' }, { reviewModel: 'claude-sonnet-5.5' }]) {
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify(saved));
    assert.deepEqual(preferences(await settings.get()), expected);
  }
  for (const saved of [{ reviewModel: 'custom-model' }, { reviewModel: 'custom-model', reviewReasoning: 'medium' }, { reviewModel: 'claude-sonnet-5.5', reviewReasoning: 'default' }]) {
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify(saved));
    assert.deepEqual(preferences(await settings.get()), saved);
    await settings.set({ textSize: 'small' });
    assert.deepEqual(preferences(await createSettings(dir).get()), saved);
  }
});
test('prompt excerpts default on for new and existing settings and preserve a saved opt-out', async t => {
  const dir = await fixture(t), settings = createSettings(dir);
  assert.equal((await settings.get()).reviewAllowSamples, true);
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ reviewModel: 'fixture-model' }));
  assert.equal((await settings.get()).reviewAllowSamples, true);
  await settings.set({ reviewAllowSamples: false });
  assert.equal((await createSettings(dir).get()).reviewAllowSamples, false);
  await settings.set({ textSize: 'large' });
  assert.equal((await settings.get()).reviewAllowSamples, false);
  for (const value of ['true', 0, null, {}]) await assert.rejects(settings.set({ reviewAllowSamples: value }), /boolean/);
  assert.equal((await settings.get()).reviewAllowSamples, false);
  await settings.set({ reviewAllowSamples: true });
  assert.equal((await createSettings(dir).get()).reviewAllowSamples, true);
});

test('settings validate paths, persist atomic changes, and never replace corrupt configuration', async t => {
  const dir = await fixture(t), settings = createSettings(dir);
  await settings.set({ extraHomes: [dir] });
  await Promise.all([settings.set({ disabledHomes: [dir] }), settings.set({ extraHomes: [] })]);
  assert.deepEqual(await createSettings(dir).get(), { extraHomes: [], disabledHomes: [dir], textSize: 'small', simplifyNumbers: true, includeWsl: true, readWslDatabases: true, includeVSCode: true, extraVSCodeHomes: [], reviewAllowSamples: true, reviewModel: 'claude-sonnet-5.5', reviewReasoning: 'high' });
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
    assert.deepEqual(await createSettings(dir).get(), { extraHomes: [dir], disabledHomes: [], textSize, simplifyNumbers: true, includeWsl: true, readWslDatabases: true, includeVSCode: true, extraVSCodeHomes: [], reviewAllowSamples: true, reviewModel: 'claude-sonnet-5.5', reviewReasoning: 'high' });
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

test('WSL discovery defaults on, validates booleans and persists independently of manual sources', async t => {
  const settings = createSettings(await fixture(t));
  assert.equal((await settings.get()).includeWsl, true);
  await settings.set({ includeWsl: false, extraHomes: [os.tmpdir()] });
  assert.equal((await settings.get()).includeWsl, false);
  assert.deepEqual((await settings.get()).extraHomes, [path.normalize(os.tmpdir())]);
  for (const includeWsl of ['true', null, 0, {}]) await assert.rejects(settings.set({ includeWsl }), /includeWsl/);
});

test('VS Code discovery settings default on and validate custom User storage roots', async t => {
  const settings = createSettings(await fixture(t));
  assert.equal((await settings.get()).includeVSCode, true);
  assert.deepEqual((await settings.get()).extraVSCodeHomes, []);
  await settings.set({ includeVSCode: false, extraVSCodeHomes: [os.tmpdir(), os.tmpdir()] });
  assert.equal((await settings.get()).includeVSCode, false);
  assert.deepEqual((await settings.get()).extraVSCodeHomes, [path.normalize(os.tmpdir())]);
  for (const includeVSCode of ['true', null, 0, {}]) await assert.rejects(settings.set({ includeVSCode }), /includeVSCode/);
  for (const extraVSCodeHomes of ['path', ['relative'], Array(51).fill(os.tmpdir())]) await assert.rejects(settings.set({ extraVSCodeHomes }));
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

test('a replacement extension restores the existing dashboard address and Refresh reaches it', async t => {
  const directory = await fixture(t);
  const registrations = [];
  t.after(() => Promise.all(registrations.map(r => r.dispose())));
  async function extension(sessionId = 'same-session') {
    let canvas;
    const registration = await registerCanvas({
      createCanvas: c => c,
      joinSession: async c => { canvas = c.canvases[0]; return { sessionId }; },
      endpointDirectory: directory,
      serverOptions: { html: '<title>Test</title>', settings: createSettings(directory),
        scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) } },
    });
    registrations.push(registration);
    return { ...registration, open: instanceId => canvas.open({ sessionId, instanceId }), close: instanceId => canvas.onClose({ sessionId, instanceId }) };
  }
  const first = await extension(), original = await first.open('dashboard');
  const refresh = () => fetch(original.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.refresh' }) });
  assert.equal((await refresh()).status, 200);
  await first.dispose();
  await assert.rejects(refresh(), { name: 'TypeError' });
  const replacement = await extension(), restored = await replacement.open('dashboard');
  assert.equal(restored.url, original.url, 'the still-open renderer must not be stranded on a dead port/token');
  assert.equal((await refresh()).status, 200, 'Refresh uses the original URL after host replacement');
  assert.notEqual((await replacement.open('second-dashboard')).url, original.url);
  assert.notEqual((await (await extension('other-session')).open('dashboard')).url, original.url);
  await replacement.close('dashboard');
  assert.notEqual((await replacement.open('dashboard')).url, original.url, 'explicit close revokes the old address; only extension disposal preserves it');
});

test('closing after a failed handoff resets an occupied address without disturbing its new owner', { timeout: 12_000 }, async t => {
  const directory = await fixture(t);
  let canvas;
  const registration = await registerCanvas({ createCanvas: c => c,
    joinSession: async c => { canvas = c.canvases[0]; return { sessionId: 'port-conflict' }; }, endpointDirectory: directory,
    serverOptions: { html: '<title>Test</title>' } });
  t.after(() => registration.dispose());
  const ctx = { sessionId: 'port-conflict', instanceId: 'dashboard', extensionId: 'provider' };
  const first = await canvas.open(ctx);
  await registration.dispose();
  const blocker = createServer((_req, res) => res.end('unrelated listener'));
  await new Promise(resolve => blocker.listen(Number(new URL(first.url).port), '127.0.0.1', resolve));
  t.after(() => { blocker.closeAllConnections(); return new Promise(resolve => blocker.close(resolve)); });
  await assert.rejects(canvas.open(ctx), { code: 'EADDRINUSE' });
  await canvas.onClose(ctx);
  const fresh = await canvas.open(ctx);
  assert.notEqual(fresh.url, first.url);
  assert.equal((await fetch(fresh.url)).status, 200);
  assert.equal(await (await fetch(first.url)).text(), 'unrelated listener');
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
