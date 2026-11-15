import { stackedBars, calendarHeatmap, punchCard, segmentBar, hBars, esc, usageValue, TOKEN_KEYS, TOKEN_LABELS, TOKEN_COLORS } from './charts.mjs';
import { pixelBanner, nextBuildingPatterns, skyFor } from './art.mjs';
import { dayKey, localDay } from '../core/query.mjs';
import { createDiagnostics, diagnosticError } from '../core/diagnostics.mjs';
import { buildEfficiencyReview, toolOutcomeSummary } from './efficiency.mjs';
import { TOKEN_TOPICS, PATTERN_TOPICS, renderTokenTopic, tokenTopicIcon } from './token-topics.mjs';
import { formatNumber, formatCredits } from '../core/format.mjs';
import { mergeMcpInventory } from '../core/integrations.mjs';

const $ = id => document.getElementById(id);
const clientDiagnostics = createDiagnostics();
clientDiagnostics.record('info', 'ui.started');
window.addEventListener('error', event => clientDiagnostics.record('error', 'ui.error', { ...diagnosticError(event.error), line: event.lineno, column: event.colno }));
window.addEventListener('unhandledrejection', event => clientDiagnostics.record('error', 'ui.rejection', diagnosticError(event.reason)));
const connectionState = () => ({ online: navigator.onLine, hidden: document.hidden, secureContext: window.isSecureContext });
for (const event of ['online', 'offline', 'pagehide', 'pageshow']) window.addEventListener(event, () => clientDiagnostics.record('info', `ui.${event}`, connectionState()));
window.addEventListener('securitypolicyviolation', event => {
  if (['connect-src', 'default-src'].includes(event.effectiveDirective)) clientDiagnostics.record('warn', 'ui.connectionPolicy', { directive: event.effectiveDirective, ...connectionState() });
});
$('feedback').href += '?body=' + encodeURIComponent(`Usage Insights v${BUILD_VERSION}\n\nWhat happened?\n\nSteps to reproduce:\n\nExpected behavior:\n\nDiagnostic logs (Show logs > Copy logs):\n\n`);
const number = (value, options = {}) => formatNumber(value, { simplify: state.simplifyNumbers, ...options });
const creditNumber = value => formatCredits(value, { simplify: state.simplifyNumbers });
const TEXT_SCALES = { small: 1, medium: 1.15, large: 1.3 };
const RANGE_LABELS = { '1d': 'Today', '7d': 'Last 7 days', mtd: 'Rolling 30', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All history', custom: 'Custom dates' };
const skillDate = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true });
const state = { range: 'mtd', metric: 'tokens', metricEmphasis: false, view: 'usage', report: null, creditsUnavailable: false, version: 0, pending: false, force: false, rescan: false, selectedDay: null, filterKey: '', skillActionPending: false, textSize: 'small', simplifyNumbers: true, bannerRange: null, buildingPatterns: {}, requestView: null, modelView: null, projectView: null };
let dismissedCoverage = '';
let loadError = '', lastResponseAt, cachedServerDiagnostics;
$('coverage-dismiss').onclick = () => {
  dismissedCoverage = $('coverage-message').textContent;
  $('coverage').hidden = true;
  if (document.activeElement === $('coverage-dismiss')) $('refresh').focus({ preventScroll: true });
};
const colors = { ...TOKEN_COLORS, unclassifiedInput: 'var(--muted-fg)', credits: 'var(--s1)' };
const labels = { ...TOKEN_LABELS, input: 'Uncached input', unclassifiedInput: 'Input (cache split unknown)', credits: 'AI credits' };

