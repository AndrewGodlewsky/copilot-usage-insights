import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installLocal } from '../scripts/install-local.mjs';

test('local installation is portable, repeatable, and refuses unrelated extensions', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-install-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const destination = path.join(temp, 'extensions', 'usage-insights');
  await installLocal({ destination });
  for (const file of ['LICENSE', 'src/vendor/js-yaml/LICENSE', 'licenses/enhance-prompt-LICENSE']) {
    assert.equal(await fs.readFile(path.join(destination, file), 'utf8'), await fs.readFile(new URL('../' + file, import.meta.url), 'utf8'));
  }
  assert.match(await fs.readFile(path.join(destination, 'extension.mjs'), 'utf8'), /\.\/src\/extension\.mjs/);
  assert.match(await fs.readFile(path.join(destination, 'panel', 'index.html'), 'utf8'), /Copilot Usage Insights/);
  assert.equal(JSON.parse(await fs.readFile(path.join(destination, 'package.json'), 'utf8')).type, 'module');
  const installed = await import(pathToFileURL(path.join(destination, 'src/node/skill-version.mjs')));
  assert.equal(installed.parseSkillVersion('---\nmetadata: {version: "1.2.3"}\n---\n').value, '1.2.3');
  await assert.rejects(fs.access(path.join(destination, 'src/panel')));
  await assert.rejects(fs.access(path.join(destination, 'src/review-guides/v1/examples.json')));
  assert.match(await fs.readFile(path.join(destination, 'SECURITY.md'), 'utf8'), /Pause Usage Insights/);
  await fs.access(path.join(destination, 'src/review-guides/v1/core.md'));
  // Exercise all lazy backend import graphs without executing child-process entrypoints.
  for (const file of ['canvas.mjs', 'canvas-server.mjs', 'canvas-usage.mjs', 'canvas-review.mjs']) await import(pathToFileURL(path.join(destination, 'src/node', file)));
  const review = await import(pathToFileURL(path.join(destination, 'src/node/review-insights.mjs')));
  assert.match((await review.loadReviewGuidance(['context-cache'])).text, /context/i);
  await fs.writeFile(path.join(destination, 'obsolete.txt'), 'old installed file');
  await installLocal({ destination });
  await assert.rejects(fs.access(path.join(destination, 'obsolete.txt')));
  const unrelated = path.join(temp, 'extensions', 'other');
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, 'extension.mjs'), 'user code');
  await assert.rejects(installLocal({ destination: unrelated }), /Refusing/);
  assert.equal(await fs.readFile(path.join(unrelated, 'extension.mjs'), 'utf8'), 'user code');
  assert.deepEqual((await fs.readdir(path.dirname(destination))).sort(), ['other', 'usage-insights']);
});
