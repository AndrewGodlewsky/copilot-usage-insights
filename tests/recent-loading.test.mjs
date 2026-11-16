import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createScanner } from '../src/node/copilot-source.mjs';
import { createVSCodeSources } from '../src/node/vscode-sources.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { normalizeDatabaseRows } from '../src/node/copilot-db.mjs';

const now = new Date(2026, 10, 15, 12), since = new Date(2026, 9, 17).getTime();
const receipt = (id, timestamp, nanoAiu = 1e9) => JSON.stringify({ type: 'session.usage_record', id, timestamp,
  data: { usage: { provider: { kind: 'copilot' }, model: 'synthetic', inputTokens: 100, outputTokens: 20, copilotUsage: { totalNanoAiu: nanoAiu } } } }) + '\n';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-recent-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('usage-recent-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
test('fresh recent journals are delivered before older bytes and reconcile to the ordinary scan', async t => {
  const root = await fixture(t), cli = path.join(root, 'cli'), user = path.join(root, 'User');
  for (const [id, date, modified] of [['recent', now, now], ['old', new Date(2026, 8, 1), new Date(2026, 8, 1)], ['old-clock', now, new Date(2026, 8, 1)]]) {
    const dir = path.join(cli, 'session-state', id); await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'events.jsonl'); await fs.writeFile(file, receipt(id, date.toISOString()));
    await fs.utimes(file, modified, modified);
  }
  const folder = path.join(user, 'globalStorage', 'github.copilot-chat', 'debug-logs', 'old-vscode');
  await fs.mkdir(folder, { recursive: true });
  const vscodeFile = path.join(folder, 'main.jsonl');
  await fs.writeFile(vscodeFile, JSON.stringify({ v: 1, type: 'llm_request', sid: 'vscode-old', spanId: 'call', ts: now.getTime(), attrs: { model: 'synthetic', inputTokens: 20, outputTokens: 2, copilotUsageNanoAiu: 0 } }) + '\n');
  await fs.utimes(vscodeFile, new Date(2026, 8, 1), new Date(2026, 8, 1));
  const diagnostics = createDiagnostics(), options = { discoverVSCode: createVSCodeSources({ defaultHomes: [user] }), diagnostics };
  let early, stages = 0;
  const scanner = createScanner(options);
  const full = await scanner.scan([cli], { recentSince: since, onRecent(scan, progress) {
    stages++; early = scan;
    assert.deepEqual(scan.records.map(r => r.sessionId), ['recent']);
    assert.equal(progress.filesDeferred, 3);
    const reads = diagnostics.snapshot().entries.filter(e => e.phase === 'finished');
    assert.equal(reads.filter(e => ['history.journals', 'history.vscode'].includes(e.event)).reduce((n, e) => n + e.filesRead, 0), 1);
  } });
  assert.equal(stages, 1);
  assert.equal(full.records.length, 4, 'old timestamps cannot erase recent usage or free calls');
  assert.equal(early.records.length, 1, 'background completion cannot mutate the displayed provisional snapshot');
  const baseline = await createScanner({ discoverVSCode: createVSCodeSources({ defaultHomes: [user] }) }).scan([cli]);
  assert.deepEqual(full, baseline);
  assert.equal(diagnostics.snapshot().entries.filter(e => e.event === 'history.background' && e.phase === 'finished').length, 1);
});

function sample() {
  const parser = createReceiptParser({ source: 'synthetic', sessionId: 'session', logFile: 'events.jsonl' });
  parser.push(receipt('recent', now.toISOString()));
  return { ...parser.snapshot(), sources: [], coverage: {} };
}

test('deferred databases see all receipts, copied journals keep ownership, and fresh scans detect edits', async t => {
  const root = await fixture(t), first = path.join(root, 'first'), copy = path.join(root, 'copy');
  const old = new Date(2026, 8, 1), files = [];
  for (const [home, modified] of [[first, old], [copy, now]]) {
    const dir = path.join(home, 'session-state', 'copied'); await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'events.jsonl'); files.push(file);
    await fs.writeFile(file, receipt('same', now.toISOString())); await fs.utimes(file, modified, modified);
  }
  await fs.writeFile(path.join(first, 'session-store.db'), '');
  let discoveries = 0, reads = 0;
  const readDatabase = async (file, sessions, source) => {
    reads++;
    assert.ok(sessions.has('copied'), 'deferred journal receipts must suppress overlapping database accounting');
    return normalizeDatabaseRows(['copied', 'database-only'].map((session_id, id) => ({ id, session_id, model: 'synthetic',
      created_at: now.toISOString(), input_tokens: 100, output_tokens: 20, total_nano_aiu: 1e9 })), new Map(), sessions, source, true);
  };
  const scanner = createScanner({ readDatabase, discoverWsl: async () => { discoveries++; return { homes: [], sources: [] }; } });
  const full = await scanner.scan([first, copy], { recentSince: since, onRecent(early, progress) {
    assert.equal(reads, 0); assert.equal(progress.databasesDeferred, 1);
    assert.equal(early.records.length, 1); assert.equal(early.records[0].source, copy);
  } });
  assert.equal(discoveries, 1, 'background work reuses discovery from this operation');
  assert.equal(full.records.length, 2); assert.equal(full.records[0].source, first);
  assert.deepEqual(full, await createScanner({ readDatabase }).scan([first, copy]));
  await fs.appendFile(files[1], receipt('new', now.toISOString()));
  await fs.utimes(files[1], new Date(since), new Date(since));
  const refreshed = await scanner.scan([first, copy], { force: true, recentSince: since, onRecent(early) {
    assert.equal(early.records.length, 2, 'cutoff is inclusive and edited bytes replace earlier results');
  } });
  assert.equal(refreshed.records.length, 3);
});