function applyTextSize(value) {
  state.textSize = typeof value === 'string' && Object.hasOwn(TEXT_SCALES, value) ? value : 'small';
  document.documentElement.style.setProperty('--text-scale', TEXT_SCALES[state.textSize]);
}
function applyPreferences(config = {}) {
  applyTextSize(config.textSize);
  const simplified = config.simplifyNumbers !== false;
  const changed = state.simplifyNumbers !== simplified;
  state.simplifyNumbers = simplified;
  if (changed && efficiencyContextSnapshot && !$('efficiency-context-read').disabled) renderEfficiencyContext();
}
async function request(method, input = {}, refresh = false, signal, known) {
  const fields = { method, range: input.range, refresh, detail: method === 'usage.requests' && input.id !== undefined, requestStage: 'fetch', ...connectionState() };
  const work = async () => {
    try {
      const response = await fetch('api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input, ...(refresh ? { refresh: true } : {}), ...(known ? { known } : {}) }), ...(signal ? { signal } : {}) });
      lastResponseAt = Date.now();
      fields.httpStatus = response.status;
      fields.requestStage = 'decode';
      const result = await response.json();
      fields.requestStage = 'http';
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
      fields.requestStage = 'complete';
      if (method === 'usage.inventory' && result.diagnostics) cachedServerDiagnostics = result.diagnostics;
      if (Array.isArray(result.rows)) fields.rows = result.rows.length;
      return result;
    } catch (error) {
      Object.assign(fields, connectionState(), lastResponseAt === undefined ? {} : { lastResponseAgeMs: Date.now() - lastResponseAt });
      if (error && typeof error === 'object') error.requestStage = fields.requestStage;
      throw error;
    }
  };
  return clientDiagnostics.measure('api.request', fields, work);
}
function diagnosticText(server = cachedServerDiagnostics, cached = true) {
  const client = clientDiagnostics.snapshot();
  const lines = [`Usage Insights v${BUILD_VERSION}`, `Exported: ${new Date().toISOString()}`,
    server ? `Server: v${server.version}, Node ${server.runtime.node}, ${server.runtime.platform}/${server.runtime.arch}` : 'Server logs unavailable.',
    `Dashboard started: ${client.startedAt}; retained ${client.entries.length}/${client.limit} entries; dropped ${client.dropped}`];
  if (server) lines.push(`Server started: ${server.startedAt}; retained ${server.entries.length}/${server.limit} entries; dropped ${server.dropped}`);
  if (server && cached) lines.push(`Cached server snapshot from ${server.capturedAt || server.startedAt}; this is not a live connection check.`);
  if (server?.persisted) lines.push(`Recent local lifecycle logs: ${server.persisted.available ? 'available' : 'partly unavailable'}; retained ${server.persisted.entries.length} entries. These can include earlier extension processes.`);
  lines.push('Structured diagnostics only: no prompts, names, paths, raw error messages, or credentials.', 'Timings are milliseconds; UI timings measure JavaScript/DOM updates, not final browser paint.', '');
  const entries = [...client.entries.map(entry => ({ ...entry, source: 'dashboard' })), ...(server?.entries || []).map(entry => ({ ...entry, source: 'server' })), ...(server?.persisted?.entries || []).map(entry => ({ ...entry, source: 'lifecycle' }))];
  entries.sort((a, b) => a.at.localeCompare(b.at));
  return lines.concat(entries.map(entry => JSON.stringify(entry))).join('\n');
}
const releaseFamily = version => version.split('.').slice(0, 2).join('.');
function showReleaseNote(version) {
  const release = RELEASE_NOTES.find(entry => entry.version === version);
  if (!release) return;
  $('release-note-title').textContent = `v${release.version}`;
  $('release-installed').hidden = release.version !== BUILD_VERSION;
  $('release-summary').textContent = release.summary;
  $('release-note').scrollTop = 0;
  for (const button of $('release-versions').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.releaseVersion === release.version));
}
function showReleaseFamily(family, version) {
  const releases = RELEASE_NOTES.filter(entry => releaseFamily(entry.version) === family);
  if (!releases.length) return;
  for (const button of $('release-families').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.releaseFamily === family));
  $('release-versions').innerHTML = releases.map(entry => `<button data-release-version="${esc(entry.version)}" aria-pressed="false" aria-controls="release-note"><span>v${esc(entry.version)}</span>${entry.version === BUILD_VERSION ? '<span class="release-installed-label">Installed</span>' : ''}</button>`).join('');
  $('release-versions').scrollTop = 0;
  showReleaseNote(version || releases[0].version);
}
$('plugin-version').onclick = () => {
  const families = [...new Set(RELEASE_NOTES.map(entry => releaseFamily(entry.version)))];
  $('release-families').innerHTML = families.map(family => `<button data-release-family="${esc(family)}" aria-pressed="false" aria-controls="release-versions"><span>v${esc(family)}.x</span></button>`).join('');
  showReleaseFamily(releaseFamily(BUILD_VERSION), BUILD_VERSION);
  if (!$('release-notes-dialog').open) $('release-notes-dialog').showModal();
  $('release-versions').querySelector('[aria-pressed="true"]')?.focus();
};
$('release-families').onclick = event => {
  const button = event.target.closest('[data-release-family]');
  if (button) showReleaseFamily(button.dataset.releaseFamily);
};
$('release-versions').onclick = event => {
  const button = event.target.closest('[data-release-version]');
  if (button) showReleaseNote(button.dataset.releaseVersion);
};
$('release-notes-close').onclick = () => $('release-notes-dialog').close();
$('release-notes-dialog').onclose = () => $('plugin-version').focus({ preventScroll: true });
let logsLoading = false;
async function showLogs() {
  if (!$('logs-dialog').open) $('logs-dialog').showModal();
  if (logsLoading) return;
  logsLoading = true;
  $('logs-reload').disabled = true;
  $('logs-copy').disabled = false;
  $('logs-status').textContent = 'Loading logs…';
  $('logs-output').value = diagnosticText();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
  try {
    cachedServerDiagnostics = await request('diagnostics.get', {}, false, controller.signal);
    $('logs-output').value = diagnosticText(cachedServerDiagnostics, false);
    $('logs-status').textContent = 'Ready to copy.';
  } catch (error) {
    clientDiagnostics.record('error', 'diagnostics.read', diagnosticError(error));
    $('logs-output').value = diagnosticText();
    $('logs-status').textContent = cachedServerDiagnostics ? 'The server is unreachable. Dashboard logs and the last server snapshot are ready to copy.' : 'Server logs are unavailable. Dashboard logs are still ready to copy.';
  } finally { clearTimeout(timeout); logsLoading = false; $('logs-reload').disabled = $('logs-copy').disabled = false; }
}
$('logs-open').onclick = $('logs-reload').onclick = showLogs;
$('logs-close').onclick = () => $('logs-dialog').close();
$('logs-copy').onclick = async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText($('logs-output').value);
    $('logs-status').textContent = 'Logs copied. Paste them into your GitHub issue.';
  } catch (error) {
    clientDiagnostics.record('warn', 'diagnostics.copy', diagnosticError(error));
    $('logs-status').textContent = 'Clipboard access is unavailable. The logs are selected; copy them manually.';
    $('logs-output').focus(); $('logs-output').select();
  }
};
function query() {
  return { range: state.range, includeCache: $('cache').checked,
    ...($('model').value ? { models: [$('model').value] } : {}), project: $('project').value, session: $('session').value,
    ...(state.range === 'custom' ? { startDate: state.startDate, endDate: state.endDate } : {}) };
}
let inventorySnapshot, inventoryPending = false, inventoryQueued = false, historyMcp;
function applyInventory() {
  if (!state.report) return;
  state.report.mcp = inventorySnapshot ? mergeMcpInventory(historyMcp, inventorySnapshot.mcp) : historyMcp;
  state.report.plugins = inventorySnapshot?.plugins;
}
async function loadInventory(refresh = false) {
  if (inventoryPending) { inventoryQueued ||= refresh; return; }
  inventoryPending = true;
  renderIntegrations(state.report);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
  try { inventorySnapshot = await request('usage.inventory', {}, false, controller.signal); }
  catch (error) {
    inventorySnapshot = { mcp: { available: false, rows: [] }, plugins: { available: false, rows: [] } };
    clientDiagnostics.record('warn', 'inventory.read', diagnosticError(error));
  } finally {
    clearTimeout(timer);
    inventoryPending = false;
    applyInventory();
    renderIntegrations(state.report);
    if (inventoryQueued) { inventoryQueued = false; void loadInventory(); }
  }
}
async function load(force = false, refresh = false) {
  state.version++; state.force ||= force; state.rescan ||= refresh;
  if (state.pending) return;
  state.pending = true;
  $('refresh').disabled = $('footer-refresh').disabled = true;
  try {
    let version;
    do {
      version = state.version;
      const method = state.force ? 'usage.refresh' : 'usage.report'; state.force = false;
      const rescan = state.rescan; state.rescan = false;
      try {
        const input = query(), filterKey = JSON.stringify(input);
        // When this very view is already on screen, the server may answer that nothing changed.
        const known = method === 'usage.report' && state.report && !state.creditsUnavailable && filterKey === state.filterKey ? state.report.revision : undefined;
        const report = await request(method, input, rescan, undefined, known);
        if (version !== state.version) continue;
        loadError = '';
        if (report.unchanged) {
          const sky = skyFor(new Date(state.report.generatedAt).getHours());
          state.report.generatedAt = report.generatedAt; state.report.scannedAt = report.scannedAt;
          renderClock(sky);
          renderLoadStatus();
          if (!inventorySnapshot || rescan) void loadInventory(rescan);
          $('live').textContent = 'Usage updated';
          continue;
        }
        if (filterKey !== state.filterKey) { state.selectedDay = null; state.requestView = null; state.modelView = null; state.projectView = null; state.filterKey = filterKey; }
        applyPreferences(report.preferences);
        state.creditsUnavailable = false;
        state.report = { ...report };
        historyMcp = report.mcp;
        applyInventory();
        render();
        if (!inventorySnapshot || method === 'usage.refresh' || rescan) void loadInventory(method === 'usage.refresh' || rescan);
        if (state.modelView) loadModelSessionPage(state.modelView.offset);
        if (state.projectView?.models) loadSessionModels();
        $('live').textContent = 'Usage updated';
      } catch (e) {
        if (version !== state.version) continue;
        state.creditsUnavailable = !state.report || state.filterKey !== JSON.stringify(query());
        if (state.creditsUnavailable) { state.requestView = null; state.modelView = null; state.projectView = null; }
        loadError = e.requestStage === 'fetch' ? 'Could not reach the local dashboard server. Try Refresh, or close and reopen Usage Insights from Copilot.' : `Could not update usage: ${e.message}`;
        renderHeaderCredits();
        renderLoadStatus();
        if (state.creditsUnavailable) $('status').before($('filters'));
      }
    } while (version !== state.version);
  } finally { state.pending = false; $('refresh').disabled = $('footer-refresh').disabled = false; }
}
function renderLoadStatus() {
  const matching = state.report && state.filterKey === JSON.stringify(query());
  $('content').hidden = !matching;
  $('status').hidden = !loadError && !!state.report?.totals.requests;
  $('status').textContent = loadError ? loadError + (matching ? ' Showing the last successful data; it may be out of date.' : ' Data for these filters could not be loaded.') : 'No matching Copilot usage yet. Make a request in Copilot, then refresh. Check Local data sources below if you expected history.';
}
const builtOptions = new Map();
function options(id, values, all) {
  const select = $(id), selected = select.value;
  // A long history has thousands of sessions; the list is rebuilt only when it differs.
  const key = JSON.stringify([selected, all, values]);
  if (builtOptions.get(id) === key) return;
  builtOptions.set(id, key);
  const choices = values.map(v => typeof v === 'string' ? { id: v, name: v } : v);
  const available = selected && !choices.some(v => v.id === selected) ? [{ id: selected, name: selected }, ...choices] : choices;
  const title = choice => choice.name === choice.id ? choice.name : `${choice.name} — ${choice.id}`;
  select.innerHTML = `<option value="">${all}</option>` + available.map(v => `<option value="${esc(v.id)}" title="${esc(title(v))}">${esc(v.name)}</option>`).join('');
  select.value = selected;
  const active = available.find(v => v.id === selected);
  select.title = active ? title(active) : all;
}
function creditLabel(row) {
  return usageValue(row, 'credits', creditNumber);
}
function renderHeaderCredits() {
  const totals = !state.creditsUnavailable && state.filterKey === JSON.stringify(query()) ? state.report?.totals : null;
  $('hero-credits').textContent = totals ? creditLabel(totals) : 'Unavailable';
  $('hero-credits').title = totals ? 'Recorded Copilot credits for the current filters.' + (totals.missingCredits || totals.partialCredits ? ' An asterisk marks incomplete credit coverage.' : '') : 'Credits could not be loaded for the current filters.';
}
function textCell(value, title = value) {
  return `<td class="text-cell" title="${esc(title)}"><span class="cell-text">${esc(value)}</span></td>`;
}
function sortActivity(rows, key) {
  const value = row => {
    if (key === 'lastUsed') return Date.parse(row.lastUsed) || 0;
    if (key === 'total' && row.requests > 0 && row.knownTokenRequests === 0) return -1;
    return row[key] ?? -1;
  };
  return [...rows].sort((a, b) => {
    const byName = (a.displayName || a.name).localeCompare(b.displayName || b.name) || a.name.localeCompare(b.name);
    if (key === 'name') return byName;
    return value(b) - value(a) || byName;
  });
}
const pluginMarketplace = plugin => plugin.marketplace || (plugin.source === 'builtin' ? 'Built-in' : 'Direct / local');
function table(rows, heading, details = false, expansion = '', depth = 0) {
  if (!rows.length) return depth ? '' : '<p class="muted">No matching usage.</p>';
  const keys = ['input', 'output', ...(details ? ['reasoning'] : []), 'cacheRead', 'cacheWrite', ...(details ? ['averageTokens'] : []), 'total', 'credits'];
  const titles = { input: 'Input', output: 'Output', reasoning: 'Reasoning', cacheRead: 'Cache read', cacheWrite: 'Cache write', total: 'Tokens', averageTokens: 'Avg. tokens / request', credits: 'AI credits' };
  const hints = { reasoning: 'Reported reasoning tokens are part of output; they are not added to the total again.', averageTokens: 'Average over requests with complete token counts. Follows Include cache tokens. An asterisk marks incomplete coverage.' };
  const modelExpansion = expansion === 'model', projectExpansion = expansion === 'project';
  const projectFilter = expansion === 'projectFilter';
  const sessionExpansion = expansion === 'session', requestExpansion = expansion === 'request', sessionModelsExpansion = expansion === 'sessionModels';
  const expandable = modelExpansion || projectExpansion || sessionExpansion || requestExpansion || sessionModelsExpansion;
  const attribute = modelExpansion ? 'data-request-model' : projectExpansion ? 'data-project-name' : sessionExpansion ? 'data-request-session' : sessionModelsExpansion ? 'data-project-session' : 'data-request-id';
  const region = modelExpansion ? 'model-sessions' : projectExpansion ? 'project-sessions' : sessionExpansion ? 'session-requests' : sessionModelsExpansion ? 'session-models' : 'request-detail';
  const body = rows.map((r, index) => {
    const open = modelExpansion ? state.modelView?.model === r.name : projectExpansion ? state.projectView?.project === r.name : sessionExpansion ? state.requestView?.session === r.id : sessionModelsExpansion ? state.projectView?.models?.session === r.id : requestExpansion && state.requestView?.selectedId === r.id;
    const label = requestExpansion ? requestDate.format(new Date(r.ts)) : r.name;
    const title = requestExpansion ? `${initiatorLabel(r.initiator)} \u00b7 Recorded model call` : r.id ? `${label} \u2014 ${r.id}` : label;
    const child = !open ? null : modelExpansion ? modelSessionList() : projectExpansion ? projectSessionList(r.name) : sessionExpansion ? requestList() : sessionModelsExpansion ? sessionModelList() : { header: requestDetail(state.requestView) };
    const childRows = child?.rows || '';
    const controlled = child ? [region, ...[...childRows.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])].join(' ') : '';
    const choice = projectFilter ? `<td class="text-cell"><button class="model-toggle cell-text" data-usage-project="${esc(r.name)}" aria-pressed="${$('project').value === r.name}" title="${esc(r.name)}: ${$('project').value === r.name ? 'clear project filter' : 'filter dashboard'}">${esc(r.name)}</button></td>` : '';
    const name = projectFilter ? choice : expandable ? `<td class="text-cell"><button class="${requestExpansion ? 'request-toggle' : 'model-toggle'} cell-text" ${attribute}="${esc(modelExpansion || projectExpansion ? r.name : r.id)}" aria-expanded="${!!open}"${open ? ` aria-controls="${controlled}"` : ''} aria-label="${esc(heading)}: ${esc(label)}" title="${esc(title)}"><span aria-hidden="true">${open ? '\u25be' : '\u25b8'}</span> ${esc(label)}</button></td>` : textCell(label, title);
    const cells = `<tr${details ? ` class="usage-row" data-depth="${depth}" id="usage-row-${depth}-${index}"` : projectFilter && $('project').value && $('project').value !== r.name ? ' class="choice-muted"' : ''}>${name}${projectFilter ? `<td title="${number(r.uncertainPrompts)} prompt candidates have uncertain attribution. Counts reflect available local logs.">${r.userPrompts == null ? '\u2014' : number(r.userPrompts) + (r.uncertainPrompts ? ' *' : '')}</td>` : ''}<td data-measure="requests">${number(r.requests)}</td>${keys.map(key => `<td data-measure="${key === 'credits' ? 'credits' : 'tokens'}"${key === 'averageTokens' ? ` title="${number(r.completeTokenRequests)} of ${number(r.requests)} requests have complete token counts"` : ''}>${esc(usageValue(r, key, key === 'credits' ? creditNumber : number))}</td>`).join('')}</tr>`;
    if (!open) return cells;
    return cells + `<tr class="usage-context" data-depth="${depth + 1}"><td colspan="${keys.length + 2}"><div id="${region}" class="${requestExpansion ? 'request-detail' : 'request-list'}" aria-label="${requestExpansion ? 'Original prompt' : `${modelExpansion || projectExpansion ? 'Sessions' : sessionModelsExpansion ? 'Models' : 'Requests'} for ${esc(label)}`}">${child.header}</div></td></tr>${childRows}`;
  }).join('');
  const header = `<tr${details ? ` class="usage-header" data-depth="${depth}" id="usage-header-${depth}"` : ''}><th scope="col">${esc(heading)}</th>${projectFilter ? '<th title="Distinct confirmed user submissions, dated by submission. Continuations and subagent messages are not additional prompts. Unknown attribution is excluded; an asterisk marks known gaps. Model filters require reliable links. Missing billing alone does not exclude a prompt. Local logs may be incomplete.">User prompts</th><th>Model turns</th>' : '<th scope="col">Requests</th>'}${keys.map(key => `<th scope="col" data-measure="${key === 'credits' ? 'credits' : 'tokens'}"${hints[key] ? ` title="${hints[key]}"` : ''}>${titles[key]}</th>`).join('')}</tr>`;
  if (depth) return header + body;
  // Reserve column space from the whole report before any child rows are loaded.
  const totals = state.report.totals;
  const metricWidth = Math.max(11, number(totals.requests).length, ...keys.map(key => usageValue(totals, key, key === 'credits' ? creditNumber : number).length));
  const layout = details ? ` class="usage-table" style="--usage-metric-width:${metricWidth}ch"` : '';
  return `<table${layout}>${details ? '<colgroup><col class="usage-name-column"><col span="9"></colgroup>' : ''}<thead>${header}</thead><tbody>${body}</tbody></table>`;
}

function sortedUsage(rows) {
  const sort = $('sort').value;
  return [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1) || a.name.localeCompare(b.name) || (a.id || '').localeCompare(b.id || ''));
}
function projectSessionList(project) {
  const rows = sortedUsage(state.report.sessions.filter(s => s.project === project));
  const total = rows.length, limit = 25, view = state.projectView;
  view.offset = Math.min(view.offset, Math.max(0, Math.ceil(total / limit) - 1) * limit);
  const offset = view.offset, end = Math.min(offset + limit, total);
  if (view.models && !rows.slice(offset, end).some(r => r.id === view.models.session)) view.models = null;
  const paging = total > limit ? `<div class="request-paging"><span>${offset + 1}–${end}</span><button data-session-page-direction="previous" data-session-page="${Math.max(0, offset - limit)}"${offset === 0 ? ' disabled' : ''}>Previous</button><button data-session-page-direction="next" data-session-page="${end}"${end >= total ? ' disabled' : ''}>Next</button></div>` : '';
  return { header: `<header class="session-paging"><strong>${number(total)} session${total === 1 ? '' : 's'}</strong>${paging}</header>`, rows: table(rows.slice(offset, end), 'Session', true, 'sessionModels', 1) };
}

