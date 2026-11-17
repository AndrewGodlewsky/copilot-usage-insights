import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function validateSecurity(root = new URL('../', import.meta.url)) {
  const read = file => readFileSync(new URL(file, root));
  const manifest = JSON.parse(read('package.json'));
  if (Object.keys(manifest.dependencies || {}).length || Object.keys(manifest.devDependencies || {}).length) throw new Error('Dependency inventory must be reviewed when npm dependencies change');
  const inventory = JSON.parse(read('security-dependencies.json'));
  if (inventory.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(inventory.reviewedAt)) throw new Error('Invalid security inventory');
  for (const dependency of inventory.vendored) {
    for (const file of [dependency.file, dependency.licenseFile]) if (!/^src\/vendor\/[\w./-]+$/.test(file) || file.includes('..')) throw new Error('Invalid vendor path');
    if (!read(dependency.licenseFile).length) throw new Error(`Missing license: ${dependency.name}`);
    if (createHash('sha256').update(read(dependency.file)).digest('hex') !== dependency.sha256) throw new Error(`Review changed vendored code: ${dependency.name}`);
  }
  const workflow = read('.github/workflows/test.yml').toString();
  for (const [, ref] of workflow.matchAll(/uses:\s+([^\s]+)/g)) if (!/@[0-9a-f]{40}$/.test(ref)) throw new Error(`Pin action to a reviewed commit: ${ref}`);
  if (!/permissions:\s*\n\s+contents: read/.test(workflow)) throw new Error('CI requires explicit read-only permissions');
  return inventory;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const inventory = validateSecurity();
  console.log(`Offline integrity checks passed: ${inventory.vendored.length} vendored dependency; inventory reviewed ${inventory.reviewedAt}. This does not check for new advisories.`);
}
