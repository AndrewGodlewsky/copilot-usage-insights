import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createScanner } from '../src/node/copilot-source.mjs';
import { createDiagnostics, parseRuntimeDiagnostics, loadTimingSummary } from '../src/core/diagnostics.mjs';

const receipt = (id, credits = 1) => JSON.stringify({ id, type: 'session.usage_record', timestamp: '2026-11-15T12:00:00Z', data: { usage: {
  provider: { kind: 'copilot' }, model: 'test-model', inputTokens: 100, outputTokens: 20,
  cacheReadTokens: 0, cacheWriteTokens: 0, copilotUsage: { totalNanoAiu: credits * 1e9 },
} } }) + '\n';
async function fixture(t, text = receipt('initial')) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-integrity-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const folder = path.join(home, 'session-state', 'PRIVATE_SESSION');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'events.jsonl');
  await fs.writeFile(file, text);
  const diagnostics = createDiagnostics(), scanner = createScanner({ diagnostics });
  const latest = () => diagnostics.snapshot().entries.filter(e => e.event === 'history.journals' && e.phase === 'finished').at(-1);
  const scan = async (options = {}) => scanner.scan([home], options);
  const totals = result => [result.records.length, result.records.reduce((n, r) => n + r.nanoAiu, 0)];
  return { home, file, scanner, scan, diagnostics, latest, totals };
}

test('full prefix verification detects an edited charge before a large unchanged suffix and an append', async t => {
  const padding = JSON.stringify({ type: 'hook.start', data: { content: 'PRIVATE_TEXT'.repeat(50000) } }) + '\n';
  const f = await fixture(t, receipt('initial', 1) + padding);
  assert.deepEqual(f.totals(await f.scan()), [1, 1e9]);
  const before = (await fs.stat(f.file)).size;
  await fs.writeFile(f.file, receipt('initial', 2) + padding + receipt('next', 3));
  const changed = await f.scan();
  assert.deepEqual(f.totals(changed), [2, 5e9]);
  assert.equal(f.latest().prefixChecks, 1);
  assert.equal(f.latest().prefixMismatches, 1);
  assert.equal(f.latest().bytesHashed, before);
  assert.equal(f.latest().filesRead, 1);
  assert.equal(f.latest().filesAppended, 0);
  assert.ok(Number.isFinite(f.latest().prefixCheckMs) && f.latest().prefixCheckMs >= 0);
  assert.deepEqual(changed.records, (await createScanner().scan([f.home])).records);
  const exported = parseRuntimeDiagnostics(f.diagnostics.snapshot().entries.map(e => JSON.stringify(e)).join('\n'));
  assert.ok(exported.some(e => e.prefixMismatches === 1));
  assert.match(loadTimingSummary(exported), /prefixChecks=1.*prefixMismatches=1.*prefixCheckMs=/);
  assert.doesNotMatch(JSON.stringify(exported), /PRIVATE|usage-integrity-|session-state/);
});

test('file replacement is detected even if size and timestamps match the cached journal', async t => {
  const f = await fixture(t);
  const initial = await f.scan(), before = await fs.stat(f.file);
  const replacement = f.file + '.replacement';
  await fs.writeFile(replacement, receipt('initial', 2));
  await fs.rename(replacement, f.file);
  const replaced = await fs.stat(f.file);
  assert.notEqual(replaced.ino, before.ino);
  const originalStat = fs.stat;
  t.mock.method(fs, 'stat', async (file, ...args) => {
    const stat = await originalStat(file, ...args);
    return file === f.file ? Object.assign(stat, { mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs }) : stat;
  });
  const changed = await f.scan();
  assert.notEqual(changed, initial);
  assert.deepEqual(f.totals(changed), [1, 2e9]);
  assert.equal(f.latest().filesReused, 0);
  assert.equal(f.latest().prefixChecks, 0);
});

test('same-size edits with restored mtime, truncation and regrowth match fresh scans', async t => {
  const f = await fixture(t, receipt('initial', 1) + receipt('second', 2));
  await f.scan();
  const before = await fs.stat(f.file);
  for (const [text, expected] of [[receipt('initial', 4) + receipt('second', 2), [2, 6e9]], ['', [0, 0]], [receipt('third', 3), [1, 3e9]]]) {
    await fs.writeFile(f.file, text);
    await fs.utimes(f.file, before.atime, before.mtime);
    const actual = await f.scan();
    assert.deepEqual(f.totals(actual), expected);
    assert.deepEqual(actual.records, (await createScanner().scan([f.home])).records);
  }
});

test('partial lines, copies and force refresh preserve exact counts and prefix diagnostics', async t => {
  const f = await fixture(t, receipt('initial') + receipt('next', 2).trimEnd());
  assert.deepEqual(f.totals(await f.scan()), [1, 1e9]);
  await fs.appendFile(f.file, '\n');
  const complete = await f.scan();
  assert.deepEqual(f.totals(complete), [2, 3e9]);
  assert.equal(f.latest().bytesHashed, Buffer.byteLength(receipt('initial')));
  assert.equal(f.latest().prefixChecks, 1);
  assert.equal(f.latest().prefixMismatches, 0);
  assert.equal(await f.scan(), complete);
  assert.equal(f.latest().prefixChecks, 0);
  assert.equal(f.latest().prefixCheckMs, 0);
  assert.deepEqual((await f.scan({ force: true })).records, complete.records);
  assert.equal(f.latest().prefixChecks, 0);
  assert.equal(f.latest().filesRead, 1);
  const copy = await fixture(t, await fs.readFile(f.file, 'utf8'));
  assert.deepEqual(f.totals(await f.scanner.scan([f.home, copy.home])), [2, 3e9]);
});

test('a concurrent append remains available on the next scan without double counting', async t => {
  const f = await fixture(t);
  const open = fs.open;
  let appended = false;
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === f.file && !appended) {
      const read = handle.read.bind(handle);
      handle.read = async (...args) => {
        const result = await read(...args);
        if (!appended) { appended = true; await fs.appendFile(f.file, receipt('concurrent', 2)); }
        return result;
      };
    }
    return handle;
  });
  assert.deepEqual(f.totals(await f.scan()), [1, 1e9]);
  assert.deepEqual(f.totals(await f.scan()), [2, 3e9]);
  assert.deepEqual(f.totals(await f.scan({ force: true })), [2, 3e9]);
});

test('prefix verification responds to cancellation and releases the file handle', async t => {
  const f = await fixture(t), controller = new AbortController();
  const scanner = createScanner({ signal: controller.signal });
  await scanner.scan([f.home]);
  await fs.appendFile(f.file, receipt('next'));
  const open = fs.open;
  let closed = false;
  t.mock.method(fs, 'open', async (file, ...args) => {
    const handle = await open(file, ...args);
    if (file === f.file) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...args) => { const result = await read(...args); controller.abort(); return result; };
      handle.close = async () => { await close(); closed = true; };
    }
    return handle;
  });
  await assert.rejects(scanner.scan([f.home]), { name: 'AbortError' });
  assert.equal(closed, true);
  assert.deepEqual(f.totals(await createScanner().scan([f.home])), [2, 2e9]);
});