function sessionModelList() {
  const view = state.projectView.models;
  if (view.pending && !view.rows) return { header: '<p class="muted" role="status">Loading session models…</p>' };
  if (view.error) return { header: `<p role="status">${esc(view.error)} <button data-project-session="${esc(view.session)}" data-session-model-retry="true">Retry</button></p>` };
  if (!view.rows?.length) return { header: '<p class="muted">No matching models remain. Refresh to update the session totals.</p>' };
  return { header: `<header><strong>${number(view.rows.length)} model${view.rows.length === 1 ? '' : 's'}</strong>${view.pending ? '<span class="footnote" role="status">Updating…</span>' : ''}</header>`, rows: table(sortedUsage(view.rows), 'Model', true, '', 2) };
}
async function loadSessionModels() {
  const project = state.projectView, view = project?.models;
  if (!view) return;
  const version = ++view.version;
  view.pending = true; view.error = '';
  renderBreakdown();
  try {
    const result = await request('usage.sessionModels', { ...JSON.parse(state.filterKey), project: project.project, session: view.session });
    if (state.projectView !== project || project.models !== view || view.version !== version) return;
    view.rows = result.rows;
  } catch (e) {
    if (state.projectView !== project || project.models !== view || view.version !== version) return;
    view.error = `Could not load models: ${e.message}`;
  } finally {
    if (state.projectView === project && project.models === view && view.version === version) { view.pending = false; renderBreakdown(); }
  }
}

