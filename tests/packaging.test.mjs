import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Script } from 'node:vm';
import { execFileSync } from 'node:child_process';

test('marketplace package has a runnable desktop entry and self-contained dashboard', async () => {
  const root = new URL('../', import.meta.url);
  const read = file => fs.readFile(new URL(file, root), 'utf8');
  const plugin = JSON.parse(await read('plugin.json'));
  const marketplace = JSON.parse(await read('.github/plugin/marketplace.json'));
  const entry = marketplace.plugins.find(p => p.name === plugin.name);
  assert.equal(entry.version, plugin.version);
  assert.equal(entry.source, './');
  assert.match(plugin.$schema, /agent-plugins\.org\/schemas\/1\.0\.0\/plugin\.schema\.json$/);
  const html = await read('panel/index.html');
  const license = (await read('LICENSE')).trim();
  assert.match(license, /Copyright \(c\) 2026 Etherll/);
  assert.ok(html.includes(license), 'standalone dashboard retains the full upstream MIT notice');
  assert.ok(html.includes('https://github.com/Etherll/orca-usage-insights'));
  assert.match(html, /<button id="plugin-version"[^>]*aria-haspopup="dialog"[^>]*>/);
  assert.ok(html.includes(`>v${plugin.version}</button>`));
  assert.ok(html.includes(`const BUILD_VERSION = ${JSON.stringify(plugin.version)};`));
  new Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  assert.doesNotMatch(html, /PANEL_SCRIPT|PANEL_STYLES|<script[^>]+src=/);
  // Exercise the package's real relative import graph with only the host SDK substituted.
  const url = new URL('com.github.copilot/extensions/usage-insights/extension.mjs', root).href;
  const sdk = 'data:text/javascript,' + encodeURIComponent(`export const createCanvas = x => x; export async function joinSession(config) { if (!config.canvases?.length || !config.tools?.length) throw new Error('Missing registrations'); console.log('SDK registration reached'); return {}; }`);
  const smoke = `import { registerHooks } from 'node:module'; registerHooks({ resolve(name, context, next) { return name === '@github/copilot-sdk/extension' ? { url: ${JSON.stringify(sdk)}, shortCircuit: true } : next(name, context); } }); await import(${JSON.stringify(url)});`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', smoke], { encoding: 'utf8' });
  assert.match(output, /SDK registration reached/);
});

test('release history is complete, ordered, and bundled with the current build', async () => {
  const read = file => fs.readFile(new URL('../' + file, import.meta.url), 'utf8');
  const notes = JSON.parse(await read('release-notes.json'));
  const { version } = JSON.parse(await read('package.json'));
  assert.equal(notes[0].version, version);
  const versions = notes.map(entry => entry.version);
  assert.equal(new Set(versions).size, versions.length);
  assert.deepEqual(versions, versions.toSorted((a, b) => b.localeCompare(a, 'en', { numeric: true })));
  for (let patch = 0; patch <= 55; patch++) assert.ok(versions.includes(`0.1.${patch}`), 'retains historical Copilot release ' + patch);
  for (const note of notes) {
    assert.match(note.version, /^\d+\.\d+\.\d+$/);
    assert.equal(typeof note.summary, 'string');
    assert.ok(note.summary.trim().length > 0 && note.summary.length <= 400);
    assert.doesNotMatch(note.summary, /[\r\n]/);
  }
  const html = await read('panel/index.html');
  assert.ok(html.includes(`const RELEASE_NOTES = ${JSON.stringify(notes).replaceAll('<', '\\u003c')};`));
});
