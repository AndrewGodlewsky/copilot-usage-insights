import { stackedBars, calendarHeatmap, punchCard, donut, hBars, esc, compact, usageValue, TOKEN_KEYS, TOKEN_LABELS, TOKEN_COLORS } from './charts.mjs';
import { pixelBanner } from './art.mjs';
import { dayKey, localDay } from '../core/query.mjs';

const $ = id => document.getElementById(id);
const number = value => value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const state = { range: '7d', metric: 'tokens', view: 'usage', report: null, version: 0, pending: false, force: false };
const colors = { ...TOKEN_COLORS, unclassifiedInput: 'var(--muted-fg)', credits: 'var(--s1)' };
const labels = { ...TOKEN_LABELS, unclassifiedInput: 'Input (cache split unknown)', credits: 'AI credits' };

async function request(method, input = {}) {
  const response = await fetch('api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function query() {
  return { range: state.range, includeCache: $('cache').checked,
    ...($('model').value ? { models: [$('model').value] } : {}), project: $('project').value, session: $('session').value,
    ...(state.range === 'custom' ? { startDate: state.startDate, endDate: state.endDate } : {}) };
}
async function load(force = false) {
  state.version++; state.force ||= force;
  if (state.pending) return;
  state.pending = true;
  $('refresh').disabled = true;
  try {
    let version;
    do {
      version = state.version;
      const method = state.force ? 'usage.refresh' : 'usage.report'; state.force = false;
      try {
        const report = await request(method, query());
        if (version !== state.version) continue;
        state.report = report;
        render();
        $('live').textContent = 'Usage updated';
      } catch (e) {
        if (version !== state.version) continue;
        $('status').hidden = false;
        $('status').textContent = `Could not update usage: ${e.message}`;
        $('content').hidden = true;
      }
    } while (version !== state.version);
  } finally { state.pending = false; $('refresh').disabled = false; }
}
function options(id, values, all) {
  const select = $(id), selected = select.value;
  const available = selected && !values.includes(selected) ? [selected, ...values] : values;
  select.innerHTML = `<option value="">${all}</option>` + available.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  select.value = selected;
}
function creditLabel(row) {
  return usageValue(row, 'credits', number);
}
function table(rows, heading) {
  if (!rows.length) return '<p class="muted">No matching usage.</p>';
  return `<table><thead><tr><th>${esc(heading)}</th><th>Requests</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Tokens</th><th>AI credits</th></tr></thead><tbody>${rows.map(r => `<tr><td title="${esc(r.name)}">${esc(r.name)}</td><td>${number(r.requests)}</td>${['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'credits'].map(key => `<td>${esc(usageValue(r, key, number))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderBreakdown() {
  const report = state.report;
  if (!report) return;
  const group = $('group').value, sort = $('sort').value;
  $('breakdown').innerHTML = table([...report[group]].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1) || a.name.localeCompare(b.name)), { models: 'Model', projects: 'Project', sessions: 'Session' }[group]);
}
function render() {
  const r = state.report;
  if (!r) return;
  const t = r.totals, credits = state.metric === 'credits';
  const keys = r.query.includeCache ? [...TOKEN_KEYS, 'unclassifiedInput'] : ['input', 'output'];
  options('model', r.options.models, 'All models'); options('project', r.options.projects, 'All projects'); options('session', r.options.sessions, 'All sessions');
  $('content').hidden = false;
  $('status').hidden = !!t.requests;
  $('status').textContent = 'No matching Copilot usage yet. Make a request in Copilot, then refresh. Check Local data sources below if you expected history.';
  const warnings = [];
  if (t.missingCredits) warnings.push(`${number(t.missingCredits)} requests have unavailable AI credits`);
  if (t.partialCredits) warnings.push(`${number(t.partialCredits)} requests have partial credit charges`);
  if (t.missingTokens) warnings.push(`${number(t.missingTokens)} requests have incomplete token counts`);
  if (t.missingCache) warnings.push(`${number(t.missingCache)} requests have an unknown cache split`);
  if (r.coverage.unclassified) warnings.push(`${number(r.coverage.unclassified)} records lack Copilot attribution and were excluded`);
  if (r.coverage.excluded) warnings.push(`${number(r.coverage.excluded)} custom-provider or BYOK records were excluded`);
  if (r.coverage.invalid) warnings.push(`${number(r.coverage.invalid)} malformed records were skipped`);
  if (r.coverage.aggregateOnly) warnings.push(`${number(r.coverage.aggregateOnly)} sessions have summary totals only and are not counted`);
  if (r.sources.some(s => ['error', 'warning', 'missing'].includes(s.state))) warnings.push('Some sources could not be fully read; see Local data sources');
  $('coverage').hidden = !warnings.length;
  $('coverage').textContent = warnings.join('. ') + (warnings.length ? '. Totals include known amounts only; * marks incomplete coverage.' : '');
  const tiles = [
    ['Tokens', usageValue(t, 'total'), r.query.includeCache ? 'Input + output, including cache' : 'Input + output, excluding cache'],
    ['AI credits', creditLabel(t), 'Recorded Copilot charges'],
    ['Requests', number(t.requests), 'Selected dates and filters'],
    ['Sessions', number(t.sessions), 'With matching requests'],
    ['Today', usageValue(r.today, 'total'), 'Tokens · current filters'],
    ['Cache read', t.inputTotal && !t.missingCache ? `${Math.round(t.cacheRead / t.inputTotal * 100)}%` : '—', 'Share of all input tokens'],
    ['Current streak', `${r.streak.current} days`, 'Days with recorded requests'],
    ['Models', number(r.models.length), 'Used through GitHub Copilot'],
  ];
  $('tiles').innerHTML = tiles.map(([label, value, sub]) => `<div class="tile"><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(sub)}</span></div>`).join('');
  $('banner').innerHTML = pixelBanner(r);
  $('daily-title').textContent = credits ? 'Daily AI credits' : 'Daily tokens';
  $('daily-caption').textContent = `${r.daily[0]?.day || ''} — ${r.daily.at(-1)?.day || ''} · local time`;
  const width = Math.max(280, $('daily').clientWidth);
  $('daily').innerHTML = credits && t.requests && t.credits === null ? '<p class="muted">Credit charges are unavailable for these requests.</p>' : stackedBars(r.daily, { width, height: 190, keys: credits ? ['credits'] : keys, colors, labels, fmt: credits ? number : null });
  const legendKeys = credits ? ['credits'] : keys.filter(k => t[k] > 0);
  $('legend').innerHTML = legendKeys.map(k => `<span><i style="background:${colors[k]}"></i>${labels[k]}</span>`).join('');
  $('calendar').innerHTML = calendarHeatmap(r.calendar);
  $('rhythm').innerHTML = punchCard(r.rhythm);
  const segments = keys.filter(k => t[k] > 0).map(k => ({ label: labels[k], value: t[k], color: colors[k] }));
  $('donut').innerHTML = donut(segments);
  $('mix-legend').innerHTML = segments.map(s => `<span><i style="background:${s.color}"></i>${s.label} · ${compact(s.value)}</span>`).join('');
  // Model bars always show tokens; the credit selector controls the daily chart.
  $('models-summary').innerHTML = hBars(r.models.slice(0, 8).map(m => ({ label: m.name, value: m.total, note: usageValue(m, 'total') })), { width: Math.max(280, $('models-summary').clientWidth) });
  $('projects-summary').innerHTML = table(r.projects.slice(0, 10), 'Project');
  $('sources').innerHTML = r.sources.map(s => `<div class="source ${esc(s.state)}"><code>${esc(s.path)}</code><p>${esc(s.state)} · ${number(s.records ?? 0)} requests · ${number(s.files ?? 0)} session logs${s.message ? ` · ${esc(s.message)}` : ''}</p></div>`).join('');
  $('updated').textContent = `Updated ${new Date(r.generatedAt).toLocaleTimeString()}. Refreshes every 30 seconds while visible.`;
  renderBreakdown();
}
function selectButton(container, name, value) {
  for (const button of $(container).querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset[name] === value));
}
$('view').onclick = e => { if (!e.target.dataset.view) return; state.view = e.target.dataset.view; selectButton('view', 'view', state.view); $('usage-view').hidden = state.view !== 'usage'; $('breakdown-view').hidden = state.view !== 'breakdown'; render(); };
$('metric').onclick = e => { if (!e.target.dataset.metric) return; state.metric = e.target.dataset.metric; selectButton('metric', 'metric', state.metric); render(); };
$('refresh').onclick = () => load(true);
$('range').onchange = () => { $('custom').hidden = $('range').value !== 'custom'; if ($('range').value !== 'custom') { state.range = $('range').value; load(); } };
$('apply-dates').onclick = () => { state.range = 'custom'; state.startDate = $('start-date').value; state.endDate = $('end-date').value; load(); };
for (const id of ['model', 'project', 'session', 'cache']) $(id).onchange = () => load();
for (const id of ['group', 'sort']) $(id).onchange = renderBreakdown;
$('clear-filters').onclick = () => { for (const id of ['model', 'project', 'session']) $(id).value = ''; $('cache').checked = true; load(); };
$('settings-open').onclick = async () => {
  $('settings-error').hidden = true;
  $('settings-save').disabled = true;
  $('settings-dialog').showModal();
  try {
    const config = await request('settings.get');
    $('default-home').textContent = config.defaultHome;
    $('extra-homes').value = config.extraHomes.join('\n'); $('disabled-homes').value = config.disabledHomes.join('\n');
    $('settings-save').disabled = false;
  } catch (e) { $('settings-error').textContent = e.message; $('settings-error').hidden = false; }
};
$('settings-close').onclick = () => $('settings-dialog').close();
$('settings-save').onclick = async () => {
  $('settings-save').disabled = true;
  const lines = id => $(id).value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  try {
    await request('settings.set', { extraHomes: lines('extra-homes'), disabledHomes: lines('disabled-homes') });
    $('settings-dialog').close(); await load(true);
  } catch (e) { $('settings-error').textContent = e.message; $('settings-error').hidden = false; }
  finally { $('settings-save').disabled = false; }
};
try { document.documentElement.classList.toggle('light', (localStorage.getItem('usage-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'light'); } catch {}
$('theme').onclick = () => { const light = document.documentElement.classList.toggle('light'); try { localStorage.setItem('usage-theme', light ? 'light' : 'dark'); } catch {} };
document.addEventListener('pointermove', e => {
  const mark = e.target.closest('.mark[data-tip]');
  if (!mark) { $('tip').hidden = true; return; }
  const tip = JSON.parse(mark.dataset.tip);
  $('tip').innerHTML = `<strong>${esc(tip.title || '')}</strong>` + (tip.rows || []).map(([label, value]) => `<p><span>${esc(label)}</span><span>${esc(typeof value === 'number' ? number(value) : value)}</span></p>`).join('') + (tip.total === undefined ? '' : `<p><b>Total</b><b>${esc(number(tip.total))}</b></p>`);
  $('tip').hidden = false;
  $('tip').style.left = `${Math.max(4, Math.min(e.clientX + 12, innerWidth - $('tip').offsetWidth - 8))}px`;
  $('tip').style.top = `${Math.max(4, Math.min(e.clientY + 12, innerHeight - $('tip').offsetHeight - 8))}px`;
});
document.addEventListener('pointerleave', () => { $('tip').hidden = true; });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(() => { if (!document.hidden && !state.pending) load(); }, 30000);
$('start-date').value = dayKey(localDay() - 6); $('end-date').value = dayKey(localDay());
$('end-date').max = $('start-date').max = dayKey(localDay());
load();
