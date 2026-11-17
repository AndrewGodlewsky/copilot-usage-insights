import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSettings } from '../src/node/settings.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-settings-pause-race-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

for (const targetPaused of [true, false]) test(`a late general-settings write cannot overwrite ${targetPaused ? 'pause' : 'resume'} from another instance`, { timeout: 5000 }, async t => {
  const directory = await fixture(t), entered = deferred(), release = deferred();
  const file = path.join(directory, 'settings.json'), originalRename = fs.rename;
  await createSettings(directory).set({ paused: !targetPaused });
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === file && JSON.parse(await fs.readFile(from, 'utf8')).textSize === 'large') {
      entered.resolve(); await release.promise;
    }
    return originalRename(from, to);
  });
  const generalWrite = createSettings(directory).set({ textSize: 'large' });
  try {
    await entered.promise;
    await createSettings(directory).set({ paused: targetPaused });
    assert.equal((await createSettings(directory).get()).paused, targetPaused);
  } finally { release.resolve(); }
  assert.equal((await generalWrite).paused, targetPaused);
  const saved = await createSettings(directory).get();
  assert.equal(saved.paused, targetPaused);
  assert.equal(saved.textSize, 'large');
});

test('legacy pause settings remain readable but an explicit pause choice is independent of general settings', async t => {
  const directory = await fixture(t), file = path.join(directory, 'settings.json');
  await fs.writeFile(file, JSON.stringify({ paused: true, textSize: 'large' }));
  const settings = createSettings(directory);
  assert.equal((await settings.get()).paused, true);
  await settings.set({ simplifyNumbers: false });
  assert.equal((await settings.get()).paused, true);
  const original = await fs.readFile(file, 'utf8');
  await settings.set({ paused: false });
  assert.equal(await fs.readFile(file, 'utf8'), original, 'pause-only writes do not replace general preferences');
  assert.equal((await createSettings(directory).get()).paused, false);
  await fs.writeFile(file, JSON.stringify({ paused: true }));
  assert.equal((await createSettings(directory).get()).paused, false, 'explicit sidecar state takes precedence over legacy settings');
});

test('unreadable pause state fails closed and is not replaced by a general settings save', async t => {
  const directory = await fixture(t), file = path.join(directory, 'pause.json');
  const settings = createSettings(directory);
  for (const invalid of ['{bad', 'null', '"false"', '{}']) {
    await fs.writeFile(file, invalid);
    await assert.rejects(settings.get(), /pause state/i);
    await assert.rejects(settings.set({ textSize: 'large' }), /pause state/i);
    assert.equal(await fs.readFile(file, 'utf8'), invalid);
  }
});
