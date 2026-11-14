import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { folderCommand, launchFolder, openSkillFolder } from '../src/node/skill-folder.mjs';

test('folder commands pass a literal path to a file manager on each supported OS', () => {
  const folder = 'a folder & $(not-a-command)';
  const windows = folderCommand(folder, 'win32');
  assert.match(windows.file, /explorer\.exe$/i);
  assert.deepEqual(windows.args, [folder]);
  assert.deepEqual(folderCommand(folder, 'darwin'), { file: '/usr/bin/open', args: ['-a', 'Finder', '--', folder] });
  assert.deepEqual(folderCommand(folder, 'linux'), { file: 'xdg-open', args: [folder] });
  assert.throws(() => folderCommand(folder, 'unknown'), /not supported/);
});

test('opening a skill validates a local SKILL.md file and launches its containing folder', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-open-skill-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "skill & ' greeting");
  await fs.mkdir(dir);
  const file = path.join(dir, 'SKILL.md');
  await fs.writeFile(file, '# Synthetic skill');
  const calls = [], launch = async (...args) => calls.push(args);
  await openSkillFolder(file, { launch });
  assert.deepEqual(calls[0], [folderCommand(dir, process.platform).file, folderCommand(dir, process.platform).args]);
  for (const bad of ['', 'relative/SKILL.md', 'https://example.com/SKILL.md', 'file:///tmp/SKILL.md', '\\\\server\\share\\SKILL.md', '\\\\?\\C:\\SKILL.md', '/tmp/x\u0000/SKILL.md', path.join(dir, 'run.exe')]) {
    await assert.rejects(openSkillFolder(bad, { launch }));
  }
  await fs.unlink(file);
  await assert.rejects(openSkillFolder(file, { launch }), /no longer available/);
  await fs.mkdir(file);
  await assert.rejects(openSkillFolder(file, { launch }), /not a file/);
  assert.equal(calls.length, 1);
});

test('file-manager failures after startup are reported on macOS and Linux', async () => {
  for (const platform of ['darwin', 'linux']) {
    await launchFolder(process.execPath, ['-e', 'process.exit(0)'], platform);
    await assert.rejects(launchFolder(process.execPath, ['-e', 'process.exit(4)'], platform), /could not open/);
  }
});
