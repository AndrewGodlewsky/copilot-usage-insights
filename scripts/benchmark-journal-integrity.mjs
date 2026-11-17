import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScanner } from '../src/node/copilot-source.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';

// Synthetic local files only. --mib=1 is a quick self-check; defaults exercise larger prefixes.
const arg = process.argv.slice(2);
if (arg.some(v => !/^--mib=\d+(?:,\d+)*$/.test(v)) || arg.length > 1) throw new Error('Usage: node scripts/benchmark-journal-integrity.mjs [--mib=32,256,1024]');
const sizes = arg.length ? arg[0].slice(6).split(',').map(Number) : [32, 256, 1024];
if (sizes.length > 8 || sizes.some(v => !Number.isSafeInteger(v) || v < 1 || v > 2048)) throw new Error('Choose one to eight sizes from 1 to 2048 MiB');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-integrity-benchmark-'));
const round = value => Math.round(value * 10) / 10;
const receipt = (id, credits = 1) => JSON.stringify({ type: 'session.usage_record', id, timestamp: '2026-11-15T12:00:00Z',
  data: { usage: { provider: { kind: 'copilot' }, model: 'test-model', inputTokens: 100, outputTokens: 20,
    copilotUsage: { totalNanoAiu: credits * 1e9 } } } }) + '\n';
const block = Buffer.from(JSON.stringify({ type: 'hook.start', data: { content: 'x'.repeat(65480) } }) + '\n');
try {
  for (const mib of sizes) {
    const home = path.join(root, String(mib)), folder = path.join(home, 'session-state', 'synthetic');
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, 'events.jsonl'), handle = await fs.open(file, 'w');
    try {
      await handle.write(receipt('initial'));
      for (let bytes = 0; bytes < mib * 1048576; bytes += block.length) await handle.write(block);
    } finally { await handle.close(); }
    const diagnostics = createDiagnostics(), scanner = createScanner({ diagnostics });
    const run = async (options = {}) => {
      const started = performance.now(), result = await scanner.scan([home], options);
      const wallMs = round(performance.now() - started);
      const e = diagnostics.snapshot().entries.filter(e => e.event === 'history.journals' && e.phase === 'finished').at(-1);
      return { result, timing: { wallMs, bytesRead: e.bytesRead, bytesHashed: e.bytesHashed,
        prefixChecks: e.prefixChecks, prefixMismatches: e.prefixMismatches, prefixCheckMs: e.prefixCheckMs } };
    };
    const cold = await run(), unchanged = await run();
    assert.equal(unchanged.result, cold.result);
    assert.equal(unchanged.timing.bytesHashed, 0);
    const appends = [];
    for (let i = 0; i < 3; i++) {
      const prefixBytes = (await fs.stat(file)).size;
      await fs.appendFile(file, receipt('append-' + i));
      const next = await run();
      assert.equal(next.result.records.length, i + 2);
      assert.equal(next.timing.bytesHashed, prefixBytes);
      assert.equal(next.timing.prefixChecks, 1);
      assert.equal(next.timing.prefixMismatches, 0);
      appends.push(next.timing);
    }
    const edit = await fs.open(file, 'r+');
    try { assert.equal(receipt('initial', 2).length, receipt('initial').length); await edit.write(receipt('initial', 2), 0, 'utf8'); }
    finally { await edit.close(); }
    await fs.appendFile(file, receipt('after-edit'));
    const rewritten = await run(), forced = await run({ force: true });
    assert.equal(rewritten.timing.prefixMismatches, 1);
    assert.equal(rewritten.result.records.reduce((sum, record) => sum + record.nanoAiu, 0), 6e9);
    assert.deepEqual(rewritten.result.records, forced.result.records);
    console.log(JSON.stringify({ node: process.version, platform: process.platform, mib, fileBytes: (await fs.stat(file)).size,
      cold: cold.timing, unchanged: unchanged.timing, appends, rewritten: rewritten.timing, forced: forced.timing }));
  }
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('usage-integrity-benchmark-'));
  await fs.rm(root, { recursive: true, force: true });
}