const requestDate = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const initiatorLabel = value => ({ user: 'User prompt', agent: 'Agent continuation', 'sub-agent': 'Subagent' }[value] || 'Not recorded');
function requestDetail(view) {
  if (view.detailPending) return '<p class="muted" role="status">Loading original prompt…</p>';
  if (view.detailError) return `<p role="status">${esc(view.detailError)} <button data-request-id="${esc(view.selectedId)}" data-request-retry="true">Retry</button></p>`;
  const r = view.detail;
  if (!r) return '<p class="muted">This request is no longer available in the selected sources.</p>';
  return `<h3>Original prompt</h3>${r.prompt?.available ? `<pre class="request-prompt">${esc(r.prompt.text || '(Empty prompt)')}</pre>${r.prompt.truncated ? `<p class="footnote">Showing the first ${number(12000)} characters.</p>` : ''}` : '<p class="muted">Prompt unavailable: the local log is missing or has no reliable link to this request.</p>'}`;
}
function modelSessionList() {
  const view = state.modelView;
  if (view.pending && !view.page) return { header: '<p class="muted" role="status">Loading model sessions…</p>' };
  if (view.error) return { header: `<p role="status">${esc(view.error)} <button data-model-session-page="${view.offset}">Retry</button></p>` };
  const page = view.page;
  if (!page?.rows.length) return { header: '<p class="muted">No matching sessions remain. Refresh to update the model totals.</p>' };
  const end = page.offset + page.rows.length;
  return { header: `<header><div><strong>${number(page.total)} session${page.total === 1 ? '' : 's'}</strong>${view.pending ? '<p class="footnote" role="status">Updating…</p>' : ''}</div><div class="request-paging"><span>${page.offset + 1}–${end}</span><button data-model-session-page-direction="previous" data-model-session-page="${Math.max(0, page.offset - page.limit)}" aria-disabled="${view.pending}"${page.offset === 0 ? ' disabled' : ''}>Previous</button><button data-model-session-page-direction="next" data-model-session-page="${end}" aria-disabled="${view.pending}"${end >= page.total ? ' disabled' : ''}>Next</button></div></header>`, rows: table(page.rows, 'Session', true, 'session', 1) };
}
function requestList() {
  const view = state.requestView;
  if (view.pending && !view.page) return { header: '<p class="muted" role="status">Loading session requests…</p>' };
  if (view.error) return { header: `<p role="status">${esc(view.error)} <button data-request-page="${view.offset}">Retry</button></p>` };
  const page = view.page;
  if (!page?.rows.length) return { header: '<p class="muted">No matching requests remain. Refresh to update the session totals.</p>' };
  const end = page.offset + page.rows.length;
  return { header: `<header><div><strong>${number(page.total)} model request${page.total === 1 ? '' : 's'}</strong><p class="footnote">One prompt can produce several model requests. Newest first.${view.pending ? ' Updating…' : ''}</p></div><div class="request-paging"><span>${page.offset + 1}–${end}</span><button data-request-page-direction="previous" data-request-page="${Math.max(0, page.offset - page.limit)}" aria-disabled="${view.pending}"${page.offset === 0 ? ' disabled' : ''}>Previous</button><button data-request-page-direction="next" data-request-page="${end}" aria-disabled="${view.pending}"${end >= page.total ? ' disabled' : ''}>Next</button></div></header>`, rows: table(page.rows, 'Time', true, 'request', 2) };
}
async function loadModelSessionPage(offset = 0) {
  const view = state.modelView;
  if (!view) return;
  const version = ++view.version;
  view.pending = true; view.error = ''; view.offset = offset;
  renderBreakdown();
  try {
    const page = await request('usage.sessions', { ...JSON.parse(state.filterKey), model: view.model, sort: $('sort').value, offset });
    if (state.modelView !== view || view.version !== version) return;
    view.page = page; view.offset = page.offset;
    if (state.requestView && !page.rows.some(r => r.id === state.requestView.session)) state.requestView = null;
    else if (state.requestView) await loadRequestPage(state.requestView.offset);
  } catch (e) {
    if (state.modelView !== view || view.version !== version) return;
    view.error = `Could not load sessions: ${e.message}`;
  } finally {
    if (state.modelView === view && view.version === version) { view.pending = false; renderBreakdown(); }
  }
}
async function loadRequestPage(offset = 0) {
  const view = state.requestView;
  if (!view) return;
  const version = ++view.version;
  view.pending = true; view.error = ''; view.offset = offset;
  view.details.clear(); view.detailVersion++; view.detail = null; view.detailPending = !!view.selectedId;
  renderBreakdown();
  try {
    const page = await request('usage.requests', { ...JSON.parse(state.filterKey), model: view.model, session: view.session, offset });
    if (state.requestView !== view || view.version !== version) return;
    view.page = page; view.offset = page.offset;
    if (view.selectedId && !page.rows.some(r => r.id === view.selectedId)) { view.selectedId = null; view.detail = null; }
    else if (view.selectedId) { view.pending = false; await loadRequestDetail(view.selectedId); }
  } catch (e) {
    if (state.requestView !== view || view.version !== version) return;
    view.error = `Could not load requests: ${e.message}`;
  } finally {
    if (state.requestView === view && view.version === version) { view.pending = false; renderBreakdown(); }
  }
}
async function loadRequestDetail(id) {
  const view = state.requestView;
  if (!view || !view.page?.rows.some(r => r.id === id) || view.pending) return;
  const version = ++view.detailVersion;
  if (view.details.has(id)) { view.selectedId = id; view.detail = view.details.get(id); view.detailPending = false; view.detailError = ''; renderBreakdown(); return; }
  view.selectedId = id; view.detail = null; view.detailPending = true; view.detailError = '';
  renderBreakdown();
  try {
    const page = await request('usage.requests', { ...JSON.parse(state.filterKey), model: view.model, session: view.session, id });
    if (state.requestView !== view || view.detailVersion !== version || view.selectedId !== id) return;
    view.detail = page.rows[0] || null; view.details.set(id, view.detail);
  } catch (e) {
    if (state.requestView !== view || view.detailVersion !== version || view.selectedId !== id) return;
    view.detailError = `Could not load original prompt: ${e.message}`;
  } finally {
    if (state.requestView === view && view.detailVersion === version) { view.detailPending = false; renderBreakdown(); }
  }
}
function skillFolder(file) {
  const end = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (end < 0) return '';
  const root = end === 0 || (end === 2 && file[1] === ':');
  return file.slice(0, end + (root ? 1 : 0));
}
function skillName(skill) {
  if (skill.unresolved) return `<span title="Failed loads recorded by name; no unique skill location, plugin, and version was identified in this session and project.">${esc(skill.name)} <span class="muted">(unresolved)</span></span>`;
  if (!skill.path) return `<span title="Location not recorded">${esc(skill.name)}</span>`;
  return `<span class="skill-actions"><button class="skill-link" data-skill-id="${esc(skill.id)}" data-skill-action="open" aria-label="Open folder for ${esc(skill.name)}" title="Open folder containing ${esc(skill.path)}">${esc(skill.name)}</button>${skillFolder(skill.path) ? `<button class="skill-copy" data-skill-id="${esc(skill.id)}" data-skill-action="copy" aria-label="Copy folder path for ${esc(skill.name)}" title="Copy folder path"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>` : ''}</span>`;
}
function skillTriggerSummary(skill) {
  const triggers = skill.triggers || { manual: 0, agent: 0, preloaded: 0, unknown: skill.invocations };
  return `By user: ${number(triggers.manual)}; By agent: ${number(triggers.agent)}; Preloaded: ${number(triggers.preloaded)}; Unknown: ${number(triggers.unknown)}`;
}
function renderIntegrations(report) {
  const focusedServer = document.activeElement?.closest?.('details[data-server]')?.dataset.server;
  const mcp = report.mcp || { rows: [], calls: 0, available: false };
  const statusLabels = { connected: 'Connected', pending: 'Connecting', 'needs-auth': 'Needs sign-in', failed: 'Failed', disabled: 'Disabled', stopped: 'Stopped', not_configured: 'Not started', 'not-in-session': 'Not in this session', unavailable: 'Unavailable' };
  const openDetails = new Set([...$('mcp').querySelectorAll('details[open]')].map(node => node.dataset.server));
  $('mcp-summary').textContent = `${number(mcp.rows.length)} servers · ${number(mcp.calls)} calls`;
  $('mcp').innerHTML = mcp.rows.length ? `<table><thead><tr><th>Server</th><th title="Live status in the session hosting this dashboard, independent of date filters.">Current status</th><th>Calls</th><th>Failures</th><th title="Successful calls divided by calls with known outcomes; this is not connection uptime.">Success rate</th><th>Last used</th></tr></thead><tbody>${sortActivity(mcp.rows, $('mcp-sort').value).map(row => {
    const details = [`Server: ${row.name}`, `Successes: ${number(row.successes)}`, `Unknown outcomes: ${number(row.unknown)}`];
    if (row.enabled !== undefined && row.enabled !== null) details.push(`Enabled: ${row.enabled ? 'Yes' : 'No'}`);
    if (row.source) details.push(`Source: ${row.source}`);
    if (row.plugin) details.push(`Source plugin: ${row.plugin}`);
    if (row.version) details.push(`Plugin version: ${row.version}`);
    if (row.toolsLoaded !== undefined && row.toolsLoaded !== null) details.push(`Tools loaded: ${row.toolsLoaded ? 'Yes' : 'No'}`);
    if (row.error) details.push(`Connection error: ${row.error}`);
    const tone = row.status === 'connected' ? 'ok' : ['failed', 'needs-auth'].includes(row.status) ? 'attention' : 'neutral';
    return `<tr><td class="text-cell"><details class="server-details" data-server="${esc(row.name)}"${openDetails.has(row.name) ? ' open' : ''}><summary class="cell-text">${esc(row.displayName || row.name)}</summary><div class="server-info">${details.map(detail => `<p>${esc(detail)}</p>`).join('')}</div></details></td><td><span class="connection-status ${tone}">${statusLabels[row.status] || 'Unavailable'}</span></td><td>${number(row.calls)}</td><td>${number(row.failures)}</td><td>${row.successRate === null ? '—' : `${number(row.successRate, { maximumFractionDigits: 1 })}%`}</td><td>${row.lastUsed ? esc(skillDate.format(new Date(row.lastUsed))) : '—'}</td></tr>`;
  }).join('')}</tbody></table>` : `<p class="muted">${mcp.available ? 'No configured MCP servers or recorded MCP calls match this view.' : 'No recorded MCP calls match these filters. Live inventory is unavailable; open this dashboard in an updated Copilot session.'}</p>`;
  $('mcp-note').textContent = `Status: current session${inventoryPending ? ' (refreshing)' : mcp.available ? '' : ' (unavailable)'}. Calls: selected dates and filters. Success rate excludes unknown outcomes. Expand a server for details.`;
  if (inventoryPending && !mcp.available && !mcp.rows.length) $('mcp').innerHTML = '<p class="muted">Loading current MCP inventory. Usage data is ready.</p>';
  const coverage = [];
  if (mcp.omitted) coverage.push(`${number(mcp.omitted)} MCP calls omitted because their sessions have missing or mixed provider attribution.`);
  if (report.coverage.invalidTools) coverage.push(`${number(report.coverage.invalidTools)} malformed tool events skipped across scanned sources.`);
  $('mcp-coverage').hidden = !coverage.length;
  $('mcp-coverage').textContent = coverage.join(' ');
  const plugins = report.plugins || { available: false, rows: [] };
  const pluginSort = $('plugins-sort').value;
  const pluginRows = [...plugins.rows].sort((a, b) => {
    const order = pluginSort === 'enabled' ? Number(b.installed) - Number(a.installed) || Number(b.enabled === true) - Number(a.enabled === true)
      : pluginSort === 'marketplace' ? pluginMarketplace(a).localeCompare(pluginMarketplace(b)) : 0;
    return order || a.name.localeCompare(b.name);
  });
  $('plugins-summary').textContent = plugins.available ? `${number(plugins.rows.filter(p => p.installed).length)} installed` : 'Inventory unavailable';
  $('plugins').innerHTML = !plugins.available ? '<p class="muted">Plugin inventory is unavailable. Open this dashboard in an updated Copilot session.</p>' : plugins.rows.length ? `<table><thead><tr><th>Plugin</th><th>Installed version</th><th>State</th><th>Marketplace</th><th>Management</th></tr></thead><tbody>${pluginRows.map(p => `<tr>${textCell(p.name)}${textCell(p.version || '—')}${textCell(!p.installed ? 'Not installed' : p.enabled === null ? 'Unknown' : p.enabled ? 'Enabled' : 'Disabled')}${textCell(pluginMarketplace(p))}${textCell(p.managed ? 'Managed' : '—')}</tr>`).join('')}</tbody></table>` : '<p class="muted">No plugins reported by Copilot.</p>';
  if (inventoryPending) {
    $('plugins-summary').textContent = plugins.available ? `${number(plugins.rows.filter(p => p.installed).length)} installed · refreshing` : 'Loading inventory';
    if (!plugins.available) $('plugins').innerHTML = '<p class="muted">Loading current plugin inventory. Usage data is ready.</p>';
  }
  if (focusedServer) {
    const summary = [...$('mcp').querySelectorAll('details[data-server]')].find(node => node.dataset.server === focusedServer)?.querySelector('summary');
    (summary || $('mcp-sort')).focus({ preventScroll: true });
  }
}
function renderBreakdown() {
  return clientDiagnostics.measure('ui.breakdown', {}, renderBreakdownContent);
}
function renderBreakdownContent() {
  const report = state.report;
  if (!report) return;
  const group = $('group').value;
  if (group !== 'models' || state.modelView && !report.models.some(r => r.name === state.modelView.model)) { state.modelView = null; state.requestView = null; }
  if (group !== 'projects' || state.projectView && !report.projects.some(r => r.name === state.projectView.project)) state.projectView = null;
  const focusedRequest = document.activeElement?.dataset;
  $('breakdown').innerHTML = table(sortedUsage(report[group]), { models: 'Model', projects: 'Project' }[group], true, group === 'models' ? 'model' : 'project');
  if (focusedRequest) {
    const buttons = [...$('breakdown').querySelectorAll('button')];
    if (focusedRequest.requestPageDirection || focusedRequest.sessionPageDirection || focusedRequest.modelSessionPageDirection) {
      const key = focusedRequest.modelSessionPageDirection ? 'modelSessionPageDirection' : focusedRequest.sessionPageDirection ? 'sessionPageDirection' : 'requestPageDirection';
      const paging = buttons.filter(b => b.dataset[key] && !b.disabled);
      (paging.find(b => b.dataset[key] === focusedRequest[key]) || paging[0] || buttons.find(b => b.dataset.requestId) || buttons.find(b => b.dataset.projectName === state.projectView?.project && b.dataset.projectName !== undefined) || $('group'))?.focus({ preventScroll: true });
    } else for (const key of ['requestModel', 'requestSession', 'requestId', 'requestPage', 'modelSessionPage', 'projectName', 'projectSession']) {
      if (focusedRequest[key] !== undefined) (buttons.find(b => b.dataset[key] === focusedRequest[key]) || $('group'))?.focus({ preventScroll: true });
    }
  }
  const skills = report.skills;
  const focusedSkill = document.activeElement?.dataset.skillId, focusedAction = document.activeElement?.dataset.skillAction;
  $('skills-summary').textContent = `${number(skills.invocations)} use${skills.invocations === 1 ? '' : 's'} · ${number(skills.failures ?? 0)} failure${skills.failures === 1 ? '' : 's'} · ${number(skills.sessions)} session${skills.sessions === 1 ? '' : 's'}`;
  $('skills').innerHTML = skills.rows.length ? `<table><thead><tr><th>Skill</th><th title="Recorded successful skill loads, including preloaded and unknown triggers. Hover over a count for its breakdown.">Uses</th><th title="Uses explicitly requested by the user.">By user</th><th title="Uses requested by the agent.">By agent</th><th>Sessions</th><th title="Recorded failed attempts to load this skill.">Failures</th><th>Source plugin</th><th>Plugin version</th><th title="Version declared in the current SKILL.md file; may differ from the version used when the skill ran.">Skill version (installed)</th><th title="Most recent recorded use or failed load.">Last used</th></tr></thead><tbody>${sortActivity(skills.rows, $('skills-sort').value).map(s => `<tr><td class="text-cell" title="${esc(s.name)}"><span class="cell-text">${skillName(s)}</span></td><td title="${esc(skillTriggerSummary(s))}">${number(s.invocations)}</td><td>${number(s.triggers?.manual ?? 0)}</td><td>${number(s.triggers?.agent ?? 0)}</td><td>${number(s.sessions)}</td><td>${number(s.failures ?? 0)}</td>${textCell(s.plugin || '\u2014')}${textCell(s.version || '\u2014')}${textCell(s.installedVersion?.value ?? (s.installedVersion?.status === 'not-declared' ? 'Not declared' : 'Unavailable'))}<td title="${esc(new Date(s.lastUsed).toLocaleString())}">${esc(skillDate.format(new Date(s.lastUsed)))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No recorded skill uses or failed loads match these filters. Use a skill in Copilot, then refresh. Older sessions may not have saved skill events.</p>';
  if (focusedSkill) [...$('skills').querySelectorAll('[data-skill-id]')].find(button => button.dataset.skillId === focusedSkill && button.dataset.skillAction === focusedAction)?.focus({ preventScroll: true });
  const coverage = [];
  if (skills.omitted) coverage.push(`${number(skills.omitted)} skill uses omitted because their sessions have missing or mixed provider attribution.`);
  if (skills.omittedFailures) coverage.push(`${number(skills.omittedFailures)} failed skill loads omitted because their sessions have missing or mixed provider attribution.`);
  if (report.coverage.invalidSkills) coverage.push(`${number(report.coverage.invalidSkills)} malformed skill events skipped across scanned sources.`);
  $('skills-coverage').hidden = !coverage.length;
  $('skills-coverage').textContent = coverage.join(' ');
  renderIntegrations(report);
}
const efficiencyMeasures = [
  { key: 'averageInput', label: 'Input / request', count: 'inputRequests', format: value => number(value), hint: 'Input includes cached context.' },
  { key: 'averageOutput', label: 'Output / request', count: 'outputRequests', format: value => number(value), hint: 'Output includes reasoning when reported.' },
  { key: 'averageToolTokens', label: 'Tool definitions / request', count: 'toolRequests', format: value => number(value), hint: 'Part of input, not tool results. Includes only requests with valid paired tool and input counts.' },
  { key: 'cacheHitRate', label: 'Cache reuse', count: 'cacheRequests', format: value => `${number(value, { maximumFractionDigits: 1 })}%`, hint: 'Weighted by measured input tokens.' },
  { key: 'averageCredits', label: 'Credits / request', count: 'creditRequests', format: creditNumber, hint: 'Only complete credit charges are included.' },
];
const efficiencyValue = (row, metric) => row[metric.key] == null ? 'Unavailable' : metric.format(row[metric.key]);
const efficiencyHint = (row, metric) => `${efficiencyValue(row, metric)} · ${number(row[metric.count])} of ${number(row.requests)} requests. ${metric.hint}`;
function renderEfficiencyFlow(s) {
  const total = (s.pairedInput || 0) + (s.pairedOutput || 0);
  const share = total > 0 ? s.pairedInput / total * 100 : null;
  $('efficiency-flow').innerHTML = share === null
    ? '<p class="muted">Input and output counts from the same requests are needed to show where tokens go. Try a wider range if these records are incomplete.</p>'
    : `<div class="efficiency-flow-heading"><strong>${number(share)}<span>%</span></strong><div><h3>of measured tokens were input</h3><p class="muted">The model reads context on every request—not just the words you type.</p></div></div><div class="efficiency-track" role="img" aria-label="Input ${number(share)} percent; output ${number(100 - share)} percent"><span style="width:${share}%;background:var(--s1)"></span><span style="width:${100 - share}%;background:var(--s2)"></span></div><div class="efficiency-flow-labels"><span><i style="background:var(--s1)"></i>Input <b>${number(s.pairedInput)}</b></span><span><i style="background:var(--s2)"></i>Output <b>${number(s.pairedOutput)}</b></span></div><p class="footnote">Both counts recorded for ${number(s.pairedRequests)} of ${number(s.requests)} requests. Cached input is included; these are token volumes, not credit shares.</p>`;
  $('efficiency-cache').innerHTML = s.cacheHitRate == null
    ? `<strong>Cache reuse is not measurable here.</strong><p class="muted">${number(s.cacheRequests ?? 0)} of ${number(s.requests)} requests have a complete cache split. Missing cache detail is not zero reuse.</p>`
    : `<strong>${number(s.cacheHitRate)}% of measured input was reused from cache</strong><p class="muted">${number(s.cacheRead)} of ${number(s.cacheInput)} input tokens, across ${number(s.cacheRequests)} of ${number(s.requests)} requests. Cached context still counts as input, but can reduce processing and credit cost. Reuse is not a measure of answer quality.</p>`;
}

let efficiencyContextSnapshot;
$('efficiency-context-read').onclick = async () => {
  const button = $('efficiency-context-read');
  if (button.disabled) return;
  button.disabled = true;
  $('efficiency-context-result').innerHTML = '<p class="footnote integration-note">Inspecting current context…</p>';
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
  try {
    efficiencyContextSnapshot = await request('efficiency.context', {}, false, controller.signal);
    renderEfficiencyContext();
  } catch (error) {
    efficiencyContextSnapshot = undefined;
    clientDiagnostics.record('warn', 'context.read', diagnosticError(error));
    $('efficiency-context-result').innerHTML = '<p class="footnote integration-note">Context inspection is unavailable. Try again, or use /context in Copilot. Historical sections are still available.</p>';
  } finally { clearTimeout(timer); button.disabled = false; button.textContent = 'Inspect again'; renderEfficiencyHabits(); renderSelectedTokenTopic(); }
};
function renderEfficiencyContext() {
  const c = efficiencyContextSnapshot;
  if (!c?.available) {
    const message = c?.reason === 'empty' ? 'This conversation has no context snapshot yet. Make a request in Copilot, then inspect again.'
      : c?.reason === 'timeout' ? 'Copilot did not return a context snapshot in time. Try again later, or use /context in Copilot.'
        : 'Context attribution is not available in this host session. Try /context in Copilot to inspect it there.';
    $('efficiency-context-result').innerHTML = `<p class="footnote integration-note">${message} Historical sections are still available.</p>`;
    return;
  }
  const categories = { systemPrompt: 'System instructions', customInstructions: 'Custom instructions', systemTools: 'Built-in tool definitions', mcpTools: 'MCP tool definitions', messages: 'Conversation & tool results' };
  const parentLabels = new Map(c.entries.map(entry => [entry.id, entry.label]));
  const modelOrigin = c.modelSource === 'autoResolved' ? 'Auto-resolved model' : c.modelSource === 'selected' ? 'Selected model' : 'Model used for estimate';
  $('efficiency-context-result').innerHTML = `<div class="efficiency-context-total"><strong>${number(c.totalTokens)}</strong> tokens in current context${c.limit > 0 ? ` · ${number(c.totalTokens / c.limit * 100)}% of the ${number(c.limit)} allowance` : ''}</div><p class="footnote">Snapshot at ${esc(new Date(c.checkedAt).toLocaleString())}. ${c.modelId ? esc(modelOrigin + ': ' + c.modelId) + '. ' : ''}This stays fixed until you inspect again. Copilot's estimate may differ from billed tokens.</p><dl class="efficiency-context-categories">${Object.entries(categories).map(([key, label]) => `<div><dt>${label}</dt><dd>${c.categories[key] == null ? 'Unavailable' : number(c.categories[key])}</dd></div>`).join('')}</dl><details><summary>Largest attributed sources${c.omitted ? ` · showing ${number(c.entries.length)} of ${number(c.entries.length + c.omitted)}` : ''}</summary><p class="footnote integration-note">Parent and child sources can overlap. These rows are not added together. A loaded skill may still be useful even without a recent invocation.</p>${c.entries.length ? `<div class="table-wrap"><table class="context-sources"><thead><tr><th>Source</th><th>Type</th><th>Tokens</th><th>Of context</th><th>Included in</th></tr></thead><tbody>${c.entries.map(e => `<tr>${textCell(e.label || 'Unnamed source')}${textCell(e.kind || 'Other')}<td>${number(e.tokens)}</td><td>${c.totalTokens > 0 ? number(e.tokens / c.totalTokens * 100) + '%' : '—'}</td>${textCell(e.parentId ? parentLabels.get(e.parentId) || 'Parent source' : '—')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Copilot did not return individual sources.</p>'}</details>${renderTokenTopic('context', state.report || {}, { number, credits: creditNumber, context: c })}`;
}
let reviewRunning = false, reviewConnectionPending = false, preparedReviewModel = '';
$('efficiency-review-open').onclick = async () => {
  if (!state.report) return;
  $('efficiency-review-output').value = buildEfficiencyReview(state.report, efficiencyContextSnapshot, JSON.parse(state.filterKey || '{}'));
  $('efficiency-review-status').textContent = 'Snapshot ready. Review the data before sending.';
  $('review-send').disabled = true;
  preparedReviewModel = '';
  $('review-send-model').textContent = 'Checking selected model…';
  $('efficiency-review-dialog').showModal();
  try {
    const config = await request('settings.get');
    preparedReviewModel = config.reviewModel || '';
    $('review-send-model').textContent = config.reviewModel ? `Review model: ${config.reviewModel}` : 'Choose and save a Copilot model in Settings first.';
    $('review-send').disabled = !config.reviewModel || reviewRunning || reviewConnectionPending;
  } catch { $('review-send-model').textContent = 'Could not read the review model. Open Settings and try again.'; }
};
async function cancelReview() {
  if (!reviewRunning && !reviewConnectionPending) return;
  try { await request('review.cancel'); }
  catch { $('efficiency-review-status').textContent = 'Could not confirm cancellation. Closing the canvas stops its helper.'; }
}
$('efficiency-review-close').onclick = () => { void cancelReview(); $('efficiency-review-dialog').close(); };
$('efficiency-review-dialog').addEventListener('cancel', () => { void cancelReview(); });
$('review-cancel').onclick = cancelReview;
$('review-connection-cancel').onclick = cancelReview;
$('review-settings').onclick = () => $('settings-open').onclick();
$('review-send').onclick = async () => {
  if (reviewRunning || reviewConnectionPending) return;
  reviewRunning = true;
  $('review-send').disabled = $('efficiency-review-open').disabled = true;
  $('review-cancel').hidden = false;
  $('efficiency-review-status').textContent = 'Analyzing your snapshot with Copilot…';
  const capturedAt = new Date().toLocaleString();
  try {
    const result = await request('review.run', { prompt: $('efficiency-review-output').value, expectedModel: preparedReviewModel });
    $('review-answer').textContent = result.text;
    $('review-result-context').textContent = `${result.model} · Snapshot sent ${capturedAt}. Later filter changes do not change this review. Recorded usage is grouped under Usage Insights and follows your dashboard filters.`;
    $('review-result').hidden = false;
    $('efficiency-review-status').textContent = 'Review complete. Usage is recorded under Usage Insights; your current filters still apply.';
    $('efficiency-review-dialog').close();
    $('review-answer').focus();
  } catch (error) { $('efficiency-review-status').textContent = error.message; }
  finally {
    reviewRunning = false;
    $('review-send').disabled = $('efficiency-review-open').disabled = false;
    $('review-cancel').hidden = true;
    await load(false, true);
  }
};
$('efficiency-review-copy').onclick = async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText($('efficiency-review-output').value);
    $('efficiency-review-status').textContent = 'Copied. Paste into a Copilot conversation when you want a review.';
  } catch {
    $('efficiency-review-output').focus(); $('efficiency-review-output').select();
    $('efficiency-review-status').textContent = 'Clipboard access is unavailable. The report is selected; copy it manually.';
  }
};
function efficiencyDirection(insight) {
  if (insight.kind === 'tools') return {
    title: 'Tools take context before they do any work',
    evidence: `${insight.model} carried ${number(insight.average)} tool-definition tokens per measured request, accounting for ${number(insight.share)}% of input. Measured on ${number(insight.samples)} of ${number(insight.requests)} requests.`,
    action: 'Inspect current context in Where did the tokens go? If a large tool set is unrelated to your next task, disable that integration for the task and compare input on similar requests.',
    caveat: 'Definitions describe available tools. This does not measure tool results, and those tools may be necessary.',
    compare: 'Compare tool-definition tokens per request and verify that the agent still has the tools it needs.',
  };
  if (insight.kind === 'growth') return {
    title: 'Inspect larger input later in a session',
    evidence: `${insight.sessionName}: median input for ${insight.model} rose from ${number(insight.early)} to ${number(insight.late)} tokens (${number(insight.multiple)}×) between the first and last three measured ${insight.initiator === 'user' ? 'user-started' : 'agent-continuation'} requests. ${number(insight.samples)} of ${number(insight.requests)} requests had input counts.`,
    action: 'Review the context attached to those later requests. For a different task or phase, start a fresh conversation with a concise handoff; keep related follow-ups together.',
    caveat: 'Larger input can be necessary as a task develops. Growth alone does not mean wasted tokens.',
    compare: 'On comparable work, compare input per request before and after a phase handoff; check that important context was retained.',
  };
  if (insight.kind === 'cache') return {
    title: 'Check opportunities to reuse context',
    evidence: `${insight.model} reused ${number(insight.rate)}% of ${number(insight.input)} measured input tokens from cache. Cache counts were complete for ${number(insight.samples)} of ${number(insight.requests)} requests.`,
    action: 'Keep related work in one conversation and avoid unnecessary model changes within it. A cold start or expired cache can also explain low reuse.',
    caveat: 'Low reuse does not identify its cause or prove that you are switching chats too often.',
    compare: 'Compare cache reuse within the same model on similar follow-ups. Keep the workflow only if it still fits the task.',
  };
  return {
    title: 'Start a model comparison where credits concentrate',
    evidence: `${insight.model} used ${creditNumber(insight.credits)} credits, or ${number(insight.share)}% of complete recorded charges. ${number(insight.samples)} of ${number(insight.requests)} requests had complete charges.`,
    action: 'On your next routine, well-scoped task, test a lighter model. Compare similar work and check the result before adopting it.',
    caveat: 'Credit concentration may reflect the volume or difficulty of work rather than the model being inefficient.',
    compare: 'Compare credits per completed task and the quality of the result, including any retries you needed.',
  };
}
function renderEfficiencyHabits() {
  const habits = state.report?.efficiency?.interactions;
  const summary = state.report?.efficiency?.summary;
  const metrics = [
    ['User messages', habits?.prompts, 'Recorded user-origin messages'],
    ['Messages / session', habits?.averagePromptsPerSession, `${number(habits?.promptSessions ?? 0)} sessions with messages`],
    ['Characters / prompt', habits?.averagePromptChars, `${number(habits?.promptSamples ?? 0)} messages with text lengths`],
    ['Input tokens / call', summary?.averageInput, `${number(summary?.inputRequests ?? 0)} of ${number(summary?.requests ?? 0)} model calls`],
    ['Agent turns / session', habits?.averageTurnsPerSession, `${number(habits?.turns ?? 0)} turns across ${number(habits?.turnSessions ?? 0)} sessions`],
  ];
  $('efficiency-habits').innerHTML = habits?.reason === 'model-filter'
    ? '<p class="muted">Clear the model filter to see conversation habits. User messages cannot reliably be assigned to one model when a session uses several.</p>'
    : !habits?.observedSessions ? `<p class="muted">${habits?.omitted ? 'No interaction metadata could be attributed exclusively to Copilot.' : 'No matching message or turn metadata was recorded. Usage receipts alone cannot tell us how many times you chatted.'}</p>`
      : `<div class="efficiency-metrics">${metrics.map(([label, value, detail]) => `<div><span class="label">${label}</span><strong class="value">${number(value)}</strong><span class="sub">${detail}</span></div>`).join('')}</div><p class="footnote">Message and turn averages cover sessions with recorded activity within the selected dates, project, and session. These are not lifetime session lengths. Input per call includes all filtered calls with input measurements, including sessions without message metadata. One message can cause several turns and model requests.</p><p class="footnote">Prompt length measures displayed text, excluding attachments and injected content. Characters per prompt and input tokens per call are separate averages, not a matched ratio; characters are not tokens. A short prompt can be precise; a long one can be unclear. Review a few requests for a clear goal, relevant context, constraints, and a way to check the result.</p>`;
  if (!habits?.observedSessions && habits?.reason !== 'model-filter') $('efficiency-habits').innerHTML += `<p class="footnote">Input tokens / call: ${number(summary?.averageInput)}. Measured on ${number(summary?.inputRequests ?? 0)} of ${number(summary?.requests ?? 0)} model calls; prompt measurements are unavailable.</p>`;
  if (habits?.omitted && habits.reason !== 'model-filter') $('efficiency-habits').innerHTML += `<p class="footnote">${number(habits.omitted)} events excluded because Copilot attribution was missing or mixed.</p>`;
  const instructions = efficiencyContextSnapshot?.available ? efficiencyContextSnapshot.categories?.customInstructions : null;
  $('efficiency-instructions').innerHTML = instructions == null
    ? '<strong>Are instructions part of your context?</strong><p>Inspect current context to see whether Copilot reports custom instructions for this conversation.</p>'
    : instructions > 0
      ? `<strong>Custom instructions are present in the inspected context</strong><p>${number(instructions)} estimated tokens. This confirms context presence, not whether the instructions were followed or were present in earlier sessions. Keep durable project guidance concise and task-specific detail available on demand.</p>`
      : '<strong>No custom-instruction tokens in this snapshot</strong><p>This does not prove your repository lacks instructions. Conditional instructions may not apply yet. Check that the agent can find project commands, conventions, and validation steps.</p>';
}
function renderEfficiencyReliability() {
  const report = state.report, rows = toolOutcomeSummary(report.tools), habits = report.efficiency.interactions;
  const failed = (report.tools?.rows || []).filter(row => row.failures > 0).sort((a, b) => b.failures - a.failures).slice(0, 5);
  $('efficiency-reliability').innerHTML = rows.some(row => row.calls)
    ? `<div class="table-wrap"><table class="efficiency-outcomes"><thead><tr><th>Tools</th><th>Calls</th><th>Succeeded</th><th>Failed</th><th>Unknown</th><th>Success rate</th></tr></thead><tbody>${rows.map(row => `<tr>${textCell(row.name)}<td>${number(row.calls)}</td><td>${number(row.successes)}</td><td>${number(row.failures)}</td><td>${number(row.unknown)}</td><td>${row.successRate == null ? 'Unavailable' : number(row.successRate, { maximumFractionDigits: 1 }) + '%'}</td></tr>`).join('')}</tbody></table></div><p class="footnote">Success rate uses only known outcomes. Calls follow the date and usage filters.</p>${failed.length ? `<details><summary>Tools with the most recorded failures</summary><ul>${failed.map(row => `<li>${esc(row.server ? row.server + ' / ' + (row.mcpTool || row.name) : row.name)}: ${number(row.failures)} failures in ${number(row.calls)} calls</li>`).join('')}</ul></details>` : ''}`
    : '<p class="muted">No matching tool execution records. Missing records do not mean no tools were used.</p>';
  $('efficiency-reliability').innerHTML += habits?.reason === 'model-filter'
    ? '<p class="footnote">Session error counts are unavailable under a model filter.</p>'
    : habits?.observedSessions ? `<p class="footnote">${number(habits.sessionErrors)} recorded root-session error events. These are incidents, not a count of failed model requests.</p>` : '';
}
function showEfficiencySection(section) {
  if (!['tokens', 'patterns', 'review'].includes(section)) return;
  selectButton('efficiency-sections', 'efficiencySection', section);
  $('efficiency-method').hidden = section === 'review';
  for (const name of ['tokens', 'patterns', 'review']) $(`efficiency-${name}-panel`).hidden = name !== section;
}
$('efficiency-sections').onclick = event => showEfficiencySection(event.target.dataset.efficiencySection);
let tokenTopic = 'overview';
const tokenPanelNames = ['overview', 'context', 'cache', 'detail'];
const topicOption = topic => `<option value="${topic.id}">${esc(topic.label)}</option>`;
$('efficiency-topic').max = String(TOKEN_TOPICS.length - 1);
$('token-track-inner').style.setProperty('--token-topic-count', TOKEN_TOPICS.length);
$('token-track-nodes').innerHTML = TOKEN_TOPICS.map(topic => `<span data-token-node="${topic.id}"></span>`).join('');
$('token-topic-stops').innerHTML = TOKEN_TOPICS.map(topic => `<button data-token-stop="${topic.id}" title="${esc(topic.label)}" aria-label="${esc(topic.label)}" aria-controls="token-topic-content">${tokenTopicIcon(topic)}</button>`).join('');
function syncTokenNavigation() {
  const index = TOKEN_TOPICS.findIndex(topic => topic.id === tokenTopic), topic = TOKEN_TOPICS[index];
  $('efficiency-topic').value = String(index);
  $('efficiency-topic').title = topic.label;
  $('efficiency-topic').style.setProperty('--lens-icon', `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(topic, true))}")`);
  $('efficiency-topic').setAttribute('aria-valuetext', `${topic.label}, section ${index + 1} of ${TOKEN_TOPICS.length}`);
  for (const button of $('token-topic-stops').querySelectorAll('[data-token-stop]')) button.setAttribute('aria-current', String(button.dataset.tokenStop === tokenTopic));
  for (const node of $('token-track-nodes').querySelectorAll('[data-token-node]')) node.classList.toggle('current', node.dataset.tokenNode === tokenTopic);
  $('token-topic-position').textContent = `${topic.group || 'Summary'} · ${index + 1} of ${TOKEN_TOPICS.length}`;
  $('token-selected-title').textContent = topic.label;
  $('token-topic-prev').disabled = index === 0;
  $('token-topic-next').disabled = index === TOKEN_TOPICS.length - 1;
}
function showTokenTopic(id, announce = false) {
  if (!TOKEN_TOPICS.some(topic => topic.id === id)) return;
  if (tokenTopic !== id) {
    tokenTopic = id;
    syncTokenNavigation();
    renderSelectedTokenTopic();
    if (announce) $('token-topic-announcement').textContent = `Showing ${TOKEN_TOPICS.find(topic => topic.id === id).label}`;
  }
}
function renderSelectedTokenTopic() {
  const contextFocused = document.activeElement?.dataset.tokenContext === 'true';
  const panel = tokenPanelNames.includes(tokenTopic) ? tokenTopic : 'detail';
  for (const name of tokenPanelNames) $(`token-${name}-panel`).hidden = name !== panel;
  if (panel !== 'detail') {
    if (panel === 'overview') $('token-overview-insight').innerHTML = renderTokenTopic('overview', state.report || {}, { number, credits: creditNumber });
    if (panel === 'cache') $('token-cache-detail').innerHTML = renderTokenTopic('cache', state.report || {}, { number, credits: creditNumber });
    if (contextFocused) $('efficiency-topic').focus({ preventScroll: true });
    return;
  }
  const topic = TOKEN_TOPICS.find(item => item.id === tokenTopic);
  $('token-topic-title').textContent = topic.label;
  $('token-topic-question').textContent = topic.question;
  $('token-topic-scope').textContent = ['tools', 'results', 'skills'].includes(tokenTopic) ? 'Selected history + current conversation snapshot' : 'Selected history · current filters';
  $('token-topic-body').innerHTML = renderTokenTopic(tokenTopic, state.report || {}, { number, credits: creditNumber, context: efficiencyContextSnapshot });
  if (contextFocused) ($('token-topic-body').querySelector('[data-token-context]') || $('efficiency-topic')).focus({ preventScroll: true });
}
$('efficiency-topic').oninput = () => showTokenTopic(TOKEN_TOPICS[Number($('efficiency-topic').value)]?.id);
$('efficiency-topic').onkeydown = event => {
  const index = TOKEN_TOPICS.findIndex(topic => topic.id === tokenTopic);
  const keys = { ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1, Home: 0, End: TOKEN_TOPICS.length - 1 };
  if (!(event.key in keys)) return;
  event.preventDefault();
  showTokenTopic(TOKEN_TOPICS[Math.max(0, Math.min(TOKEN_TOPICS.length - 1, keys[event.key]))].id);
};
$('token-topic-stops').onclick = event => showTokenTopic(event.target.closest('[data-token-stop]')?.dataset.tokenStop, true);
for (const [id, step] of [['token-topic-prev', -1], ['token-topic-next', 1]]) $(id).onclick = () => {
  const focused = document.activeElement === $(id);
  const index = TOKEN_TOPICS.findIndex(topic => topic.id === tokenTopic);
  showTokenTopic(TOKEN_TOPICS[index + step]?.id, true);
  if ($(id).disabled && focused) $('efficiency-topic').focus({ preventScroll: true });
};
syncTokenNavigation();
let patternTopic = 'findings';
const patternPanelNames = ['findings', 'habits', 'recovery', 'models', 'detail'];
$('efficiency-pattern-topic').innerHTML = PATTERN_TOPICS.map(topicOption).join('');
$('efficiency-pattern-topic').value = patternTopic;
function showPatternTopic(id) {
  if (PATTERN_TOPICS.some(topic => topic.id === id)) patternTopic = id;
  $('efficiency-pattern-topic').value = patternTopic;
  const panel = patternPanelNames.includes(patternTopic) ? patternTopic : 'detail';
  for (const name of patternPanelNames) $(`pattern-${name}-panel`).hidden = name !== panel;
  if (panel !== 'detail') return;
  const topic = PATTERN_TOPICS.find(item => item.id === patternTopic);
  $('pattern-topic-title').textContent = topic.label;
  $('pattern-topic-question').textContent = topic.question;
  $('pattern-topic-scope').textContent = patternTopic === 'growth' ? 'Selected history · current filters' : 'Measurement not available yet';
  $('pattern-topic-body').innerHTML = renderTokenTopic(patternTopic, state.report || {}, { number, credits: creditNumber });
}
$('efficiency-pattern-topic').onchange = () => showPatternTopic($('efficiency-pattern-topic').value);
function openTokenContext() {
  showEfficiencySection('tokens');
  showTokenTopic('context');
  $('efficiency-context-read').focus({ preventScroll: false });
}
$('token-detail-panel').onclick = event => { if (event.target.closest('[data-token-context]')) openTokenContext(); };
$('efficiency-inspect-instructions').onclick = openTokenContext;
$('token-overview-panel').onclick = event => {
  const topic = event.target.closest('[data-token-jump]')?.dataset.tokenJump;
  if (!topic) return;
  showTokenTopic(topic, true);
  $('efficiency-topic').focus({ preventScroll: true });
};
function renderEfficiency() {
  const efficiency = state.report?.efficiency;
  if (!efficiency) return;
  const { summary, models, insights } = efficiency;
  for (const [id, value] of [['efficiency-cache-minimum', 50000], ['efficiency-growth-minimum', 10000], ['efficiency-tools-minimum', 1000]]) $(id).textContent = number(value);
  const failedServer = (state.report.mcp?.rows || []).filter(s => s.failures >= 3).sort((a, b) => b.failures - a.failures)[0];
  const focused = document.activeElement?.dataset;
  renderEfficiencyFlow(summary);
  renderEfficiencyHabits();
  renderEfficiencyReliability();
  renderSelectedTokenTopic();
  showPatternTopic(patternTopic);
  $('efficiency-summary').innerHTML = efficiencyMeasures.filter(metric => metric.key !== 'cacheHitRate').map(metric => `<div><span class="label">${metric.label}</span><strong class="value" title="${esc(efficiencyHint(summary, metric))}">${esc(efficiencyValue(summary, metric))}</strong><span class="sub">${number(summary[metric.count] ?? 0)} of ${number(summary.requests)} requests</span></div>`).join('');
  $('efficiency-insights').innerHTML = insights.length ? insights.map((insight, index) => {
    const copy = efficiencyDirection(insight);
    return `<section class="efficiency-insight"><div class="efficiency-observation"><span class="efficiency-kicker">PATTERN ${index + 1}</span><h3>${copy.title}</h3><p>${esc(copy.evidence)}</p><p class="footnote">${copy.caveat}</p><button data-efficiency-insight="${index}" data-efficiency-kind="${insight.kind}" data-efficiency-model="${esc(insight.model)}">Inspect usage<span class="sr-only">: ${esc(copy.title)} for ${esc(insight.model)}</span></button></div><div class="efficiency-experiment"><span class="efficiency-kicker">TRY THIS</span><p>${copy.action}</p><details><summary>What to compare afterward</summary><p>${copy.compare}</p></details></div></section>`;
  }).join('') : failedServer ? '' : `<p class="muted">${summary.requests < 5 ? 'More recorded requests are needed to identify patterns. Try a wider date range or use Copilot, then refresh.' : 'No standout patterns meet the review rules in this range. Open Model comparisons or try a wider date range.'}</p>`;
  if (failedServer) {
    const completed = failedServer.failures + failedServer.successes;
    $('efficiency-insights').innerHTML += `<section class="efficiency-insight"><div class="efficiency-observation"><span class="efficiency-kicker">MCP RELIABILITY</span><h3>Repeated tool failures deserve a look</h3><p>${esc(failedServer.name)}: ${number(failedServer.failures)} of ${number(completed)} calls with a known outcome failed (${number(failedServer.failures / completed * 100)}%). ${number(failedServer.unknown)} outcomes are unknown.</p><p class="footnote">These are failed tool calls, not a measurement of server uptime or proof of a connection problem.</p><button data-efficiency-mcp="true">Inspect MCP activity</button></div><div class="efficiency-experiment"><span class="efficiency-kicker">TRY THIS</span><p>Check the server's current status and reproduce one failed operation. Verify authentication, permissions, and arguments before retrying a larger task.</p><details><summary>What to compare afterward</summary><p>Compare failures and known outcomes on the same operation after the change. A successful connection alone does not guarantee successful tools.</p></details></div></section>`;
  }
  $('efficiency-insight-count').textContent = `${insights.length + (failedServer ? 1 : 0)} patterns to review`;
  const reused = models.filter(row => row.cacheRequests >= 5 && row.cacheRequests / row.requests >= .8 && row.cacheInput >= 50000 && row.cacheHitRate >= 80).slice(0, 3);
  if (reused.length) $('efficiency-insights').innerHTML += `<div class="efficiency-positive"><span class="efficiency-kicker">WORKING IN YOUR FAVOR</span>${reused.map(row => `<p><strong>${esc(row.name)} is reusing context.</strong> ${number(row.cacheHitRate)}% of measured input came from cache, across ${number(row.cacheRequests)} of ${number(row.requests)} requests. Keep stable context for related follow-ups when that workflow suits the task.</p>`).join('')}<p class="footnote">Cache reuse reduces repeated input processing. It does not by itself establish task quality or monetary savings.</p></div>`;
  $('efficiency-models').innerHTML = models.length ? `<table><thead><tr><th>Model</th><th>Requests</th>${efficiencyMeasures.map(metric => `<th title="${esc(metric.hint)}">${metric.label}</th>`).join('')}</tr></thead><tbody>${models.map(row => `<tr><td class="text-cell"><button class="model-toggle cell-text" data-efficiency-model="${esc(row.name)}" title="Inspect usage for ${esc(row.name)}">${esc(row.name)}</button></td><td>${number(row.requests)}</td>${efficiencyMeasures.map(metric => `<td title="${esc(efficiencyHint(row, metric))}">${esc(efficiencyValue(row, metric))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p class="muted">No matching model requests. Change the filters to include recorded Copilot usage.</p>';
  if (focused?.efficiencyModel !== undefined) {
    const button = [...$('efficiency-view').querySelectorAll('[data-efficiency-model]')].find(b => b.dataset.efficiencyModel === focused.efficiencyModel && b.dataset.efficiencyKind === focused.efficiencyKind);
    (button || $('view').querySelector('[data-view="efficiency"]'))?.focus({ preventScroll: true });
  } else if (focused?.tokenJump) {
    const button = [...$('token-overview-insight').querySelectorAll('[data-token-jump]')].find(b => b.dataset.tokenJump === focused.tokenJump);
    (button || $('efficiency-topic')).focus({ preventScroll: true });
  }
}
async function inspectEfficiency(target) {
  if (!target) return;
  $('model').value = target.model;
  if (target.project !== undefined) $('project').value = target.project;
  if (target.session !== undefined) $('session').value = target.session;
  $('group').value = 'models';
  state.requestView = null; state.projectView = null;
  showView('breakdown');
  $('group').focus({ preventScroll: true });
  if (JSON.stringify(query()) !== state.filterKey) await load();
}
$('efficiency-insights').onclick = event => {
  if (event.target.closest('[data-efficiency-mcp]')?.dataset.efficiencyMcp) {
    showView('breakdown');
    $('breakdown-sections').onclick({ target: { dataset: { section: 'mcp' } } });
    $('mcp-sort').focus({ preventScroll: true });
    return;
  }
  const index = event.target.closest('[data-efficiency-insight]')?.dataset.efficiencyInsight;
  if (index !== undefined) return inspectEfficiency(state.report?.efficiency?.insights[Number(index)]);
};
$('efficiency-models').onclick = event => {
  const model = event.target.closest('[data-efficiency-model]')?.dataset.efficiencyModel;
  if (model !== undefined) return inspectEfficiency({ model });
};

function render() {
  return clientDiagnostics.measure('ui.render', {}, renderContent);
}
function renderBanner(r) {
  const banner = $('banner');
  state.buildingPatterns = nextBuildingPatterns(state.buildingPatterns, state.bannerRange, r.query.range);
  state.bannerRange = r.query.range;
  banner.innerHTML = pixelBanner(r, { patterns: state.buildingPatterns, h: Math.max(34, Math.ceil(120 * banner.clientHeight / Math.max(1, banner.clientWidth))) });
}
function renderUpdated(r) {
  $('updated').textContent = `Updated ${new Date(r.scannedAt || r.generatedAt).toLocaleTimeString()}. Refreshes every 60 seconds while visible.`;
}
// The data is the same as before; only what follows the clock is redrawn.
function renderClock(previousSky) {
  const r = state.report;
  renderUpdated(r);
  if (skyFor(new Date(r.generatedAt).getHours()) !== previousSky) renderBanner(r);
}
function visibleChoices(rows, selected, limit, sort) {
  const visible = sortActivity(rows, sort).slice(0, limit);
  if (selected && !visible.some(r => r.name === selected)) visible.push(rows.find(r => r.name === selected) || { name: selected, requests: 0, total: 0, userPrompts: null, uncertainPrompts: 0 });
  return visible;
}
function renderContent() {
  const r = state.report;
  if (!r) return;
  if (state.metricEmphasis) $('content').dataset.metric = state.metric;
  else delete $('content').dataset.metric;
  $('tiles').hidden = state.view === 'efficiency';
  const t = r.totals, credits = state.metric === 'credits', textScale = TEXT_SCALES[state.textSize];
  renderHeaderCredits();
  const focusedDay = $('daily').contains(document.activeElement) ? document.activeElement.dataset.day : null;
  const focusedChoice = document.activeElement?.dataset;
  const selected = r.daily.find(d => d.day === state.selectedDay);
  if (!selected) state.selectedDay = null;
  const scope = selected || t;
  const scopeDate = selected ? new Date(selected.day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const keys = r.query.includeCache ? [...TOKEN_KEYS, 'unclassifiedInput'] : ['input', 'output'];
  options('model', r.options.models, 'All models'); options('project', r.options.projects, 'All projects'); options('session', r.options.sessions, 'All sessions');
  renderLoadStatus();
  const filterPosition = state.view === 'efficiency' && !$('content').hidden ? $('efficiency-tokens-panel') : $('status');
  if ($('filters').nextElementSibling !== filterPosition) filterPosition.before($('filters'));
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
  const coverageMessage = warnings.join('. ') + (warnings.length ? '. Totals include known amounts only; * marks incomplete coverage.' : '');
  $('coverage-message').textContent = coverageMessage;
  $('coverage').hidden = !warnings.length || coverageMessage === dismissedCoverage;
  const rateValue = (value, samples, total = t.requests) => creditNumber(value) + (value != null && samples < total ? ' *' : '');
  const creditSamples = count => `${number(count)} of ${number(t.requests)} requests`;
  const cacheContext = r.query.includeCache ? 'including cache' : 'excluding cache';
  const p = r.promptCredits;
  const promptCoverage = `${number(p.eligiblePrompts)} of ${number(p.prompts)} prompts`;
  $('prompt-coverage-note').hidden = p.eligiblePrompts === p.prompts && !p.unlinkedRequests;
  $('prompt-coverage-note').textContent = `* AI credits / prompt: ${promptCoverage} have complete, attributable costs. Excluded: ${number(p.excluded.attribution)} uncertain attribution, ${number(p.excluded.accounting)} incomplete charges, ${number(p.excluded.unfinished)} unfinished work. ${number(p.unlinkedRequests)} model calls could not be linked to prompts. Local logs cannot establish work they never recorded.`;
  const promptHint = `Complete recorded AI credits for initial calls, agent continuations and reliably linked subagents, divided by eligible user prompts. ${promptCoverage} eligible. Prompts are dated by submission; all linked work is grouped before filters. ${p.modelFiltered ? 'Selected-model contribution only, per eligible prompt using the selected models; whole-prompt accounting must still be complete. ' : ''}Excluded: ${number(p.excluded.attribution)} uncertain attribution, ${number(p.excluded.accounting)} incomplete charges, ${number(p.excluded.unfinished)} unfinished work. ${number(p.unlinkedRequests)} requests could not be linked to prompts. Unlinked calls make prompt attribution uncertain for their journal session. Local logs cannot establish work they never recorded.`;
  const tiles = [
    ['AI credits', creditLabel(t), 'Recorded Copilot charges', 'credits'],
    ['Tokens', usageValue(t, 'total', number), RANGE_LABELS[r.query.range], 'tokens'],
    ['AI credits / prompt', creditNumber(p.averageCredits), `${number(p.eligiblePrompts)} prompts${p.modelFiltered ? ' · selected-model contribution' : ''}`, 'credits', promptHint],
    ['AI credit / 1M tokens', rateValue(t.creditsPerMillionTokens, t.creditTokenRequests), 'input + output + cache', 'credits',
      `Recorded credits divided by input + output tokens, ${cacheContext}, multiplied by 1,000,000. Only requests with complete charges and token counts are included (${creditSamples(t.creditTokenRequests)}). Unavailable when there are no eligible tokens.`],
  ];
  $('tiles').innerHTML = tiles.map(([label, value, sub, measure, title]) => `<div class="tile"><span class="label">${esc(label)}</span><strong class="value"${measure ? ` data-measure="${measure}"` : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(value)}</strong><span class="sub">${esc(sub)}</span></div>`).join('');
  $('token-title').textContent = (selected ? `Tokens on ${scopeDate}` : 'Total tokens') + (r.query.includeCache ? '' : ' excluding cache');
  $('token-total').textContent = usageValue(scope, 'total', number);
  $('token-total').title = usageValue(scope, 'total', number);
  $('token-context').textContent = `${number(scope.sessions)} sessions · ${number(scope.requests)} requests through GitHub Copilot`;
  $('token-types-title').textContent = `Tokens by type · ${scopeDate || 'all days'}`;
  $('all-days').hidden = !selected;
  const stats = [['Input (including cache)', 'inputTotal'], ['Output', 'output'], ['Uncached input', 'input'], ['Cache read', 'cacheRead'], ['Cache write', 'cacheWrite']];
  const cacheRate = scope.missingCache ? 'Unavailable' : scope.inputTotal ? `${number(scope.cacheRead / scope.inputTotal * 100)}%` : '—';
  $('token-stats').innerHTML = stats.map(([label, key]) => `<div><dt>${label}</dt><dd title="${esc(usageValue(scope, key, number))}">${esc(usageValue(scope, key, number))}</dd></div>`).join('') + `<div><dt>Cache hit rate</dt><dd>${cacheRate}</dd></div>`;
  $('token-note').textContent = 'Input includes cache reads and writes. Cache hit rate is the share of input read from cache. Percentages show shares of recorded tokens.' + (r.query.includeCache ? '' : ' Cache is excluded from totals and charts; the individual counts above remain visible.');
  renderBanner(r);
  $('daily-title').textContent = credits ? 'Daily AI credits' : 'Daily tokens';
  $('daily-caption').textContent = `${r.daily[0]?.day || ''} — ${r.daily.at(-1)?.day || ''} · local time`;
  const width = Math.max(280, $('daily').clientWidth);
  const unavailable = t.requests && (credits ? t.credits === null : t.knownTokenRequests === 0);
  $('daily').innerHTML = unavailable ? `<p class="muted">${credits ? 'Credit charges' : 'Token counts'} are unavailable for these requests.</p>` : stackedBars(r.daily, { width, height: 230, keys: credits ? ['credits'] : keys, colors, labels, fmt: credits ? creditNumber : number, selectable: true, selectedDay: state.selectedDay, textScale });
  const legendKeys = credits ? ['credits'] : keys.filter(k => t[k] > 0);
  $('legend').innerHTML = legendKeys.map(k => `<span><i style="background:${colors[k]}"></i>${labels[k]}</span>`).join('');
  $('calendar').innerHTML = calendarHeatmap(r.calendar);
  $('rhythm').innerHTML = punchCard(r.rhythm);
  const typeKeys = r.query.includeCache ? ['input', 'cacheRead', 'cacheWrite', 'unclassifiedInput', 'output'] : ['input', 'output'];
  const segments = typeKeys.filter(k => scope[k] > 0).map(k => ({ label: labels[k], value: scope[k], color: colors[k] }));
  $('token-bar').innerHTML = segmentBar(segments, { width: Math.max(280, $('token-bar').clientWidth), textScale });
  $('token-legend').innerHTML = typeKeys.filter(k => k !== 'unclassifiedInput' || scope[k] > 0).map(k => `<span title="${esc(usageValue(scope, k, number))}"><i style="background:${colors[k]}"></i>${labels[k]} <b>${esc(usageValue(scope, k, number))}</b></span>`).join('');
  // Model bars always show tokens; the credit selector controls the daily chart.
  $('models-summary').innerHTML = hBars(visibleChoices(r.usageChoices.models, $('model').value, 8, $('models-sort').value).map(m => ({ label: m.name, value: m.total, note: usageValue(m, 'total', number) })), { width: Math.max(280, $('models-summary').clientWidth), textScale, selectable: true, selectedLabel: $('model').value });
  $('projects-summary').innerHTML = table(visibleChoices(r.usageChoices.projects, $('project').value, 10, $('projects-sort').value), 'Project', false, 'projectFilter');
  $('models-selection').textContent = $('model').value ? 'Model filter on · bars show tokens' : 'Top 8 · bars show tokens';
  $('projects-selection').textContent = $('project').value ? 'Project filter on · select again to clear' : 'Top 10 · select to filter';
  $('sources').innerHTML = r.sources.map(s => `<div class="source ${esc(s.state)}"><code>${esc(s.path)}</code><p>${esc(s.state)} · ${number(s.records ?? 0)} requests · ${number(s.files ?? 0)} session logs${s.message ? ` · ${esc(s.message)}` : ''}</p></div>`).join('');
  renderUpdated(r);
  renderBreakdown();
  renderEfficiency();
  if (focusedDay) $('daily').querySelector(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true });
  for (const type of ['model', 'project']) {
    const key = type === 'model' ? 'usageModel' : 'usageProject';
    if (focusedChoice?.[key] !== undefined) [...$(`${type}s-summary`).querySelectorAll(`[data-usage-${type}]`)].find(el => el.dataset[key] === focusedChoice[key])?.focus({ preventScroll: true });
  }
}
function selectUsageFilter(type, value) {
  if (value === undefined) return;
  $(type).value = $(type).value === value ? '' : value;
  $('tip').hidden = true;
  return load();
}
$('models-summary').onclick = e => selectUsageFilter('model', e.target.closest('[data-usage-model]')?.dataset.usageModel);
$('models-summary').onkeydown = e => {
  const model = e.target.closest('[data-usage-model]')?.dataset.usageModel;
  if (model !== undefined && ['Enter', ' '].includes(e.key)) { e.preventDefault(); return selectUsageFilter('model', model); }
};
$('projects-summary').onclick = e => selectUsageFilter('project', e.target.closest('[data-usage-project]')?.dataset.usageProject);
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
function showView(view) {
  if (!['usage', 'breakdown', 'efficiency'].includes(view)) return;
  state.view = view;
  selectButton('view', 'view', view);
  for (const name of ['usage', 'breakdown', 'efficiency']) $(`${name}-view`).hidden = name !== view;
  render();
}
$('view').onclick = e => showView(e.target.dataset.view);
$('breakdown-sections').onclick = e => {
  const section = e.target.dataset.section;
  if (!['skills', 'plugins', 'mcp'].includes(section)) return;
  selectButton('breakdown-sections', 'section', section);
  for (const name of ['skills', 'plugins', 'mcp']) $(`${name}-panel`).hidden = name !== section;
};
$('metric').onclick = e => {
  const metric = e.target.dataset.metric;
  if (!['tokens', 'credits'].includes(metric)) return;
  state.metricEmphasis = metric !== state.metric || !state.metricEmphasis;
  state.metric = metric;
  selectButton('metric', 'metric', state.metricEmphasis ? metric : null);
  render();
};
$('refresh').onclick = $('footer-refresh').onclick = () => load(true);
$('breakdown').onclick = async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const { requestModel, requestSession, modelSessionPage, requestPage, requestId, requestRetry, projectName, sessionPage, projectSession, sessionModelRetry } = button.dataset;
  if (projectName !== undefined && $('group').value === 'projects') {
    state.projectView = state.projectView?.project === projectName ? null : { project: projectName, offset: 0 };
    renderBreakdown();
  } else if (sessionPage !== undefined && state.projectView) {
    state.projectView.models = null;
    state.projectView.offset = Math.max(0, Number(sessionPage) || 0);
    renderBreakdown();
    const total = state.report.projects.find(r => r.name === state.projectView.project).sessions;
    $('live').textContent = `Showing sessions ${state.projectView.offset + 1}–${Math.min(state.projectView.offset + 25, total)}`;
  } else if (projectSession !== undefined && state.projectView) {
    const view = state.projectView;
    if (!sortedUsage(state.report.sessions.filter(r => r.project === view.project)).slice(view.offset, view.offset + 25).some(r => r.id === projectSession)) return;
    if (view.models?.session === projectSession && !sessionModelRetry) { view.models = null; renderBreakdown(); return; }
    view.models = { session: projectSession, version: 0 };
    await loadSessionModels();
  } else if (requestModel !== undefined) {
    state.requestView = null;
    if (state.modelView?.model === requestModel) { state.modelView = null; renderBreakdown(); return; }
    state.modelView = { model: requestModel, offset: 0, version: 0 };
    await loadModelSessionPage();
  } else if (state.modelView && modelSessionPage !== undefined) {
    if (state.modelView.pending) return;
    state.requestView = null;
    await loadModelSessionPage(Number(modelSessionPage));
  } else if (state.modelView && requestSession !== undefined) {
    if (state.modelView.pending || !state.modelView.page?.rows.some(r => r.id === requestSession)) return;
    if (state.requestView?.session === requestSession) { state.requestView = null; renderBreakdown(); return; }
    state.requestView = { model: state.modelView.model, session: requestSession, offset: 0, version: 0, detailVersion: 0, details: new Map() };
    await loadRequestPage();
  } else if (state.requestView && requestPage !== undefined) {
    if (state.requestView.pending) return;
    state.requestView.selectedId = null; state.requestView.detail = null;
    await loadRequestPage(Number(requestPage));
  } else if (state.requestView && requestId !== undefined) {
    if (state.requestView.selectedId === requestId && !requestRetry) { state.requestView.selectedId = null; state.requestView.detail = null; renderBreakdown(); return; }
    await loadRequestDetail(requestId);
  }
};
$('range').onchange = () => { $('custom').hidden = $('range').value !== 'custom'; if ($('range').value !== 'custom') { state.range = $('range').value; load(); } };
$('apply-dates').onclick = () => { state.range = 'custom'; state.startDate = $('start-date').value; state.endDate = $('end-date').value; load(); };
for (const id of ['model', 'project', 'session', 'cache']) $(id).onchange = () => load();
for (const id of ['group', 'sort']) $(id).onchange = () => {
  if (state.projectView) state.projectView.offset = 0;
  renderBreakdown();
  if (id === 'sort' && state.modelView) { state.requestView = null; return loadModelSessionPage(0); }
};
for (const id of ['skills-sort', 'plugins-sort', 'mcp-sort']) $(id).onchange = renderBreakdown;
for (const id of ['models-sort', 'projects-sort']) $(id).onchange = render;
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
  catch (error) { clientDiagnostics.record('error', 'ui.skillAction', { action: copy ? 'copy' : 'open', ...diagnosticError(error) }); status.hidden = false; status.textContent = `Could not ${copy ? 'copy folder path' : 'open skill folder'}: ${error.message}`; }
  finally { state.skillActionPending = false; button.removeAttribute('aria-busy'); }
};
$('clear-filters').onclick = () => { for (const id of ['model', 'project', 'session']) $(id).value = ''; $('cache').checked = true; load(); };
let settingsSources;
function reviewModelOptions(models, selected) {
  $('review-model').innerHTML = '<option value="">Choose a model</option>' +
    (selected && !models.some(m => m.id === selected) ? `<option value="${esc(selected)}">${esc(selected)} (saved; unavailable until verified)</option>` : '') +
    models.map(model => `<option value="${esc(model.id)}">${esc(model.label)}</option>`).join('');
  $('review-model').value = selected || '';
}
async function refreshReviewConnection(reconnect) {
  if (reviewConnectionPending || reviewRunning) return;
  reviewConnectionPending = true;
  $('review-models-refresh').disabled = $('review-reconnect').disabled = true;
  $('review-connection-cancel').hidden = false;
  $('review-connection-status').textContent = reconnect ? 'Verifying a fresh Copilot connection…' : 'Loading models from Copilot…';
  try {
    const result = await request(reconnect ? 'review.reconnect' : 'review.catalog');
    reviewModelOptions(result.models, $('review-model').value);
    $('review-connection-status').textContent = reconnect ? 'Connection verified with the same GitHub account. No prompt was sent. Choose a model and save settings.' : 'Models refreshed. Choose a model and save settings. The helper account is verified again before each review.';
  } catch (error) { $('review-connection-status').textContent = error.message; }
  finally {
    reviewConnectionPending = false;
    $('review-models-refresh').disabled = $('review-reconnect').disabled = false;
    $('review-connection-cancel').hidden = true;
  }
}
$('review-models-refresh').onclick = () => refreshReviewConnection(false);
$('review-reconnect').onclick = () => refreshReviewConnection(true);
$('settings-open').onclick = $('footer-settings').onclick = async () => {
  $('settings-error').hidden = true;
  $('settings-save').disabled = true;
  $('settings-dialog').showModal();
  try {
    const config = await request('settings.get');
    $('text-size').value = config.textSize ?? 'small';
    $('simplify-numbers').checked = config.simplifyNumbers !== false;
    reviewModelOptions([], config.reviewModel);
    settingsSources = JSON.stringify([config.extraHomes, config.disabledHomes]);
    $('default-home').textContent = config.defaultHome;
    $('extra-homes').value = config.extraHomes.join('\n'); $('disabled-homes').value = config.disabledHomes.join('\n');
    $('settings-save').disabled = false;
  } catch (e) { $('settings-error').textContent = e.message; $('settings-error').hidden = false; }
};
$('settings-close').onclick = () => { if (reviewConnectionPending) void cancelReview(); $('settings-dialog').close(); };
$('settings-dialog').addEventListener('cancel', () => { if (reviewConnectionPending) void cancelReview(); });
$('settings-save').onclick = async () => {
  $('settings-save').disabled = true;
  const lines = id => $(id).value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  try {
    const config = await request('settings.set', { textSize: $('text-size').value, simplifyNumbers: $('simplify-numbers').checked, extraHomes: lines('extra-homes'), disabledHomes: lines('disabled-homes'), reviewModel: $('review-model').value });
    applyPreferences(config); render();
    $('settings-dialog').close();
    await load(settingsSources !== JSON.stringify([config.extraHomes, config.disabledHomes]));
  } catch (e) { $('settings-error').textContent = e.message; $('settings-error').hidden = false; }
  finally { $('settings-save').disabled = false; }
};
try { document.documentElement.classList.toggle('light', (localStorage.getItem('usage-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'light'); } catch {}
$('theme').onclick = () => { const light = document.documentElement.classList.toggle('light'); try { localStorage.setItem('usage-theme', light ? 'light' : 'dark'); } catch {} };
function showTooltip(mark, x, y) {
  const tip = JSON.parse(mark.dataset.tip), popup = $('tip');
  popup.innerHTML = `<strong>${esc(tip.title || '')}</strong>` + (tip.rows || []).map(([label, value]) => `<p><span>${esc(label)}</span><span>${esc(typeof value === 'number' ? number(value) : value)}</span></p>`).join('') + (tip.total === undefined ? '' : `<p><b>Total</b><b>${esc(typeof tip.total === 'number' ? number(tip.total) : tip.total)}</b></p>`);
  popup.hidden = false;
  const width = popup.offsetWidth, height = popup.offsetHeight, gap = 12, margin = 8;
  const viewportWidth = document.documentElement.clientWidth || innerWidth;
  const viewportHeight = document.documentElement.clientHeight || innerHeight;
  const left = x + gap + width <= viewportWidth - margin ? x + gap : x - gap - width;
  const top = y + gap + height <= viewportHeight - margin ? y + gap : y - gap - height;
  popup.style.left = `${Math.max(margin, Math.min(left, viewportWidth - width - margin))}px`;
  popup.style.top = `${Math.max(margin, Math.min(top, viewportHeight - height - margin))}px`;
}
document.addEventListener('pointermove', e => {
  const mark = e.target.closest('.mark[data-tip]');
  if (!mark) { $('tip').hidden = true; return; }
  showTooltip(mark, e.clientX, e.clientY);
});
$('daily').addEventListener('focusin', e => {
  const mark = e.target.closest('[data-day]');
  if (!mark?.matches(':focus-visible')) return;
  const bounds = mark.getBoundingClientRect();
  showTooltip(mark, bounds.x + bounds.width / 2, bounds.y);
});
$('daily').addEventListener('focusout', () => { $('tip').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('tip').hidden = true; });
document.addEventListener('pointerleave', () => { $('tip').hidden = true; });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
document.addEventListener('visibilitychange', () => { clientDiagnostics.record('info', 'ui.visibility', connectionState()); if (!document.hidden) load(false, true); });
setInterval(() => { if (!document.hidden && !state.pending) load(false, true); }, 60000);
$('start-date').value = dayKey(localDay() - 6); $('end-date').value = dayKey(localDay());
$('end-date').max = $('start-date').max = dayKey(localDay());
load();
