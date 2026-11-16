import test from 'node:test';
import assert from 'node:assert/strict';
import { createVSCodeParser } from '../src/core/vscode.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createScanner } from '../src/node/copilot-source.mjs';
import { createVSCodeSources, workspaceInfo } from '../src/node/vscode-sources.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

const event = (id, attrs = {}, extra = {}) => ({ v: 1, type: 'llm_request', sid: 'session', spanId: id, ts: Date.parse('2026-11-15T12:00:00Z'), dur: 10, status: 'ok',
  attrs: { model: 'model', inputTokens: 100, outputTokens: 20, cachedTokens: 80, copilotUsageNanoAiu: 125000000, ...attrs }, ...extra });
function parse(events) { const p = createVSCodeParser({ source: 'fixture', logFile: 'main.jsonl', project: 'project' }); for (const e of events) p.push(JSON.stringify(e)); return p.snapshot(); }

test('VS Code reads overlap with a bounded queue and preserve discovery order and individual failures', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-vscode-parallel-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('usage-vscode-parallel-'));
    await fs.rm(temp, { recursive: true, force: true });
  });
  const root = path.join(temp, 'globalStorage', 'github.copilot-chat', 'debug-logs');
  for (let i = 0; i < 24; i++) {
    const dir = path.join(root, String(i).padStart(2, '0'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'main.jsonl'), '{}\n');
  }
  let active = 0, peak = 0;
  const result = await createVSCodeSources({ defaultHomes: [temp] })({ readJournal: async (file, stat, source, session) => {
    peak = Math.max(peak, ++active);
    try {
      await new Promise(resolve => setTimeout(resolve, 30));
      if (session === '07') throw Object.assign(new Error('synthetic read error'), { code: 'EIO' });
      return { session, invalid: 0, unclassified: 0 };
    } finally { active--; }
  } });
  assert.ok(peak > 1, 'independent journal reads must not serialize filesystem waits');
  assert.ok(peak <= 8, 'cap journal reads to avoid unbounded memory and file handles');
  assert.deepEqual(result.snapshots.map(s => s.session), Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).filter(s => s !== '07'));
  assert.equal(result.files.length, 23);
  assert.equal(result.sources[0].files, 23);
  assert.equal(result.sources[0].state, 'warning');
  assert.equal(result.sources[0].diagnostic.errorCode, 'EIO');
  assert.ok(result.owners.every(owner => owner === result.sources[0]));
});

test('VS Code discovery limits remain explicit when earlier queued reads fail or contain invalid records', async t => {
  const root = path.resolve(os.tmpdir(), 'synthetic-vscode-limit'), debug = path.join(root, 'globalStorage', 'github.copilot-chat', 'debug-logs');
  t.mock.method(fs, 'stat', async file => ({ isDirectory: () => file === root, isFile: () => file !== root }));
  t.mock.method(fs, 'readdir', async dir => {
    if (dir === debug) return [{ name: 'session', isDirectory: () => true }];
    if (dir === path.join(debug, 'session')) return Array.from({ length: 20001 }, (_, i) => ({ name: `${String(i).padStart(5, '0')}.jsonl`, isFile: () => true }));
    return [];
  });
  for (const failure of [false, true]) {
    let calls = 0;
    const result = await createVSCodeSources({ defaultHomes: [root] })({ readJournal: async () => {
      calls++;
      if (failure && calls === 1) throw Object.assign(new Error('synthetic read failure'), { code: 'EIO' });
      return { invalid: calls === 1 ? 1 : 0, unclassified: 0 };
    } });
    assert.equal(calls, 20000, 'the cap still bounds all queued reads');
    assert.equal(result.sources[0].state, 'warning');
    assert.equal(result.sources[0].message, 'VS Code log discovery reached its limit.');
  }
});

test('VS Code records exact per-call charges, zero credits and inclusive tokens without retaining payloads', () => {
  const s = parse([event('a', { userRequest: 'PRIVATE_PROMPT', inputMessages: 'PRIVATE_CONTEXT', requestOptions: 'PRIVATE_OPTIONS' }), event('b', { copilotUsageNanoAiu: 0 })]);
  assert.equal(s.records.length, 2);
  assert.equal(s.records.reduce((n, r) => n + r.nanoAiu, 0), 125000000);
  assert.equal(s.records[0].total, 120);
  assert.equal(s.records[0].cacheRead, null);
  assert.equal(s.records[0].cacheWrite, null);
  assert.equal(s.records[0].reasoning, null);
  assert.equal(s.records[0].initiator, '');
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE/);
});

