import { stackedBars, calendarHeatmap, punchCard, segmentBar, hBars, esc, usageValue, TOKEN_KEYS, TOKEN_LABELS, TOKEN_COLORS } from './charts.mjs';
import { pixelBanner } from './art.mjs';
import { dayKey, localDay } from '../core/query.mjs';

const $ = id => document.getElementById(id);
const number = value => value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const TEXT_SCALES = { small: 1, medium: 1.15, large: 1.3 };
const skillDate = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true });
const state = { range: '7d', metric: 'tokens', view: 'usage', report: null, version: 0, pending: false, force: false, selectedDay: null, filterKey: '', skillActionPending: false, textSize: 'small' };
const colors = { ...TOKEN_COLORS, unclassifiedInput: 'var(--muted-fg)', credits: 'var(--s1)' };
const labels = { ...TOKEN_LABELS, input: 'Uncached input', unclassifiedInput: 'Input (cache split unknown)', credits: 'AI credits' };

function applyTextSize(value) {
  state.textSize = typeof value === 'string' && Object.hasOwn(TEXT_SCALES, value) ? value : 'small';
  document.documentElement.style.setProperty('--text-scale', TEXT_SCALES[state.textSize]);
}
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
        const input = query(), filterKey = JSON.stringify(input);
        const report = await request(method, input);
        if (version !== state.version) continue;
        if (filterKey !== state.filterKey) { state.selectedDay = null; state.filterKey = filterKey; }
        applyTextSize(report.preferences?.textSize);
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
  const choices = values.map(v => typeof v === 'string' ? { id: v, name: v } : v);
  const available = selected && !choices.some(v => v.id === selected) ? [{ id: selected, name: selected }, ...choices] : choices;
  const title = choice => choice.name === choice.id ? choice.name : `${choice.name} — ${choice.id}`;
  select.innerHTML = `<option value="">${all}</option>` + available.map(v => `<option value="${esc(v.id)}" title="${esc(title(v))}">${esc(v.name)}</option>`).join('');
  select.value = selected;
  const active = available.find(v => v.id === selected);
  select.title = active ? title(active) : all;
}
function creditLabel(row) {
  return usageValue(row, 'credits', number);
}
function textCell(value, title = value) {
  return `<td class="text-cell" title="${esc(title)}"><span class="cell-text">${esc(value)}</span></td>`;
}
function table(rows, heading, details = false) {
  if (!rows.length) return '<p class="muted">No matching usage.</p>';
  const keys = ['input', 'output', ...(details ? ['reasoning'] : []), 'cacheRead', 'cacheWrite', 'total', ...(details ? ['averageTokens'] : []), 'credits'];
  const titles = { input: 'Input', output: 'Output', reasoning: 'Reasoning', cacheRead: 'Cache read', cacheWrite: 'Cache write', total: 'Tokens', averageTokens: 'Avg. tokens / request', credits: 'AI credits' };
  const hints = { reasoning: 'Reported reasoning tokens are part of output; they are not added to the total again.', averageTokens: 'Average over requests with complete token counts. Follows Include cache tokens. An asterisk marks incomplete coverage.' };
  return `<table><thead><tr><th>${esc(heading)}</th><th>Requests</th>${keys.map(key => `<th${hints[key] ? ` title="${hints[key]}"` : ''}>${titles[key]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${textCell(r.name, r.id ? `${r.name} — ${r.id}` : r.name)}<td>${number(r.requests)}</td>${keys.map(key => `<td${key === 'averageTokens' ? ` title="${number(r.completeTokenRequests)} of ${number(r.requests)} requests have complete token counts"` : ''}>${esc(usageValue(r, key, number))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function skillFolder(file) {
  const end = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (end < 0) return '';
  const root = end === 0 || (end === 2 && file[1] === ':');
  return file.slice(0, end + (root ? 1 : 0));
}
function skillName(skill) {
  if (!skill.path) return `<span title="Location not recorded">${esc(skill.name)}</span>`;
  return `<span class="skill-actions"><button class="skill-link" data-skill-id="${esc(skill.id)}" data-skill-action="open" aria-label="Open folder for ${esc(skill.name)}" title="Open folder containing ${esc(skill.path)}">${esc(skill.name)}</button>${skillFolder(skill.path) ? `<button class="skill-copy" data-skill-id="${esc(skill.id)}" data-skill-action="copy" aria-label="Copy folder path for ${esc(skill.name)}" title="Copy folder path"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>` : ''}</span>`;
}
function skillTriggerSummary(skill) {
  const triggers = skill.triggers || { manual: 0, agent: 0, preloaded: 0, unknown: skill.invocations };
  return `By user: ${number(triggers.manual)}; By agent: ${number(triggers.agent)}; Preloaded: ${number(triggers.preloaded)}; Unknown: ${number(triggers.unknown)}`;
}
function renderIntegrations(report) {
  const mcp = report.mcp || { rows: [], calls: 0, available: false };
  const statusLabels = { connected: 'Connected', pending: 'Connecting', 'needs-auth': 'Needs sign-in', failed: 'Failed', disabled: 'Disabled', stopped: 'Stopped', not_configured: 'Not started', 'not-in-session': 'Not in this session', unavailable: 'Unavailable' };
  const openDetails = new Set([...$('mcp').querySelectorAll('details[open]')].map(node => node.dataset.server));
  $('mcp-summary').textContent = `${number(mcp.rows.length)} servers · ${number(mcp.calls)} calls`;
  $('mcp').innerHTML = mcp.rows.length ? `<table><thead><tr><th>Server</th><th title="Live status in the session hosting this dashboard, independent of date filters.">Current status</th><th>Calls</th><th>Failures</th><th title="Successful calls divided by calls with known outcomes; this is not connection uptime.">Success rate</th><th>Last used</th></tr></thead><tbody>${mcp.rows.map(row => {
    const details = [`Server: ${row.name}`, `Successes: ${number(row.successes)}`, `Unknown outcomes: ${number(row.unknown)}`];
    if (row.enabled !== undefined && row.enabled !== null) details.push(`Enabled: ${row.enabled ? 'Yes' : 'No'}`);
    if (row.source) details.push(`Source: ${row.source}`);
    if (row.plugin) details.push(`Source plugin: ${row.plugin}`);
    if (row.version) details.push(`Plugin version: ${row.version}`);
    if (row.toolsLoaded !== undefined && row.toolsLoaded !== null) details.push(`Tools loaded: ${row.toolsLoaded ? 'Yes' : 'No'}`);
    if (row.error) details.push(`Connection error: ${row.error}`);
    const tone = row.status === 'connected' ? 'ok' : ['failed', 'needs-auth'].includes(row.status) ? 'attention' : 'neutral';
    return `<tr><td class="text-cell"><details class="server-details" data-server="${esc(row.name)}"${openDetails.has(row.name) ? ' open' : ''}><summary class="cell-text">${esc(row.displayName || row.name)}</summary><div class="server-info">${details.map(detail => `<p>${esc(detail)}</p>`).join('')}</div></details></td><td><span class="connection-status ${tone}">${statusLabels[row.status] || 'Unavailable'}</span></td><td>${number(row.calls)}</td><td>${number(row.failures)}</td><td>${row.successRate === null ? '—' : `${row.successRate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}</td><td>${row.lastUsed ? esc(skillDate.format(new Date(row.lastUsed))) : '—'}</td></tr>`;
  }).join('')}</tbody></table>` : `<p class="muted">${mcp.available ? 'No configured MCP servers or recorded MCP calls match this view.' : 'No recorded MCP calls match these filters. Live inventory is unavailable; open this dashboard in an updated Copilot session.'}</p>`;
  $('mcp-note').textContent = `Status: current session${mcp.available ? '' : ' (unavailable)'}. Calls: selected dates and filters. Success rate excludes unknown outcomes. Expand a server for details.`;
  const coverage = [];
  if (mcp.omitted) coverage.push(`${number(mcp.omitted)} MCP calls omitted because their sessions have missing or mixed provider attribution.`);
  if (report.coverage.invalidTools) coverage.push(`${number(report.coverage.invalidTools)} malformed tool events skipped across scanned sources.`);
  $('mcp-coverage').hidden = !coverage.length;
  $('mcp-coverage').textContent = coverage.join(' ');
  const plugins = report.plugins || { available: false, rows: [] };
  $('plugins-summary').textContent = plugins.available ? `${number(plugins.rows.filter(p => p.installed).length)} installed` : 'Inventory unavailable';
  $('plugins').innerHTML = !plugins.available ? '<p class="muted">Plugin inventory is unavailable. Open this dashboard in an updated Copilot session.</p>' : plugins.rows.length ? `<table><thead><tr><th>Plugin</th><th>Installed version</th><th>State</th><th>Marketplace</th><th>Management</th></tr></thead><tbody>${[...plugins.rows].sort((a, b) => a.name.localeCompare(b.name)).map(p => `<tr>${textCell(p.name)}${textCell(p.version || '—')}${textCell(!p.installed ? 'Not installed' : p.enabled === null ? 'Unknown' : p.enabled ? 'Enabled' : 'Disabled')}${textCell(p.marketplace || (p.source === 'builtin' ? 'Built-in' : 'Direct / local'))}${textCell(p.managed ? 'Managed' : '—')}</tr>`).join('')}</tbody></table>` : '<p class="muted">No plugins reported by Copilot.</p>';
}
function renderBreakdown() {
  const report = state.report;
  if (!report) return;
  const group = $('group').value, sort = $('sort').value;
  $('breakdown').innerHTML = table([...report[group]].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1) || a.name.localeCompare(b.name)), { models: 'Model', projects: 'Project', sessions: 'Session' }[group], true);
  const skills = report.skills;
  const focusedSkill = document.activeElement?.dataset.skillId, focusedAction = document.activeElement?.dataset.skillAction;
  $('skills-summary').textContent = `${number(skills.invocations)} activation${skills.invocations === 1 ? '' : 's'} · ${number(skills.sessions)} session${skills.sessions === 1 ? '' : 's'}`;
  $('skills').innerHTML = skills.rows.length ? `<table><thead><tr><th>Skill</th><th title="All recorded activations, including preloaded and unknown triggers. Hover over a count for its breakdown.">Activations</th><th title="Activations explicitly requested by the user.">By user</th><th title="Activations requested by the agent.">By agent</th><th>Sessions</th><th>Projects</th><th>Source plugin</th><th>Plugin version</th><th title="Version declared in the current SKILL.md file; may differ from the version used when the skill ran.">Skill version (installed)</th><th>Last used</th></tr></thead><tbody>${skills.rows.map(s => `<tr><td class="text-cell" title="${esc(s.name)}"><span class="cell-text">${skillName(s)}</span></td><td title="${esc(skillTriggerSummary(s))}">${number(s.invocations)}</td><td>${number(s.triggers?.manual ?? 0)}</td><td>${number(s.triggers?.agent ?? 0)}</td><td>${number(s.sessions)}</td><td>${number(s.projects)}</td>${textCell(s.plugin || '\u2014')}${textCell(s.version || '\u2014')}${textCell(s.installedVersion?.value ?? (s.installedVersion?.status === 'not-declared' ? 'Not declared' : 'Unavailable'))}<td title="${esc(new Date(s.lastUsed).toLocaleString())}">${esc(skillDate.format(new Date(s.lastUsed)))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No recorded skill activations match these filters. Use a skill in Copilot, then refresh. Older sessions may not have saved skill events.</p>';
  if (focusedSkill) [...$('skills').querySelectorAll('[data-skill-id]')].find(button => button.dataset.skillId === focusedSkill && button.dataset.skillAction === focusedAction)?.focus({ preventScroll: true });
  const coverage = [];
  if (skills.omitted) coverage.push(`${number(skills.omitted)} activations omitted because their sessions have missing or mixed provider attribution.`);
  if (report.coverage.invalidSkills) coverage.push(`${number(report.coverage.invalidSkills)} malformed skill events skipped across scanned sources.`);
  $('skills-coverage').hidden = !coverage.length;
  $('skills-coverage').textContent = coverage.join(' ');
  renderIntegrations(report);
}
function render() {
  const r = state.report;
  if (!r) return;
  const t = r.totals, credits = state.metric === 'credits', textScale = TEXT_SCALES[state.textSize];
  const focusedDay = $('daily').contains(document.activeElement) ? document.activeElement.dataset.day : null;
  const selected = r.daily.find(d => d.day === state.selectedDay);
  if (!selected) state.selectedDay = null;
  const scope = selected || t;
  const scopeDate = selected ? new Date(selected.day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
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
    ['AI credits', creditLabel(t), 'Recorded Copilot charges'],
    ['Today', usageValue(r.today, 'total'), 'Tokens · current filters'],
    ['Current streak', `${r.streak.current} days`, 'Days with recorded requests'],
    ['Models', number(r.models.length), 'Used through GitHub Copilot'],
  ];
  $('tiles').innerHTML = tiles.map(([label, value, sub]) => `<div class="tile"><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(sub)}</span></div>`).join('');
  $('token-title').textContent = (selected ? `Tokens on ${scopeDate}` : 'Total tokens') + (r.query.includeCache ? '' : ' excluding cache');
  $('token-total').textContent = usageValue(scope, 'total');
  $('token-total').title = usageValue(scope, 'total', number);
  $('token-context').textContent = `${number(scope.sessions)} sessions · ${number(scope.requests)} requests through GitHub Copilot`;
  $('token-types-title').textContent = `Tokens by type · ${scopeDate || 'all days'}`;
  $('all-days').hidden = !selected;
  const stats = [['Input (including cache)', 'inputTotal'], ['Output', 'output'], ['Uncached input', 'input'], ['Cache read', 'cacheRead'], ['Cache write', 'cacheWrite']];
  const cacheRate = scope.missingCache ? 'Unavailable' : scope.inputTotal ? `${number(scope.cacheRead / scope.inputTotal * 100)}%` : '—';
  $('token-stats').innerHTML = stats.map(([label, key]) => `<div><dt>${label}</dt><dd title="${esc(usageValue(scope, key, number))}">${esc(usageValue(scope, key))}</dd></div>`).join('') + `<div><dt>Cache hit rate</dt><dd>${cacheRate}</dd></div>`;
  $('token-note').textContent = 'Input includes cache reads and writes. Cache hit rate is the share of input read from cache.' + (r.query.includeCache ? '' : ' Cache is excluded from totals and charts; the individual counts above remain visible.');
  $('banner').innerHTML = pixelBanner(r);
  $('daily-title').textContent = credits ? 'Daily AI credits' : 'Daily tokens';
  $('daily-caption').textContent = `${r.daily[0]?.day || ''} — ${r.daily.at(-1)?.day || ''} · local time`;
  const width = Math.max(280, $('daily').clientWidth);
  const unavailable = t.requests && (credits ? t.credits === null : t.knownTokenRequests === 0);
  $('daily').innerHTML = unavailable ? `<p class="muted">${credits ? 'Credit charges' : 'Token counts'} are unavailable for these requests.</p>` : stackedBars(r.daily, { width, height: 230, keys: credits ? ['credits'] : keys, colors, labels, fmt: credits ? number : null, selectable: true, selectedDay: state.selectedDay, textScale });
  const legendKeys = credits ? ['credits'] : keys.filter(k => t[k] > 0);
  $('legend').innerHTML = legendKeys.map(k => `<span><i style="background:${colors[k]}"></i>${labels[k]}</span>`).join('');
  $('calendar').innerHTML = calendarHeatmap(r.calendar);
  $('rhythm').innerHTML = punchCard(r.rhythm);
  const segments = keys.filter(k => scope[k] > 0).map(k => ({ label: labels[k], value: scope[k], color: colors[k] }));
  $('token-bar').innerHTML = segmentBar(segments, { width: Math.max(280, $('token-bar').clientWidth) });
  $('token-legend').innerHTML = keys.filter(k => k !== 'unclassifiedInput' || scope[k] > 0).map(k => `<span title="${esc(usageValue(scope, k, number))}"><i style="background:${colors[k]}"></i>${labels[k]} <b>${esc(usageValue(scope, k))}</b></span>`).join('');
  // Model bars always show tokens; the credit selector controls the daily chart.
  $('models-summary').innerHTML = hBars(r.models.slice(0, 8).map(m => ({ label: m.name, value: m.total, note: usageValue(m, 'total') })), { width: Math.max(280, $('models-summary').clientWidth), textScale });
  $('projects-summary').innerHTML = table(r.projects.slice(0, 10), 'Project');
  $('sources').innerHTML = r.sources.map(s => `<div class="source ${esc(s.state)}"><code>${esc(s.path)}</code><p>${esc(s.state)} · ${number(s.records ?? 0)} requests · ${number(s.files ?? 0)} session logs${s.message ? ` · ${esc(s.message)}` : ''}</p></div>`).join('');
  $('updated').textContent = `Updated ${new Date(r.generatedAt).toLocaleTimeString()}. Refreshes every 30 seconds while visible.`;
  renderBreakdown();
  if (focusedDay) $('daily').querySelector(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true });
}
function selectDay(day) {
  const focusDay = day || state.selectedDay;
  state.selectedDay = state.selectedDay === day ? null : day;
  render();
  $('tip').hidden = true;
  $('live').textContent = state.selectedDay ? `Showing tokens for ${state.selectedDay}` : 'Showing tokens for all days';
  $('daily').querySelector(`[data-day="${focusDay}"]`)?.focus({ preventScroll: true });
}
$('daily').onclick = e => { const day = e.target.closest('[data-day]')?.dataset.day; if (day) selectDay(day); };
$('daily').onkeydown = e => { const day = e.target.closest('[data-day]')?.dataset.day; if (day && ['Enter', ' '].includes(e.key)) { e.preventDefault(); selectDay(day); } };
$('all-days').onclick = () => selectDay(null);
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
$('skills').onclick = async event => {
  const button = event.target.closest('[data-skill-id]');
  if (!button || state.skillActionPending) return;
  const skill = state.report.skills.rows.find(s => s.id === button.dataset.skillId);
  if (!skill?.path) return;
  const copy = button.dataset.skillAction === 'copy';
  state.skillActionPending = true;
  button.setAttribute('aria-busy', 'true');
  const status = $('skill-folder-status');
  status.hidden = true;
  status.textContent = '';
  $('live').textContent = `${copy ? 'Copying folder path' : 'Opening folder'} for ${skill.name}…`;
  try {
    if (copy) {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this window.');
      await navigator.clipboard.writeText(skillFolder(skill.path));
      $('live').textContent = `Folder path copied for ${skill.name}.`;
    } else {
      await request('skills.openFolder', { id: button.dataset.skillId });
      $('live').textContent = 'Folder request sent to your file manager.';
    }
  }
  catch (error) { status.hidden = false; status.textContent = `Could not ${copy ? 'copy folder path' : 'open skill folder'}: ${error.message}`; }
  finally { state.skillActionPending = false; button.removeAttribute('aria-busy'); }
};
$('clear-filters').onclick = () => { for (const id of ['model', 'project', 'session']) $(id).value = ''; $('cache').checked = true; load(); };
$('settings-open').onclick = async () => {
  $('settings-error').hidden = true;
  $('settings-save').disabled = true;
  $('settings-dialog').showModal();
  try {
    const config = await request('settings.get');
    $('text-size').value = config.textSize ?? 'small';
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
    const config = await request('settings.set', { textSize: $('text-size').value, extraHomes: lines('extra-homes'), disabledHomes: lines('disabled-homes') });
    applyTextSize(config.textSize); render();
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
