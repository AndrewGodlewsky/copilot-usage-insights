import { esc } from './charts.mjs';

export const CONTEXT_SHAPES = { growing: 'Builds up', steady: 'Stays level', spike: 'Spike & settle', falling: 'Smaller later', mixed: 'Mixed / unclear' };
const growthSigned = (n, number) => n == null ? 'Unavailable' : (n > 0 ? '+' : n < 0 ? '−' : '') + number(Math.abs(n));
const growthExample = (data, key) => data?.examples?.find(e => e.key === key);
function growthPaths(points) {
  const parts = []; let part = [];
  for (const p of points) {
    if (p.input == null || !p.visible || p.breakBefore) { if (part.length) parts.push(part); part = []; }
    if (p.input != null && p.visible) part.push(p);
  }
  if (part.length) parts.push(part);
  return parts;
}
export function contextGrowthChart(data, { number, width = 760, mode = 'input', pattern = '', sessionKey = '', prompt = 1 } = {}) {
  const example = growthExample(data, sessionKey), delta = mode === 'change';
  const series = example ? [] : Object.entries(CONTEXT_SHAPES).filter(([k]) => k !== 'mixed' && (!pattern || pattern === k))
    .map(([k, label]) => ({ kind: k, label, points: data?.patterns?.[k]?.curve || [] })).filter(s => s.points.length);
  if (!example && !series.length) return '<p class="growth-empty">Grouped trends need at least three comparable sessions at a prompt position. Choose a session below to inspect the available measurements.</p>';
  const first = example?.points.find(p => p.input != null && p.visible)?.input ?? 0;
  const parts = example ? growthPaths(example.points).map(part => part.map(p => ({ ...p, value: delta ? p.input - first : p.input }))) : [];
  const values = example ? parts.flatMap(p => p.map(v => v.value)) : series.flatMap(s => s.points.flatMap(p => delta ? [p.changeLow, p.changeHigh] : [p.low, p.high]));
  const W = Math.max(260, width), H = 285, L = 56, R = 15, T = 25, B = 48;
  const maxTurn = Math.max(2, ...(example ? example.points.map(p => p.turn) : series.flatMap(s => s.points.map(p => p.turn))));
  let low = 0, high = 1; for (const v of values) { low = Math.min(low, v); high = Math.max(high, v); }
  const padding = (high - low) * .06; high += padding; if (low < 0) low -= padding;
  const x = t => L + (t - 1) / (maxTurn - 1) * (W - L - R), y = v => T + (high - v) / (high - low) * (H - T - B);
  const path = points => points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`).join(' ');
  let body = '';
  for (let i = 0; i < 5; i++) {
    const value = low + (high - low) * i / 4;
    body += `<line class="growth-grid" x1="${L}" x2="${W - R}" y1="${y(value)}" y2="${y(value)}"/><text x="${L - 8}" y="${y(value) + 4}" text-anchor="end">${esc(number(value))}</text>`;
  }
  const tickCount = Math.min(maxTurn, W < 500 ? 4 : 6);
  for (let i = 0; i < tickCount; i++) { const turn = Math.round(1 + (maxTurn - 1) * i / (tickCount - 1)); body += `<text x="${x(turn)}" y="${H - 26}" text-anchor="middle">${turn}</text>`; }
  body += `<text x="${L}" y="13">${delta ? 'Change in input' : 'Input tokens'}</text><text x="${(L + W - R) / 2}" y="${H - 5}" text-anchor="middle">User prompt number</text>`;
  if (example) {
    for (const p of example.points) if (p.compactedBefore && p.turn > 1) {
      const mx = (x(p.turn - 1) + x(p.turn)) / 2;
      body += `<line class="growth-compaction" x1="${mx.toFixed(2)}" x2="${mx.toFixed(2)}" y1="${T}" y2="${H - B}" stroke="var(--s3)" stroke-dasharray="3 3" stroke-width="1.5"><title>Compaction recorded before Prompt ${p.turn}</title></line>`;
    }
    for (const part of parts) {
      body += `<path class="growth-line" d="${path(part.map(p => [x(p.turn), y(p.value)]))}"/>`;
      body += part.map(p => `<circle class="growth-point${p.turn === prompt ? ' selected' : ''}" cx="${x(p.turn)}" cy="${y(p.value)}" r="${p.turn === prompt ? 5 : 2.5}"><title>Prompt ${p.turn}: ${esc(number(p.input))} input tokens${p.compactedBefore ? ' · Compaction recorded before this prompt' : ''}</title></circle>`).join('');
    }
  } else for (const s of series) {
    // Ordinal cohorts can become sparse: never draw across a missing position.
    const segments = []; let part = [];
    for (const p of s.points) { if (part.length && p.turn !== part.at(-1).turn + 1) { segments.push(part); part = []; } part.push(p); }
    if (part.length) segments.push(part);
    for (const ps of segments) {
      const upper = ps.map(p => [x(p.turn), y(delta ? p.changeHigh : p.high)]), lower = ps.slice().reverse().map(p => [x(p.turn), y(delta ? p.changeLow : p.low)]);
      body += `<g class="growth-series growth-${s.kind}"><path class="growth-band" d="${path([...upper, ...lower])}Z"/><path class="growth-line" d="${path(ps.map(p => [x(p.turn), y(delta ? p.change : p.median)]))}"/>`;
      body += ps.map(p => `<circle class="growth-point" cx="${x(p.turn)}" cy="${y(delta ? p.change : p.median)}" r="2.5"><title>${esc(s.label)} · Prompt ${p.turn} · ${p.sessions} sessions · median ${esc(number(delta ? p.change : p.median))} · middle 50% ${esc(number(delta ? p.changeLow : p.low))}–${esc(number(delta ? p.changeHigh : p.high))}</title></circle>`).join('') + '</g>';
    }
  }
  const accessible = example ? `${example.name}: input by prompt` : series.map(s => `${s.label}: ${s.points[0].sessions} sessions at prompt ${s.points[0].turn}`).join('; ');
  return `<svg class="growth-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(accessible)}">${body}</svg>`;
}
export function contextGrowthPrompt(data, { sessionKey, prompt = 1, number }) {
  const p = growthExample(data, sessionKey)?.points.find(p => p.turn === prompt);
  if (!p) return '';
  const compacted = p.compactedBefore ? ' · Compaction recorded before this prompt' : '';
  return (!p.visible ? `Prompt ${prompt}: outside the model filter.` : `Prompt ${prompt}: ${p.input == null ? 'input unavailable' : number(p.input) + ' input tokens'} · ${p.model || 'Model unavailable'} · ${p.cache == null || !p.input ? 'cache reuse unavailable' : number(p.cache / p.input * 100) + '% read from cache'}`) + compacted;
}
export function renderContextGrowth(data, options = {}) {
  const { number, loading, mode = 'input', pattern = '', sessionKey = '', prompt = 1 } = options;
  if (loading) return '<p role="status" class="muted">Loading history to compare conversation patterns…</p>';
  if (!data?.sessions) return '<p class="muted">No confirmed user prompts with comparable input metadata are available for these filters. Older or accounting-only logs may not contain prompt links.</p>';
  const example = growthExample(data, sessionKey), bucket = data.patterns[pattern] || data;
  const ranked = Object.keys(CONTEXT_SHAPES).filter(k => k !== 'mixed').sort((a, b) => data.patterns[b].sessions - data.patterns[a].sessions);
  const lead = ranked[0], verbs = { growing: 'carry more input later', steady: 'stay broadly level', spike: 'spike and settle', falling: 'carry less input later' };
  const count = data.patterns[lead].sessions, headline = count ? `${number(count)} of ${number(data.sessions)} sessions ${verbs[lead]}.` : 'There is not enough comparable input to identify a recurring shape.';
  const n = v => esc(v == null ? 'Unavailable' : number(v)), reuse = bucket.cacheInput > 0 ? bucket.cacheRead / bucket.cacheInput * 100 : null;
  const modeButtons = ['input', 'change'].map(k => `<button data-growth-mode="${k}" id="growth-mode-${k}" aria-pressed="${mode === k}">${k === 'input' ? 'Input size' : 'Change since first'}</button>`).join('');
  const groupedDetails = Object.entries(CONTEXT_SHAPES).filter(([k]) => k !== 'mixed' && (!pattern || pattern === k)).flatMap(([k, label]) => (data.patterns[k].curve || []).map(p => `<tr><td>${esc(label)}</td><td>${p.turn}</td><td>${n(p.sessions)}</td><td>${n(mode === 'change' ? p.change : p.median)}</td><td>${n(mode === 'change' ? p.changeLow : p.low)}–${n(mode === 'change' ? p.changeHigh : p.high)}</td></tr>`));
  return `<p class="growth-headline">${esc(headline)}</p><p class="footnote">${n(data.patterns.mixed.sessions)} sessions have mixed patterns or insufficient comparable measurements. Shapes describe usage, not efficiency.</p>
    <div class="growth-chart-tools"><span class="footnote">${example ? esc(example.name) : 'Grouped medians · shaded middle 50% of sessions'}</span><div class="seg">${modeButtons}</div></div>
    <div id="growth-plot">${contextGrowthChart(data, options)}</div><p class="footnote">First main-agent call per user prompt · includes cache · ${example ? 'Individual session' : `First ${data.curveLimit} prompt positions; at least ${data.minimumContributors} sessions per position`}</p>
    <div class="growth-patterns">${Object.entries(CONTEXT_SHAPES).map(([k, label]) => `<button class="growth-pattern growth-${k}" id="growth-pattern-${k}" data-growth-pattern="${k}" aria-pressed="${pattern === k}" ${data.patterns[k].sessions ? '' : 'disabled'}><span>${esc(label)}</span><strong>${n(data.patterns[k].sessions)} <small>/ ${n(data.sessions)}</small></strong></button>`).join('')}</div><p class="footnote growth-hint">Select a shape to isolate its trend. Select it again to show all shapes. Sparse groups remain available through session inspection.</p>
    <div class="growth-takeaways"><section><h3>How much does input change?</h3><strong class="growth-value">${esc(growthSigned(bucket.medianChange, number))}</strong><p>Median earlier-to-later change in input per prompt.</p><p class="footnote">${n(bucket.comparable)} comparable sessions · first 3 vs. last 3 prompts${pattern ? ' · ' + esc(CONTEXT_SHAPES[pattern]) : ''}</p></section><section><h3>Is the input being reused?</h3><strong class="growth-value">${reuse == null ? 'Unavailable' : n(reuse) + '%'}</strong><p>Of matched input read from cache.</p><p class="footnote">${n(bucket.cacheRequests)} of ${n(bucket.inputRequests)} measured prompts have a complete cache split. Reuse is not a savings estimate.</p></section></div>
    <section class="growth-inspect"><label for="growth-session">Inspect a session</label><select id="growth-session"><option value="">Grouped trends</option>${data.examples.map(e => `<option value="${esc(e.key)}"${e.key === sessionKey ? ' selected' : ''}>${esc(e.project)} · ${esc(e.name)} · ${esc(CONTEXT_SHAPES[e.kind])}${e.change != null ? ` (${esc(growthSigned(e.change, number))})` : ''}</option>`).join('')}</select><p class="footnote">${n(data.examples.length)} examples, including largest-growth and recent sessions within each shape; ${n(data.examplesOmitted)} more sessions are included in the totals.</p>
    ${example ? `<dl class="growth-detail"><div><dt>Earlier median</dt><dd>${n(example.early)}</dd></div><div><dt>Later median</dt><dd>${n(example.late)}</dd></div><div><dt>Peak input</dt><dd>${n(example.peak)}</dd></div><div><dt>Measured prompts</dt><dd>${n(example.measured)} / ${n(example.prompts)}</dd></div></dl><div class="token-insight-actions"><button id="growth-open-breakdown" class="conversation-link" data-efficiency-open-session="${esc(example.key)}" data-efficiency-open-project="${esc(example.project === 'Multiple projects' ? '' : example.project || '')}">Open in Breakdown<span class="sr-only">: ${esc(example.name)}</span></button></div><label class="growth-prompt-picker">Inspect prompt <input id="growth-prompt" type="range" min="1" max="${example.points.length}" step="1" value="${prompt}" aria-describedby="growth-prompt-readout" aria-valuetext="${esc(contextGrowthPrompt(data, { sessionKey, prompt, number }))}"></label><p id="growth-prompt-readout" class="footnote" aria-live="polite">${esc(contextGrowthPrompt(data, { sessionKey, prompt, number }))}</p><p class="footnote">${example.filtered ? 'Some prompt positions use other models and are hidden. ' : ''}${example.kind === 'mixed' ? 'Incomplete, short, changing-model or irregular histories remain unclassified. ' : ''}${example.pointsOmitted ? `Only the first ${example.points.length} positions are drawn; ${number(example.pointsOmitted)} later positions are omitted. Summary measurements use the full selected history.` : ''}</p>` : ''}</section>
    <details id="growth-measurements" class="growth-notes"><summary>Measurements and coverage · ${n(data.inputRequests)} / ${n(data.prompts)} prompts have input counts</summary><p>Input is what the model processed, including cache once; it is not context-window fullness or a record of exactly which files and messages were retained. Continuations may process more input than the first call shown here. Missing or ambiguous prompt links remain unknown. ${n(data.unconfirmedPrompts)} submissions lack confirmed human identity and are excluded.</p><p>These are prompt positions inside the selected dates, not necessarily the start of a new conversation. Whole-session patterns need six complete, ordered prompts using one exact model identity. A model filter preserves original positions; partial or mixed-model histories remain unclassified. Missing inputs, uncertain ordering and model changes break individual lines.</p><p>A rise or fall exceeds both 8K tokens and 25% of the early median. A spike exceeds both end medians by 60% and 20K, then settles below 65% of its peak. A level shape stays within the larger of 16K or 40% of its median. These descriptive thresholds are not validated efficiency benchmarks.</p><p>Shading is the 25th–75th percentile, not confidence in a recommendation. Later positions contain only sessions that reached those prompts, so changes in the group can affect its curve. Use individual sessions before drawing conclusions about growth. No shape establishes waste, task success, or the cause of a change.</p></details>
    ${!example && groupedDetails.length ? `<details id="growth-values" class="growth-notes"><summary>Grouped values and contributing sessions</summary><div class="table-wrap"><table><thead><tr><th>Shape</th><th>Prompt</th><th>Sessions</th><th>Median input${mode === 'change' ? ' change' : ''}</th><th>Middle 50%</th></tr></thead><tbody>${groupedDetails.join('')}</tbody></table></div></details>` : ''}`;
}
