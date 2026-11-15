import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { isLocalSkillFilePath } from '../src/node/skill-folder.mjs';

test('installed skill version reads accept only local absolute SKILL.md paths', () => {
  assert.equal(isLocalSkillFilePath(path.join(os.tmpdir(), "skill & ' greeting", 'SKILL.md')), true);
  for (const file of [undefined, '', 'relative/SKILL.md', 'https://example.com/SKILL.md', 'file:///tmp/SKILL.md', String.raw`\\server\share\SKILL.md`, String.raw`\\?\C:\SKILL.md`, '/tmp/x\u0000/SKILL.md', path.join(os.tmpdir(), 'run.exe')]) {
    assert.equal(isLocalSkillFilePath(file), false);
  }
});
