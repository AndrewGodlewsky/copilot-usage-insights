import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { copilotHome } from '../src/node/settings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const marker = '.usage-insights-install.json';
const identity = 'copilot-usage-insights';
async function exists(file) {
  try { return await fs.lstat(file); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function installLocal({ destination = path.join(copilotHome(), 'extensions', 'usage-insights') } = {}) {
  destination = path.resolve(destination);
  const parent = path.dirname(destination), name = path.basename(destination);
  if (parent === destination || destination === path.resolve(root) || path.resolve(root).startsWith(destination + path.sep)) throw new Error('Refusing an unsafe installation destination');
  const previous = await exists(destination);
  if (previous) {
    let owned = false;
    try { owned = JSON.parse(await fs.readFile(path.join(destination, marker), 'utf8')).id === identity; } catch {}
    if (!previous.isDirectory() || previous.isSymbolicLink() || !owned) throw new Error(`Refusing to overwrite an unrelated extension at ${destination}`);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  await fs.access(path.join(root, 'panel', 'index.html'));
  await fs.mkdir(parent, { recursive: true });
  const stage = path.join(parent, `.${name}-stage-${randomUUID()}`);
  const backup = path.join(parent, `.${name}-backup-${randomUUID()}`);
  // All recursive removals are limited to these generated siblings in the verified parent.
  for (const target of [stage, backup]) if (path.dirname(target) !== parent || target === destination) throw new Error('Unsafe temporary installation path');
  let backedUp = false;
  try {
    await fs.mkdir(stage);
    for (const file of ['src', 'panel', 'licenses', 'LICENSE', 'package.json']) await fs.cp(path.join(root, file), path.join(stage, file), { recursive: true });
    await fs.writeFile(path.join(stage, 'extension.mjs'), "import './src/extension.mjs';\n");
    await fs.writeFile(path.join(stage, marker), JSON.stringify({ id: identity, version: manifest.version }, null, 2) + '\n');
    if (previous) { await fs.rename(destination, backup); backedUp = true; }
    try { await fs.rename(stage, destination); }
    catch (e) { if (backedUp) { await fs.rename(backup, destination); backedUp = false; } throw e; }
    if (backedUp) await fs.rm(backup, { recursive: true, force: true });
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(`Installed Usage Insights at ${await installLocal()}\nStart a new Copilot desktop session and ask: Open Usage Insights.`); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
