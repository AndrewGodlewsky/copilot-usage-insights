import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { builtinModules } from 'node:module';
import { assertNoTopLevelCollisions, assertSafeEmbeddedDocument } from '../scripts/build.mjs';
import { validateSecurity } from '../scripts/validate-security.mjs';
import { validateRelease } from '../scripts/validate-release.mjs';
import { defaultDemoSettings, applyDemoSettings } from '../scripts/preview.mjs';
import { installLocal } from '../scripts/install-local.mjs';
import { createSettings } from '../src/node/settings.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { createTransitionsTopic } from '../src/core/efficiency-transitions.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { randomUUID } from 'node:crypto';
import { createUsageRecorder, reconcileUsageJournal } from '../src/node/review-usage.mjs';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

const ROOT = path.resolve(new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function walkFiles(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full, entry.name)) out.push(full);
  }
  return out;
}

test('src/core/ stays free of Node built-in imports', () => {
  const builtins = new Set(builtinModules.map(m => m.replace(/^node:/, '')));
  const coreDir = path.join(ROOT, 'src', 'core');
  const violations = [];
  for (const file of walkFiles(coreDir, (_, name) => name.endsWith('.mjs'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (spec.startsWith('node:') || builtins.has(spec.split('/')[0])) {
        violations.push(`${path.relative(ROOT, file)} imports ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('all internal Markdown links across the repository resolve to existing files', () => {
  const broken = [];
  for (const file of walkFiles(ROOT, (_, name) => name.endsWith('.md'))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let inFence = false;
    lines.forEach((line, idx) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const raw = match[1].trim();
        if (/^(https?:|mailto:|#)/i.test(raw)) continue;
        const target = raw.split('#')[0];
        if (!target) continue;
        const resolved = path.resolve(path.dirname(file), target);
        if (!fs.existsSync(resolved)) broken.push(`${path.relative(ROOT, file)}:${idx + 1} -> ${raw}`);
      }
    });
  }
  assert.deepEqual(broken, []);
});

test('src/review-guides/v1/examples.json parses and has valid example entries', () => {
  const examples = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/review-guides/v1/examples.json'), 'utf8'));
  assert.ok(Array.isArray(examples) ? examples.length > 0 : examples && typeof examples === 'object');
  const list = Array.isArray(examples) ? examples : (examples.examples || examples.cases || Object.values(examples));
  assert.ok(list.length > 0);
});

test('preview demo settings defaults match src/node/settings.mjs and reject invalid values', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-preview-defaults-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const realDefaults = await createSettings(dir).get();
  const demoDefaults = defaultDemoSettings();
  for (const key of Object.keys(demoDefaults)) {
    assert.deepEqual(demoDefaults[key], realDefaults[key], `demo default for ${key} must match settings.mjs`);
  }
  assert.equal(applyDemoSettings(demoDefaults, { textSize: 'large', paused: true }).textSize, 'large');
  assert.throws(() => applyDemoSettings(demoDefaults, { textSize: 'huge' }), TypeError);
  assert.throws(() => applyDemoSettings(demoDefaults, { paused: 'yes' }), TypeError);
});

test('build guards reject duplicate top-level functions and unsafe HTML closing tags', () => {
  assert.throws(() => assertNoTopLevelCollisions([
    { file: 'a.mjs', code: 'function helper() { return 1; }' },
    { file: 'b.mjs', code: 'function helper() { return 2; }' },
  ]), /Top-level identifier collision.*helper/);
  assert.throws(() => assertNoTopLevelCollisions([
    { file: 'a.mjs', code: 'const sharedName = 1;' },
    { file: 'b.mjs', code: 'let sharedName = 2;' },
  ]), /Top-level identifier collision.*sharedName/);
  assert.doesNotThrow(() => assertNoTopLevelCollisions([
    { file: 'a.mjs', code: 'function alpha() {}' },
    { file: 'b.mjs', code: 'function beta() {}' },
  ]));
  assert.throws(() => assertSafeEmbeddedDocument({ noticeBody: 'ok', styles: '', bundledScript: 'const x = "</script>";' }), /<\/script/);
  assert.throws(() => assertSafeEmbeddedDocument({ noticeBody: 'ok', styles: '/* </style> */', bundledScript: '' }), /<\/style/);
  assert.throws(() => assertSafeEmbeddedDocument({ noticeBody: 'bad --> comment', styles: '', bundledScript: '' }), /-->/);
});

test('validateSecurity rejects optionalDependencies, uninventoried vendor files, and workflow write permissions', async t => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-sec-neg-'));
  t.after(() => fsp.rm(temp, { recursive: true, force: true }));
  const files = ['package.json', 'com.github.copilot/extensions/usage-insights/package.json', 'security-dependencies.json',
    'src/vendor/js-yaml/js-yaml.mjs', 'src/vendor/js-yaml/LICENSE', '.github/workflows/test.yml'];
  for (const file of files) {
    await fsp.mkdir(path.dirname(path.join(temp, file)), { recursive: true });
    await fsp.copyFile(path.join(ROOT, file), path.join(temp, file));
  }
  const root = pathToFileURL(temp + path.sep);
  validateSecurity(root);

  // 1. optionalDependencies in extension package.json fails
  const extPkgPath = path.join(temp, 'com.github.copilot/extensions/usage-insights/package.json');
  const origExtPkg = await fsp.readFile(extPkgPath, 'utf8');
  await fsp.writeFile(extPkgPath, JSON.stringify({ ...JSON.parse(origExtPkg), optionalDependencies: { evil: '1.0.0' } }));
  assert.throws(() => validateSecurity(root), /Dependency inventory/);
  await fsp.writeFile(extPkgPath, origExtPkg);

  // 2. uninventoried file under src/vendor fails
  const extraVendor = path.join(temp, 'src/vendor/extra.mjs');
  await fsp.writeFile(extraVendor, 'export const x = 1;\n');
  assert.throws(() => validateSecurity(root), /Uninventoried vendored file/);
  await fsp.rm(extraVendor);

  // 3. write permission in any workflow fails
  const extraWf = path.join(temp, '.github/workflows/extra.yml');
  await fsp.writeFile(extraWf, 'name: extra\npermissions:\n  contents: read\n  issues: write\n');
  assert.throws(() => validateSecurity(root), /must not grant write permissions/);
  await fsp.rm(extraWf);
});

test('validateRelease enforces newest-first semver ordering and manifest name parity', () => {
  const base = {
    'package.json': JSON.stringify({ name: 'copilot-usage-insights', version: '2.4.0' }),
    'plugin.json': JSON.stringify({ name: 'copilot-usage-insights', version: '2.4.0' }),
    '.github/plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'copilot-usage-insights', version: '2.4.0' }] }),
    'com.github.copilot/extensions/usage-insights/package.json': JSON.stringify({ name: 'copilot-usage-insights', version: '2.4.0' }),
    'release-notes.json': JSON.stringify([
      { version: '2.4.0', summary: 'New release.' },
      { version: '2.3.0', summary: 'Previous release.' },
    ]),
    'README.md': 'Version **2.4.0** ships updates.',
  };
  const read = overrides => file => ({ ...base, ...overrides })[file];
  assert.equal(validateRelease(read({}), { checkAssets: false }).version, '2.4.0');
  assert.throws(() => validateRelease(read({
    'release-notes.json': JSON.stringify([
      { version: '2.4.0', summary: 'Top.' },
      { version: '2.2.0', summary: 'Older.' },
      { version: '2.3.0', summary: 'Out of order.' },
    ]),
  }), { checkAssets: false }), /newest-first/);
  assert.throws(() => validateRelease(read({
    'com.github.copilot/extensions/usage-insights/package.json': JSON.stringify({ name: 'wrong-name', version: '2.4.0' }),
  }), { checkAssets: false }), /Name mismatch/);
});

test('installLocal refuses the repository root and its ancestor directories', async () => {
  await assert.rejects(() => installLocal({ destination: ROOT }), /unsafe installation destination/i);
  await assert.rejects(() => installLocal({ destination: path.dirname(ROOT) }), /unsafe installation destination/i);
});

test('HTTP review.run endpoint is removed and returns 400 Unknown method', async t => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-no-review-run-'));
  const server = await startServer({ html: '<title>Test</title>', settings: createSettings(dir), defaultHome: dir, scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) } });
  t.after(async () => { await server.close(); await fsp.rm(dir, { recursive: true, force: true }); });
  const res = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'review.run', input: {} }) });
  assert.equal(res.status, 400);
});

test('transitions track responseModel drift and skill rows include failureRate', () => {
  const t = createTransitionsTopic();
  t.add({ ms: 1000, sessionId: 's1', model: 'Claude', modelId: 'claude-sonnet-5.5', responseModel: 'claude-sonnet-5.5-20261101', initiator: 'user', isAuto: true });
  t.add({ ms: 2000, sessionId: 's1', model: 'Claude', modelId: 'claude-sonnet-5.5', responseModel: 'claude-sonnet-5.5', initiator: 'agent', isAuto: false });
  const detail = t.finish();
  assert.equal(detail.routing.resolvedCalls, 2);
  assert.equal(detail.routing.driftCalls, 1);
  assert.deepEqual(detail.routing.driftPairs, [{ from: 'claude-sonnet-5.5', to: 'claude-sonnet-5.5-20261101', count: 1 }]);
  assert.deepEqual(detail.routing.autoResolved, [{ from: 'claude-sonnet-5.5', to: 'claude-sonnet-5.5-20261101', count: 1 }]);

  const now = new Date('2026-11-15T12:00:00Z');
  const ms = now.getTime() - 1000;
  const report = buildReport(
    [{ key: 'r1', ms, ts: new Date(ms).toISOString(), sessionId: 's1', project: 'proj', model: 'M', inputTotal: 100, output: 10, input: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, nanoAiu: 1e9, creditStatus: 'complete' }],
    { range: '7d' }, now,
    {
      skills: [{ key: 'sk1', ms, ts: new Date(ms).toISOString(), sessionId: 's1', project: 'proj', name: 'my-skill', plugin: 'p', version: '1.0.0', path: '', trigger: 'context-load' }],
      tools: [{ key: 'tf1', ms, completedMs: ms + 100, ts: new Date(ms).toISOString(), sessionId: 's1', project: 'proj', name: 'skill', skillName: 'my-skill', server: '', mcpTool: '', success: false }],
    },
  );
  assert.equal(report.skills.rows[0].invocations, 1);
  assert.equal(report.skills.rows[0].failures, 1);
  assert.equal(report.skills.rows[0].failureRate, 50);
});

test('review-usage reconciles assistant.usage events from stopped helper journals', async t => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-reconcile-assistant-'));
  t.after(() => fsp.rm(base, { recursive: true, force: true }));
  const sid = randomUUID();
  const recorder = await createUsageRecorder(sid, base);
  const journal = path.join(base, 'helper-events.jsonl');
  await fsp.writeFile(journal, JSON.stringify({
    type: 'assistant.usage',
    id: randomUUID(),
    timestamp: '2026-11-15T12:00:00Z',
    data: { apiCallId: 'call-1', model: 'claude-sonnet-5.5', inputTokens: 200, outputTokens: 50, copilotUsage: { totalNanoAiu: 500000000 } },
  }) + '\n');
  await reconcileUsageJournal(journal, recorder);
  const saved = await fsp.readFile(path.join(base, 'session-state', sid, 'events.jsonl'), 'utf8');
  assert.match(saved, /session\.usage_record/);
  assert.match(saved, /500000000/);
});

test('prepareInsightReview exports v2.0 Efficiency evidence (cache-by-timing, compaction, repetition, failure runs) without private names', async () => {
  const f = reviewFixture({ sessionId: 'PRIVATE-V2-SESS' });
  const t0 = new Date(2026, 10, 15, 9, 0);
  f.time(t0); f.user('p1'); f.call('p1', 'c1', { inputTokens: 1000, cacheReadTokens: 800, cacheWriteTokens: 0 });
  f.time(new Date(t0.getTime() + 60_000)); f.call('p1', 'c2', { initiator: 'agent', inputTokens: 1000, cacheReadTokens: 800, cacheWriteTokens: 0 });
  f.time(new Date(t0.getTime() + 90 * 60_000)); f.call('p1', 'c3', { initiator: 'agent', inputTokens: 1000, cacheReadTokens: 100, cacheWriteTokens: 0 });
  f.push('session.compaction_complete', { success: true, preCompactionTokens: 50000, postCompactionTokens: 10000, trigger: 'auto' });
  for (let i = 0; i < 3; i++) {
    f.time(new Date(t0.getTime() + (100 + i) * 60_000));
    f.push('tool.execution_start', { toolCallId: `ft-${i}`, toolName: 'view', arguments: { path: 'PRIVATE_SECRET.txt' } });
    f.push('tool.execution_complete', { toolCallId: `ft-${i}`, success: false });
  }
  const scan = f.scan();
  scan.tools.forEach((tool, i) => { tool.repeat = i; tool.repeatOfMs = i > 0 ? scan.tools[i - 1].ms : null; });
  const snapshot = await prepareInsightReview(scan, { range: '7d' }, reviewNow);
  const ids = new Set(snapshot.payload.evidence.map(e => e.id));
  assert.ok(ids.has('cache-by-timing'), 'includes cache-by-timing');
  assert.ok(ids.has('compaction-events'), 'includes compaction-events');
  assert.ok(ids.has('tool-repetition'), 'includes tool-repetition');
  assert.ok(ids.has('tool-failure-runs'), 'includes tool-failure-runs');
  assert.doesNotMatch(snapshot.preview, /PRIVATE/);
});
