import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { createWslDiscovery, parseWslDistributions } from '../src/node/wsl-sources.mjs';
import { sourceIdentity } from '../src/node/source-paths.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';
import { createSettings } from '../src/node/settings.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = name => `\\\\wsl.localhost\\${name}`;
const missing = () => Object.assign(new Error('PRIVATE_PATH'), { code: 'ENOENT' });
const dir = name => ({ name, isDirectory: () => true });
function discoveryFixture(options = {}) {
  const calls = [], reads = [], directories = new Map(), homes = new Set();
  const run = async (file, args, settings) => { calls.push({ file, args, settings }); return Buffer.from((args.includes('--running') ? 'Ubuntu\n' : 'Ubuntu\nDebian\ndocker-desktop\n'), 'utf16le'); };
  const io = {
    async readdir(file) { reads.push(file); if (!directories.has(file)) throw missing(); return directories.get(file).map(dir); },
    async stat(file) { reads.push(file); if (!homes.has(file)) throw missing(); return { isDirectory: () => true }; },
  };
  directories.set(root('Ubuntu') + '\\home', ['alice', 'Alice']);
  homes.add(root('Ubuntu') + '\\home\\alice\\.copilot');
  homes.add(root('Ubuntu') + '\\home\\Alice\\.copilot');
  return { calls, reads, directories, homes, discover: createWslDiscovery({ platform: 'win32', run, io, ...options }) };
}

test('WSL list decoding accepts Unicode names without accepting path traversal or command output', () => {
  assert.deepEqual(parseWslDistributions(Buffer.from('\ufeffUbuntu\r\nDebian Work\r\n', 'utf16le')), ['Ubuntu', 'Debian Work']);
  assert.deepEqual(parseWslDistributions(Buffer.from('Ubuntu\nUbuntu\nLinux-测试\n../escape\n\\bad\n.\nC:\\escape\n')), ['Ubuntu', 'Linux-测试']);
});

test('WSL discovery includes running standard homes and explains stopped distributions without starting them', async () => {
  const f = discoveryFixture();
  const result = await f.discover();
  assert.deepEqual(new Set(result.homes), f.homes);
  assert.ok(result.sources.some(s => s.path === root('Debian') && s.state === 'warning' && /stopped/.test(s.message)));
  assert.ok(!f.reads.some(p => /Debian|docker-desktop/.test(p)));
  assert.equal(f.calls.length, 2);
  for (const { file, args, settings } of f.calls) {
    assert.match(file, /wsl\.exe$/i);
    assert.ok(args.includes('--list') && args.includes('--quiet'));
    assert.ok(!args.includes('--distribution') && !args.includes('--exec'));
    assert.equal(settings.shell, false);
    assert.equal(settings.windowsHide, true);
    assert.ok(settings.timeout > 0 && settings.maxBuffer > 0);
  }
});

test('WSL paths normalize aliases but preserve Linux path case and disabled sources are not probed', async () => {
  assert.equal(sourceIdentity('\\\\wsl$\\Ubuntu\\home\\alice\\.copilot', 'win32'), sourceIdentity(root('ubuntu') + '\\home\\alice\\.copilot', 'win32'));
  assert.notEqual(sourceIdentity(root('Ubuntu') + '\\home\\Alice\\.copilot', 'win32'), sourceIdentity(root('Ubuntu') + '\\home\\alice\\.copilot', 'win32'));
  assert.equal(sourceIdentity('C:\\HOME\\.copilot', 'win32'), sourceIdentity('c:\\home\\.copilot', 'win32'));
  const f = discoveryFixture(), home = root('Ubuntu') + '\\home\\alice\\.copilot';
  const result = await f.discover({ disabled: ['\\\\wsl$\\Ubuntu\\home\\alice\\.copilot'] });
  assert.ok(result.sources.some(s => s.path === home && s.state === 'off'));
  assert.ok(!f.reads.includes(home));
  assert.deepEqual(result.homes, [root('Ubuntu') + '\\home\\Alice\\.copilot']);
});

