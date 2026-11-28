// Ship one self-contained canvas document with no network dependencies.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Script } from 'node:vm';
import { benchmarkModuleSource } from '../src/core/benchmark-schema.mjs';
import { validateSecurity } from './validate-security.mjs';
import { validateRelease } from './validate-release.mjs';

validateSecurity();

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const benchmarkSource = benchmarkModuleSource(JSON.parse(read('data/model-benchmarks.json')));
mkdirSync(new URL('src/generated/', root), { recursive: true });
const generatedBenchmarks = new URL('src/generated/model-benchmarks.mjs', root);
if (!existsSync(generatedBenchmarks) || readFileSync(generatedBenchmarks, 'utf8') !== benchmarkSource) {
  writeFileSync(generatedBenchmarks, benchmarkSource);
}

const { version, releaseNotes } = validateRelease(read);

const flatten = src => src
  .replace(/^import [^\n]*\n/gm, '')
  .replace(/^export \{[^\n]*\n/gm, '')
  .replace(/^export (?=(const|function|let|class) )/gm, '');

const PANEL_MODULES = [
  'src/core/query.mjs',
  'src/core/format.mjs',
  'src/core/provider-names.mjs',
  'src/core/diagnostics.mjs',
  'src/core/integrations.mjs',
  'src/core/public-models.mjs',
  'src/generated/model-benchmarks.mjs',
  'src/core/benchmark-schema.mjs',
  'src/core/benchmark-reference.mjs',
  'src/core/model-reference.mjs',
  'src/panel/charts.mjs',
  'src/panel/art.mjs',
  'src/panel/efficiency.mjs',
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

const script = PANEL_MODULES.map(p => `// ${p}\n${flatten(read(p))}`).join('\n');
const bundledScript = `;(() => {\n'use strict'\nconst BUILD_VERSION = ${JSON.stringify(version)};\nconst RELEASE_NOTES = ${JSON.stringify(releaseNotes).replaceAll('<', '\\u003c')};\n${script}\n})()`;

// Catch syntax errors and top-level identifier collisions across flattened panel modules before writing output.
new Script(bundledScript, { filename: 'panel/index.html#script' });

const notice = `<!--\nDerived from Orca Usage Insights by Etherll:\nhttps://github.com/Etherll/orca-usage-insights\n\n${read('LICENSE').trim()}\n\n${read('licenses/aider-Apache-2.0.txt').trim()}\n-->`;
const html = read('src/panel/panel.html')
  .replace('<!doctype html>', () => `<!doctype html>\n${notice}`)
  .replaceAll('{{PLUGIN_VERSION}}', version)
  .replace('/* PANEL_STYLES */', () => read('src/panel/panel.css') + '\n' + read('src/panel/review-desktop.css'))
  .replace('/* PANEL_SCRIPT */', () => bundledScript);

const out = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])) : new URL('panel/index.html', root);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, html);
console.log(`Built ${out.pathname}`);
