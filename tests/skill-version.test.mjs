import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSkillVersion, readInstalledSkillVersion } from '../src/node/skill-version.mjs';

const frontmatter = header => `---\n${header}\n---\nPRIVATE SKILL INSTRUCTIONS`;

test('skill version supports YAML metadata maps, quoting, comments, and aliases', () => {
  for (const [source, version] of [
    [frontmatter('metadata:\n  author: example\n  version: 1.2.3 # release'), '1.2.3'],
    [frontmatter('metadata: {version: "1.0", author: example}'), '1.0'],
    [frontmatter("metadata:\n  version: '2.3.0-beta+build.7'"), '2.3.0-beta+build.7'],
    [frontmatter('release: &release "3.0.0"\nmetadata:\n  version: *release'), '3.0.0'],
    ['\uFEFF' + frontmatter('metadata:\n  version: "4.0.0"').replaceAll('\n', '\r\n'), '4.0.0'],
    [frontmatter('description: |\n  metadata:\n    version: wrong\nmetadata:\n  version: "5.0.0"'), '5.0.0'],
  ]) assert.deepEqual(parseSkillVersion(source), { value: version, status: 'available' });
});

test('skill version does not confuse body text, other version fields, or malformed metadata', () => {
  for (const source of [
    frontmatter('name: example'), frontmatter('version: "1.2.3"'),
    frontmatter('metadata: {author: example}'), frontmatter('metadata: {version: ""}'),
    'metadata:\n  version: "1.2.3"', frontmatter('name: example') + '\nmetadata:\n  version: "9.9.9"',
    frontmatter('description: |\n  metadata:\n    version: "9.9.9"'),
  ]) assert.deepEqual(parseSkillVersion(source), { value: null, status: 'not-declared' });
  for (const header of [
    'metadata: [broken', 'metadata: {version: 1.2}', 'metadata: {version: true}',
    'metadata: {version: ["1.0.0"]}', 'metadata: {version: {name: "1.0.0"}}',
    'metadata: {version: "1.0.0", version: "2.0.0"}',
    'metadata: {version: !custom "1.0.0"}', 'metadata: []',
    'metadata:\n  version: "one\\ntwo"', `metadata: {version: "${'a'.repeat(257)}"}`,
  ]) assert.deepEqual(parseSkillVersion(frontmatter(header)), { value: null, status: 'unavailable' }, header);
  assert.equal(parseSkillVersion('---\nmetadata:\n  version: "1.0.0"').status, 'unavailable');
});

test('version reads are bounded, local, and tolerate unavailable skill files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installed-skill-version-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'SKILL.md');
  await fs.writeFile(file, frontmatter('metadata: {version: "1.2.3"}') + 'x'.repeat(100000));
  assert.deepEqual(await readInstalledSkillVersion(file), { value: '1.2.3', status: 'available' });
  await fs.writeFile(file, frontmatter('description: ' + 'x'.repeat(65536) + '\nmetadata: {version: "1.2.3"}'));
  assert.equal((await readInstalledSkillVersion(file)).status, 'unavailable');
  await fs.writeFile(file, frontmatter('name: example'));
  assert.equal((await readInstalledSkillVersion(file)).status, 'not-declared');
  await fs.unlink(file);
  assert.equal((await readInstalledSkillVersion(file)).status, 'unavailable');
  await fs.mkdir(file);
  assert.equal((await readInstalledSkillVersion(file)).status, 'unavailable');
  for (const bad of ['', null, 'relative/SKILL.md', 'https://example.com/SKILL.md', 'file:///tmp/SKILL.md', '\\\\server\\share\\SKILL.md', '\\\\?\\C:\\SKILL.md', '/tmp/x\u0000/SKILL.md', path.join(root, 'another.md')]) {
    assert.deepEqual(await readInstalledSkillVersion(bad), { value: null, status: 'unavailable' });
  }
});
