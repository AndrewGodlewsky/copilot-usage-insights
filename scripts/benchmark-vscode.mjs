// Synthetic VS Code history; no personal logs. --files=1395 --kib=1168 approximates a 1.67 GB history.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createScanner } from '../src/node/copilot-source.mjs';
import { createVSCodeSources } from '../src/node/vscode-sources.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';

const option = (name, value) => Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? value);
const files = option('files', 240), kib = option('kib', 256);
const recentPercent = option('recent-percent', 100), progressive = process.argv.some(a => a.startsWith('--recent-percent='));
assert.ok(Number.isFinite(recentPercent) && recentPercent >= 0 && recentPercent <= 100);
const recentFiles = Math.ceil(files * recentPercent / 100), now = new Date(), since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).getTime();
assert.ok(Number.isInteger(files) && files > 0 && files <= 2000 && Number.isInteger(kib) && kib > 0 && kib <= 4096);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-vscode-bench-'));
try {
  const home = path.join(temp, 'User');
  let bytes = 0;
  for (let i = 0; i < files; i++) {
    const workspace = path.join(home, 'workspaceStorage', String(i % 40).padStart(3, '0'));
    const folder = path.join(workspace, 'github.copilot-chat', 'debug-logs', `session-${i}`);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(workspace, 'workspace.json'), JSON.stringify({ folder: 'file:///C:/synthetic/project' }));
    const modified = i < recentFiles ? now : new Date(since - 30 * 86400000);
    const line = JSON.stringify({ v: 1, type: 'llm_request', sid: `session-${i}`, spanId: 'call', ts: modified.getTime(), attrs: {
      model: 'synthetic', inputTokens: 100, outputTokens: 20, copilotUsageNanoAiu: 125000000, inputMessages: 'x'.repeat(kib * 1024),
    } }) + '\n';
    bytes += Buffer.byteLength(line);
    await fs.writeFile(path.join(folder, 'main.jsonl'), line);
    if (progressive) await fs.utimes(path.join(folder, 'main.jsonl'), modified, modified);
  }
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const diagnostics = createDiagnostics();
    const scanner = createScanner({ discoverVSCode: createVSCodeSources({ defaultHomes: [home] }), diagnostics });
    const start = performance.now(), first = await scanner.scan([]), coldMs = performance.now() - start;
    assert.equal(first.records.length, files);
    assert.equal(first.records.reduce((n, r) => n + r.nanoAiu, 0), files * 125000000);
    const warmStart = performance.now();
    assert.equal(await scanner.scan([]), first);
    const sample = { coldMs: Math.round(coldMs), warmMs: Math.round(performance.now() - warmStart) };
    if (progressive) {
      const fresh = createScanner({ discoverVSCode: createVSCodeSources({ defaultHomes: [home] }) });
      const began = performance.now();
      const full = await fresh.scan([], { recentSince: since, onRecent(partial, progress) {
        assert.equal(partial.records.length, recentFiles);
        sample.recentReadyMs = Math.round(performance.now() - began);
        sample.filesDeferred = progress.filesDeferred;
      } });
      sample.historyReadyMs = Math.round(performance.now() - began);
      assert.deepEqual(full, first, 'progressive loading must not change final accounting');
    }
    samples.push(sample);
  }
  console.log(JSON.stringify({ files, bytes, ...(progressive ? { recentFiles } : {}), samples }));
} finally {
  const target = path.resolve(temp);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('usage-vscode-bench-'));
  assert.equal((await fs.lstat(target)).isSymbolicLink(), false);
  await fs.rm(target, { recursive: true, force: true });
}
