// Ship one self-contained canvas document with no network dependencies.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { Script } from 'node:vm';
import { benchmarkModuleSource } from '../src/core/benchmark-schema.mjs';
import { validateSecurity } from './validate-security.mjs';
import { validateRelease } from './validate-release.mjs';

export const PANEL_MODULES = [
  'src/core/query.mjs',
  'src/core/format.mjs',
  'src/core/provider-names.mjs',
  'src/core/diagnostics.mjs',
  'src/core/integrations.mjs',
  'src/core/public-models.mjs',
  'src/panel/charts.mjs',
  'src/panel/art.mjs',
  'src/core/conversation-summary.mjs',
  'src/panel/conversations.mjs',
  'src/panel/review-cards.mjs',
  'src/panel/token-insights.mjs',
  'src/panel/overview-topic.mjs',
  'src/panel/context-topic.mjs',
  'src/panel/compaction-topic.mjs',
  'src/panel/transitions-topic.mjs',
  'src/panel/repetition-topic.mjs',
  'src/panel/token-topics.mjs',
  'src/panel/topic-explorer.mjs',
  'src/panel/panel-dialogs.mjs',
  'src/panel/context-growth.mjs',
  'src/core/report-wire.mjs',
  'src/panel/recovery.mjs',
  'src/panel/model-mix.mjs',
  'src/panel/growth-summary.mjs',
  'src/panel/habits-topic.mjs',
  'src/panel/findings.mjs',
  'src/panel/panel.js',
];

export function flattenModule(src) {
  return src
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*\r?\n/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*\r?\n/gm, '')
    .replace(/^export\s+\{[\s\S]*?\}(?:\s+from\s+['"][^'"]+['"])?;?[ \t]*\r?\n/gm, '')
    .replace(/^export\s+(?=(?:async\s+function|function|const|let|class)\b)/gm, '');
}

// Detect duplicate top-level declarations across flattened modules, including `function` hoisting
// collisions that JS strict-mode parsing alone does not reject.
export function assertNoTopLevelCollisions(entries) {
  const seen = new Map();
  const declRe = /^(?:async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm;
  for (const { file, code } of entries) {
    for (const match of code.matchAll(declRe)) {
      const name = match[1];
      if (seen.has(name)) {
        throw new Error(`Top-level identifier collision in flattened panel bundle: "${name}" defined in both ${seen.get(name)} and ${file}`);
      }
      seen.set(name, file);
    }
  }
}

export function assertSafeEmbeddedDocument({ noticeBody, styles, bundledScript }) {
  if (noticeBody.includes('-->')) throw new Error('HTML comment notice contains closing sequence "-->"');
  if (/<\/style\b/i.test(styles)) throw new Error('Panel styles contain unsafe "</style" sequence');
  if (/<\/script\b/i.test(bundledScript)) throw new Error('Bundled panel script contains unsafe "</script" sequence');
}

export function buildPanel({ root = new URL('../', import.meta.url), outPath } = {}) {
  validateSecurity(root);
  const read = file => readFileSync(new URL(file, root), 'utf8');
  const benchmarkSource = benchmarkModuleSource(JSON.parse(read('data/model-benchmarks.json')));
  if (!outPath) {
    mkdirSync(new URL('src/generated/', root), { recursive: true });
    const generatedBenchmarks = new URL('src/generated/model-benchmarks.mjs', root);
    if (!existsSync(generatedBenchmarks) || readFileSync(generatedBenchmarks, 'utf8') !== benchmarkSource) {
      writeFileSync(generatedBenchmarks, benchmarkSource);
    }
  }

  const { version, releaseNotes } = validateRelease(read);
  const flattened = PANEL_MODULES.map(file => ({ file, code: flattenModule(read(file)) }));
  assertNoTopLevelCollisions(flattened);
  const script = flattened.map(({ file, code }) => `// ${file}\n${code}`).join('\n');
  const bundledScript = `;(() => {\n'use strict'\nconst BUILD_VERSION = ${JSON.stringify(version)};\nconst RELEASE_NOTES = ${JSON.stringify(releaseNotes).replaceAll('<', '\\u003c')};\n${script}\n})()`;

  // Catch syntax errors across flattened panel modules before writing output.
  new Script(bundledScript, { filename: 'panel/index.html#script' });

  const noticeBody = `Derived from Orca Usage Insights by Etherll:\nhttps://github.com/Etherll/orca-usage-insights\n\n${read('LICENSE').trim()}\n\n${read('licenses/aider-Apache-2.0.txt').trim()}`;
  const styles = read('src/panel/panel.css') + '\n' + read('src/panel/review-desktop.css');
  assertSafeEmbeddedDocument({ noticeBody, styles, bundledScript });

  const notice = `<!--\n${noticeBody}\n-->`;
  const html = read('src/panel/panel.html')
    .replace('<!doctype html>', () => `<!doctype html>\n${notice}`)
    .replaceAll('{{PLUGIN_VERSION}}', version)
    .replace('/* PANEL_STYLES */', () => styles)
    .replace('/* PANEL_SCRIPT */', () => bundledScript);

  const out = outPath ? pathToFileURL(path.resolve(outPath)) : new URL('panel/index.html', root);
  mkdirSync(new URL('.', out), { recursive: true });
  writeFileSync(out, html);
  return fileURLToPath(out);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const built = buildPanel({ outPath: process.argv[2] });
  console.log(`Built ${built}`);
}
