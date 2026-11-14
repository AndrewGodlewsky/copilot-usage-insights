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
  assert.ok(html.includes(`<span id="plugin-version">v${plugin.version}</span>`));
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