test('VS Code attribution requires recorded Copilot charges and excludes explicit BYOK', () => {
  const s = parse([event('a', { copilotUsageNanoAiu: undefined }), event('b', { copilotUsageNanoAiu: null }), event('c', { isByok: true }), event('d', { copilotUsageNanoAiu: -1 })]);
  assert.equal(s.records.length, 0);
  assert.equal(s.unclassified, 3);
  assert.equal(s.excluded, 1);
});

test('VS Code distinct spans sharing a response ID are separate calls; replayed spans count once', () => {
  const a = event('a'), b = event('b', { responseId: 'response' }), c = event('c', { responseId: 'response', copilotUsageNanoAiu: 300000000 });
  const shared = parse([a, a, b, c, b]);
  assert.equal(shared.records.length, 3);
  assert.equal(shared.invalid, 0);
  assert.equal(shared.records.reduce((n, r) => n + r.nanoAiu, 0), 550000000);
  assert.equal(parse([b, { ...b, spanId: 'another-span' }]).records.length, 2, 'distinct spans can also have identical amounts');
  const conflict = parse([a, event('a', { copilotUsageNanoAiu: 5 }), a]);
  assert.equal(conflict.records.length, 0);
  assert.equal(conflict.invalid, 1);
  for (const attrs of [{ isByok: true }, { providerKind: 'other' }, { copilotUsageNanoAiu: undefined }]) {
    const rejected = event('a', attrs);
    assert.equal(parse([a, rejected, a]).records.length, 0, 'rejected duplicates remove previously accepted accounting');
    assert.equal(parse([rejected, a]).records.length, 0, 'input order cannot restore rejected accounting');
  }
});

test('VS Code malformed schemas stay out, absent tokens remain unavailable, and failed responses retain recorded charges', () => {
  const s = parse([event('a', {}, { v: 99 }), event('b', {}, { ts: 1 }), event('c', { inputTokens: undefined, outputTokens: undefined }, { status: 'error' })]);
  assert.equal(s.invalid, 2);
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].total, null);
  assert.equal(s.records[0].nanoAiu, 125000000);
});

test('VS Code storage discovery combines native and WSL workspaces, tails journals and deduplicates copies', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-vscode-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'User'), cli = path.join(temp, 'cli');
  await fs.mkdir(cli);
  async function write(folder, sid, entries, uri = 'file:///C:/work/project') {
    const workspace = path.join(home, 'workspaceStorage', folder), root = path.join(workspace, 'github.copilot-chat', 'debug-logs');
    await fs.mkdir(path.join(root, sid), { recursive: true });
    await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify({ folder: uri }));
    const file = path.join(root, sid, 'main.jsonl');
    await fs.writeFile(file, entries.map(e => JSON.stringify({ ...e, sid })).join('\n') + '\n');
    return { root, file };
  }
  const a = await write('native', 'native-session', [event('a')]);
  await write('remote', 'remote-session', [event('b', { copilotUsageNanoAiu: 250000000 })], 'vscode-remote://wsl+Ubuntu/home/me/project');
  await write('copy', 'native-session', [event('a')]);
  const scanner = createScanner({ discoverVSCode: createVSCodeSources({ defaultHomes: [home], platform: 'win32' }) });
  const first = await scanner.scan([cli]);
  assert.equal(first.records.length, 2);
  assert.equal(first.records.reduce((n, r) => n + r.nanoAiu, 0), 375000000);
  assert.equal(buildReport(first.records, { range: 'all', environment: 'wsl:ubuntu' }, new Date('2026-11-15T18:00:00Z'), first).totals.credits, .25);
  assert.equal(await scanner.scan([cli]), first, 'unchanged discovery and journals reuse the snapshot');
  await fs.appendFile(a.file, JSON.stringify({ ...event('c'), sid: 'native-session' }) + '\n');
  assert.equal((await scanner.scan([cli])).records.length, 3);
  await fs.writeFile(a.file, JSON.stringify({ ...event('new'), sid: 'native-session' }) + '\n');
  assert.equal((await scanner.scan([cli])).records.length, 3, 'rewritten journal no longer retains the old appended call');
  assert.equal((await scanner.scan([cli], { includeVSCode: false })).records.length, 0);
  assert.equal((await scanner.scan([cli], { includeVSCode: false, extraVSCodeHomes: [home] })).records.length, 3);
  assert.equal((await scanner.scan([cli], { disabled: [home] })).records.length, 0);
  await fs.unlink(a.file);
  assert.equal((await scanner.scan([cli])).records.length, 2);
});