test('background failure stays failed until Refresh, then retries with a fresh generation', async t => {
  let reject, scans = 0;
  const gate = new Promise((resolve, fail) => { reject = fail; }), snapshot = sample();
  const server = await startServer({ html: 'test', defaultHome: 'synthetic', now: () => now,
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async (roots, options) => {
      scans++; options.onRecent(snapshot, { files: 1, filesDeferred: 1, databasesDeferred: 0 });
      if (scans === 1) await gate;
      return snapshot;
    } },
  });
  t.after(async () => { reject(new Error('synthetic')); await server.close(); });
  const call = (method = 'usage.report') => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input: { range: '7d' } }) });
  assert.equal((await (await call()).json()).loading.scanId, 1);
  reject(new Error('synthetic background failure')); await new Promise(setImmediate);
  assert.equal((await call()).status, 500); assert.equal((await call()).status, 500); assert.equal(scans, 1);
  const retry = await (await call('usage.refresh')).json();
  assert.equal(retry.scanId, 2); assert.equal(retry.totals.credits, 1);
  const full = await (await call()).json();
  assert.equal(full.loading, undefined); assert.equal(full.scanId, 2); assert.equal(scans, 2);
});

test('month-to-date on day 31 waits while the actual last 30 calendar days are available', async t => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const at = new Date(2026, 9, 31, 12), snapshot = sample();
  const server = await startServer({ html: 'test', defaultHome: 'synthetic', now: () => at,
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async (roots, options) => {
      assert.equal(options.recentSince, new Date(2026, 9, 2).getTime());
      options.onRecent(snapshot, {}); await gate; return snapshot;
    } },
  });
  t.after(async () => { finish(); await server.close(); });
  const call = async range => (await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.report', input: { range } }) })).json();
  assert.equal((await call('mtd')).loading.phase, 'history');
  assert.equal((await call('30d')).loading.phase, 'recent');
});
test('server serves fresh recent results, keeps wider ranges loading, and polls one scan through completion', async t => {
  let finish, scans = 0;
  const gate = new Promise(resolve => { finish = resolve; }), snapshot = sample();
  const server = await startServer({ html: 'test', defaultHome: 'synthetic', now: () => now,
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async (roots, options) => {
      scans++;
      assert.equal(options.recentSince, since);
      assert.equal(typeof options.onRecent, 'function');
      options.onRecent(snapshot, { files: 4, filesDeferred: 3, databasesDeferred: 0 });
      await gate; return snapshot;
    } },
  });
  t.after(async () => { finish(); await server.close(); });
  const call = async (input, extra = {}) => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.report', input, ...extra }) });
    assert.equal(response.status, 200); return response.json();
  };
  const early = await call({ range: 'mtd' }, { refresh: true });
  assert.equal(early.loading.phase, 'recent');
  assert.equal(early.totals.credits, 1);
  assert.equal(early.promptCredits.pending, true);
  assert.equal(early.promptCredits.averageCredits, null);
  for (const range of ['1d', '7d', '30d']) assert.equal((await call({ range })).loading.phase, 'recent');
  for (const range of ['90d', 'all']) {
    const pending = await call({ range });
    assert.equal(pending.loading.phase, 'history'); assert.equal(pending.totals, undefined);
  }
  assert.equal((await call({ range: 'custom', startDate: '2026-10-17', endDate: '2026-11-15' })).loading.phase, 'recent');
  assert.equal((await call({ range: 'custom', startDate: '2026-10-16', endDate: '2026-11-15' })).loading.phase, 'history');
  assert.equal((await call({ range: 'mtd' }, { known: early.revision })).unchanged, true);
  assert.equal((await call({ range: '7d' }, { refresh: true })).loading.phase, 'recent');
  assert.equal(scans, 1, 'polls, filters and Refresh during the active operation do not start parallel scans');
  finish(); await new Promise(setImmediate);
  const full = await call({ range: 'mtd' }, { known: early.revision });
  assert.equal(full.loading, undefined);
  assert.equal(full.unchanged, undefined, 'completion must replace the provisional view even with identical totals');
  assert.equal(full.totals.credits, 1);
  assert.equal((await call({ range: 'all' })).totals.credits, 1);
});
