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
    const line = JSON.stringify({ v: 1, type: 'llm_request', sid: `session-${i}`, spanId: 'call', ts: Date.now(), attrs: {
      model: 'synthetic', inputTokens: 100, outputTokens: 20, copilotUsageNanoAiu: 125000000, inputMessages: 'x'.repeat(kib * 1024),
    } }) + '\n';
    bytes += Buffer.byteLength(line);
    await fs.writeFile(path.join(folder, 'main.jsonl'), line);
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
    samples.push({ coldMs: Math.round(coldMs), warmMs: Math.round(performance.now() - warmStart) });
  }
  console.log(JSON.stringify({ files, bytes, samples }));
} finally {
  const target = path.resolve(temp);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('usage-vscode-bench-'));
  assert.equal((await fs.lstat(target)).isSymbolicLink(), false);
  await fs.rm(target, { recursive: true, force: true });
}
