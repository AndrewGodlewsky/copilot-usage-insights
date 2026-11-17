import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createVSCodeSources } from '../src/node/vscode-sources.mjs';

test('VS Code discovery releases removed and disabled workspace metadata without changing its values', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-vscode-cache-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(home).startsWith('usage-vscode-cache-'));
    assert.equal((await fs.lstat(home)).isSymbolicLink(), false);
    await fs.rm(home, { recursive: true, force: true });
  });
  const workspace = path.join(home, 'workspaceStorage', 'synthetic');
  await fs.mkdir(workspace, { recursive: true });
  const file = path.join(workspace, 'workspace.json');
  await fs.writeFile(file, JSON.stringify({ folder: 'file:///synthetic/project' }));
  let reads = 0;
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (...args) => { if (args[0] === file) reads++; return readFile(...args); });
  const discover = createVSCodeSources({ defaultHomes: [home] });
  const first = await discover({});
  assert.deepEqual(await discover({}), first);
  assert.equal(reads, 1, 'present unchanged metadata remains cached');
  await discover({ include: false });
  assert.deepEqual(await discover({}), first);
  assert.equal(reads, 2, 'excluded roots release their cached metadata');
  const hidden = path.join(home, 'workspaceStorage', '.removed');
  await fs.rename(workspace, hidden);
  await discover({});
  await fs.rename(hidden, workspace);
  assert.deepEqual(await discover({}), first);
  assert.equal(reads, 3, 'removed workspace entries are not retained indefinitely');
  await discover({ disabled: [home] });
  assert.deepEqual(await discover({}), first);
  assert.equal(reads, 4, 'disabled roots release metadata and reread it when enabled');
});
