import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];

function walkFiles(dir, baseDir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, baseDir, out);
    else out.push(path.relative(baseDir, full).split(path.sep).join('/'));
  }
  return out;
}

export function validateSecurity(root = new URL('../', import.meta.url)) {
  const read = file => readFileSync(new URL(file, root));
  const rootPath = fileURLToPath(root);
  const manifests = ['package.json'];
  const extPkg = 'com.github.copilot/extensions/usage-insights/package.json';
  if (existsSync(path.join(rootPath, extPkg))) manifests.push(extPkg);
  for (const file of manifests) {
    const manifest = JSON.parse(read(file));
    for (const field of DEP_FIELDS) {
      if (Object.keys(manifest[field] || {}).length) {
        throw new Error(`Dependency inventory must be reviewed when ${file} ${field} changes`);
      }
    }
  }
  const inventory = JSON.parse(read('security-dependencies.json'));
  if (inventory.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(inventory.reviewedAt)) throw new Error('Invalid security inventory');
  const inventoried = new Set();
  for (const dependency of inventory.vendored) {
    for (const file of [dependency.file, dependency.licenseFile]) {
      if (!/^src\/vendor\/[\w./-]+$/.test(file) || file.includes('..')) throw new Error('Invalid vendor path');
      inventoried.add(file);
    }
    if (!read(dependency.licenseFile).length) throw new Error(`Missing license: ${dependency.name}`);
    if (createHash('sha256').update(read(dependency.file)).digest('hex') !== dependency.sha256) throw new Error(`Review changed vendored code: ${dependency.name}`);
  }
  const vendorDir = path.join(rootPath, 'src', 'vendor');
  if (existsSync(vendorDir)) {
    const allowedDocs = new Set([...inventoried].map(f => path.posix.join(path.posix.dirname(f), 'README.md')));
    for (const rel of walkFiles(vendorDir, rootPath)) {
      if (!inventoried.has(rel) && !allowedDocs.has(rel)) throw new Error(`Uninventoried vendored file: ${rel}`);
    }
  }
  const workflowsDir = path.join(rootPath, '.github', 'workflows');
  const workflowFiles = existsSync(workflowsDir)
    ? readdirSync(workflowsDir).filter(f => /\.(ya?ml)$/i.test(f)).sort()
    : [];
  if (!workflowFiles.length) throw new Error('CI workflow files not found');
  for (const wf of workflowFiles) {
    const workflow = read(`.github/workflows/${wf}`).toString();
    for (const [, ref] of workflow.matchAll(/uses:\s+([^\s]+)/g)) {
      if (!/@[0-9a-f]{40}$/.test(ref)) throw new Error(`Pin action to a reviewed commit in ${wf}: ${ref}`);
    }
    if (!/permissions:\s*\r?\n\s+contents:\s*read\b/.test(workflow)) {
      throw new Error(`CI requires explicit read-only permissions in ${wf}`);
    }
    if (/^\s*[\w-]+:\s*write\b/m.test(workflow)) {
      throw new Error(`CI workflow ${wf} must not grant write permissions`);
    }
  }
  return inventory;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const inventory = validateSecurity();
  console.log(`Offline integrity checks passed: ${inventory.vendored.length} vendored dependency; inventory reviewed ${inventory.reviewedAt}. This does not check for new advisories.`);
}