test('CLI sessions take precedence over overlapping VS Code sessions and all their child logs', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-vscode-overlap-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const cli = path.join(temp, 'cli'), user = path.join(temp, 'User');
  const cliSession = path.join(cli, 'session-state', 'shared'), debug = path.join(user, 'globalStorage', 'github.copilot-chat', 'debug-logs', 'shared');
  await fs.mkdir(cliSession, { recursive: true }); await fs.mkdir(debug, { recursive: true });
  await fs.writeFile(path.join(cliSession, 'events.jsonl'), JSON.stringify({ type: 'session.usage_record', id: 'receipt', timestamp: '2026-11-15T12:00:00Z', data: { usage: { provider: { kind: 'copilot' }, model: 'model', inputTokens: 100, outputTokens: 20, copilotUsage: { totalNanoAiu: 125000000 } } } }) + '\n');
  await fs.writeFile(path.join(debug, 'main.jsonl'), JSON.stringify(event('a', {}, { sid: 'shared' })) + '\n');
  await fs.writeFile(path.join(debug, 'child.jsonl'), JSON.stringify(event('b', {}, { sid: 'child' })) + '\n');
  const scanner = createScanner({ discoverVSCode: createVSCodeSources({ defaultHomes: [user] }) });
  const scan = await scanner.scan([cli]);
  assert.equal(scan.records.length, 1);
  assert.equal(scan.records[0].nanoAiu, 125000000);
  assert.ok(scan.sources.some(s => /Overlapping CLI/.test(s.message)));
});

test('custom User storage discovers profile logs and supports disabling a specific debug root', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-vscode-profile-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const user = path.join(temp, 'User'), root = path.join(user, 'profiles', 'profile-a', 'globalStorage', 'github.copilot-chat', 'debug-logs');
  await fs.mkdir(path.join(root, 'session'), { recursive: true });
  await fs.writeFile(path.join(root, 'session', 'main.jsonl'), JSON.stringify(event('a')) + '\n');
  const scanner = createScanner({ discoverVSCode: createVSCodeSources({ defaultHomes: [] }) });
  const options = { includeVSCode: false, extraVSCodeHomes: [user] };
  const scan = await scanner.scan([], options);
  assert.equal(scan.records.length, 1);
  assert.equal(scan.records[0].project, 'VS Code', 'missing workspace metadata does not hide accounting');
  const disabled = await scanner.scan([], { ...options, disabled: [root] });
  assert.equal(disabled.records.length, 0);
  assert.equal(disabled.sources.find(s => s.path === root).state, 'off');
  const missing = await scanner.scan([], { includeVSCode: false, extraVSCodeHomes: [path.join(temp, 'missing')] });
  assert.equal(missing.sources[0].state, 'warning');
});

test('VS Code remote workspace metadata identifies environments without reading repository content', () => {
  const fallback = { environment: 'windows', environmentName: 'Windows' };
  assert.equal(workspaceInfo({ folder: 'vscode-remote://wsl+Ubuntu/home/a/project' }, fallback).environment, 'wsl:ubuntu');
  assert.equal(workspaceInfo({ folder: 'vscode-remote://ssh-remote+server/home/a/project' }, fallback).environment, 'remote:ssh-remote+server');
  assert.equal(workspaceInfo({ folder: 'not a URL' }, fallback).environment, 'windows');
  assert.equal(workspaceInfo({ folder: 'file:///C:/work/project' }, fallback).project, 'project');
  const wsl = { environment: 'wsl:ubuntu', environmentName: 'WSL · Ubuntu' };
  assert.deepEqual(workspaceInfo({ folder: 'file:///home/alice/project-a' }, wsl), { project: 'project-a', cwd: '/home/alice/project-a', ...wsl });
  assert.equal(workspaceInfo({ workspace: 'file:///home/alice/project-b.code-workspace' }, wsl).project, 'project-b');
});
