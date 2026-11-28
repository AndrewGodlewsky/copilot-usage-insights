import { esc } from './charts.mjs';
import { loadTimingSummary } from '../core/diagnostics.mjs';

export function formatDiagnosticText({ buildVersion, clientDiagnostics, server, cached = true, importedRuntimeLogs }) {
  const client = clientDiagnostics.snapshot();
  const lines = [`Usage Insights v${buildVersion}`, `Exported: ${new Date().toISOString()}`,
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

export function bindReleaseNotesDialog({ getElement, releaseNotes, buildVersion }) {
  const familyOf = version => version.split('.').slice(0, 2).join('.');
  function showNote(version) {
    const release = releaseNotes.find(entry => entry.version === version);
    if (!release) return;
    getElement('release-note-title').textContent = `v${release.version}`;
    getElement('release-installed').hidden = release.version !== buildVersion;
    getElement('release-summary').textContent = release.summary;
    getElement('release-note').scrollTop = 0;
    for (const button of getElement('release-versions').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.releaseVersion === release.version));
  }
  function showFamily(family, version) {
    const releases = releaseNotes.filter(entry => familyOf(entry.version) === family);
    if (!releases.length) return;
    for (const button of getElement('release-families').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.releaseFamily === family));
    getElement('release-versions').innerHTML = releases.map(entry => `<button data-release-version="${esc(entry.version)}" aria-pressed="false" aria-controls="release-note"><span>v${esc(entry.version)}</span>${entry.version === buildVersion ? '<span class="release-installed-label">Installed</span>' : ''}</button>`).join('');
    getElement('release-versions').scrollTop = 0;
    showNote(version || releases[0].version);
  }
  getElement('plugin-version').onclick = () => {
    const families = [...new Set(releaseNotes.map(entry => familyOf(entry.version)))];
    getElement('release-families').innerHTML = families.map(family => `<button data-release-family="${esc(family)}" aria-pressed="false" aria-controls="release-versions"><span>v${esc(family)}.x</span></button>`).join('');
    showFamily(familyOf(buildVersion), buildVersion);
    if (!getElement('release-notes-dialog').open) getElement('release-notes-dialog').showModal();
    getElement('release-versions').querySelector('[aria-pressed="true"]')?.focus();
  };
  getElement('release-families').onclick = event => {
    const button = event.target.closest('[data-release-family]');
    if (button) showFamily(button.dataset.releaseFamily);
  };
  getElement('release-versions').onclick = event => {
    const button = event.target.closest('[data-release-version]');
    if (button) showNote(button.dataset.releaseVersion);
  };
  getElement('release-notes-close').onclick = () => getElement('release-notes-dialog').close();
  getElement('release-notes-dialog').onclose = () => getElement('plugin-version').focus({ preventScroll: true });
}
