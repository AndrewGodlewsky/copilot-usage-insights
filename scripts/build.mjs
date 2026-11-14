// Ship one self-contained canvas document with no network dependencies.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const { version } = JSON.parse(read('package.json'));
if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Invalid package version');
const flatten = src => src.replace(/^import [^\n]*\n/gm, '').replace(/^export \{[^\n]*\n/gm, '').replace(/^export (?=(const|function|let|class) )/gm, '');
const modules = ['src/core/query.mjs', 'src/core/format.mjs', 'src/core/provider-names.mjs', 'src/core/diagnostics.mjs', 'src/panel/charts.mjs', 'src/panel/art.mjs', 'src/panel/efficiency.mjs', 'src/panel/token-topics.mjs', 'src/panel/panel.js'];
const script = modules.map(p => `// ${p}\n${flatten(read(p))}`).join('\n');
const html = read('src/panel/panel.html').replaceAll('{{PLUGIN_VERSION}}', version).replace('/* PANEL_STYLES */', () => read('src/panel/panel.css')).replace('/* PANEL_SCRIPT */', () => `;(() => {\n'use strict'\nconst BUILD_VERSION = ${JSON.stringify(version)};\n${script}\n})()`);
const out = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])) : new URL('panel/index.html', root);
mkdirSync(new URL('.', out), { recursive: true });
writeFileSync(out, html);
console.log(`Built ${out.pathname}`);
