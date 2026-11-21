import { stackedBars, calendarHeatmap, punchCard, segmentBar, hBars, esc, usageValue, coverageValue, TOKEN_KEYS, TOKEN_LABELS, TOKEN_COLORS } from './charts.mjs';
import { pixelBanner, nextBuildingPatterns, skyFor } from './art.mjs';
import { dayKey, localDay } from '../core/query.mjs';
import { createDiagnostics, diagnosticError, parseRuntimeDiagnostics, loadTimingSummary } from '../core/diagnostics.mjs';
import { buildEfficiencyReview, toolOutcomeSummary } from './efficiency.mjs';
import { renderReviewCards, reviewResultCaption } from './review-cards.mjs';
import { renderConversations, CONVERSATION_TOPICS } from './conversations.mjs';
import { renderContextGrowth, contextGrowthChart, contextGrowthPrompt, CONTEXT_SHAPES } from './context-growth.mjs';
import { TOKEN_TOPICS, PATTERN_TOPICS, renderTokenTopic, tokenTopicIcon } from './token-topics.mjs';
import { formatNumber, formatCredits } from '../core/format.mjs';
import { mergeMcpInventory } from '../core/integrations.mjs';
import { publicModelLabels } from '../core/public-models.mjs';
import { decodeReportWire } from '../core/report-wire.mjs';

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
const AUTO_REFRESH_MS = 15 * 60 * 1000;
const RANGE_LABELS = { '1d': 'Today', '7d': 'Last 7 days', mtd: 'Rolling 30', '30d': 'Last 30 days', '90d': 'Last 90 days', all: 'All history', custom: 'Custom dates' };
const skillDate = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true });
const state = { range: 'mtd', metric: 'tokens', metricEmphasis: false, view: 'usage', report: null, creditsUnavailable: false, version: 0, pending: false, force: false, rescan: false, selectedDay: null, filterKey: '', skillActionPending: false, skillView: null, textSize: 'small', simplifyNumbers: true, bannerRange: null, buildingPatterns: {}, requestView: null, modelView: null, projectView: null };
const recordedValue = (row, key, format = number) => usageValue(row, key, format, !$('coverage').hidden);
const markedValue = (value, incomplete, format = number) => coverageValue(value, incomplete, format, !$('coverage').hidden);
let dismissedCoverage = '';
let coveragePage = 0;
const coverageKinds = { unclassified: 'No Copilot attribution', excluded: 'Custom provider / BYOK', invalid: 'Malformed usage record',
  invalidSkills: 'Malformed skill event', invalidTools: 'Malformed tool event', aggregateOnly: 'Summary-only session' };