test('non-Windows and missing WSL stay quiet, and errors and slow discovery are bounded and sanitized', async () => {
  let called = false;
  assert.deepEqual(await createWslDiscovery({ platform: 'linux', run: () => { called = true; } })(), { homes: [], sources: [] });
  assert.equal(called, false);
  assert.deepEqual(await createWslDiscovery({ platform: 'win32', run: async () => { throw missing(); } })(), { homes: [], sources: [] });
  const diagnostics = createDiagnostics();
  const failed = await createWslDiscovery({ platform: 'win32', diagnostics, run: async () => { throw Object.assign(new Error('PRIVATE_SECRET'), { code: 'EACCES' }); } })();
  assert.equal(failed.sources[0].state, 'warning');
  assert.doesNotMatch(JSON.stringify([failed, diagnostics.snapshot()]), /PRIVATE/);
  const slow = discoveryFixture({ timeoutMs: 10, io: { readdir: () => new Promise(() => {}), stat: () => { throw missing(); } } });
  const result = await slow.discover();
  assert.ok(result.sources.some(s => s.diagnostic?.errorCode === 'ETIMEDOUT'));
});

test('discovery keeps readable homes when another probe fails and reports its limits', async () => {
  const f = discoveryFixture();
  f.directories.set(root('Ubuntu') + '\\home', ['alice', ...Array.from({ length: 70 }, (_, i) => `u${i}`)]);
  const result = await f.discover();
  assert.ok(result.homes.includes(root('Ubuntu') + '\\home\\alice\\.copilot'));
  assert.ok(result.sources.some(s => /limit/.test(s.message)));
  assert.ok(f.reads.filter(p => p.endsWith('.copilot')).length <= 65);
  const noHomes = discoveryFixture();
  noHomes.homes.clear();
  assert.ok((await noHomes.discover()).sources.some(s => s.state === 'empty' && /VS Code/.test(s.message)));
});

