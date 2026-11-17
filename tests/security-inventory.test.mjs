import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSecurity } from '../scripts/validate-security.mjs';

test('offline dependency inventory verifies shipped bytes, notices and CI pins', () => {
  const inventory = validateSecurity();
  assert.equal(inventory.vendored.length, 1);
  assert.equal(inventory.vendored[0].version, '5.5.0');
});

test('changed vendor bytes and mutable CI actions fail integrity validation', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-security-inventory-'));
  t.after(() => fs.rm(temp, { force: true, recursive: true }));
  for (const file of ['package.json', 'security-dependencies.json', 'src/vendor/js-yaml/js-yaml.mjs', 'src/vendor/js-yaml/LICENSE', '.github/workflows/test.yml']) {
    await fs.mkdir(path.dirname(path.join(temp, file)), { recursive: true });
    await fs.copyFile(new URL('../' + file, import.meta.url), path.join(temp, file));
  }
  const root = pathToFileURL(temp + path.sep);
  validateSecurity(root);
  const vendor = path.join(temp, 'src/vendor/js-yaml/js-yaml.mjs'), original = await fs.readFile(vendor);
  await fs.appendFile(vendor, '\n// changed\n');
  assert.throws(() => validateSecurity(root), /Review changed vendored code/);
  await fs.writeFile(vendor, original);
  const workflow = path.join(temp, '.github/workflows/test.yml');
  await fs.writeFile(workflow, (await fs.readFile(workflow, 'utf8')).replace(/checkout@[a-f0-9]+/, 'checkout@v4'));
  assert.throws(() => validateSecurity(root), /Pin action/);
});