function renderCoverageReview() {
  const details = state.report?.coverageDetails || { counts: {}, rows: [], unreadable: [] };
  $('coverage-current').textContent = $('coverage-message').textContent || 'No unexpected coverage problems were found in the current view. Local logs may still have measurement limits.';
  const r = state.report, p = r?.promptCredits?.coverage || {}, t = r?.totals, measurements = r?.efficiency?.summary, interactions = r?.efficiency?.interactions;
  const limits = [];
  if (p.cancelledPrompts) limits.push(`${number(p.cancelledPrompts)} user-cancelled prompts are excluded from cost averages. An absent charge is unknown, not proof of zero spending.`);
  if (p.interruptedPrompts) limits.push(`${number(p.interruptedPrompts)} interrupted prompts are excluded from cost averages because their work did not finish.`);
  if (p.pluginCalls) limits.push(`${number(p.pluginCalls)} background plugin calls have no originating human prompt in their retained accounting records.`);
  if (p.compactionCalls) limits.push(`${number(p.compactionCalls)} conversation-compaction calls cannot be assigned to an individual prompt.`);
  if (t?.missing?.reasoning > 0 && t.missing.reasoning < t.requests || measurements?.reasoningRequests > 0 && measurements.reasoningRequests < measurements.requests) limits.push('Reasoning counts are only partly measured.');
  if (measurements && ['toolRequests', 'toolCountRequests'].some(key => measurements[key] > 0 && measurements[key] < measurements.requests)) limits.push('Some tool-footprint measurements are only partly recorded.');
  if (interactions?.promptSamples > 0 && interactions.promptSamples < interactions.prompts) limits.push('Some prompt lengths are not recorded.');
  if (r?.tools?.rows.some(row => row.unknown > 0)) limits.push('Some tool calls have no recorded outcome.');
  if (t?.missingCache) limits.push(`${number(t.missingCache)} requests have an unknown cache split.`);
  $('coverage-limitations').innerHTML = limits.length ? `<h3>Known limitations in this view</h3><p class="footnote">These do not activate the warning banner. All recorded credits and tokens remain in totals.</p><ul>${limits.map(text => `<li>${esc(text)}</li>`).join('')}</ul>` : '';
  const scope = $('coverage-scope').value, rows = details.rows.filter(row => row.scope === scope);
  coveragePage = Math.min(coveragePage, Math.max(0, Math.ceil(rows.length / 25) - 1));
  $('coverage-counts').textContent = ['current', 'outside', 'unknown'].map((key, i) => `${['In selected dates', 'Outside selected dates', 'Cannot place'][i]}: ${number(details.rows.filter(row => row.scope === key).reduce((n, row) => n + row.count, 0))}`).join(' · ');
  $('coverage-rows').innerHTML = rows.length ? `<table><thead><tr><th>Issue / file</th><th>Count</th><th>Recorded dates</th></tr></thead><tbody>${rows.slice(coveragePage * 25, coveragePage * 25 + 25).map(row => `<tr><td>${esc(coverageKinds[row.kind] || row.kind)}<code>${esc(row.file || 'File unavailable')}</code></td><td>${number(row.count)}</td><td>${esc(row.from && row.to ? row.from === row.to ? row.from : `${row.from} – ${row.to}` : 'Date unknown')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No recorded issues in this category.</p>';
  $('coverage-page').textContent = rows.length ? `${number(coveragePage + 1)} / ${number(Math.ceil(rows.length / 25))}` : '';
  $('coverage-prev').disabled = !coveragePage;
  $('coverage-next').disabled = (coveragePage + 1) * 25 >= rows.length;
  $('coverage-unreadable').innerHTML = details.unreadable.length ? `<h3>Source availability</h3><p class="footnote">Source-wide warnings cannot always be assigned dates. See Local data sources for read errors and other limitations.</p>${details.unreadable.map(s => `<code>${esc(s.file)}</code>`).join('')}` : '';
}
function openCoverageReview() {
  coveragePage = 0;
  const rows = state.report?.coverageDetails?.rows || [];
  $('coverage-scope').value = rows.some(row => row.scope === 'current') ? 'current' : rows.some(row => row.scope === 'unknown') ? 'unknown' : 'outside';
  renderCoverageReview(); $('coverage-dialog').showModal();
}
$('coverage-review').onclick = $('coverage-open').onclick = openCoverageReview;
$('coverage-close').onclick = () => $('coverage-dialog').close();
$('coverage-scope').onchange = () => { coveragePage = 0; renderCoverageReview(); };
$('coverage-prev').onclick = () => { coveragePage--; renderCoverageReview(); };
$('coverage-next').onclick = () => { coveragePage++; renderCoverageReview(); };
let loadError = '', lastResponseAt, cachedServerDiagnostics, lastSuccessfulScanAt;
let historyLoading, historyPoll, historyStarted, displayedHistoryPhase;
function scheduleHistoryPoll() {
  clearTimeout(historyPoll); historyPoll = null;
  if (state.paused || !historyLoading || loadError || document.hidden) return;
  historyPoll = setTimeout(() => {
    historyPoll = null;
    if (document.hidden) return;
    if (state.pending) { scheduleHistoryPoll(); return; }
    return load(false, false, true);
  }, 2000);
}
try { cachedServerDiagnostics = JSON.parse($('initial-diagnostics').textContent || 'null') || undefined; }
catch { clientDiagnostics.record('warn', 'diagnostics.initial'); }
let importedRuntimeLogs;
$('coverage-dismiss').onclick = () => {
  dismissedCoverage = $('coverage-message').textContent;
  $('coverage').hidden = true;
  $('tip').hidden = true;
  render();
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
      const response = await fetch('api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input, ...(['usage.report', 'usage.refresh'].includes(method) ? { compact: true } : {}), ...(refresh ? { refresh: true } : {}), ...(known ? { known } : {}) }), ...(signal ? { signal } : {}) });
      lastResponseAt = Date.now();
      fields.httpStatus = response.status;
      fields.requestStage = 'decode';
      const result = ['usage.report', 'usage.refresh'].includes(method)
        ? await clientDiagnostics.measure('api.decode', { method }, async () => decodeReportWire(await response.json())) : await response.json();
      fields.requestStage = 'http';
      if (!response.ok) {
        if (result.code === 'paused') applyPaused(true);
        throw Object.assign(new Error(result.error || `Request failed (${response.status})`), { code: result.code });
      }
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
    server ? `Server: v${server.version}, Node ${server.runtime.node}, ${server.runtime.platform}/${server.runtime.arch}${server.runtime.processId ? `, process ${server.runtime.processId}` : ''}` : 'Server logs unavailable.',
    `Dashboard started: ${client.startedAt}; retained ${client.entries.length}/${client.limit} entries; dropped ${client.dropped}`];
  if (server) lines.push(`Server started: ${server.startedAt}; retained ${server.entries.length}/${server.limit} entries; dropped ${server.dropped}`);
  if (server && cached) lines.push(`Cached server snapshot from ${server.capturedAt || server.startedAt}; this is not a live connection check.`);
  if (server?.persisted) lines.push(`Recent local runtime logs: ${server.persisted.available ? 'available' : 'partly unavailable'}; retained ${server.persisted.entries.length} entries. These can include earlier extension processes.`);
  if (importedRuntimeLogs) lines.push(`Manually loaded runtime logs: ${importedRuntimeLogs.entries.length} entries; loaded ${importedRuntimeLogs.at}. These are a file snapshot, not a live connection check.`);
  lines.push('Structured diagnostics only: no prompts, names, paths, raw error messages, or credentials.', 'Timings are milliseconds; UI timings measure JavaScript/DOM updates, not final browser paint.', '');
  const runtime = new Map();
  for (const entry of [...(server?.persisted?.entries || []), ...(importedRuntimeLogs?.entries || [])]) runtime.set(JSON.stringify(entry), entry);
  const entries = [...client.entries.map(entry => ({ ...entry, source: 'dashboard' })), ...(server?.entries || []).map(entry => ({ ...entry, source: 'server' })), ...[...runtime.values()].map(entry => ({ ...entry, source: 'runtime' }))];
  entries.sort((a, b) => a.at.localeCompare(b.at));
  // Retain startup evidence from failed opens, labelled by process; older history timings
  // must not be presented as stages of this dashboard's current usage load.
  lines.push(loadTimingSummary(entries.filter(entry => entry.source !== 'runtime' || /^(extension\.(sdk|join)|canvas\.(open|queue)|server\.(start|import|assets|bind|page|endpointRead))$/.test(entry.event))), '', 'Structured events', '');
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
    $('logs-help').open = true;
  } finally { clearTimeout(timeout); logsLoading = false; $('logs-reload').disabled = $('logs-copy').disabled = false; }
}
$('logs-open').onclick = $('logs-reload').onclick = showLogs;
$('logs-close').onclick = () => $('logs-dialog').close();
$('logs-import').onclick = () => $('logs-files').click();
$('logs-files').onchange = async () => {
  const files = [...($('logs-files').files || [])];
  $('logs-files').value = '';
  if (!files.length) return;
  try {
    if (files.length > 2 || files.some(file => file.size > 1024 * 1024)) throw new Error('Choose up to two runtime log files, each no larger than 1 MB.');
    const unique = new Map();
    for (const text of await Promise.all(files.map(file => file.text()))) for (const entry of parseRuntimeDiagnostics(text)) unique.set(JSON.stringify(entry), entry);
    const entries = [...unique.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-300);
    if (!entries.length) throw new Error('No supported runtime diagnostics found. Choose diagnostics.jsonl or diagnostics.previous.jsonl.');
    importedRuntimeLogs = { at: new Date().toISOString(), entries };
    $('logs-output').value = diagnosticText();
    $('logs-status').textContent = 'Saved runtime logs included. Copy logs includes these and the dashboard diagnostics. Files are read locally; nothing is uploaded.';
  } catch {
    $('logs-status').textContent = 'Could not load runtime logs. Choose diagnostics.jsonl and optionally diagnostics.previous.jsonl, up to 1 MB each. Existing logs are still available to copy.';
  }
};
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
    ...($('environment').value ? { environment: $('environment').value } : {}),
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
  if (state.paused) return;
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
let refreshFeedbackTimer;
function setRefreshFeedback(status) {
  clearTimeout(refreshFeedbackTimer);
  const busy = status === 'busy', label = busy ? 'Refreshing…' : status === 'done' ? 'Updated' : 'Refresh';
  for (const id of ['refresh', 'footer-refresh']) {
    $(id).dataset.refreshState = status;
    $(id).disabled = busy || !!state.paused;
    $(id).setAttribute('aria-busy', String(busy));
    $(id).setAttribute('aria-label', busy ? 'Refreshing usage' : status === 'done' ? 'Usage updated. Refresh again.' : 'Refresh usage');
    $(`${id}-label`).textContent = label;
  }
  if (status === 'done') refreshFeedbackTimer = setTimeout(() => setRefreshFeedback('idle'), 1400);
}
async function load(force = false, refresh = false, background = false) {
  if (state.paused) { renderLoadStatus(); return; }
  clearTimeout(historyPoll); historyPoll = null;
  state.version++; state.force ||= force; state.rescan ||= refresh;
  if (state.pending) return;
  state.pending = true;
  const loadStarted = globalThis.performance?.now() ?? Date.now();
  const loadFields = { loadKind: background ? 'background' : !state.report ? 'initial' : force ? 'manual' : refresh ? 'automatic' : 'filter', range: state.range };
  if (!background && (!state.report || force || refresh) && (!historyLoading || loadError)) { historyStarted = loadStarted; displayedHistoryPhase = undefined; }
  clientDiagnostics.record('info', 'ui.load', { ...loadFields, phase: 'started' });
  setRefreshFeedback('busy');
  let successful = false, manual = false;
  try {
    let version;
    do {
      version = state.version;
      successful = false;
      manual ||= state.force;
      const method = state.force ? 'usage.refresh' : 'usage.report'; state.force = false;
      const rescan = state.rescan; state.rescan = false;
      try {
        const input = query(), filterKey = JSON.stringify(input);
        // When this very view is already on screen, the server may answer that nothing changed.
        const known = method === 'usage.report' && state.report && !state.creditsUnavailable && filterKey === state.filterKey ? state.report.revision : undefined;
        let report;
        for (let attempt = 0; ; attempt++) {
          try {
            report = await request(method, input, rescan, undefined, known);
            if (attempt) clientDiagnostics.record('info', 'ui.reconnect', { phase: 'finished' });
            break;
          } catch (error) {
            // Only the explicit, read-only Refresh action retries. Never replay an AI
            // review or settings change after an uncertain transport outcome.
            if (method !== 'usage.refresh' || error.requestStage !== 'fetch' || version !== state.version) throw error;
            if (attempt === 3) { clientDiagnostics.record('warn', 'ui.reconnect', { phase: 'failed' }); throw error; }
            clientDiagnostics.record('info', 'ui.reconnect', { phase: 'started' });
            $('live').textContent = 'Reconnecting to the dashboard server';
            await new Promise(resolve => setTimeout(resolve, [500, 1000, 2000][attempt]));
            if (version !== state.version) throw error;
          }
        }
        if (!report.loading && (rescan || method === 'usage.refresh' || historyLoading)) lastSuccessfulScanAt = Date.now();
        if (version !== state.version) continue;
        loadError = '';
        historyLoading = report.loading;
        const historyPhase = report.loading?.phase || 'complete', historyKey = `${report.scanId || report.loading?.scanId}:${historyPhase}`;
        if (historyKey !== displayedHistoryPhase) {
          clientDiagnostics.record('info', 'ui.history', { historyPhase, scanId: report.scanId || report.loading?.scanId, phase: 'finished',
            durationMs: (globalThis.performance?.now() ?? Date.now()) - historyStarted });
          displayedHistoryPhase = historyKey;
        }
        if (report.loading?.phase === 'history') {
          state.report = null; state.creditsUnavailable = true; state.filterKey = filterKey;
          state.requestView = state.modelView = state.projectView = state.skillView = null;
          $('coverage').hidden = true;
          renderHeaderCredits(); renderLoadStatus();
          $('status').before($('filters'));
          $('live').textContent = 'History for this date range is still loading';
          successful = true;
          continue;
        }
        if (report.unchanged) {
          const sky = skyFor(new Date(state.report.generatedAt).getHours());
          state.report.generatedAt = report.generatedAt; state.report.scannedAt = report.scannedAt; state.report.loading = report.loading;
          renderClock(sky);
          renderLoadStatus();
          if (!inventorySnapshot || rescan) void loadInventory(rescan);
          $('live').textContent = historyLoading ? 'Recent usage so far; history is still loading' : 'Usage updated';
          successful = true;
          continue;
        }
        if (filterKey !== state.filterKey) { state.selectedDay = null; state.requestView = null; state.modelView = null; state.projectView = null; state.skillView = null; state.filterKey = filterKey; }
        applyPreferences(report.preferences);
        state.creditsUnavailable = false;
        state.report = { ...report };
        historyMcp = report.mcp;
        applyInventory();
        render();
        if (!inventorySnapshot || method === 'usage.refresh' || rescan) void loadInventory(method === 'usage.refresh' || rescan);
        if (state.modelView) loadModelProjectPage(state.modelView.offset);
        if (state.projectView?.models) loadSessionModels();
        $('live').textContent = historyLoading ? 'Recent usage so far; history is still loading' : 'Usage updated';
        successful = true;
      } catch (e) {
        if (version !== state.version) continue;
        state.creditsUnavailable = !state.report || state.filterKey !== JSON.stringify(query());
        if (state.creditsUnavailable) { state.requestView = null; state.modelView = null; state.projectView = null; }
        loadError = e.requestStage === 'fetch' ? 'Could not reach the local dashboard server. Copilot may have restarted the extension. Try Refresh to reconnect; if it stays unavailable, close and reopen Usage Insights from Copilot.' : `Could not update usage: ${e.message}`;
        renderHeaderCredits();
        renderLoadStatus();
        if (state.creditsUnavailable) $('status').before($('filters'));
      }
    } while (!state.paused && version !== state.version);
  } finally {
    state.pending = false; setRefreshFeedback(manual && successful ? 'done' : 'idle');
    clientDiagnostics.record(successful ? 'info' : 'error', 'ui.load', { ...loadFields, phase: successful ? 'finished' : 'failed', durationMs: (globalThis.performance?.now() ?? Date.now()) - loadStarted });
    scheduleHistoryPoll();
  }
}
function renderLoadStatus() {
  if (state.paused) {
    $('content').hidden = true;
    $('coverage').hidden = true;
    $('status').hidden = false;
    $('status').textContent = 'Usage Insights is paused. New reads and AI reviews are paused. Open Settings to resume.';
    if ($('activity-dialog').open) $('activity-dialog').close();
    return;
  }
  const matching = state.report && state.filterKey === JSON.stringify(query());
  if (!matching) rememberReviewAnimation();
  $('content').hidden = !matching;
  if (!matching && $('activity-dialog').open) $('activity-dialog').close();
  if (historyLoading) {
    $('status').hidden = false;
    $('status').textContent = loadError ? 'History loading stopped. Any recent results shown are incomplete. Use Refresh to retry. ' + loadError
      : historyLoading.phase === 'history' ? `Loading history for ${RANGE_LABELS[state.range] || 'the selected dates'}… Recent ranges are available while the remaining history is checked.`
      : 'Recent usage so far. Checking older files and databases in the background; totals may change. Prompt-cost averages will appear after verification.';
    return;
  }
  $('status').hidden = !loadError && !!state.report?.totals.requests;
  $('status').textContent = loadError ? loadError + (matching ? ' Showing the last successful data; it may be out of date.' : ' Data for these filters could not be loaded.') : 'No matching Copilot usage yet. Make a request in Copilot, then refresh. Check Local data sources below if you expected history.';
}
const builtOptions = new Map();
function renderSessionChoices() {
  const values = state.report?.options.sessions || [];
  // A collapsed filter must not create thousands of invisible native option elements.
  const visible = values.length <= 1000 || $('filters').open ? values : values.filter(v => v.id === $('session').value);
  options('session', visible, 'All sessions');
}
$('filters').addEventListener('toggle', renderSessionChoices);
function options(id, values, all) {
  const select = $(id), selected = select.value;
  const previous = builtOptions.get(id);
  if (previous?.values === values && previous.selected === selected && previous.all === all) return;
  // A long history has thousands of sessions; the list is rebuilt only when it differs.
  const key = JSON.stringify([selected, all, values]);
  builtOptions.set(id, { values, selected, all, key });
  if (previous?.key === key) return;
  const choices = values.map(v => typeof v === 'string' ? { id: v, name: v } : v);
  const available = selected && !choices.some(v => v.id === selected) ? [{ id: selected, name: selected }, ...choices] : choices;
  const title = choice => choice.name === choice.id ? choice.name : `${choice.name} — ${choice.id}`;
  select.innerHTML = `<option value="">${all}</option>` + available.map(v => `<option value="${esc(v.id)}" title="${esc(title(v))}">${esc(v.name)}</option>`).join('');
  select.value = selected;
  const active = available.find(v => v.id === selected);
  select.title = active ? title(active) : all;
}
function creditLabel(row) {
  return recordedValue(row, 'credits', creditNumber);
}
function renderHeaderCredits() {
  const totals = !state.creditsUnavailable && state.filterKey === JSON.stringify(query()) ? state.report?.totals : null;
  $('hero-credits').textContent = totals ? creditLabel(totals) : historyLoading && !loadError ? 'Loading…' : 'Unavailable';
  $('hero-credits').title = totals ? 'Recorded Copilot credits for the current filters.' + (totals.missingCredits || totals.partialCredits ? ' Credit coverage is incomplete.' : '') : 'Credits could not be loaded for the current filters.';
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
  const titles = { input: 'Input', output: 'Output', reasoning: 'Reasoning', cacheRead: 'Cache read', cacheWrite: 'Cache write', total: 'Tokens', averageTokens: 'Avg. tokens / turn', credits: 'AI credits' };
  const hints = { reasoning: 'Reported reasoning tokens are part of output; they are not added to the total again.', averageTokens: 'Average over requests with complete token counts. Follows Include cache tokens. Coverage reflects requests with complete counts.' };
  const modelExpansion = expansion === 'model', projectExpansion = expansion === 'project', modelProjectExpansion = expansion === 'modelProject';
  const projectFilter = expansion === 'projectFilter';
  const sessionExpansion = expansion === 'session', requestExpansion = expansion === 'request', sessionModelsExpansion = expansion === 'sessionModels';
  const expandable = modelExpansion || modelProjectExpansion || projectExpansion || sessionExpansion || requestExpansion || sessionModelsExpansion;
  const attribute = modelExpansion ? 'data-request-model' : modelProjectExpansion ? 'data-model-project' : projectExpansion ? 'data-project-name' : sessionExpansion ? 'data-request-session' : sessionModelsExpansion ? 'data-project-session' : 'data-request-id';
  const region = modelExpansion ? 'model-projects' : modelProjectExpansion ? 'model-sessions' : projectExpansion ? 'project-sessions' : sessionExpansion ? 'session-requests' : sessionModelsExpansion ? 'session-models' : 'request-detail';
  const body = rows.map((r, index) => {
    const open = modelExpansion ? state.modelView?.model === r.name : modelProjectExpansion ? state.modelView?.sessions?.project === r.name : projectExpansion ? state.projectView?.project === r.name : sessionExpansion ? state.requestView?.session === r.id : sessionModelsExpansion ? state.projectView?.models?.session === r.id : requestExpansion && state.requestView?.selectedId === r.id;
    const label = requestExpansion ? requestDate.format(new Date(r.ts)) : r.name;
    const title = requestExpansion ? `${initiatorLabel(r.initiator)} \u00b7 Recorded model call` : r.id ? `${label} \u2014 ${r.id}` : label;
    const child = !open ? null : modelExpansion ? modelProjectList() : modelProjectExpansion ? modelSessionList() : projectExpansion ? projectSessionList(r.name) : sessionExpansion ? requestList() : sessionModelsExpansion ? sessionModelList() : { header: requestDetail(state.requestView) };
    const childRows = child?.rows || '';
    const controlled = child ? [region, ...[...childRows.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])].join(' ') : '';
    const choice = projectFilter ? `<td class="text-cell"><button class="model-toggle cell-text" data-usage-project="${esc(r.name)}" aria-pressed="${$('project').value === r.name}" title="${esc(r.name)}: ${$('project').value === r.name ? 'clear project filter' : 'filter dashboard'}">${esc(r.name)}</button></td>` : '';
    const name = projectFilter ? choice : expandable ? `<td class="text-cell"><button class="${requestExpansion ? 'request-toggle' : 'model-toggle'} cell-text" ${attribute}="${esc(modelExpansion || projectExpansion ? r.name : r.id)}" aria-expanded="${!!open}"${open ? ` aria-controls="${controlled}"` : ''} aria-label="${esc(heading)}: ${esc(label)}" title="${esc(title)}"><span aria-hidden="true">${open ? '\u25be' : '\u25b8'}</span> ${esc(label)}</button></td>` : textCell(label, title);
    const promptHint = requestExpansion ? 'Individual model call. User prompts are counted once in the parent summaries.' : `${number(r.uncertainPrompts || 0)} prompt candidates have uncertain attribution. ${number(r.requests)} model turns. Counts reflect available local logs.`;
    const cells = `<tr${details ? ` class="usage-row" data-depth="${depth}" id="usage-row-${depth}-${index}"` : projectFilter && $('project').value && $('project').value !== r.name ? ' class="choice-muted"' : ''}>${name}${projectFilter || details ? `<td data-measure="prompts" title="${esc(promptHint)}">${r.userPrompts == null ? '\u2014' : markedValue(r.userPrompts, r.uncertainPrompts)}</td>` : ''}${details ? '' : `<td data-measure="requests">${number(r.requests)}</td>`}${keys.map(key => `<td data-measure="${key === 'credits' ? 'credits' : 'tokens'}"${key === 'averageTokens' ? ` title="${number(r.completeTokenRequests)} of ${number(r.requests)} requests have complete token counts"` : ''}>${esc(recordedValue(r, key, key === 'credits' ? creditNumber : number))}</td>`).join('')}</tr>`;
    if (!open) return cells;
    return cells + `<tr class="usage-context" data-depth="${depth + 1}"><td colspan="${keys.length + 2}"><div id="${region}" class="${requestExpansion ? 'request-detail' : 'request-list'}" aria-label="${requestExpansion ? 'Original prompt' : `${modelExpansion ? 'Projects' : modelProjectExpansion || projectExpansion ? 'Sessions' : sessionModelsExpansion ? 'Models' : 'Requests'} for ${esc(label)}`}">${child.header}</div></td></tr>${childRows}`;
  }).join('');
  const header = `<tr${details ? ` class="usage-header" data-depth="${depth}" id="usage-header-${depth}"` : ''}><th scope="col">${esc(heading)}</th>${projectFilter ? '<th title="Distinct confirmed user submissions, dated by submission. Continuations and subagent messages are not additional prompts. Unknown attribution is excluded; hover over a count for known gaps. Model filters require reliable links. Missing billing alone does not exclude a prompt. Local logs may be incomplete.">User prompts</th><th>Model turns</th>' : '<th scope="col" title="Distinct confirmed human submissions, dated by submission. Continuations are not additional prompts. A prompt can count once for each model it used; model counts are not additive. Unknown attribution is excluded. Individual call rows show a dash because this count belongs to the parent summary.">User prompts</th>'}${keys.map(key => `<th scope="col" data-measure="${key === 'credits' ? 'credits' : 'tokens'}"${hints[key] ? ` title="${hints[key]}"` : ''}>${titles[key]}</th>`).join('')}</tr>`;
  if (depth) return header + body;
  // Reserve column space from the whole report before any child rows are loaded.
  const totals = state.report.totals;
  const metricWidth = Math.max(11, number(totals.requests).length, ...keys.map(key => recordedValue(totals, key, key === 'credits' ? creditNumber : number).length));
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
  if (state.view === 'breakdown') renderBreakdown();
  try {
    const result = await request('usage.sessionModels', { ...JSON.parse(state.filterKey), project: project.project, session: view.session });
    if (state.projectView !== project || project.models !== view || view.version !== version) return;
    view.rows = result.rows;
  } catch (e) {
    if (state.projectView !== project || project.models !== view || view.version !== version) return;
    view.error = `Could not load models: ${e.message}`;
  } finally {
    if (state.projectView === project && project.models === view && view.version === version) { view.pending = false; if (state.view === 'breakdown') renderBreakdown(); }
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
function modelGroupList(view, projects) {
  const noun = projects ? 'project' : 'session', pageKey = projects ? 'model-project-page' : 'model-session-page';
  if (view.pending && !view.page) return { header: `<p class="muted" role="status">Loading ${noun}s…</p>` };
  if (view.error) return { header: `<p role="status">${esc(view.error)} <button data-${pageKey}="${view.offset}">Retry</button></p>` };
  const page = view.page;
  if (!page?.rows.length) return { header: `<p class="muted">No matching ${noun}s remain. Refresh to update the totals.</p>` };
  const end = page.offset + page.rows.length;
  return { header: `<header><div><strong>${number(page.total)} ${noun}${page.total === 1 ? '' : 's'}</strong>${view.pending ? '<p class="footnote" role="status">Updating…</p>' : ''}</div><div class="request-paging"><span>${page.offset + 1}–${end}</span><button data-${pageKey}-direction="previous" data-${pageKey}="${Math.max(0, page.offset - page.limit)}" aria-disabled="${view.pending}"${page.offset === 0 ? ' disabled' : ''}>Previous</button><button data-${pageKey}-direction="next" data-${pageKey}="${end}" aria-disabled="${view.pending}"${end >= page.total ? ' disabled' : ''}>Next</button></div></header>`, rows: table(page.rows, projects ? 'Project' : 'Session', true, projects ? 'modelProject' : 'session', projects ? 1 : 2) };
}
const modelProjectList = () => modelGroupList(state.modelView, true);
const modelSessionList = () => modelGroupList(state.modelView.sessions, false);
function requestList() {
  const view = state.requestView;
  if (view.pending && !view.page) return { header: '<p class="muted" role="status">Loading session requests…</p>' };
  if (view.error) return { header: `<p role="status">${esc(view.error)} <button data-request-page="${view.offset}">Retry</button></p>` };
  const page = view.page;
  if (!page?.rows.length) return { header: '<p class="muted">No matching requests remain. Refresh to update the session totals.</p>' };
  const end = page.offset + page.rows.length;
  return { header: `<header><div><strong>${number(page.total)} model turn${page.total === 1 ? '' : 's'}</strong><p class="footnote">One prompt can produce several model turns. User prompts are counted in the parent summaries. Newest first.${view.pending ? ' Updating…' : ''}</p></div><div class="request-paging"><span>${page.offset + 1}–${end}</span><button data-request-page-direction="previous" data-request-page="${Math.max(0, page.offset - page.limit)}" aria-disabled="${view.pending}"${page.offset === 0 ? ' disabled' : ''}>Previous</button><button data-request-page-direction="next" data-request-page="${end}" aria-disabled="${view.pending}"${end >= page.total ? ' disabled' : ''}>Next</button></div></header>`, rows: table(page.rows, 'Time', true, 'request', 3) };
}
async function loadModelGroupPage(offset, projects) {
  const parent = state.modelView, view = projects ? parent : parent?.sessions;
  if (!view) return;
  const current = () => state.modelView === parent && (projects || parent.sessions === view);
  const version = ++view.version;
  view.pending = true; view.error = ''; view.offset = offset;
  if (state.view === 'breakdown') renderBreakdown();
  try {
    const page = await request(projects ? 'usage.modelProjects' : 'usage.sessions', { ...JSON.parse(state.filterKey), model: parent.model, ...(!projects ? { project: view.project } : {}), sort: $('sort').value, offset });
    if (!current() || view.version !== version) return;
    view.page = page; view.offset = page.offset;
    if (projects) {
      if (view.sessions && !page.rows.some(r => r.name === view.sessions.project)) { view.sessions = null; state.requestView = null; }
      else if (view.sessions) await loadModelSessionPage(view.sessions.offset);
    } else {
      if (state.requestView && !page.rows.some(r => r.id === state.requestView.session)) state.requestView = null;
      else if (state.requestView) await loadRequestPage(state.requestView.offset);
    }
  } catch (e) {
    if (!current() || view.version !== version) return;
    view.error = `Could not load ${projects ? 'projects' : 'sessions'}: ${e.message}`;
  } finally {
    if (current() && view.version === version) { view.pending = false; if (state.view === 'breakdown') renderBreakdown(); }
  }
}
const loadModelProjectPage = (offset = 0) => loadModelGroupPage(offset, true);
const loadModelSessionPage = (offset = 0) => loadModelGroupPage(offset, false);
async function loadRequestPage(offset = 0) {
  const view = state.requestView;
  if (!view) return;
  const version = ++view.version;
  view.pending = true; view.error = ''; view.offset = offset;
  view.details.clear(); view.detailVersion++; view.detail = null; view.detailPending = !!view.selectedId;
  if (state.view === 'breakdown') renderBreakdown();
  try {
    const page = await request('usage.requests', { ...JSON.parse(state.filterKey), model: view.model, project: view.project, session: view.session, offset });
    if (state.requestView !== view || view.version !== version) return;
    view.page = page; view.offset = page.offset;
    if (view.selectedId && !page.rows.some(r => r.id === view.selectedId)) { view.selectedId = null; view.detail = null; }
    else if (view.selectedId) { view.pending = false; await loadRequestDetail(view.selectedId); }
  } catch (e) {
    if (state.requestView !== view || view.version !== version) return;
    view.error = `Could not load requests: ${e.message}`;
  } finally {
    if (state.requestView === view && view.version === version) { view.pending = false; if (state.view === 'breakdown') renderBreakdown(); }
  }
}
async function loadRequestDetail(id) {
  const view = state.requestView;
  if (!view || !view.page?.rows.some(r => r.id === id) || view.pending) return;
  const version = ++view.detailVersion;
  if (view.details.has(id)) { view.selectedId = id; view.detail = view.details.get(id); view.detailPending = false; view.detailError = ''; if (state.view === 'breakdown') renderBreakdown(); return; }
  view.selectedId = id; view.detail = null; view.detailPending = true; view.detailError = '';
  if (state.view === 'breakdown') renderBreakdown();
  try {
    const page = await request('usage.requests', { ...JSON.parse(state.filterKey), model: view.model, project: view.project, session: view.session, id });
    if (state.requestView !== view || view.detailVersion !== version || view.selectedId !== id) return;
    view.detail = page.rows[0] || null; view.details.set(id, view.detail);
  } catch (e) {
    if (state.requestView !== view || view.detailVersion !== version || view.selectedId !== id) return;
    view.detailError = `Could not load original prompt: ${e.message}`;
  } finally {
    if (state.requestView === view && view.detailVersion === version) { view.detailPending = false; if (state.view === 'breakdown') renderBreakdown(); }
  }
}
function skillFolder(file) {
  const end = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (end < 0) return '';
  const root = end === 0 || (end === 2 && file[1] === ':');
  return file.slice(0, end + (root ? 1 : 0));
}
function skillName(skill, open) {
  const hint = skill.unresolved ? 'Failed loads recorded by name; no unique skill location, plugin, and version was identified. Show statistics by project.' : 'Show statistics by project';
  return `<span class="skill-actions"><button class="model-toggle skill-toggle" data-skill-id="${esc(skill.id)}" data-skill-action="toggle" aria-expanded="${open}"${open ? ' aria-controls="skill-project-rows"' : ''} aria-label="Projects for ${esc(skill.name)}" title="${hint}"><span aria-hidden="true">${open ? '\u25be' : '\u25b8'}</span> ${esc(skill.name)}${skill.unresolved ? ' <span class="muted">(unresolved)</span>' : ''}${skill.unattributedUses || skill.unattributedFailures ? ' <span class="muted">(provider unverified)</span>' : ''}</button>${skill.path && !skill.unresolved && skillFolder(skill.path) ? `<button class="skill-copy" data-skill-id="${esc(skill.id)}" data-skill-action="copy" aria-label="Copy folder path for ${esc(skill.name)}" title="Copy folder path"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>` : ''}</span>`;
}
function skillHeader(label) {
  return `<tr><th scope="col">${label}</th><th scope="col" title="Recorded successful skill loads, including preloaded and unknown triggers. Hover over a count for its breakdown.">Uses</th><th scope="col" title="Uses explicitly requested by the user.">By user</th><th scope="col" title="Uses requested by the agent.">By agent</th><th scope="col">Sessions</th><th scope="col" title="Recorded failed attempts to load this skill.">Failures</th><th scope="col" title="Version declared in the current SKILL.md file; may differ from the version used when the skill ran.">Skill version (installed)</th><th scope="col" title="Most recent recorded use or failed load.">Last used</th></tr>`;
}
function skillStats(row, skill = row) {
  return `<td title="${esc(skillTriggerSummary(row))}">${number(row.invocations)}</td><td>${number(row.triggers?.manual ?? 0)}</td><td>${number(row.triggers?.agent ?? 0)}</td><td>${number(row.sessions)}</td><td>${number(row.failures ?? 0)}</td>${textCell(skill.installedVersion?.value ?? (skill.installedVersion?.status === 'not-declared' ? 'Not declared' : 'Unavailable'))}<td title="${esc(new Date(row.lastUsed).toLocaleString())}">${esc(skillDate.format(new Date(row.lastUsed)))}</td>`;
}
function skillTable(skills) {
  return `<table><thead>${skillHeader('Skill')}</thead>${sortActivity(skills, $('skills-sort').value).map(skill => {
    const open = state.skillView === skill.id;
    const parent = `<tbody><tr><td class="text-cell" title="${esc(skill.name)}">${skillName(skill, open)}</td>${skillStats(skill)}</tr></tbody>`;
    if (!open) return parent;
    const projects = sortActivity(skill.projectRows || [], $('skills-sort').value);
    return parent + `<tbody id="skill-project-rows" class="skill-projects" aria-label="Projects for ${esc(skill.name)}">${skillHeader('Project')}${projects.length ? projects.map(project => `<tr>${textCell(project.name)}${skillStats(project, skill)}</tr>`).join('') : '<tr><td colspan="8">No project statistics available. Refresh to update this skill.</td></tr>'}</tbody>`;
  }).join('')}</table>`;
}
function skillTriggerSummary(skill) {
  const triggers = skill.triggers || { manual: 0, agent: 0, preloaded: 0, unknown: skill.invocations };
  return `By user: ${number(triggers.manual)}; By agent: ${number(triggers.agent)}; Preloaded: ${number(triggers.preloaded)}; Unknown: ${number(triggers.unknown)}`;
}
function renderIntegrations(report) {
  if (!report) return;
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
    return `<tr><td class="text-cell"><details class="server-details" data-server="${esc(row.name)}"${openDetails.has(row.name) ? ' open' : ''}><summary class="cell-text">${esc(row.displayName || row.name)}</summary><div class="server-info">${details.map(detail => `<p>${esc(detail)}</p>`).join('')}</div></details></td><td><span class="connection-status ${tone}">${statusLabels[row.status] || 'Unavailable'}</span></td><td>${number(row.calls)}</td><td>${number(row.failures)}</td><td>${row.successRate === null ? '—' : markedValue(row.successRate, row.unknown > 0, value => number(value, { maximumFractionDigits: 1 }) + '%')}</td><td>${row.lastUsed ? esc(skillDate.format(new Date(row.lastUsed))) : '—'}</td></tr>`;
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
    if (focusedRequest.requestPageDirection || focusedRequest.sessionPageDirection || focusedRequest.modelSessionPageDirection || focusedRequest.modelProjectPageDirection) {
      const key = focusedRequest.modelProjectPageDirection ? 'modelProjectPageDirection' : focusedRequest.modelSessionPageDirection ? 'modelSessionPageDirection' : focusedRequest.sessionPageDirection ? 'sessionPageDirection' : 'requestPageDirection';
      const paging = buttons.filter(b => b.dataset[key] && !b.disabled);
      (paging.find(b => b.dataset[key] === focusedRequest[key]) || paging[0] || buttons.find(b => b.dataset.requestId) || buttons.find(b => b.dataset.projectName === state.projectView?.project && b.dataset.projectName !== undefined) || $('group'))?.focus({ preventScroll: true });
    } else for (const key of ['requestModel', 'modelProject', 'requestSession', 'requestId', 'requestPage', 'modelSessionPage', 'modelProjectPage', 'projectName', 'projectSession']) {
      if (focusedRequest[key] !== undefined) (buttons.find(b => b.dataset[key] === focusedRequest[key]) || $('group'))?.focus({ preventScroll: true });
    }
  }
  const skills = report.skills;
  const unattributed = (skills.unattributedUses || 0) + (skills.unattributedFailures || 0), omitted = skills.omitted + (skills.omittedFailures || 0);
  const focusedSkill = document.activeElement?.dataset.skillId, focusedAction = document.activeElement?.dataset.skillAction;
  $('skills-summary').textContent = `${number(skills.invocations)} use${skills.invocations === 1 ? '' : 's'} · ${number(skills.failures ?? 0)} failure${skills.failures === 1 ? '' : 's'} · ${number(skills.sessions)} session${skills.sessions === 1 ? '' : 's'} · ${RANGE_LABELS[report.query.range]}${unattributed ? ` · ${number(unattributed)} included with provider unverified` : ''}${omitted ? ` · ${number(omitted)} excluded` : ''}`;
  $('skills-summary').title = 'Recorded skill loads in the selected dates, project, session and environment. Model filters do not apply. Reusing an already loaded skill may not create another activation. Recorded activity without billing receipts is included with provider unverified. VS Code skill loads are not currently imported.';
  if (state.skillView && !skills.rows.some(skill => skill.id === state.skillView)) state.skillView = null;
  $('skills').innerHTML = skills.rows.length ? skillTable(skills.rows) : '<p class="muted">No included skill activations or failed loads match these filters. See any exclusions above. VS Code skill loads are not currently imported; database-only history may lack activation events.</p>';
  if (focusedSkill) ([...$('skills').querySelectorAll('[data-skill-id]')].find(button => button.dataset.skillId === focusedSkill && button.dataset.skillAction === focusedAction) || $('skills-sort')).focus({ preventScroll: true });
  const coverage = [];
  if (unattributed) coverage.push(`${number(skills.unattributedUses || 0)} uses and ${number(skills.unattributedFailures || 0)} failures are recorded activity without verified billing-provider attribution. No charges are inferred.`);
  if (skills.omitted) coverage.push(`${number(skills.omitted)} skill uses omitted because their sessions contain rejected or mixed billing-provider evidence.`);
  if (skills.omittedFailures) coverage.push(`${number(skills.omittedFailures)} failed skill loads omitted because their sessions contain rejected or mixed billing-provider evidence.`);
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
const efficiencyValue = (row, metric) => markedValue(row[metric.key], row[metric.count] < row.requests, metric.format);
const efficiencyHint = (row, metric) => `${efficiencyValue(row, metric)} · ${number(row[metric.count])} of ${number(row.requests)} requests. ${metric.hint}`;
function renderEfficiencyFlow(s) {
  const total = (s.pairedInput || 0) + (s.pairedOutput || 0);
  const share = total > 0 ? s.pairedInput / total * 100 : null;
  $('efficiency-flow').innerHTML = share === null
    ? '<p class="muted">Input and output counts from the same requests are needed to show where tokens go. Try a wider range if these records are incomplete.</p>'
    : `<div class="efficiency-flow-heading"><strong>${markedValue(share, s.pairedRequests < s.requests, value => number(value) + '<span>%</span>')}</strong><div><h3>of measured tokens were input</h3><p class="muted">The model reads context on every request—not just the words you type.</p></div></div><div class="efficiency-track" role="img" aria-label="Input ${markedValue(share, s.pairedRequests < s.requests)} percent; output ${markedValue(100 - share, s.pairedRequests < s.requests)} percent"><span style="width:${share}%;background:var(--s1)"></span><span style="width:${100 - share}%;background:var(--s2)"></span></div><div class="efficiency-flow-labels"><span><i style="background:var(--s1)"></i>Input <b>${markedValue(s.pairedInput, s.pairedRequests < s.requests)}</b></span><span><i style="background:var(--s2)"></i>Output <b>${markedValue(s.pairedOutput, s.pairedRequests < s.requests)}</b></span></div><p class="footnote">Both counts recorded for ${number(s.pairedRequests)} of ${number(s.requests)} requests. Cached input is included; these are token volumes, not credit shares.</p>`;
  $('efficiency-cache').innerHTML = s.cacheHitRate == null
    ? `<strong>Cache reuse is not measurable here.</strong><p class="muted">${number(s.cacheRequests ?? 0)} of ${number(s.requests)} requests have a complete cache split. Missing cache detail is not zero reuse.</p>`
    : `<strong>${markedValue(s.cacheHitRate, s.cacheRequests < s.requests, value => number(value) + '%')} of measured input was reused from cache</strong><p class="muted">${markedValue(s.cacheRead, s.cacheRequests < s.requests)} of ${markedValue(s.cacheInput, s.cacheRequests < s.requests)} input tokens, across ${number(s.cacheRequests)} of ${number(s.requests)} requests. Cached context still counts as input, but can reduce processing and credit cost. Reuse is not a measure of answer quality.</p>`;
}

let efficiencyContextSnapshot;
$('efficiency-context-read').onclick = async () => {
  const button = $('efficiency-context-read');
  if (button.disabled) return;
  button.disabled = true;
  $('efficiency-context-result').innerHTML = '<p class="footnote integration-note">Inspecting current context…</p>';
  $('efficiency-context-history').innerHTML = '';
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
    renderEfficiencyContextHistory();
    return;
  }
  const parentLabels = new Map(c.entries.map(entry => [entry.id, entry.label]));
  const modelOrigin = c.modelSource === 'autoResolved' ? 'Auto-resolved model' : c.modelSource === 'selected' ? 'Selected model' : 'Model used for estimate';
  $('efficiency-context-result').innerHTML = `<div class="efficiency-context-total"><strong>${number(c.totalTokens)}</strong> tokens in current context${c.limit > 0 ? ` · ${number(c.totalTokens / c.limit * 100)}% of the ${number(c.limit)} allowance` : ''}</div><p class="footnote">Snapshot at ${esc(new Date(c.checkedAt).toLocaleString())}. ${c.modelId ? esc(modelOrigin + ': ' + c.modelId) + '. ' : ''}This stays fixed until you inspect again. Copilot's estimate may differ from billed tokens.</p>${renderEfficiencyContextPart('snapshot')}<details><summary>Largest attributed sources${c.omitted ? ` · showing ${number(c.entries.length)} of ${number(c.entries.length + c.omitted)}` : ''}</summary><p class="footnote integration-note">Parent and child sources can overlap. These rows are not added together. A loaded skill may still be useful even without a recent invocation.</p>${c.entries.length ? `<div class="table-wrap"><table class="context-sources"><thead><tr><th>Source</th><th>Type</th><th>Tokens</th><th>Of context</th><th>Included in</th></tr></thead><tbody>${c.entries.map(e => `<tr>${textCell(e.label || 'Unnamed source')}${textCell(e.kind || 'Other')}<td>${number(e.tokens)}</td><td>${c.totalTokens > 0 ? number(e.tokens / c.totalTokens * 100) + '%' : '—'}</td>${textCell(e.parentId ? parentLabels.get(e.parentId) || 'Parent source' : '—')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Copilot did not return individual sources.</p>'}</details>`;
  renderEfficiencyContextHistory();
}
function renderEfficiencyContextPart(contextPart) {
  return renderTokenTopic('context', state.report || {}, { number, showCoverage: !$('coverage').hidden, credits: creditNumber, context: efficiencyContextSnapshot, contextPart });
}
// The comparison with the selected history sits outside the snapshot's live region, so it can
// follow the filters without redrawing the snapshot or closing its source table.
function renderEfficiencyContextHistory() {
  $('efficiency-context-history').innerHTML = efficiencyContextSnapshot?.available ? renderEfficiencyContextPart('history') : '';
}
let reviewRunning = false, reviewConnectionPending = false, reviewRun, reviewResult, reviewResultFormat, reviewProgressTimer;
const reviewMotion = matchMedia('(prefers-reduced-motion: reduce)');
let reviewAnimationPaused = false, reviewAnimationTimes;
function reviewAnimationVisible() {
  return !$('review-progress').hidden && !$('content').hidden && state.view === 'efficiency' && !$('efficiency-review-panel').hidden;
}
function rememberReviewAnimation() {
  if (!reviewRunning || reviewMotion.matches || !reviewAnimationVisible()) return;
  // display:none destroys CSS clocks. Keep their positions before hiding an ancestor.
  reviewAnimationTimes = ($('review-desktop').getAnimations?.({ subtree: true }) || []).map(animation => {
    const duration = animation.effect?.getTiming().duration;
    const time = Number.isFinite(animation.currentTime) && duration > 0 ? animation.currentTime % duration : animation.currentTime;
    return { target: animation.effect?.target, name: animation.animationName, time };
  });
}
function syncReviewAnimation() {
  const progress = $('review-progress'), still = reviewMotion.matches;
  const visible = reviewAnimationVisible();
  progress.dataset.still = String(still);
  progress.dataset.paused = String(still || reviewAnimationPaused || !reviewRunning || reviewRun?.cancelled === true || document.hidden || !visible);
  if (still || !reviewRunning || progress.hidden) reviewAnimationTimes = null;
  else if (visible && reviewAnimationTimes) {
    for (const animation of $('review-desktop').getAnimations?.({ subtree: true }) || []) {
      const saved = reviewAnimationTimes.find(clock => clock.target === animation.effect?.target && clock.name === animation.animationName);
      if (Number.isFinite(saved?.time)) animation.currentTime = saved.time;
    }
    reviewAnimationTimes = null;
  }
  $('review-animation-toggle').hidden = still;
  $('review-animation-toggle').disabled = !reviewRunning || reviewRun?.cancelled === true;
  $('review-animation-toggle').textContent = reviewAnimationPaused ? 'Resume animation' : 'Pause animation';
}
reviewMotion.addEventListener?.('change', syncReviewAnimation);
$('review-animation-toggle').onclick = () => { reviewAnimationPaused = !reviewAnimationPaused; syncReviewAnimation(); };
$('review-desktop-record').addEventListener('animationiteration', event => {
  const progress = $('review-progress');
  if (event.animationName !== 'review-desktop-cycle' || progress.dataset.paused !== 'false') return;
  progress.dataset.scene = String((Number(progress.dataset.scene) + 1) % 4);
});
function reviewQuery() {
  const { range, startDate, endDate } = query();
  return { range, includeCache: true, ...(range === 'custom' ? { startDate, endDate } : {}) };
}
function syncReviewScope() {
  const active = state.view === 'efficiency' && !$('efficiency-review-panel').hidden;
  $('filters').hidden = $('environment').hidden = active;
  $('review-scope').textContent = RANGE_LABELS[state.range] + ' · all models, projects, sessions, and environments';
  syncReviewAnimation();
}
function reviewProgress(phase) {
  clearTimeout(reviewProgressTimer);
  $('review-progress').hidden = !phase;
  syncReviewAnimation();
  $('efficiency-review-status').setAttribute('class', phase ? 'sr-only' : 'footnote');
  if (!phase) return;
  const phrases = phase === 'prepare' ? ['Preparing your review', 'Gathering your usage statistics'] : ['Reviewing your usage', 'Looking for supported patterns', 'Weighing the evidence'];
  let index = 0;
  $('review-progress-message').textContent = phrases[0];
  $('efficiency-review-status').textContent = phase === 'prepare' ? 'Preparing your review. No prompt has been sent yet.' : 'Reviewing your usage with Copilot. You can cancel this review.';
  if (reviewMotion.matches) return;
  const tick = () => {
    if (!reviewRun || reviewRun.cancelled || reviewMotion.matches) return;
    if (!document.hidden) $('review-progress-message').textContent = phrases[++index % phrases.length];
    reviewProgressTimer = setTimeout(tick, 5000);
  };
  reviewProgressTimer = setTimeout(tick, 5000);
}
function renderReviewResult(force = false) {
  if (!reviewResult) return;
  $('review-result').hidden = false;
  const stale = reviewResult.filterKey !== JSON.stringify(reviewQuery());
  $('review-result-context').textContent = 'Last completed review: ' + reviewResultCaption(reviewResult, stale, { number, credits: creditNumber });
  const followUpNotice = { failed: 'The prompt-excerpt follow-up failed; showing the initial statistical findings.', 'timed-out': 'The prompt-excerpt follow-up timed out; showing the initial statistical findings.', cancelled: 'The prompt-excerpt follow-up was cancelled; showing the initial statistical findings.', unavailable: 'Requested prompt excerpts were unavailable; showing statistical findings.' }[reviewResult.enrichment];
  $('review-result-note').textContent = [stale ? 'This review uses a previous date range. Create another review to update it.' : '', followUpNotice].filter(Boolean).join(' ');
  $('review-result-note').hidden = !$('review-result-note').textContent;
  if (force || reviewResultFormat !== state.simplifyNumbers) {
    const open = [...$('review-answer').querySelectorAll('details[open]')].map(node => [...node.parentElement.children].indexOf(node));
    $('review-answer').innerHTML = renderReviewCards(reviewResult, { number, credits: creditNumber });
    const cards = $('review-answer').querySelectorAll('details');
    for (const index of open) if (cards[index]) cards[index].open = true;
    reviewResultFormat = state.simplifyNumbers;
  }
}
$('efficiency-development-dismiss').onclick = () => { $('efficiency-development').hidden = true; };
$('efficiency-review-open').onclick = async () => {
  if (!state.report || historyLoading || reviewRunning || reviewConnectionPending) return;
  const run = reviewRun = { cancelled: false, cancellation: null, analysisStarted: false };
  const filters = reviewQuery();
  reviewRunning = true;
  reviewAnimationTimes = null;
  reviewAnimationPaused = false;
  $('review-progress').dataset.scene = '0';
  if (!reviewResult) {
    $('efficiency-review-output').value = '';
    $('review-preview').hidden = true;
  }
  $('review-samples').disabled = $('review-settings').disabled = $('efficiency-review-copy').disabled = $('efficiency-review-open').disabled = true;
  $('review-cancel').hidden = false; $('review-cancel').disabled = false;
  $('review-send-model').textContent = 'Checking selected model and reasoning…';
  reviewProgress('prepare');
  try {
    const snapshot = await request('review.prepare', { filters });
    if (run.cancelled) return;
    $('efficiency-review-output').value = snapshot.preview;
    $('review-preview').hidden = false;
    $('review-reference-status').textContent = snapshot.referenceStatus || 'Statistics-only review: model reference unavailable.';
    $('review-send-model').textContent = snapshot.model ? snapshot.model + ' · ' + (snapshot.reasoningEffort === 'default' ? 'Model default' : snapshot.reasoningEffort) + ' reasoning' : 'Choose and save a Copilot model in Settings first.';
    if (!snapshot.hasEvidence || !snapshot.model) {
      $('efficiency-review-status').textContent = !snapshot.hasEvidence ? 'No eligible evidence in this date range. Choose another date range before creating a review.' : 'Use the settings gear to choose a Copilot model, then create your review.';
      return;
    }
    reviewProgress('analyze');
    run.analysisStarted = true;
    const result = await request('review.analyze', { snapshotId: snapshot.id, expectedModel: snapshot.model, expectedReasoning: snapshot.reasoningEffort, allowSamples: snapshot.allowSamples === true });
    if (run.cancelled) return;
    reviewResult = { ...result, scope: result.scope || snapshot.scope, filterKey: JSON.stringify(filters), reasoningEffort: result.reasoningEffort || snapshot.reasoningEffort };
    renderReviewResult(true);
    $('efficiency-review-open').dataset.attention = 'false';
    $('review-create-label').textContent = 'Create another review';
    $('efficiency-review-status').textContent = '';
    if (state.view === 'efficiency' && !$('efficiency-review-panel').hidden) $('review-answer').focus();
  } catch (error) { if (!run.cancelled) $('efficiency-review-status').textContent = error.message; }
  finally {
    // A late cancellation must finish before a new review can start.
    await run.cancellation;
    if (run.cancelled) $('efficiency-review-status').textContent = run.cancelFailed ? 'Could not confirm cancellation. Closing the dashboard stops its helper.' : 'Review cancelled. Any usage already incurred is still recorded.';
    const restoreAnimationFocus = $('review-progress').contains(document.activeElement);
    reviewProgress(null);
    reviewRun = null; reviewRunning = false;
    $('review-samples').disabled = $('review-settings').disabled = $('efficiency-review-copy').disabled = $('efficiency-review-open').disabled = false;
    $('review-cancel').hidden = true;
    if (restoreAnimationFocus) $('efficiency-review-open').focus({ preventScroll: true });
    if (run.analysisStarted) await load(false, true);
  }
};
$('logs-download').onclick = () => {
  let url, link;
  try {
    const markdown = `# Usage Insights diagnostic logs\n\n\`\`\`text\n${$('logs-output').value}\n\`\`\`\n`;
    url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    link = document.createElement('a');
    link.href = url;
    link.download = `usage-insights-v${BUILD_VERSION}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    $('logs-status').textContent = 'Download requested. Check Downloads, or the save location chosen by your browser.';
  } catch (error) {
    clientDiagnostics.record('warn', 'diagnostics.download', diagnosticError(error));
    $('logs-status').textContent = 'Could not start the download. Use Copy logs instead.';
  } finally {
    link?.remove();
    // Give the download time to consume the URL before releasing its memory.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
async function cancelReview() {
  if (reviewRun) {
    const run = reviewRun;
    run.cancelled = true;
    syncReviewAnimation();
    clearTimeout(reviewProgressTimer);
    $('review-cancel').disabled = true;
    $('review-progress-message').textContent = 'Stopping your review';
    $('efficiency-review-status').textContent = 'Stopping your review…';
    run.cancellation ||= request('review.cancel').catch(() => { run.cancelFailed = true; });
    return run.cancellation;
  }
  if (reviewConnectionPending) {
    try { await request('review.cancel'); }
    catch { $('review-connection-status').textContent = 'Could not confirm cancellation. Closing the dashboard stops its helper.'; }
  }
}
$('review-cancel').onclick = cancelReview;
$('review-connection-cancel').onclick = cancelReview;
$('review-settings').onclick = async () => { await $('settings-open').onclick(); if ($('settings-dialog').open) $('review-model').focus(); };
$('efficiency-review-copy').onclick = async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText($('efficiency-review-output').value);
    $('efficiency-review-status').textContent = 'Copied the statistics snapshot.';
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
let conversationTopic = 'interaction', conversationExamplesOpen = false, conversationExampleIndex = 0, conversationBucketSelection = null;
function renderEfficiencyHabits() {
  const root = $('efficiency-conversations'), focus = document.activeElement?.id;
  const open = [...root.querySelectorAll('details[open]')].map(d => d.id);
  root.innerHTML = renderConversations(state.report?.efficiency?.conversations, { number, topic: conversationTopic,
    loading: !!historyLoading, examplesOpen: conversationExamplesOpen, exampleIndex: conversationExampleIndex,
    bucket: conversationBucketSelection, interactions: state.report?.efficiency?.interactions });
  for (const id of open) { const detail = $(id); if (detail) detail.open = true; }
  for (const id of CONVERSATION_TOPICS) $('conversation-tab-' + id).setAttribute('aria-pressed', String(id === conversationTopic));
  if (focus?.startsWith('conversation-')) $(focus)?.focus({ preventScroll: true });
}
function selectConversationTopic(topic) {
  if (!CONVERSATION_TOPICS.includes(topic) || topic === conversationTopic) return;
  conversationTopic = topic; conversationBucketSelection = null; conversationExampleIndex = 0; conversationExamplesOpen = false;
  renderEfficiencyHabits();
}
$('conversation-topics').onclick = event => {
  const topic = event.target.closest('[data-conversation-topic]')?.dataset.conversationTopic;
  if (topic) selectConversationTopic(topic);
};
$('conversation-topics').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const focused = event.target?.closest('[data-conversation-topic]')?.dataset.conversationTopic;
  const index = CONVERSATION_TOPICS.indexOf(CONVERSATION_TOPICS.includes(focused) ? focused : conversationTopic);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : Math.max(0, Math.min(3, index + (event.key === 'ArrowRight' ? 1 : -1)));
  event.preventDefault(); selectConversationTopic(CONVERSATION_TOPICS[next]);
  $('conversation-tab-' + CONVERSATION_TOPICS[next]).focus({ preventScroll: true });
};
$('efficiency-conversations').onclick = event => {
  const button = event.target.closest('button');
  if (!button) return;
  const data = button.dataset;
  if (data.conversationBucket !== undefined) {
    const bucket = Number(data.conversationBucket);
    if (!Number.isInteger(bucket) || bucket < 0 || bucket > (conversationTopic === 'returning' ? 2 : 3)) return;
    conversationBucketSelection = conversationBucketSelection === bucket ? null : bucket;
    conversationExamplesOpen = true; conversationExampleIndex = 0;
  } else if (data.conversationExample !== undefined) {
    conversationExampleIndex = Number(data.conversationExample);
  } else if (data.conversationExplore !== undefined) {
    conversationExamplesOpen = !conversationExamplesOpen; conversationBucketSelection = null;
  } else if (data.conversationClear !== undefined) conversationBucketSelection = null;
  else if (data.conversationClose !== undefined) conversationExamplesOpen = false;
  else return;
  renderEfficiencyHabits();
  if (data.conversationClose !== undefined || data.conversationClear !== undefined) $('conversation-explore')?.focus({ preventScroll: true });
};
function renderEfficiencyReliability() {
  const report = state.report, rows = toolOutcomeSummary(report.tools), habits = report.efficiency.interactions;
  const failed = (report.tools?.rows || []).filter(row => row.failures > 0).sort((a, b) => b.failures - a.failures).slice(0, 5);
  $('efficiency-reliability').innerHTML = rows.some(row => row.calls)
    ? `<div class="table-wrap"><table class="efficiency-outcomes"><thead><tr><th>Tools</th><th>Calls</th><th>Succeeded</th><th>Failed</th><th>Unknown</th><th>Success rate</th></tr></thead><tbody>${rows.map(row => `<tr>${textCell(row.name)}<td>${number(row.calls)}</td><td>${number(row.successes)}</td><td>${number(row.failures)}</td><td>${number(row.unknown)}</td><td>${row.successRate == null ? 'Unavailable' : markedValue(row.successRate, row.unknown > 0, value => number(value, { maximumFractionDigits: 1 }) + '%')}</td></tr>`).join('')}</tbody></table></div><p class="footnote">Success rate uses only known outcomes. Calls follow the date and usage filters.</p>${failed.length ? `<details><summary>Tools with the most recorded failures</summary><ul>${failed.map(row => `<li>${esc(row.server ? row.server + ' / ' + (row.mcpTool || row.name) : row.name)}: ${number(row.failures)} failures in ${number(row.calls)} calls</li>`).join('')}</ul></details>` : ''}`
    : '<p class="muted">No matching tool execution records. Missing records do not mean no tools were used.</p>';
  $('efficiency-reliability').innerHTML += habits?.reason === 'model-filter'
    ? '<p class="footnote">Session error counts are unavailable under a model filter.</p>'
    : habits?.observedSessions ? `<p class="footnote">${number(habits.sessionErrors)} recorded root-session error events. These are incidents, not a count of failed model requests.</p>` : '';
}
function showEfficiencySection(section) {
  if (!['tokens', 'patterns', 'review'].includes(section)) return;
  if (section !== 'review') rememberReviewAnimation();
  selectButton('efficiency-sections', 'efficiencySection', section);
  $('efficiency-method').hidden = section === 'review';
  for (const name of ['tokens', 'patterns', 'review']) $(`efficiency-${name}-panel`).hidden = name !== section;
  syncReviewScope();
}
$('efficiency-sections').onclick = event => showEfficiencySection(event.target.dataset.efficiencySection);
let tokenTopic = 'overview';
const tokenPanelNames = ['overview', 'context', 'cache', 'detail'];
function createTopicExplorer(prefix, rangeId, topics, initial, onSelect) {
  let selected = initial;
  const lens = $(rangeId), stops = $(`${prefix}-topic-stops`), nodes = $(`${prefix}-track-nodes`);
  lens.max = String(topics.length - 1);
  $(`${prefix}-track-inner`).style.setProperty('--token-topic-count', topics.length);
  nodes.innerHTML = topics.map(topic => `<span data-${prefix}-node="${topic.id}"></span>`).join('');
  stops.innerHTML = topics.map(topic => `<button data-${prefix}-stop="${topic.id}" title="${esc(topic.label)}" aria-label="${esc(topic.label)}" aria-controls="${prefix}-topic-content">${tokenTopicIcon(topic)}</button>`).join('');
  function sync() {
    const index = topics.findIndex(topic => topic.id === selected), topic = topics[index];
    lens.value = String(index);
    lens.title = topic.label;
    lens.style.setProperty('--lens-icon', `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(topic, true))}")`);
    lens.setAttribute('aria-valuetext', `${topic.label}, section ${index + 1} of ${topics.length}`);
    for (const button of stops.querySelectorAll(`[data-${prefix}-stop]`)) button.setAttribute('aria-current', String(button.dataset[`${prefix}Stop`] === selected));
    for (const node of nodes.querySelectorAll(`[data-${prefix}-node]`)) node.classList.toggle('current', node.dataset[`${prefix}Node`] === selected);
    $(`${prefix}-topic-position`).textContent = `${topic.group || (prefix === 'token' ? 'Summary' : 'Patterns')} · ${index + 1} of ${topics.length}`;
    $(`${prefix}-selected-title`).textContent = topic.label;
    $(`${prefix}-topic-prev`).disabled = index === 0;
    $(`${prefix}-topic-next`).disabled = index === topics.length - 1;
  }
  function select(id, announce = false) {
    const topic = topics.find(topic => topic.id === id);
    if (!topic || selected === id) return;
    selected = id;
    sync();
    // Keep short panels from shrinking the document past the current viewport during navigation.
    const content = $(`${prefix}-topic-content`);
    content.style.minHeight = `${Math.max(0, (document.documentElement.clientHeight || innerHeight) - Math.max(0, content.getBoundingClientRect().top))}px`;
    onSelect(id);
    if (announce) $(`${prefix}-topic-announcement`).textContent = `Showing ${topic.label}`;
  }
  lens.oninput = () => select(topics[Number(lens.value)]?.id);
  lens.onkeydown = event => {
    const index = topics.findIndex(topic => topic.id === selected);
    const keys = { ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1, Home: 0, End: topics.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(topics[Math.max(0, Math.min(topics.length - 1, keys[event.key]))].id);
  };
  stops.onclick = event => select(event.target.closest(`[data-${prefix}-stop]`)?.dataset[`${prefix}Stop`], true);
  for (const [direction, step] of [['prev', -1], ['next', 1]]) {
    const button = $(`${prefix}-topic-${direction}`);
    button.onclick = () => {
      const focused = document.activeElement === button;
      const index = topics.findIndex(topic => topic.id === selected);
      select(topics[index + step]?.id, true);
      if (button.disabled && focused) lens.focus({ preventScroll: true });
    };
  }
  sync();
  return select;
}
const showTokenTopic = createTopicExplorer('token', 'efficiency-topic', TOKEN_TOPICS, tokenTopic, id => {
  tokenTopic = id;
  renderSelectedTokenTopic();
});
function renderSelectedTokenTopic() {
  const contextFocused = document.activeElement?.dataset.tokenContext === 'true';
  const panel = tokenPanelNames.includes(tokenTopic) ? tokenTopic : 'detail';
  for (const name of tokenPanelNames) $(`token-${name}-panel`).hidden = name !== panel;
  if (panel !== 'detail') {
    if (panel === 'overview') $('token-overview-insight').innerHTML = renderTokenTopic('overview', state.report || {}, { number, showCoverage: !$('coverage').hidden, credits: creditNumber, context: efficiencyContextSnapshot });
    if (panel === 'cache') $('token-cache-detail').innerHTML = renderTokenTopic('cache', state.report || {}, { number, showCoverage: !$('coverage').hidden, credits: creditNumber });
    if (contextFocused) $('efficiency-topic').focus({ preventScroll: true });
    return;
  }
  const topic = TOKEN_TOPICS.find(item => item.id === tokenTopic);
  $('token-topic-title').textContent = topic.label;
  $('token-topic-question').textContent = topic.question;
  $('token-topic-scope').textContent = ['tools', 'results', 'skills'].includes(tokenTopic) ? 'Selected history + current conversation snapshot' : 'Selected history · current filters';
  $('token-topic-body').innerHTML = renderTokenTopic(tokenTopic, state.report || {}, { number, showCoverage: !$('coverage').hidden, credits: creditNumber, context: efficiencyContextSnapshot });
  if (contextFocused) ($('token-topic-body').querySelector('[data-token-context]') || $('efficiency-topic')).focus({ preventScroll: true });
}
let growthMode = 'input', growthPattern = '', growthSession = '', growthPrompt = 1;
function growthOptions() { return { number, width: $('efficiency-growth').clientWidth, mode: growthMode, pattern: growthPattern,
  sessionKey: growthSession, prompt: growthPrompt, loading: !!historyLoading }; }
function renderEfficiencyGrowth() {
  const report = state.report, data = report?.efficiency?.contextGrowth, root = $('efficiency-growth');
  const focus = document.activeElement?.id, open = [...root.querySelectorAll('details[open]')].map(d => d.id);
  const example = data?.examples.find(e => e.key === growthSession);
  if (!example) growthSession = ''; else growthPrompt = Math.min(growthPrompt, example.points.length);
  if (growthPattern && !data?.patterns[growthPattern]?.sessions) growthPattern = '';
  for (const [id, label, values] of [['project', 'projects', report?.options.projects], ['model', 'models', report?.options.models]]) {
    const select = $('growth-' + id);
    select.innerHTML = `<option value="">All ${label}</option>` + (values || []).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    select.value = $(id).value;
  }
  root.innerHTML = renderContextGrowth(data, growthOptions());
  for (const id of open) { const detail = document.getElementById(id); if (detail) detail.open = true; }
  if (focus?.startsWith('growth-')) document.getElementById(focus)?.focus({ preventScroll: true });
}
for (const id of ['project', 'model']) $('growth-' + id).onchange = event => {
  $(id).value = event.target.value; growthSession = ''; growthPattern = ''; return load();
};
$('efficiency-growth').onclick = event => {
  const button = event.target.closest('button'), data = button?.dataset;
  if (!data || button.disabled) return;
  if (['input', 'change'].includes(data.growthMode)) growthMode = data.growthMode;
  else if (Object.hasOwn(CONTEXT_SHAPES, data.growthPattern)) { growthPattern = growthPattern === data.growthPattern ? '' : data.growthPattern; growthSession = ''; }
  else return;
  renderEfficiencyGrowth();
};
$('efficiency-growth').onchange = event => {
  if (event.target.id !== 'growth-session') return;
  growthSession = event.target.value; growthPrompt = 1; growthPattern = ''; renderEfficiencyGrowth();
};
$('efficiency-growth').oninput = event => {
  if (event.target.id !== 'growth-prompt') return;
  const data = state.report?.efficiency?.contextGrowth, example = data?.examples.find(e => e.key === growthSession), value = Number(event.target.value);
  if (!example || !Number.isInteger(value) || value < 1 || value > example.points.length) return;
  growthPrompt = value;
  // Keep the native range mounted while dragging or using its keyboard controls.
  $('growth-plot').innerHTML = contextGrowthChart(data, growthOptions());
  const text = contextGrowthPrompt(data, growthOptions());
  $('growth-prompt-readout').textContent = text; event.target.setAttribute('aria-valuetext', text);
};
let patternTopic = 'findings';
const patternPanelNames = ['findings', 'habits', 'growth', 'recovery', 'models', 'detail'];
const showPatternTopic = createTopicExplorer('pattern', 'efficiency-pattern-topic', PATTERN_TOPICS, patternTopic, id => {
  patternTopic = id;
  renderSelectedPatternTopic();
});
function renderSelectedPatternTopic() {
  const panel = patternPanelNames.includes(patternTopic) ? patternTopic : 'detail';
  for (const name of patternPanelNames) $(`pattern-${name}-panel`).hidden = name !== panel;
  if (panel === 'growth') renderEfficiencyGrowth();
  if (panel !== 'detail') return;
  const topic = PATTERN_TOPICS.find(item => item.id === patternTopic);
  $('pattern-topic-title').textContent = topic.label;
  $('pattern-topic-question').textContent = topic.question;
  $('pattern-topic-scope').textContent = patternTopic === 'growth' ? 'Selected history · current filters' : 'Measurement not available yet';
  $('pattern-topic-body').innerHTML = renderTokenTopic(patternTopic, state.report || {}, { number, showCoverage: !$('coverage').hidden, credits: creditNumber });
}
function openTokenContext() {
  showEfficiencySection('tokens');
  showTokenTopic('context');
  $('efficiency-context-read').focus({ preventScroll: false });
}
$('token-detail-panel').onclick = event => {
  // A spend-driver row opens its session in Breakdown. The model filter stays as the user set it.
  const row = event.target.closest('[data-token-session]')?.dataset;
  if (row?.tokenSession !== undefined && row.tokenProject !== undefined) return inspectEfficiency({ project: row.tokenProject, session: row.tokenSession });
  if (event.target.closest('[data-token-context]')) openTokenContext();
};
$('token-overview-panel').onclick = event => {
  const topic = event.target.closest('[data-token-jump]')?.dataset.tokenJump;
  if (!topic) return;
  showTokenTopic(topic, true);
  $('efficiency-topic').focus({ preventScroll: true });
};
function renderEfficiency() {
  renderReviewResult();
  const efficiency = state.report?.efficiency;
  if (!efficiency) return;
  const { summary, models, insights } = efficiency;
  for (const [id, value] of [['efficiency-cache-minimum', 50000], ['efficiency-growth-minimum', 10000], ['efficiency-tools-minimum', 1000]]) $(id).textContent = number(value);
  const failedServer = (state.report.mcp?.rows || []).filter(s => s.failures >= 3).sort((a, b) => b.failures - a.failures)[0];
  const focused = document.activeElement?.dataset;
  renderEfficiencyFlow(summary);
  renderEfficiencyHabits();
  renderEfficiencyReliability();
  if (!$('efficiency-context-read').disabled) renderEfficiencyContextHistory();
  renderSelectedTokenTopic();
  renderSelectedPatternTopic();
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
  if (target.model !== undefined) $('model').value = target.model;
  if (target.project !== undefined) $('project').value = target.project;
  if (target.session !== undefined) {
    options('session', (state.report?.options.sessions || []).filter(v => v.id === target.session), 'All sessions');
    $('session').value = target.session;
  }
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
  $('updated').textContent = r.loading ? 'Recent usage so far. Older history is loading in the background.' : `Updated ${new Date(r.scannedAt || r.generatedAt).toLocaleTimeString()}. Refreshes every 15 minutes while visible.`;
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
  const focusedDay = $('daily').contains(document.activeElement) ? document.activeElement.dataset.day : null;
  const focusedChoice = document.activeElement?.dataset;
  const selected = r.daily.find(d => d.day === state.selectedDay);
  if (!selected) state.selectedDay = null;
  const scope = selected || t;
  const scopeDate = selected ? new Date(selected.day + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const keys = r.query.includeCache ? [...TOKEN_KEYS, 'unclassifiedInput'] : ['input', 'output'];
  options('environment', r.options.environments || [], 'All environments');
  options('model', r.options.models, 'All models'); options('project', r.options.projects, 'All projects'); renderSessionChoices();
  renderLoadStatus();
  const filterPosition = state.view === 'efficiency' && !$('content').hidden ? $('efficiency-tokens-panel') : $('status');
  if ($('filters').nextElementSibling !== filterPosition) filterPosition.before($('filters'));
  syncReviewScope();
  const p = r.promptCredits, promptIncomplete = p.eligiblePrompts < p.prompts || p.unlinkedRequests > 0;
  const warnings = [];
  if (t.missingCredits) warnings.push(`${number(t.missingCredits)} requests have unavailable AI credits`);
  if (t.partialCredits) warnings.push(`${number(t.partialCredits)} requests have partial credit charges`);
  if (t.missingTokens) warnings.push(`${number(t.missingTokens)} requests have incomplete token counts`);
  const unexpectedPrompts = p.prompts - p.eligiblePrompts - (p.coverage?.cancelledPrompts || 0) - (p.coverage?.interruptedPrompts || 0);
  const unexpectedCalls = p.unlinkedRequests - (p.coverage?.pluginCalls || 0) - (p.coverage?.compactionCalls || 0);
  if (unexpectedPrompts > 0) warnings.push(`${number(unexpectedPrompts)} prompts have unresolved cost coverage and are excluded from averages`);
  if (unexpectedCalls > 0) warnings.push(`${number(unexpectedCalls)} model calls could not be linked to user prompts`);
  if (p.work?.tokenPrompts > 0 && p.work.tokenPrompts < p.eligiblePrompts) warnings.push('Some eligible prompts have incomplete token counts across their linked calls');
  const relevantCoverage = r.coverageDetails?.counts || {};
  if (relevantCoverage.unclassified) warnings.push(`${number(relevantCoverage.unclassified)} records lack Copilot attribution and were excluded`);
  if (relevantCoverage.invalid) warnings.push(`${number(relevantCoverage.invalid)} malformed records were skipped`);
  if (relevantCoverage.invalidSkills) warnings.push(`${number(relevantCoverage.invalidSkills)} malformed skill events were skipped`);
  if (relevantCoverage.invalidTools) warnings.push(`${number(relevantCoverage.invalidTools)} malformed tool events were skipped`);
  if (relevantCoverage.aggregateOnly) warnings.push(`${number(relevantCoverage.aggregateOnly)} sessions have summary totals only and are not counted`);
  if (r.coverageDetails?.unreadable.some(source => source.failed)) warnings.push('Some enabled data sources could not be fully read; their affected dates are unknown');
  const coverageMessage = warnings.join('. ') + (warnings.length ? '. Totals include known amounts only; * marks incomplete coverage.' : '');
  $('coverage-message').textContent = coverageMessage;
  $('coverage').hidden = !!r.loading || !warnings.length || coverageMessage === dismissedCoverage;
  if ($('coverage-dialog').open) renderCoverageReview();
  renderHeaderCredits();
  const rateValue = (value, samples, total = t.requests) => markedValue(value, samples < total, creditNumber);
  const creditSamples = count => `${number(count)} of ${number(t.requests)} requests`;
  const cacheContext = r.query.includeCache ? 'including cache' : 'excluding cache';
  const promptCoverage = `${number(p.eligiblePrompts)} of ${number(p.prompts)} prompts`;
  $('prompt-coverage-note').hidden = !!r.loading || p.eligiblePrompts === p.prompts && !p.unlinkedRequests;
  $('prompt-coverage-note').textContent = `${!$('coverage').hidden ? '* ' : ''}AI credits / prompt: ${promptCoverage} have complete, attributable costs. Excluded: ${number(p.excluded.attribution)} uncertain attribution, ${number(p.excluded.accounting)} incomplete charges, ${number(p.excluded.unfinished)} unfinished work. ${number(p.unlinkedRequests)} model calls could not be linked to prompts. Local logs cannot establish work they never recorded.`;
  const promptHint = `Complete recorded AI credits for initial calls, agent continuations and reliably linked subagents, divided by eligible user prompts. ${promptCoverage} eligible. Prompts are dated by submission; all linked work is grouped before filters. ${p.modelFiltered ? 'Selected-model contribution only, per eligible prompt using the selected models; whole-prompt accounting must still be complete. ' : ''}Excluded: ${number(p.excluded.attribution)} uncertain attribution, ${number(p.excluded.accounting)} incomplete charges, ${number(p.excluded.unfinished)} unfinished work. ${number(p.unlinkedRequests)} requests could not be linked to prompts. Unlinked ordinary calls make prompt attribution uncertain for their journal session. Conversation-compaction costs count in totals but are not assigned to individual prompts. Local logs cannot establish work they never recorded.`;
  const tiles = [
    ['AI credits', creditLabel(t), 'Recorded Copilot charges', 'credits'],
    ['Tokens', recordedValue(t, 'total', number), RANGE_LABELS[r.query.range], 'tokens'],
    ['AI credits / prompt', p.pending ? 'Loading…' : markedValue(p.averageCredits, promptIncomplete, creditNumber), p.pending ? 'Verifying linked calls' : `${number(p.eligiblePrompts)} prompts${p.modelFiltered ? ' · selected-model contribution' : ''}`, 'credits', p.pending ? 'Waiting for complete history to reconcile prompt costs.' : promptHint],
    ['AI credit / 1M tokens', rateValue(t.creditsPerMillionTokens, t.creditTokenRequests), 'input + output + cache', 'credits',
      `Recorded credits divided by input + output tokens, ${cacheContext}, multiplied by 1,000,000. Only requests with complete charges and token counts are included (${creditSamples(t.creditTokenRequests)}). Unavailable when there are no eligible tokens.`],
  ];
  $('tiles').innerHTML = tiles.map(([label, value, sub, measure, title]) => `<div class="tile"><span class="label">${esc(label)}</span><strong class="value"${measure ? ` data-measure="${measure}"` : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(value)}</strong><span class="sub">${esc(sub)}</span></div>`).join('');
  renderBanner(r);
  if (state.view === 'usage') {
    $('token-title').textContent = (selected ? `Tokens on ${scopeDate}` : 'Total tokens') + (r.query.includeCache ? '' : ' excluding cache');
    $('token-total').textContent = recordedValue(scope, 'total', number);
    $('token-total').title = recordedValue(scope, 'total', number);
    $('token-context').textContent = `${number(scope.sessions)} sessions · ${number(scope.requests)} requests through GitHub Copilot`;
    $('token-types-title').textContent = `Tokens by type · ${scopeDate || 'all days'}`;
    $('all-days').hidden = !selected;
    const stats = [['Input (including cache)', 'inputTotal'], ['Output', 'output'], ['Uncached input', 'input'], ['Cache read', 'cacheRead'], ['Cache write', 'cacheWrite']];
    const cacheRate = scope.missingCache ? 'Unavailable' : scope.inputTotal ? `${number(scope.cacheRead / scope.inputTotal * 100)}%` : '—';
    $('token-stats').innerHTML = stats.map(([label, key]) => `<div><dt>${label}</dt><dd title="${esc(recordedValue(scope, key, number))}">${esc(recordedValue(scope, key, number))}</dd></div>`).join('') + `<div><dt>Cache hit rate</dt><dd>${cacheRate}</dd></div>`;
    $('token-note').textContent = 'Input includes cache reads and writes. Cache hit rate is the share of input read from cache. Percentages show shares of recorded tokens.' + (r.query.includeCache ? '' : ' Cache is excluded from totals and charts; the individual counts above remain visible.');
    $('daily-title').textContent = credits ? 'Daily AI credits' : 'Daily tokens';
    $('daily-caption').textContent = `${r.daily[0]?.day || ''} — ${r.daily.at(-1)?.day || ''} · local time`;
    const width = Math.max(280, $('daily').clientWidth);
    const unavailable = t.requests && (credits ? t.credits === null : t.knownTokenRequests === 0);
    $('daily').innerHTML = unavailable ? `<p class="muted">${credits ? 'Credit charges' : 'Token counts'} are unavailable for these requests.</p>` : stackedBars(r.daily, { width, height: 230, keys: credits ? ['credits'] : keys, colors, labels, fmt: credits ? creditNumber : number, selectable: true, selectedDay: state.selectedDay, textScale, showCoverage: !$('coverage').hidden });
    const legendKeys = credits ? ['credits'] : keys.filter(k => t[k] > 0);
    $('legend').innerHTML = legendKeys.map(k => `<span><i style="background:${colors[k]}"></i>${labels[k]}</span>`).join('');
    $('calendar').innerHTML = r.loading ? '<p class="muted">Activity history is loading…</p>' : calendarHeatmap(r.calendar, { fmt: number, showCoverage: !$('coverage').hidden });
    $('rhythm').innerHTML = punchCard(r.rhythm, { fmt: number });
    $('activity-expand').disabled = !!r.loading;
    const typeKeys = r.query.includeCache ? ['input', 'cacheRead', 'cacheWrite', 'unclassifiedInput', 'output'] : ['input', 'output'];
    const segments = typeKeys.filter(k => scope[k] > 0).map(k => ({ label: labels[k], value: scope[k], color: colors[k], note: recordedValue(scope, k), incomplete: !$('coverage').hidden && !!(scope.missingTokens || scope.missing?.[k]) }));
    $('token-bar').innerHTML = segmentBar(segments, { width: Math.max(280, $('token-bar').clientWidth), textScale });
    $('token-legend').innerHTML = typeKeys.filter(k => k !== 'unclassifiedInput' || scope[k] > 0).map(k => `<span title="${esc(recordedValue(scope, k, number))}"><i style="background:${colors[k]}"></i>${labels[k]} <b>${esc(recordedValue(scope, k, number))}</b></span>`).join('');
    // Model bars always show tokens; the credit selector controls the daily chart.
    $('models-summary').innerHTML = hBars(visibleChoices(r.usageChoices.models, $('model').value, 8, $('models-sort').value).map(m => ({ label: m.name, value: m.total, note: recordedValue(m, 'total', number) })), { width: Math.max(280, $('models-summary').clientWidth), textScale, selectable: true, selectedLabel: $('model').value });
    $('projects-summary').innerHTML = table(visibleChoices(r.usageChoices.projects, $('project').value, 10, $('projects-sort').value), 'Project', false, 'projectFilter');
    $('models-selection').textContent = $('model').value ? 'Model filter on · bars show tokens' : 'Top 8 · bars show tokens';
    $('projects-selection').textContent = $('project').value ? 'Project filter on · select again to clear' : 'Top 10 · select to filter';
  }
  renderActivityExplorer();
  $('sources').innerHTML = r.sources.map(s => `<div class="source ${esc(s.state)}"><code>${esc(s.path)}</code><p>${esc(s.state)} · ${number(s.records ?? 0)} requests · ${number(s.files ?? 0)} session logs${s.message ? ` · ${esc(s.message)}` : ''}</p></div>`).join('');
  renderUpdated(r);
  if (state.view === 'breakdown') renderBreakdown();
  if (state.view === 'efficiency') renderEfficiency();
  $('efficiency-review-open').disabled = !!r.loading || reviewRunning || reviewConnectionPending;
  if (state.view === 'usage') {
    if (focusedDay) $('daily').querySelector(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true });
    for (const type of ['model', 'project']) {
      const key = type === 'model' ? 'usageModel' : 'usageProject';
      if (focusedChoice?.[key] !== undefined) [...$(`${type}s-summary`).querySelectorAll(`[data-usage-${type}]`)].find(el => el.dataset[key] === focusedChoice[key])?.focus({ preventScroll: true });
    }
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

let activityKind, activitySelection;
const activityDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const activityDate = day => new Date(day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const activityStats = rows => rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
function activityIndex() {
  return activityKind === 'calendar' ? state.report.calendar.findIndex(day => day.day === activitySelection) : activitySelection;
}
function openActivity(kind) {
  if (!state.report || kind === 'calendar' && state.report.loading || $('activity-dialog').open) return;
  activityKind = kind;
  const r = state.report;
  activitySelection = kind === 'calendar' ? (r.calendar.findLast(day => day.requests > 0) || r.calendar.at(-1))?.day
    : r.rhythm.reduce((best, value, i) => value > r.rhythm[best] ? i : best, 0);
  $('tip').hidden = true;
  $('activity-dialog').showModal();
  renderActivityExplorer();
}
function renderActivityExplorer() {
  const r = state.report;
  if (!$('activity-dialog').open || !r) return;
  const calendar = activityKind === 'calendar', focused = document.activeElement?.dataset?.inspect;
  if (calendar && r.loading) { $('activity-dialog').close(); return; }
  if (calendar && activityIndex() < 0) activitySelection = r.calendar.at(-1)?.day;
  $('activity-title').textContent = calendar ? 'Activity' : 'When you work';
  $('activity-caption').textContent = calendar
    ? `${r.calendar[0]?.day || ''} — ${r.calendar.at(-1)?.day || ''} · 26 weeks · current model, project, session and environment filters; independent of the date dropdown.`
    : `${r.daily[0]?.day || ''} — ${r.daily.at(-1)?.day || ''} · local time · current filters${r.loading ? ' · recent usage so far; history is still loading' : ''}`;
  if (calendar) {
    const active = r.calendar.filter(day => day.requests > 0), peak = active.reduce((best, day) => day.total > (best?.total || 0) ? day : best, null);
    $('activity-summary').innerHTML = activityStats([['Active days', number(active.length)], ['Model turns', number(active.reduce((sum, day) => sum + day.requests, 0))], ['Busiest recorded day', peak ? activityDate(peak.day) : '—']]);
    $('activity-chart').innerHTML = calendarHeatmap(r.calendar, { cell: 24, gap: 4, selectable: true, selected: activityIndex(), fmt: number, showCoverage: !$('coverage').hidden });
  } else {
    const days = activityDays.map((_, d) => r.rhythm.slice(d * 24, d * 24 + 24).reduce((sum, value) => sum + value, 0));
    const hours = Array.from({ length: 24 }, (_, h) => days.reduce((sum, _, d) => sum + r.rhythm[d * 24 + h], 0));
    const peakDay = days.indexOf(Math.max(...days)), peakHour = hours.indexOf(Math.max(...hours));
    const total = days.reduce((sum, value) => sum + value, 0);
    $('activity-summary').innerHTML = activityStats([['Recorded tokens', recordedValue(r.totals, 'total', number)], ['Busiest weekday', total ? activityDays[peakDay] : '—'], ['Busiest hour', total ? `${String(peakHour).padStart(2, '0')}:00–${String(peakHour + 1).padStart(2, '0')}:00` : '—']]);
    $('activity-chart').innerHTML = punchCard(r.rhythm, { cell: 28, selectable: true, selected: activityIndex(), fmt: number });
  }
  $('activity-note').textContent = calendar
    ? 'Color intensity compares recorded daily tokens. A day with no recorded usage is not proof of no activity. Input includes cache; reasoning is part of output.'
    : 'Dots group recorded tokens by the local time of model calls, not hours spent working. Weekdays and hours combine all selected dates; missing token counts are not estimated.';
  if (!r.query.includeCache) $('activity-note').textContent += ' Cache is excluded from totals; individual cache counts remain available.';
  renderActivitySelection();
  if (focused !== undefined) $('activity-chart').querySelector(`[data-inspect="${activityIndex()}"]`)?.focus({ preventScroll: true });
}
function renderActivitySelection() {
  const r = state.report, index = activityIndex();
  for (const mark of $('activity-chart').querySelectorAll('[data-inspect]')) {
    const selected = Number(mark.dataset.inspect) === index;
    mark.setAttribute('aria-pressed', String(selected)); mark.setAttribute('tabindex', selected ? '0' : '-1');
  }
  if (activityKind === 'calendar') {
    const day = r.calendar[index];
    $('activity-detail-title').textContent = day ? activityDate(day.day) : 'No recorded dates';
    $('activity-detail').innerHTML = day ? activityStats([['Tokens', recordedValue(day, 'total', number)], ['AI credits', recordedValue(day, 'credits', creditNumber)], ['Model turns', number(day.requests)], ['Sessions', number(day.sessions)], ['Uncached input', recordedValue(day, 'input', number)], ['Cache read', recordedValue(day, 'cacheRead', number)], ['Cache write', recordedValue(day, 'cacheWrite', number)], ['Output', recordedValue(day, 'output', number)]]) : '';
  } else {
    const day = Math.floor(index / 24), hour = index % 24, tokens = r.rhythm[index] || 0, total = r.rhythm.reduce((sum, value) => sum + value, 0);
    const weekdayTotal = r.rhythm.slice(day * 24, day * 24 + 24).reduce((sum, value) => sum + value, 0);
    $('activity-detail-title').textContent = `${activityDays[day]} · ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`;
    $('activity-detail').innerHTML = activityStats([['Recorded tokens in this slot', number(tokens)], ['Share of recorded tokens', total ? `${number(tokens / total * 100)}%` : '—'], [`All ${activityDays[day]} tokens`, number(weekdayTotal)]]);
  }
}
function selectActivity(index, focus = false) {
  if (!state.report || !Number.isInteger(index)) return;
  const count = activityKind === 'calendar' ? state.report.calendar.length : 168;
  if (index < 0 || index >= count) return;
  activitySelection = activityKind === 'calendar' ? state.report.calendar[index].day : index;
  renderActivitySelection();
  if (focus) {
    const chart = $('activity-chart'), mark = chart.querySelector(`[data-inspect="${index}"]`);
    mark?.focus({ preventScroll: true });
    const cell = mark?.getBoundingClientRect?.(), bounds = chart.getBoundingClientRect();
    if (cell?.left < bounds.left) chart.scrollLeft -= bounds.left - cell.left + 5;
    else if (cell?.right > bounds.right) chart.scrollLeft += cell.right - bounds.right + 5;
  }
}
for (const [id, kind] of [['activity', 'calendar'], ['rhythm', 'rhythm']]) {
  $(`${id}-card`).onclick = () => openActivity(kind);
  $(`${id}-expand`).onclick = () => openActivity(kind);
}
$('activity-close').onclick = () => $('activity-dialog').close();
$('activity-dialog').onclose = () => {
  const opener = activityKind === 'calendar' ? 'activity-expand' : 'rhythm-expand';
  activityKind = undefined;
  ($('content').hidden ? $('range') : $(opener)).focus({ preventScroll: true });
};
$('activity-chart').onclick = e => { const mark = e.target.closest('[data-inspect]'); if (mark) selectActivity(Number(mark.dataset.inspect)); };
$('activity-chart').onfocusin = e => { const mark = e.target.closest('[data-inspect]'); if (mark) selectActivity(Number(mark.dataset.inspect)); };
$('activity-chart').onkeydown = e => {
  const mark = e.target.closest('[data-inspect]'); if (!mark) return;
  const index = Number(mark.dataset.inspect), calendar = activityKind === 'calendar', count = calendar ? state.report.calendar.length : 168;
  const offsets = calendar ? { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24 };
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : e.key in offsets ? Math.max(0, Math.min(count - 1, index + offsets[e.key])) : ['Enter', ' '].includes(e.key) ? index : undefined;
  if (next !== undefined) { e.preventDefault(); selectActivity(next, true); }
};
function selectButton(container, name, value) {
  for (const button of $(container).querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset[name] === value));
}
function showView(view) {
  if (!['usage', 'breakdown', 'efficiency'].includes(view)) return;
  if (view !== 'efficiency') rememberReviewAnimation();
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
  const { requestModel, modelProject, modelProjectPage, requestSession, modelSessionPage, requestPage, requestId, requestRetry, projectName, sessionPage, projectSession, sessionModelRetry } = button.dataset;
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
    await loadModelProjectPage();
  } else if (state.modelView && modelProjectPage !== undefined) {
    if (state.modelView.pending) return;
    state.requestView = null; state.modelView.sessions = null;
    await loadModelProjectPage(Number(modelProjectPage));
  } else if (state.modelView && modelProject !== undefined) {
    if (state.modelView.pending || !state.modelView.page?.rows.some(r => r.name === modelProject)) return;
    state.requestView = null;
    if (state.modelView.sessions?.project === modelProject) { state.modelView.sessions = null; renderBreakdown(); return; }
    state.modelView.sessions = { project: modelProject, offset: 0, version: 0 };
    await loadModelSessionPage();
  } else if (state.modelView?.sessions && modelSessionPage !== undefined) {
    if (state.modelView.pending || state.modelView.sessions.pending) return;
    state.requestView = null;
    await loadModelSessionPage(Number(modelSessionPage));
  } else if (state.modelView?.sessions && requestSession !== undefined) {
    if (state.modelView.pending || state.modelView.sessions.pending || !state.modelView.sessions.page?.rows.some(r => r.id === requestSession)) return;
    if (state.requestView?.session === requestSession) { state.requestView = null; renderBreakdown(); return; }
    state.requestView = { model: state.modelView.model, project: state.modelView.sessions.project, session: requestSession, offset: 0, version: 0, detailVersion: 0, details: new Map() };
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
$('environment').onchange = () => { for (const id of ['model', 'project', 'session']) $(id).value = ''; return load(); };
for (const id of ['group', 'sort']) $(id).onchange = () => {
  if (state.projectView) state.projectView.offset = 0;
  renderBreakdown();
  if (id === 'sort' && state.modelView) { state.requestView = null; if (state.modelView.sessions) state.modelView.sessions.offset = 0; return loadModelProjectPage(0); }
};
for (const id of ['skills-sort', 'plugins-sort', 'mcp-sort']) $(id).onchange = renderBreakdown;
for (const id of ['models-sort', 'projects-sort']) $(id).onchange = render;
$('skills').onclick = async event => {
  const button = event.target.closest('[data-skill-id]');
  if (!button) return;
  const skill = state.report.skills.rows.find(s => s.id === button.dataset.skillId);
  if (!skill) return;
  if (button.dataset.skillAction === 'toggle') {
    state.skillView = state.skillView === skill.id ? null : skill.id;
    renderBreakdown();
    return;
  }
  if (button.dataset.skillAction !== 'copy' || !skill.path || skill.unresolved || state.skillActionPending) return;
  state.skillActionPending = true;
  button.setAttribute('aria-busy', 'true');
  const status = $('skill-folder-status');
  status.hidden = true;
  status.textContent = '';
  $('live').textContent = `Copying folder path for ${skill.name}…`;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this window.');
    await navigator.clipboard.writeText(skillFolder(skill.path));
    $('live').textContent = `Folder path copied for ${skill.name}.`;
  }
  catch (error) { clientDiagnostics.record('error', 'ui.skillAction', { action: 'copy', ...diagnosticError(error) }); status.hidden = false; status.textContent = `Could not copy folder path: ${error.message}`; }
  finally { state.skillActionPending = false; button.removeAttribute('aria-busy'); }
};
$('clear-filters').onclick = () => { for (const id of ['environment', 'model', 'project', 'session']) $(id).value = ''; $('cache').checked = true; load(); };
let settingsSources;
let reviewModels = [], savedReviewReasoning, reviewReasoningTouched = false;
function reviewReasoningOptions(preferred = savedReviewReasoning) {
  const model = reviewModels.find(m => m.id === $('review-model').value);
  const choices = model ? ['default', ...(model.reasoningEfforts || [])] : ['default', 'medium', 'high'];
  const selected = preferred || (model?.reasoningEfforts?.includes('medium') ? 'medium' : 'default');
  $('review-reasoning').innerHTML = (!choices.includes(selected) ? `<option value="${esc(selected)}">${esc(selected)} (saved; unsupported)</option>` : '') + choices.map(effort => `<option value="${effort}">${effort === 'default' ? 'Model default' : effort === 'medium' ? 'Medium' : 'High'}</option>`).join('');
  $('review-reasoning').value = selected;
  $('review-reasoning-help').textContent = !model ? 'Refresh models to verify supported reasoning levels.' : !choices.includes(selected) ? 'The selected level is unsupported. Choose a supported level before analyzing.' : model.reasoningEfforts?.length ? 'High allows more reasoning and may use more credits. Choose Medium for a lighter review.' : 'This model does not advertise configurable Medium or High reasoning. Model default is used.';
}
function reviewModelOptions(models, selected, preferred = savedReviewReasoning) {
  reviewModels = models;
  $('review-model').innerHTML = '<option value="">Choose a model</option>' +
    (selected && !models.some(m => m.id === selected) ? `<option value="${esc(selected)}">${esc(publicModelLabels[selected] || selected)} (unavailable until verified)</option>` : '') +
    models.map(model => `<option value="${esc(model.id)}">${esc(model.label)}</option>`).join('');
  $('review-model').value = selected || '';
  reviewReasoningOptions(preferred);
}
$('review-model').onchange = () => {
  reviewReasoningTouched = true;
  const model = reviewModels.find(m => m.id === $('review-model').value);
  reviewReasoningOptions(model?.reasoningEfforts?.includes('high') ? 'high' : null);
};
$('review-reasoning').onchange = () => { reviewReasoningTouched = true; };
async function refreshReviewConnection(reconnect) {
  if (reviewConnectionPending || reviewRunning) return;
  reviewConnectionPending = true;
  $('review-models-refresh').disabled = $('review-reconnect').disabled = true;
  $('review-connection-cancel').hidden = false;
  $('review-connection-status').textContent = reconnect ? 'Verifying a fresh Copilot connection…' : 'Loading models from Copilot…';
  try {
    const result = await request(reconnect ? 'review.reconnect' : 'review.catalog');
    reviewModelOptions(result.models, $('review-model').value || result.recommendedModel, reviewReasoningTouched ? $('review-reasoning').value : savedReviewReasoning);
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
function applyPaused(paused) {
  const changed = !!state.paused !== paused;
  state.paused = paused;
  $('settings-pause').textContent = paused ? 'Resume Usage Insights' : 'Pause Usage Insights';
  $('settings-pause-status').textContent = paused ? 'Paused. Settings and diagnostic logs remain available.' : 'Running. You can pause new data reads and AI reviews at any time.';
  if (paused && changed) {
    state.version++;
    state.report = null; state.creditsUnavailable = true;
    state.requestView = state.modelView = state.projectView = state.skillView = null;
    inventorySnapshot = undefined; inventoryQueued = false;
    historyLoading = null; clearTimeout(historyPoll); historyPoll = null;
    efficiencyContextSnapshot = null;
    if (reviewRun) reviewRun.cancelled = true;
    reviewResult = null;
    reviewProgress(null);
    $('review-result').hidden = true;
    $('review-answer').textContent = '';
    $('review-preview').hidden = true;
    $('efficiency-review-output').value = '';
    $('tip').hidden = true;
    renderHeaderCredits();
  }
  setRefreshFeedback('idle');
  renderLoadStatus();
}
function renderRuntimeSecurity(status) {
  const node = status?.nodeVersion || 'unknown';
  $('settings-runtime').textContent = status?.status === 'below-baseline'
    ? `Node ${node} is older than the reviewed security baseline ${status.minimum}. Update Copilot to obtain its runtime updates. You can pause this plugin while updating. Reviewed ${status.reviewedAt}.`
    : status?.status === 'baseline-met'
      ? `Node ${node} meets the baseline reviewed ${status.reviewedAt}. This is a dated check, not a vulnerability scan or safety guarantee.`
      : `Node ${node} has not been checked against a supported security baseline. Keep Copilot and this plugin updated.`;
}
$('settings-pause').onclick = async () => {
  $('settings-pause').disabled = true; $('settings-error').hidden = true;
  try {
    const config = await request('settings.set', { paused: !state.paused });
    applyPaused(config.paused === true);
    if (!state.paused) await load(true);
  } catch (error) { $('settings-error').textContent = error.message; $('settings-error').hidden = false; }
  finally { $('settings-pause').disabled = false; }
};
$('settings-open').onclick = $('footer-settings').onclick = async () => {
  $('settings-error').hidden = true;
  $('settings-save').disabled = true;
  $('settings-pause').disabled = true;
  $('settings-dialog').showModal();
  try {
    const config = await request('settings.get');
    applyPaused(config.paused === true);
    renderRuntimeSecurity(config.runtimeSecurity);
    $('settings-pause').disabled = false;
    $('text-size').value = config.textSize ?? 'small';
    $('simplify-numbers').checked = config.simplifyNumbers !== false;
    $('review-samples').checked = config.reviewAllowSamples !== false;
    $('include-wsl').checked = config.includeWsl !== false;
    $('read-wsl-databases').checked = config.readWslDatabases !== false;
    $('include-vscode').checked = config.includeVSCode !== false;
    $('extra-vscode-homes').value = (config.extraVSCodeHomes || []).join('\n');
    savedReviewReasoning = config.reviewReasoning;
    reviewReasoningTouched = false;
    reviewModelOptions(reviewModels, config.reviewModel);
    settingsSources = JSON.stringify([config.extraHomes, config.disabledHomes, config.includeWsl !== false, config.readWslDatabases !== false, config.includeVSCode !== false, config.extraVSCodeHomes || []]);
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
    const effort = savedReviewReasoning || reviewReasoningTouched || reviewModels.some(m => m.id === $('review-model').value) ? { reviewReasoning: $('review-reasoning').value } : {};
    const config = await request('settings.set', { textSize: $('text-size').value, simplifyNumbers: $('simplify-numbers').checked, includeWsl: $('include-wsl').checked, readWslDatabases: $('read-wsl-databases').checked, includeVSCode: $('include-vscode').checked, extraVSCodeHomes: lines('extra-vscode-homes'), extraHomes: lines('extra-homes'), disabledHomes: lines('disabled-homes'), reviewModel: $('review-model').value, reviewAllowSamples: $('review-samples').checked, ...effort });
    applyPaused(config.paused === true);
    applyPreferences(config); render();
    $('settings-dialog').close();
    await load(settingsSources !== JSON.stringify([config.extraHomes, config.disabledHomes, config.includeWsl !== false, config.readWslDatabases !== false, config.includeVSCode !== false, config.extraVSCodeHomes || []]));
  } catch (e) { $('settings-error').textContent = e.message; $('settings-error').hidden = false; }
  finally { $('settings-save').disabled = false; }
};
try { document.documentElement.classList.toggle('light', (localStorage.getItem('usage-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'light'); } catch {}
$('theme').onclick = () => { const light = document.documentElement.classList.toggle('light'); try { localStorage.setItem('usage-theme', light ? 'light' : 'dark'); } catch {} };
let tooltipLayout;
function showTooltip(mark, x, y) {
  const popup = $('tip');
  const viewportWidth = document.documentElement.clientWidth || innerWidth;
  const viewportHeight = document.documentElement.clientHeight || innerHeight;
  const key = JSON.stringify([mark.dataset.tip, state.simplifyNumbers, state.textSize, viewportWidth, viewportHeight]);
  if (tooltipLayout?.key !== key) {
    const tip = JSON.parse(mark.dataset.tip);
    popup.innerHTML = `<strong>${esc(tip.title || '')}</strong>` + (tip.rows || []).map(([label, value]) => `<p><span>${esc(label)}</span><span>${esc(typeof value === 'number' ? number(value) : value)}</span></p>`).join('') + (tip.total === undefined ? '' : `<p><b>Total</b><b>${esc(typeof tip.total === 'number' ? number(tip.total) : tip.total)}</b></p>`);
    popup.hidden = false;
    tooltipLayout = { key, width: popup.offsetWidth, height: popup.offsetHeight };
  }
  popup.hidden = false;
  const { width, height } = tooltipLayout, gap = 12, margin = 8;
  const left = x + gap + width <= viewportWidth - margin ? x + gap : x - gap - width;
  const top = y + gap + height <= viewportHeight - margin ? y + gap : y - gap - height;
  popup.style.left = `${Math.max(margin, Math.min(left, viewportWidth - width - margin))}px`;
  popup.style.top = `${Math.max(margin, Math.min(top, viewportHeight - height - margin))}px`;
}
document.addEventListener('pointermove', e => {
  if ($('activity-dialog').open) { $('tip').hidden = true; return; }
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
document.addEventListener('visibilitychange', () => {
  syncReviewAnimation();
  clientDiagnostics.record('info', 'ui.visibility', connectionState());
  clearTimeout(historyPoll); historyPoll = null;
  if (dashboardReady && !document.hidden && !state.pending) {
    if (historyLoading && !loadError) load(false, false, true);
    else if (lastSuccessfulScanAt === undefined || Date.now() - lastSuccessfulScanAt >= AUTO_REFRESH_MS) load(false, true);
  }
});
setInterval(() => { if (!document.hidden && !state.pending && !historyLoading) load(false, true); }, AUTO_REFRESH_MS);
$('start-date').value = dayKey(localDay() - 6); $('end-date').value = dayKey(localDay());
$('end-date').max = $('start-date').max = dayKey(localDay());
// Let the self-contained document finish loading before starting potentially large scans.
// Keep the page load event independent of history becoming available.
let dashboardReady = false;
function startDashboard() {
  if (dashboardReady) return;
  dashboardReady = true;
  clientDiagnostics.record('info', 'ui.ready', { phase: 'finished', durationMs: globalThis.performance?.now() });
  setTimeout(() => load(false, true), 0);
}
if (document.readyState === 'complete') startDashboard();
else window.addEventListener('load', startDashboard, { once: true });