test('a failed list command waits for its bounded peer before the helper can exit', async () => {
  let finishPeer, returned = false;
  const discover = createWslDiscovery({ platform: 'win32', run: async (_file, args) => {
    if (!args.includes('--running')) throw Object.assign(new Error('PRIVATE_COMMAND_ERROR'), { code: 'EACCES' });
    return new Promise((_, reject) => { finishPeer = () => reject(Object.assign(new Error('PRIVATE_TIMEOUT'), { killed: true })); });
  } });
  const pending = discover().then(result => { returned = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false);
  finishPeer();
  const result = await pending;
  assert.equal(result.sources[0].state, 'warning');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test('production discovery uses an isolated, bounded helper and keeps failures safe', async () => {
  const calls = [], diagnostics = createDiagnostics();
  const expected = { homes: [root('Ubuntu') + '\\home\\alice\\.copilot'], sources: [] };
  const discover = createWslDiscovery({ platform: 'win32', diagnostics, launch: async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: JSON.stringify({ result: expected, counts: { distributions: 1, running: 1, homes: 1, unavailable: 0 } }) };
  } });
  assert.deepEqual(await discover({ disabled: ['private-disabled-path'] }), expected);
  const { file, args, options } = calls[0];
  assert.equal(file, process.execPath);
  assert.match(args[0], /wsl-discovery-process\.mjs$/);
  assert.equal(options.windowsHide, true);
  assert.equal(options.shell, false);
  assert.equal(options.killSignal, 'SIGKILL');
  assert.equal(options.timeout, 17000);
  assert.ok(options.maxBuffer > 0);
  assert.deepEqual(JSON.parse(options.env.WSL_DISCOVERY_INPUT).disabled, ['private-disabled-path']);
  assert.equal(options.env.GITHUB_TOKEN, undefined);
  assert.equal(options.env.GH_TOKEN, undefined);
  assert.equal(options.env.NODE_OPTIONS, undefined);
  assert.equal(diagnostics.snapshot().entries.at(-1).homes, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /alice|private-disabled/);
  for (const launch of [async () => { throw Object.assign(new Error('PRIVATE_RAW_ERROR'), { killed: true }); }, async () => ({ stdout: 'PRIVATE_RAW_OUTPUT' })]) {
    const result = await createWslDiscovery({ platform: 'win32', launch })();
    assert.deepEqual(result.homes, []);
    assert.equal(result.sources[0].state, 'warning');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test('discovery helper returns a structured result and exits without a persistent process', async () => {
  const entry = fileURLToPath(new URL('../src/node/wsl-discovery-process.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [entry], {
    windowsHide: true, timeout: 5000, env: { ...process.env, WSL_DISCOVERY_INPUT: JSON.stringify({ disabled: [], timeoutMs: 10 }) },
  });
  const { result } = JSON.parse(stdout);
  assert.ok(Array.isArray(result.homes) && Array.isArray(result.sources));
});

test('scanner includes discovered histories, deduplicates copies and respects refresh and disabled sources', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-usage-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const native = path.join(tmp, 'native'), linux = path.join(tmp, 'linux');
  const now = new Date('2026-11-15T12:00:00Z');
  async function write(home, sid, id, tokens, credits) {
    const folder = path.join(home, 'session-state', sid);
    await fs.mkdir(folder, { recursive: true });
    const event = { type: 'session.usage_record', id, timestamp: now.toISOString(), data: { usage: {
      provider: { kind: 'copilot' }, model: 'model', inputTokens: tokens, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
      copilotUsage: { totalNanoAiu: credits * 1e9 },
    } } };
    await fs.appendFile(path.join(folder, 'events.jsonl'), JSON.stringify(event) + '\n');
  }
  await write(native, 'windows-session', 'w1', 100, 1);
  await write(linux, 'linux-session', 'l1', 200, 2);
  await fs.cp(path.join(native, 'session-state'), path.join(linux, 'session-state'), { recursive: true });
  let discoveryCalls = 0;
  const scanner = createScanner({ discoverWsl: async () => { discoveryCalls++; return { homes: [linux], sources: [] }; } });
  const first = await scanner.scan([native]);
  const report = buildReport(first.records, { range: 'all' }, now, first);
  assert.deepEqual([report.totals.sessions, report.totals.requests, report.totals.total, report.totals.credits], [2, 2, 320, 3]);
  assert.equal(await scanner.scan([native, linux]), first, 'automatic/manual source overlap reuses the unchanged snapshot');
  await write(linux, 'linux-session', 'l2', 50, 0);
  const appended = await scanner.scan([native]);
  assert.equal(appended.records.length, 3);
  const off = await scanner.scan([native], { disabled: [linux] });
  assert.equal(off.records.length, 1);
  assert.equal(off.sources.find(s => s.path === linux).state, 'off');
  const before = discoveryCalls;
  assert.equal((await scanner.scan([native], { includeWsl: false })).records.length, 1);
  assert.equal(discoveryCalls, before, 'turning off discovery does not call WSL');
  assert.equal((await scanner.scan([native, linux], { includeWsl: false })).records.length, 3, 'explicit homes remain available with automatic discovery off');
  const stopped = createScanner({ discoverWsl: async () => ({ homes: [], sources: [{ path: root('Ubuntu'), state: 'warning', message: 'Stopped' }] }) });
  const withoutWsl = await stopped.scan([native]);
  assert.equal(withoutWsl.records.length, 1);
  assert.ok(withoutWsl.sources.some(s => s.state === 'warning'));
  const unavailable = path.join(tmp, 'missing-disabled');
  assert.equal((await scanner.scan([native, unavailable], { disabled: [unavailable], includeWsl: false })).sources.find(s => s.path === unavailable).state, 'off');
});

test('report filters reuse discovered history while source settings and refresh invalidate it', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-cache-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const settings = createSettings(tmp), calls = [];
  const scanner = { async scan(roots, options) { calls.push({ roots, options }); return { records: [], sources: [], coverage: {} }; } };
  const server = await startServer({ scanner, settings, defaultHome: tmp, html: 'test' });
  t.after(() => server.close());
  const request = async (method, input = {}, refresh = false) => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input, refresh }) });
    assert.equal(response.status, 200); return response.json();
  };
  await request('usage.report', { range: '1d' });
  assert.equal(calls[0].options.includeWsl, true);
  await request('usage.report', { range: '7d' });
  await request('usage.report', { range: 'all', models: ['model'] });
  assert.equal(calls.length, 1);
  await request('settings.set', { includeWsl: false });
  await request('usage.report');
  assert.equal(calls.length, 2);
  assert.equal(calls.at(-1).options.includeWsl, false);
  await request('usage.report', {}, true);
  await request('usage.refresh');
  assert.equal(calls.length, 4);
  assert.equal(calls.at(-1).options.force, true);
});
