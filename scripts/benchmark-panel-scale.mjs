import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { normalizeUsage } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { mountPanel } from '../tests/fixtures/panel.mjs';

// Synthetic VM measurements only: no browser, history files, SDK, or network.
// The baseline restores the two formerly unconditional render calls and bypasses
// the tooltip cache in memory. The generated panel on disk is never modified.
const projects = 2000, iterations = 10, samples = 3, pointerMoves = 1000;
const records = Array.from({ length: projects }, (_, i) => normalizeUsage({
  provider: { kind: 'copilot' }, model: `model-${i % 20}`, inputTokens: 1000,
  outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 100,
  copilotUsage: { totalNanoAiu: 1000000 },
}, { key: String(i), timestamp: '2026-11-15T12:00:00.000Z', sessionId: `session-${i}`, project: `project-${i}`, source: 'fixture' }).record);
const report = { ...buildReport(records, { range: '30d' }, new Date('2026-11-17T12:00:00Z')), sources: [], coverage: {} };
function restoreBaseline(html) {
  const guards = /  if \(state\.view === 'breakdown'\) renderBreakdown\(\);\r?\n  if \(state\.view === 'efficiency'\) renderEfficiency\(\);/;
  assert.match(html, guards, 'Rebuild the panel before benchmarking');
  assert.ok(html.includes('if (tooltipLayout?.key !== key)'));
  return html.replace(guards, '  renderBreakdown();\n  renderEfficiency();').replace('if (tooltipLayout?.key !== key)', 'if (true)');
}
function restoreUsageRendering(html) {
  const guard = /  if \(state\.view === 'usage'\) \{\r?\n    \$\('token-title'\)\.textContent =/;
  assert.match(html, guard, 'Rebuild the panel before benchmarking');
  return html.replace(guard, "  if (true) {\n    $('token-title').textContent =");
}
async function measureHiddenUsage(baseline, view) {
  const { get } = await mountPanel(report, undefined, undefined, undefined, baseline ? { transformHtml: restoreUsageRendering } : {});
  get('view').onclick({ target: { dataset: { view } } });
  const writes = new Map();
  for (const id of ['daily', 'calendar', 'rhythm', 'token-bar', 'models-summary', 'projects-summary']) {
    let markup = get(id).innerHTML;
    Object.defineProperty(get(id), 'innerHTML', { get: () => markup, set(value) { markup = value; writes.set(id, (writes.get(id) || 0) + 1); } });
  }
  const started = performance.now();
  for (let i = 0; i < iterations; i++) get('metric').onclick({ target: { dataset: { metric: i % 2 ? 'tokens' : 'credits' } } });
  return { ms: performance.now() - started, dailyWrites: writes.get('daily') || 0, usageChartWrites: [...writes.values()].reduce((a, b) => a + b, 0) };
}
async function measure(baseline) {
  const { get, nodes, listeners } = await mountPanel(report, undefined, undefined, undefined, baseline ? { transformHtml: restoreBaseline } : {});
  const writes = new Map();
  for (const [id, node] of nodes) {
    if (Object.getOwnPropertyDescriptor(node, 'innerHTML')?.configurable === false) continue;
    let markup = node.innerHTML;
    Object.defineProperty(node, 'innerHTML', { get: () => markup, set(value) { markup = value; writes.set(id, (writes.get(id) || 0) + 1); } });
  }
  get('group').value = 'projects';
  let start = performance.now();
  for (let i = 0; i < iterations; i++) get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-15' } }) } });
  const renderMs = performance.now() - start;
  const render = { ms: renderMs, hiddenBreakdownWrites: writes.get('breakdown') || 0, hiddenEfficiencyWrites: writes.get('efficiency-summary') || 0,
    breakdownCharacters: get('breakdown').innerHTML.length, countedHtmlWrites: [...writes.values()].reduce((a, b) => a + b, 0) };
  const popup = get('tip');
  let layoutReads = 0;
  Object.defineProperty(popup, 'offsetWidth', { get() { layoutReads++; return 240; } });
  Object.defineProperty(popup, 'offsetHeight', { get() { layoutReads++; return 110; } });
  const mark = { dataset: { tip: JSON.stringify({ title: 'Fixture tokens', rows: [['Input', 2131]] }) } };
  start = performance.now();
  for (let i = 0; i < pointerMoves; i++) listeners.get('pointermove')({ clientX: 100 + i % 100, clientY: 100, target: { closest: () => mark } });
  return { render, tooltip: { ms: performance.now() - start, htmlWrites: writes.get('tip') || 0, layoutReads } };
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = {};
for (const baseline of [true, false]) {
  await measure(baseline); // Warm the VM/code path outside the measured samples.
  const runs = [];
  for (let i = 0; i < samples; i++) runs.push(await measure(baseline));
  results[baseline ? 'baseline' : 'current'] = Object.fromEntries(['render', 'tooltip'].map(section => [section,
    Object.fromEntries(Object.keys(runs[0][section]).map(key => [key, median(runs.map(run => run[section][key]))])),
  ]));
}
// Isolate the additional Usage guard while retaining the earlier optimizations.
const hiddenUsage = {};
for (const baseline of [true, false]) {
  const mode = hiddenUsage[baseline ? 'baseline' : 'current'] = {};
  for (const view of ['breakdown', 'efficiency']) {
    await measureHiddenUsage(baseline, view);
    const runs = [];
    for (let i = 0; i < samples; i++) runs.push(await measureHiddenUsage(baseline, view));
    mode[view] = Object.fromEntries(Object.keys(runs[0]).map(key => [key, median(runs.map(run => run[key]))]));
  }
}
console.log(JSON.stringify({ node: process.version, projects, models: 20, iterations, samples, pointerMoves,
  measurement: 'Median JavaScript time and synthetic DOM operation counts; no browser layout or paint timing.', ...results, hiddenUsage }, null, 2));
