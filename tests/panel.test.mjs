import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mountPanel } from './fixtures/panel.mjs';
import { requestPanel, jumpTokenTopic } from './fixtures/panel-requests.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildModelProjectPage, buildSessionModels } from '../src/core/copilot-report.mjs';

test('dashboard waits for document load before requesting history, and starts only once', async () => {
  const panel = await mountPanel(buildReport([], { range: 'mtd' }), undefined, undefined, undefined, { beforeLoad: true });
  assert.equal(panel.requests.length, 0);
  panel.windowListeners.get('load')();
  panel.windowListeners.get('load')();
  assert.equal(panel.requests.length, 0, 'loading is deferred out of the load event');
  const timers = panel.timeouts.filter(timer => timer.ms === 0);
  assert.equal(timers.length, 1);
  await timers[0].callback();
  assert.equal(panel.requests.filter(r => r.method === 'usage.report').length, 1);
});

test('persistent pause stops panel polling, leaves diagnostics/settings available, and resumes with a fresh read', async () => {
  const { get, requests, intervals, server } = await mountPanel({ ...buildReport([], { range: 'mtd' }), sources: [], coverage: {} }, { paused: true, extraHomes: [], disabledHomes: [], runtimeSecurity: { nodeVersion: 'v24.22.1', status: 'below-baseline', minimum: '24.22.3', reviewedAt: '2026-11-17' } });
  assert.match(get('status').textContent, /paused/);
  assert.equal(get('content').hidden, true);
  assert.equal(get('refresh').disabled, true);
  const before = requests.length;
  for (const timer of intervals) await timer.callback();
  assert.equal(requests.length, before);
  await get('settings-open').onclick();
  assert.match(get('settings-runtime').textContent, /older than.*24.22.3/);
  assert.equal(get('settings-pause').textContent, 'Resume Usage Insights');
  await get('logs-open').onclick();
  assert.ok(requests.some(r => r.method === 'diagnostics.get'));
  await get('settings-pause').onclick();
  assert.equal(server.config.paused, false);
  assert.doesNotMatch(get('status').textContent, /Could not/);
  assert.ok(requests.some(r => r.method === 'usage.refresh'));
  assert.equal(get('refresh').disabled, false);
  await get('settings-pause').onclick();
  assert.equal(server.config.paused, true);
  assert.match(get('status').textContent, /paused/);
  assert.equal(get('content').hidden, true);
  assert.equal(get('refresh').disabled, true);
});

test('pause discards a report that finishes after the user stops activity', async () => {
  const { get, server } = await mountPanel(buildReport([], {}));
  let finish;
  server.report = () => new Promise(resolve => { finish = resolve; });
  const pending = get('refresh').onclick();
  await new Promise(setImmediate);
  await get('settings-open').onclick();
  await get('settings-pause').onclick();
  finish(buildReport([], {}));
  await pending;
  assert.equal(get('content').hidden, true);
  assert.match(get('status').textContent, /paused/);
  assert.equal(get('refresh').disabled, true);
});

test('Skills rerenders dated rows when switching between 7 and 90 days', async () => {
  const now = new Date(2026, 10, 13, 12);
  const parser = createReceiptParser({ sessionId: 'dated-skills', source: 'fixture' });
  parser.push(JSON.stringify({ id: 'usage', type: 'session.usage_record', timestamp: now.toISOString(),
    data: { usage: { provider: { kind: 'copilot' }, model: 'fixture-model', inputTokens: 10, outputTokens: 2 } } }));
  for (const [name, days] of [['recent-skill', 0], ['older-skill', 60]]) parser.push(JSON.stringify({
    id: name, type: 'skill.invoked', timestamp: new Date(2026, 10, 13 - days, 10).toISOString(), data: { name },
  }));
  const snapshot = parser.snapshot();
  const report = input => ({ ...buildReport(snapshot.records, input, now, snapshot), sources: [], coverage: {} });
  const { get, server, requests } = await mountPanel(report({ range: 'mtd' }));
  server.report = report;
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  for (const range of ['7d', '90d', '7d']) {
    get('range').value = range; get('range').onchange(); await new Promise(setImmediate);
    assert.match(get('skills').innerHTML, /recent-skill/);
    assert.equal(get('skills').innerHTML.includes('older-skill'), range === '90d');
    assert.match(get('skills-summary').textContent, range === '90d' ? /2 uses.*Last 90 days/ : /1 use.*Last 7 days/);
    assert.equal(requests.filter(r => r.method === 'usage.report').at(-1).input.range, range);
  }
  assert.match(get('skills-summary').title, /Model filters do not apply/);
});

test('Skills shows unverified-provider activity visibly in the selected month without requiring charges', async () => {
  const now = new Date(2026, 10, 13, 12), parser = createReceiptParser({ sessionId: 'activity-only', source: 'fixture' });
  parser.push(JSON.stringify({ type: 'skill.invoked', id: 'skill', timestamp: now.toISOString(), data: { name: 'saved-skill', trigger: 'agent-invoked' } }));
  const snapshot = parser.snapshot(), report = { ...buildReport(snapshot.records, { range: 'mtd' }, now, snapshot), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.equal(get('content').hidden, false);
  assert.match(get('skills-summary').textContent, /1 use.*Rolling 30.*1 included with provider unverified/);
  assert.match(get('skills').innerHTML, /saved-skill.*provider unverified/);
  assert.match(get('skills-coverage').textContent, /No charges are inferred/);
  assert.match(get('session').innerHTML, /activity-only/);
});

test('diagnostic Markdown download uses the displayed snapshot offline and releases its blob', async () => {
  const { get, server, requests, document, timeouts, objectUrls, revoked } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} });
  await get('logs-open').onclick();
  server.transportError = true;
  await get('logs-reload').onclick();
  const before = requests.length, logs = get('logs-output').value;
  get('logs-download').focus();
  get('logs-download').onclick();
  assert.equal(server.downloads.length, 1);
  const download = server.downloads[0];
  assert.match(download.name, /^usage-insights-v\d+\.\d+\.\d+-\d{4}-\d\d-\d\dT[\d-]+Z\.md$/);
  assert.equal(download.blob.type, 'text/markdown;charset=utf-8');
  assert.equal(await download.blob.text(), `# Usage Insights diagnostic logs\n\n\`\`\`text\n${logs}\n\`\`\`\n`);
  assert.match(logs, /Cached server snapshot|Server logs unavailable/);
  assert.match(logs, /Load timing summary/);
  assert.doesNotMatch(await download.blob.text(), /PRIVATE/);
  assert.equal(document.activeElement, get('logs-download'));
  assert.equal(requests.length, before, 'downloading makes no network request or scan');
  assert.equal(objectUrls.size, 1, 'allow the browser to consume the URL before revoking it');
  timeouts.at(-1).callback();
  assert.equal(objectUrls.size, 0); assert.equal(revoked.length, 1);
  server.downloadError = true;
  get('logs-download').onclick();
  assert.match(get('logs-status').textContent, /Copy logs/);
  timeouts.at(-1).callback();
  assert.equal(objectUrls.size, 0);
  await get('logs-copy').onclick();
  assert.equal(server.copied.at(-1), logs);
});

async function finishReconnect(timeouts, pending) {
  for (let i = 0; i < 4; i++) {
    await new Promise(setImmediate);
    const retry = timeouts.find(timer => [500, 1000, 2000].includes(timer.ms) && !timer.ran && !timer.cleared);
    if (!retry) break;
    retry.ran = true;
    retry.callback();
  }
  await pending;
}

test('recent loading keeps filters usable, holds wider views, and polls without refreshing or losing focus', async () => {
  const { get, server, requests, document, timeouts, listeners, report } = await requestPanel();
  let complete = false;
  server.report = input => {
    const loading = { phase: ['all', '90d'].includes(input.range) ? 'history' : 'recent', scanId: 1, since: '2026-10-17', filesDeferred: 5, databasesDeferred: 1 };
    if (!complete && loading.phase === 'history') return { loading };
    return { ...report, query: { ...report.query, ...input }, ...(complete ? {} : { loading, promptCredits: { ...report.promptCredits, pending: true, averageCredits: null } }) };
  };
  await get('refresh').onclick();
  assert.match(get('status').textContent, /Recent usage so far/);
  assert.equal(get('status').hidden, false);
  assert.equal(get('content').hidden, false);
  assert.match(get('tiles').innerHTML, /Verifying linked calls/);
  assert.equal(get('efficiency-review-open').disabled, true);
  assert.equal(get('coverage').hidden, true, 'unresolved background attribution is not an error notice');
  assert.match(get('calendar').innerHTML, /loading/);
  const count = requests.length;
  await get('efficiency-review-open').onclick();
  assert.equal(requests.length, count, 'AI analysis cannot use incomplete history');
  get('range').value = '90d'; get('range').onchange(); await new Promise(setImmediate);
  assert.match(get('status').textContent, /Loading history for Last 90 days/);
  assert.equal(get('content').hidden, true);
  assert.equal(get('hero-credits').textContent, 'Loading…');
  get('range').value = '7d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(get('content').hidden, false);
  document.hidden = true; listeners.get('visibilitychange')();
  assert.ok(timeouts.filter(timer => timer.ms === 2000).every(timer => timer.cleared));
  const beforeVisible = requests.length;
  document.hidden = false; listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests[beforeVisible].method, 'usage.report');
  assert.equal(requests[beforeVisible].refresh, undefined, 'visibility joins existing background work');
  get('range').focus();
  complete = true;
  const poll = timeouts.findLast(timer => timer.ms === 2000 && !timer.cleared);
  assert.ok(poll);
  await poll.callback();
  assert.equal(get('status').hidden, true);
  assert.equal(get('efficiency-review-open').disabled, false);
  assert.equal(document.activeElement, get('range'));
  assert.equal(get('range').value, '7d');
  assert.equal(requests.filter(r => r.method === 'usage.refresh').length, 1);
  assert.equal(timeouts.filter(timer => timer.ms === 2000 && !timer.cleared && timer !== poll).length, 0);
});

test('background loading stops polling on failure and manual Refresh recovers', async () => {
  const { get, server, timeouts, report } = await requestPanel();
  server.report = () => ({ ...report, loading: { phase: 'recent', scanId: 1 } });
  await get('refresh').onclick();
  const poll = timeouts.findLast(timer => timer.ms === 2000 && !timer.cleared);
  server.transportError = true;
  await poll.callback();
  assert.match(get('status').textContent, /History loading stopped/);
  assert.equal(get('efficiency-review-open').disabled, true);
  assert.equal(timeouts.filter(timer => timer.ms === 2000 && !timer.cleared && timer !== poll).length, 0);
  server.transportError = false; server.report = () => ({ ...report, scanId: 2 });
  await get('refresh').onclick();
  assert.equal(get('status').hidden, true);
  assert.equal(get('efficiency-review-open').disabled, false);
});

test('late inventory completion survives switching from recent results to a wider loading view', async () => {
  const { get, server, report } = await requestPanel();
  let finish;
  server.inventory = () => new Promise(resolve => { finish = resolve; });
  server.report = input => input.range === '90d' ? { loading: { phase: 'history' } } : { ...report, loading: { phase: 'recent' } };
  await get('refresh').onclick();
  await new Promise(setImmediate);
  assert.equal(typeof finish, 'function');
  get('range').value = '90d'; get('range').onchange(); await new Promise(setImmediate);
  finish({ mcp: { available: true, rows: [] }, plugins: { available: true, rows: [] } });
  await new Promise(setImmediate);
  assert.equal(get('content').hidden, true);
  assert.match(get('status').textContent, /Loading history/);
  get('range').value = '7d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(get('content').hidden, false);
});

test('manual Refresh reconnects during an extension restart without repeating AI work', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, requests, timeouts } = await mountPanel(report);
  server.transportError = true;
  const start = requests.length;
  const pending = get('refresh').onclick();
  await new Promise(setImmediate);
  assert.equal(get('refresh').dataset.refreshState, 'busy', 'Refresh waits through a brief host restart');
  server.transportError = false;
  await finishReconnect(timeouts, pending);
  assert.equal(get('refresh').dataset.refreshState, 'done');
  assert.equal(requests.slice(start).filter(r => r.method === 'usage.refresh').length, 2);
  assert.equal(requests.slice(start).some(r => r.method.startsWith('review.')), false);
  assert.doesNotMatch(get('status').textContent, /Could not reach/);
});

test('queued filters supersede a reconnect attempt without loading the old scope', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, requests, timeouts } = await mountPanel(report);
  server.transportError = true;
  const pending = get('refresh').onclick();
  await new Promise(setImmediate);
  const start = requests.length;
  get('project').value = 'Changed project';
  await get('project').onchange();
  server.transportError = false;
  await finishReconnect(timeouts, pending);
  const reports = requests.slice(start).filter(r => ['usage.report', 'usage.refresh'].includes(r.method));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].input.project, 'Changed project');
  assert.equal(get('refresh').disabled, false);
});

test('Refresh does not retry server errors or start background reconnection polling', async () => {
  const { get, server, requests, timeouts } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} });
  server.report = () => { throw new Error('fixture server error'); };
  const before = requests.length;
  await get('refresh').onclick();
  assert.equal(requests.length, before + 1, 'a response/decode error is not a lost server');
  assert.equal(timeouts.some(t => [500, 1000, 2000].includes(t.ms)), false);
  assert.equal(get('refresh').disabled, false);
});

test('refresh controls show pending and successful feedback, including unchanged data', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, timeouts } = await mountPanel(report);
  const check = (status, label, busy) => {
    for (const id of ['refresh', 'footer-refresh']) {
      assert.equal(get(id).dataset.refreshState, status);
      assert.equal(get(`${id}-label`).textContent, label);
      assert.equal(get(id).disabled, busy);
      assert.equal(get(id).getAttribute('aria-busy'), String(busy));
    }
  };
  check('idle', 'Refresh', false);
  let resolve;
  server.report = () => new Promise(done => { resolve = done; });
  const pending = get('refresh').onclick();
  check('busy', 'Refreshing…', true);
  await new Promise(setImmediate);
  resolve({ unchanged: true, generatedAt: new Date().toISOString() });
  await pending;
  check('done', 'Updated', false);
  const reset = timeouts.findLast(t => t.ms === 1400 && !t.cleared);
  assert.ok(reset);
  reset.callback();
  check('idle', 'Refresh', false);
});

test('a new refresh clears success feedback and failures restore both controls without claiming success', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, timeouts, requests } = await mountPanel(report);
  await get('refresh').onclick();
  const reset = timeouts.findLast(t => t.ms === 1400 && !t.cleared);
  assert.ok(reset, 'successful manual refresh has a brief completion state');
  server.transportError = true;
  const before = requests.length;
  const failed = get('footer-refresh').onclick();
  assert.equal(reset.cleared, true, 'previous completion cannot reset a new refresh');
  assert.equal(get('refresh').dataset.refreshState, 'busy');
  await finishReconnect(timeouts, failed);
  assert.equal(requests.length - before, 4, 'one manual refresh has at most three recovery retries');
  for (const id of ['refresh', 'footer-refresh']) {
    assert.equal(get(id).dataset.refreshState, 'idle');
    assert.equal(get(`${id}-label`).textContent, 'Refresh');
    assert.equal(get(id).disabled, false);
    assert.equal(get(id).getAttribute('aria-busy'), 'false');
  }
  assert.match(get('status').textContent, /Could not reach/);
  assert.equal(timeouts.some(t => t.ms === 1400 && !t.cleared), false);
});

test('refresh feedback stays busy through queued filters and ignores stale responses', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server } = await mountPanel(report);
  const responses = [];
  server.report = () => new Promise(resolve => responses.push(resolve));
  const pending = get('footer-refresh').onclick();
  await new Promise(setImmediate);
  get('project').value = 'Another project';
  await get('project').onchange();
  responses[0](report);
  await new Promise(setImmediate);
  assert.equal(responses.length, 2);
  assert.equal(get('refresh').dataset.refreshState, 'busy');
  assert.equal(get('footer-refresh').disabled, true);
  responses[1](report);
  await pending;
  assert.equal(get('refresh').dataset.refreshState, 'done');
  assert.equal(get('footer-refresh').disabled, false);
});

test('failed automatic refresh preserves the last matching report and marks it stale', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, intervals } = await mountPanel(report);
  const tiles = get('tiles').innerHTML;
  server.transportError = true;
  intervals[0].callback();
  await new Promise(setImmediate);
  assert.equal(get('content').hidden, false, 'a lost connection must not blank the last report');
  assert.equal(get('tiles').innerHTML, tiles);
  assert.match(get('status').textContent, /last successful|last loaded/i);
  assert.match(get('status').textContent, /reopen/i);
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.match(get('status').textContent, /last successful/i, 'tab changes keep the stale notice');
  assert.equal(get('content').hidden, false);
  server.transportError = false;
  await get('refresh').onclick();
  assert.doesNotMatch(get('status').textContent, /last successful|last loaded/i);
});

test('failed filter changes do not display the previous report under a new scope', async () => {
  const { get, server } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} });
  server.transportError = true;
  get('project').value = 'Unloaded project';
  await get('project').onchange();
  assert.equal(get('content').hidden, true);
  assert.match(get('status').textContent, /these filters could not be loaded/i);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('content').hidden, true);
  assert.equal(get('hero-credits').textContent, 'Unavailable');
  assert.equal(get('filters').nextElementSibling, get('status'), 'filters stay outside the hidden report');
});

test('inventory retains server diagnostics for a later outage without an extra request', async () => {
  const snapshot = { version: '0.1.73', runtime: { node: 'v24.0.0', platform: 'win32', arch: 'x64' }, capturedAt: '2026-11-15T12:00:00.000Z', startedAt: '2026-11-15T11:59:00.000Z', limit: 300, dropped: 0, entries: [{ at: '2026-11-15T11:59:00.000Z', level: 'info', event: 'server.listening' }] };
  const { get, requests, server, windowListeners, viewport, timeouts } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} }, undefined, undefined,
    () => ({ mcp: { available: false, rows: [] }, plugins: { available: false, rows: [] }, diagnostics: snapshot }));
  assert.deepEqual(requests.map(r => r.method), ['usage.report', 'usage.inventory']);
  viewport.navigator.onLine = true;
  windowListeners.get('securitypolicyviolation')({ effectiveDirective: 'connect-src', blockedURI: 'PRIVATE_URL' });
  server.transportError = true;
  await finishReconnect(timeouts, get('refresh').onclick());
  await get('logs-open').onclick();
  const logs = get('logs-output').value;
  assert.match(logs, /Cached server snapshot from 2026-11-15T12:00:00.000Z/);
  assert.match(logs, /server.listening/);
  assert.match(logs, /"requestStage":"fetch"/);
  assert.match(logs, /"lastResponseAgeMs":\d/);
  assert.match(logs, /"online":true/);
  assert.match(logs, /ui.connectionPolicy/);
  assert.doesNotMatch(logs, /PRIVATE|SECRET/);
  assert.match(get('logs-status').textContent, /last server snapshot/);
});

test('Show logs keeps initial saved evidence when the very first usage request cannot connect', async () => {
  const at = '2026-11-15T21:02:43.000Z';
  const diagnostics = { version: '0.1.83', runtime: { node: 'v24.0.0', platform: 'win32', arch: 'x64' }, capturedAt: at, startedAt: at, limit: 300, dropped: 0,
    entries: [{ at, level: 'info', event: 'server.listening' }], persisted: { available: true, entries: [{ at, level: 'error', event: 'extension.crash', errorType: 'Error', errorCode: 'EIO' }] } };
  const { get, requests, server } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} }, undefined, undefined, undefined, { diagnostics, transportError: true });
  assert.deepEqual(requests.map(r => r.method), ['usage.report'], 'no additional startup request');
  await get('logs-open').onclick();
  assert.match(get('logs-output').value, /Cached server snapshot from/);
  assert.match(get('logs-output').value, /extension.crash/);
  assert.match(get('logs-output').value, /Recent local runtime logs/);
  await get('logs-copy').onclick();
  assert.match(server.copied.at(-1), /"source":"runtime"/);
  assert.doesNotMatch(server.copied.at(-1), /PRIVATE/);
});

test('offline runtime files are sanitized, bounded, and copyable without a server or upload', async () => {
  const { get, server, requests } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} });
  server.transportError = true;
  await get('logs-open').onclick();
  const before = requests.length;
  get('logs-import').onclick();
  assert.equal(get('logs-files').clicked, true);
  const entries = Array.from({ length: 305 }, (_, i) => ({ at: new Date(Date.UTC(2026, 10, 15, 21, 0, i)).toISOString(), level: 'info', event: 'history.scan', phase: 'started', processId: i, message: 'PRIVATE message', path: 'SECRET path' }));
  const current = entries.slice(150).map(e => JSON.stringify(e)).join('\n');
  const previous = entries.slice(0, 160).map(e => JSON.stringify(e)).join('\n');
  get('logs-files').files = [{ name: 'PRIVATE file.jsonl', size: current.length, text: async () => current }, { size: previous.length, text: async () => previous }];
  await get('logs-files').onchange();
  const output = get('logs-output').value;
  assert.match(output, /Manually loaded runtime logs: 300 entries/);
  assert.match(output, /"processId":304/);
  assert.doesNotMatch(output, /"processId":0\b|PRIVATE|SECRET/);
  assert.equal(output.match(/"processId":155\b/g).length, 1, 'overlapping rotated entries count once');
  assert.equal(requests.length, before, 'loading files never contacts the server');
  await get('logs-copy').onclick();
  assert.equal(server.copied.at(-1), output);
  for (const files of [[], [{ size: 1024 * 1024 + 1, text: async () => { throw new Error('must not read'); } }], [{ size: 5, text: async () => 'wrong' }], [{ size: 5, text: async () => { throw new Error('SECRET read error'); } }]]) {
    get('logs-files').files = files;
    await get('logs-files').onchange();
    assert.equal(get('logs-output').value, output, 'cancel or invalid file leaves useful logs intact');
    assert.doesNotMatch(get('logs-status').textContent, /PRIVATE|SECRET/);
  }
  await get('logs-reload').onclick();
  assert.match(get('logs-output').value, /"processId":304/);
});

test('Rolling 30 is selected by default and remains selectable alongside Last 30 days', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests, server } = await mountPanel(report);
  assert.equal(get('range').value, 'mtd');
  assert.equal(requests[0].input.range, 'mtd');
  assert.match(get('tiles').innerHTML, /Rolling 30/);
  server.report = input => ({ ...buildReport([], input), sources: [], coverage: {} });
  for (const [range, label] of [['30d', 'Last 30 days'], ['mtd', 'Rolling 30']]) {
    get('range').value = range;
    get('range').onchange();
    await new Promise(setImmediate);
    assert.equal(requests.findLast(r => r.method === 'usage.report').input.range, range);
    assert.match(get('tiles').innerHTML, new RegExp(label));
    assert.equal(get('custom').hidden, true);
  }
});

test('coverage notice can be dismissed across renders and refreshes without suppressing changed warnings', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: { aggregateOnly: 2 }, coverageDetails: { counts: { aggregateOnly: 2 }, rows: [], unreadable: [] } };
  const { get, document } = await mountPanel(report);
  assert.equal(get('coverage').hidden, false);
  assert.match(get('coverage-message').textContent, /2 sessions have summary totals only and are not counted/);
  assert.equal(get('coverage-dismiss').getAttribute('aria-label'), 'Dismiss data coverage notice');
  get('coverage-dismiss').focus();
  get('coverage-dismiss').onclick();
  assert.equal(get('coverage').hidden, true);
  assert.equal(document.activeElement, get('refresh'));
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.equal(get('coverage').hidden, true);
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, true, 'the same notice stays dismissed after a refresh');
  report.coverageDetails.counts.invalid = 1;
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, false, 'changed warnings remain visible');
  assert.match(get('coverage-message').textContent, /1 malformed records were skipped/);
  delete report.coverageDetails.counts.invalid;
  delete report.coverageDetails.counts.aggregateOnly;
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, true, 'no notice is displayed without warnings');
  report.coverageDetails.counts.aggregateOnly = 2;
  const reopened = await mountPanel(report);
  assert.equal(reopened.get('coverage').hidden, false, 'dismissal lasts only for this dashboard instance');
});

test('coverage review keeps outside and undated issues out of the banner, pages locally, and survives refresh', async () => {
  const details = { counts: {}, unreadable: [{ file: '<unreadable>' }], rows: [
    { scope: 'unknown', kind: 'invalid', count: 6, file: '<private-file>', from: '', to: '' },
    ...Array.from({ length: 26 }, (_, i) => ({ scope: 'outside', kind: 'aggregateOnly', count: 1, file: `/old/${i}`, from: '2024-01-01', to: '2024-01-02' })),
  ] };
  const report = { ...buildReport([], {}), sources: [], coverage: { invalid: 6, aggregateOnly: 26 }, coverageDetails: details };
  const { get, requests } = await mountPanel(report);
  assert.equal(get('coverage').hidden, true, 'all-history counts do not trigger the filtered banner');
  const before = requests.length;
  get('coverage-open').onclick();
  assert.equal(get('coverage-dialog').open, true);
  assert.equal(get('coverage-scope').value, 'unknown');
  assert.match(get('coverage-rows').innerHTML, /&lt;private-file&gt;/);
  assert.match(get('coverage-rows').innerHTML, /Date unknown/);
  assert.match(get('coverage-unreadable').innerHTML, /&lt;unreadable&gt;/);
  assert.match(get('coverage-counts').textContent, /Outside selected dates: 26/);
  get('coverage-scope').value = 'outside'; get('coverage-scope').onchange();
  assert.equal(get('coverage-prev').disabled, true);
  assert.equal(get('coverage-next').disabled, false);
  get('coverage-next').onclick();
  assert.match(get('coverage-rows').innerHTML, /\/old\/25/);
  assert.equal(get('coverage-next').disabled, true);
  assert.equal(requests.length, before, 'reviewing issues never requests or scans data');
  await get('refresh').onclick();
  assert.equal(get('coverage-scope').value, 'outside');
  assert.equal(get('coverage-page').textContent, '2 / 2');
  details.counts.unclassified = 1;
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, false);
  assert.match(get('coverage-current').textContent, /1 records lack Copilot attribution/);
  get('coverage-close').onclick();
  assert.equal(get('coverage-dialog').open, false);
});

test('coverage dismissal hides only relevant markers across cards, charts, and expanded tables without fetching', async () => {
  const { get, report, records, now, requests, server, click } = await requestPanel();
  const visitAll = () => { for (const view of ['usage', 'efficiency', 'breakdown']) get('view').onclick({ target: { dataset: { view } } }); };
  const history = [records[0], { ...records[1], input: null, inputTotal: null, output: null, reasoning: null, cacheRead: null, cacheWrite: null, nanoAiu: null, creditStatus: 'unavailable' }];
  Object.assign(report, buildReport(history, {}, now));
  Object.assign(report.promptCredits, { prompts: 2, eligiblePrompts: 1, averageCredits: .25, excluded: { attribution: 0, accounting: 1, unfinished: 0 } });
  for (const row of [...report.projects, ...report.usageChoices.projects]) Object.assign(row, { userPrompts: 1, uncertainPrompts: 1 });
  server.sessionPage = input => buildModelSessionPage(history, input, now);
  server.requestPage = input => buildRequestPage(history, input, now);
  await get('refresh').onclick();
  const before = JSON.stringify(report);
  const markedSurfaces = ['tiles', 'token-stats', 'token-legend', 'models-summary', 'projects-summary', 'daily', 'calendar', 'token-bar', 'breakdown', 'efficiency-summary', 'efficiency-models'];
  assert.equal(get('coverage').hidden, false);
  assert.equal(get('hero-credits').textContent, '0.25 *');
  assert.match(get('prompt-coverage-note').textContent, /^\*/);
  visitAll();
  for (const id of markedSurfaces) assert.match(get(id).innerHTML, /\d(?:[KM]|%)? \*/, `${id} marks its partial measurements`);
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  await click({ requestSession: 's1' });
  assert.match(get('breakdown').innerHTML, /id="session-requests"/);
  const requestCount = requests.length;
  get('tip').hidden = false;
  get('coverage-dismiss').onclick();
  assert.equal(requests.length, requestCount, 'dismissing the notice uses only the existing report');
  assert.equal(get('tip').hidden, true, 'an already open tooltip cannot retain a stale marker');
  assert.equal(get('hero-credits').textContent, '0.25');
  visitAll();
  assert.equal(get('token-total').textContent, '120');
  for (const id of markedSurfaces) assert.doesNotMatch(get(id).innerHTML, /\d(?:[KM]|%)? \*/, `${id} clears its markers`);
  assert.doesNotMatch(get('prompt-coverage-note').textContent, /^\*/);
  assert.match(get('prompt-coverage-note').textContent, /incomplete charges/, 'coverage explanations remain available');
  assert.match(get('breakdown').innerHTML, /id="session-requests"/, 'expanded sessions stay open');
  assert.match(get('breakdown').innerHTML, /Unavailable/, 'missing readings are not turned into zeros');
  assert.equal(JSON.stringify(report), before, 'dismissing the notice never changes accounting');
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, true);
  assert.equal(get('hero-credits').textContent, '0.25');
  get('efficiency-topic').value = '9'; get('efficiency-topic').oninput();
  assert.doesNotMatch(get('token-topic-body').innerHTML, /\d \*/, 'newly opened topics honor dismissal');
  report.coverageDetails.counts.invalid = 1;
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, false);
  assert.equal(get('hero-credits').textContent, '0.25 *', 'new warnings restore relevant markers');
});

test('known exclusions stay inspectable, while unexpected prompt and source problems still warn', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  Object.assign(report.promptCredits, { prompts: 3, eligiblePrompts: 1, averageCredits: 2, unlinkedRequests: 4,
    coverage: { cancelledPrompts: 1, interruptedPrompts: 1, pluginCalls: 3, compactionCalls: 1 },
    excluded: { attribution: 1, accounting: 0, unfinished: 1 } });
  const { get, requests } = await mountPanel(report);
  assert.equal(get('coverage').hidden, true);
  assert.doesNotMatch(get('tiles').innerHTML, />2 \*</);
  const before = requests.length;
  get('coverage-open').onclick();
  assert.equal(requests.length, before, 'coverage uses the existing report');
  assert.match(get('coverage-limitations').innerHTML, /1 user-cancelled/);
  assert.match(get('coverage-limitations').innerHTML, /1 interrupted/);
  assert.match(get('coverage-limitations').innerHTML, /3 background plugin/);
  assert.match(get('coverage-limitations').innerHTML, /1 conversation-compaction/);
  report.promptCredits.prompts++;
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, false);
  assert.match(get('coverage-message').textContent, /1 prompts have unresolved cost coverage/);
  get('coverage-dismiss').onclick();
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, true, 'dismissal survives an unchanged refresh');
  report.promptCredits.unlinkedRequests++;
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, false);
  assert.match(get('coverage-message').textContent, /1 model calls could not be linked/);
  Object.assign(report, buildReport([], {}));
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, true);
  assert.doesNotMatch(get('coverage-limitations').innerHTML, /background plugin/);
  report.coverageDetails.unreadable = [{ file: 'fixture', state: 'error', failed: true }];
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, false);
  assert.match(get('coverage-message').textContent, /could not be fully read/);
});

test('optional prompt lengths and tool outcomes stay in coverage details without a warning', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('coverage').hidden, true);
  report.efficiency.interactions = { prompts: 2, promptSamples: 1, averagePromptChars: 14, observedSessions: 1 };
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, true);
  const before = requests.length;
  get('coverage-open').onclick();
  assert.match(get('coverage-limitations').innerHTML, /Some prompt lengths are not recorded/);
  assert.equal(requests.length, before);
  assert.match(get('efficiency-conversations').innerHTML, /14 characters across 1 messages/);

  report.efficiency.interactions.promptSamples = 2;
  const row = { name: 'tool', server: 'server', calls: 2, successes: 1, failures: 0, unknown: 1, successRate: 100, lastUsed: null };
  report.tools.rows = [row];
  report.mcp.rows = [{ ...row, name: 'server' }];
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, true);
  assert.match(get('coverage-limitations').innerHTML, /Some tool calls have no recorded outcome/);
  assert.doesNotMatch(get('coverage-limitations').innerHTML, /prompt lengths/);
  for (const id of ['mcp', 'efficiency-reliability']) {
    assert.match(get(id).innerHTML, /100%/);
    assert.doesNotMatch(get(id).innerHTML, /100% \*/);
  }
  assert.match(get('efficiency-reliability').innerHTML, /Success rate uses only known outcomes/);
});

test('optional reasoning stays informational while missing primary prompt tokens still warn', async () => {
  const { get, report, records, now } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const history = [records[0], { ...records[1], reasoning: 30 }];
  Object.assign(report, buildReport(history, {}, now));
  report.promptCredits.unlinkedRequests = 0;
  await get('refresh').onclick();
  assert.equal(report.totals.missing.reasoning, 0);
  assert.equal(report.efficiency.summary.reasoningRequests, 1);
  assert.equal(get('coverage').hidden, true);
  get('coverage-open').onclick();
  assert.match(get('coverage-limitations').innerHTML, /Reasoning counts are only partly measured/);
  jumpTokenTopic(get, 'output');
  assert.match(get('token-topic-body').innerHTML, />5</);

  Object.assign(report, buildReport(records, {}, now));
  Object.assign(report.promptCredits, { prompts: 2, eligiblePrompts: 2, unlinkedRequests: 0,
    work: { tokenPrompts: 1, averageTokens: 120 } });
  assert.equal(report.totals.missingTokens, 0, 'whole-prompt measurements can include calls outside the receipt date filter');
  await get('refresh').onclick();
  assert.equal(get('coverage').hidden, false);
  assert.match(get('coverage-message').textContent, /Some eligible prompts have incomplete token counts across their linked calls/);
  jumpTokenTopic(get, 'prompts');
  assert.match(get('token-topic-body').innerHTML, />120 \*</);
  get('coverage-dismiss').onclick();
  assert.match(get('token-topic-body').innerHTML, />120</);
});

test('Usage selections cross-filter metrics, preserve gray alternatives, and clear on repeat', async () => {
  const { records, now } = await requestPanel();
  const data = [
    { ...records[0], key: 'a', model: 'Alpha', project: 'One' },
    { ...records[0], key: 'b', model: 'Beta', project: 'One', nanoAiu: 1000000000 },
    { ...records[0], key: 'c', model: 'Alpha', project: 'Two' },
  ];
  const makeReport = input => ({ ...buildReport(data, input, now), sources: [], coverage: {} });
  const { get, server, requests } = await mountPanel(makeReport({ range: '7d' }));
  server.report = makeReport;
  const choose = (type, value) => get(`${type}s-summary`).onclick({ target: { closest: () => ({ dataset: { [type === 'model' ? 'usageModel' : 'usageProject']: value } }) } });
  assert.match(get('projects-summary').innerHTML, />User prompts<\/th><th>Model turns<\/th>/);
  assert.doesNotMatch(get('projects-summary').innerHTML, />Requests<\/th>/);
  assert.match(get('projects-summary').innerHTML, />\u2014<\/td>/);
  const original = get('token-total').textContent;
  await choose('model', 'Alpha');
  assert.equal(get('model').value, 'Alpha');
  assert.match(get('models-summary').innerHTML, /data-usage-model="Alpha"[^>]*aria-pressed="true"/);
  assert.match(get('models-summary').innerHTML, /class="mark choice-muted"[^>]*data-usage-model="Beta"/);
  assert.notEqual(get('token-total').textContent, original);
  assert.match(get('token-context').textContent, /2 requests/);
  await choose('project', 'One');
  assert.equal(get('project').value, 'One');
  assert.match(get('token-context').textContent, /1 requests/);
  assert.match(get('projects-summary').innerHTML, /<tr class="choice-muted">.*?data-usage-project="Two"/);
  assert.match(get('projects-summary').innerHTML, /data-usage-project="One" aria-pressed="true"/);
  assert.match(get('models-summary').innerHTML, /data-usage-model="Beta"/);
  assert.deepEqual(requests.at(-1).input.models, ['Alpha']);
  assert.equal(requests.at(-1).input.project, 'One');
  await choose('model', 'Alpha');
  assert.equal(get('model').value, '');
  assert.match(get('token-context').textContent, /2 requests/);
  let prevented = false;
  await get('models-summary').onkeydown({ key: ' ', preventDefault() { prevented = true; }, target: { closest: () => ({ dataset: { usageModel: 'Beta' } }) } });
  assert.ok(prevented);
  assert.equal(get('model').value, 'Beta');
  assert.equal(get('hero-credits').textContent, '1');
  await choose('project', 'One');
  assert.equal(get('project').value, '');
  assert.equal(get('model').value, 'Beta', 'clearing a dimension preserves the other selection');
  get('clear-filters').onclick(); await new Promise(setImmediate);
  assert.equal(get('token-total').textContent, original);
  assert.doesNotMatch(get('models-summary').innerHTML, /choice-muted/);
  assert.doesNotMatch(get('projects-summary').innerHTML, /choice-muted/);
  assert.equal(requests.filter(r => r.method === 'usage.inventory').length, 1, 'filters reuse current inventory');
  assert.ok(requests.every(r => ['usage.report', 'usage.inventory'].includes(r.method)), 'selections use the cached report without rescans or detail lookups');
  get('model').value = 'Missing <model>'; get('model').onchange(); await new Promise(setImmediate);
  assert.match(get('models-summary').innerHTML, /data-usage-model="Missing &lt;model&gt;"[^>]*aria-pressed="true"/);
  assert.match(get('token-context').textContent, /0 requests/);
  await choose('model', 'Missing <model>');
  assert.equal(get('token-total').textContent, original);
});

test('Usage sorts rank all choices before limits, keep selections, and do not fetch', async () => {
  const report = { ...buildReport([], { range: '7d' }), sources: [], coverage: {} };
  const rows = Array.from({ length: 12 }, (_, i) => ({ name: String.fromCharCode(65 + i), total: (12 - i) * 100,
    credits: i === 0 ? null : i === 1 ? 0 : i, requests: i === 2 ? 100 : 1, userPrompts: i === 3 ? 100 : i === 0 ? null : 0, uncertainPrompts: 0 }));
  report.usageChoices = { models: rows, projects: rows };
  report.options.models = report.options.projects = rows.map(r => r.name);
  const { get, requests } = await mountPanel(report);
  const names = type => [...get(`${type}s-summary`).innerHTML.matchAll(new RegExp(`data-usage-${type}="([^"]+)"`, 'g'))].map(m => m[1]).join('');
  const sort = (type, value) => { get(`${type}s-sort`).value = value; get(`${type}s-sort`).onchange(); };
  const before = requests.length;
  assert.equal(names('model'), 'ABCDEFGH');
  assert.equal(names('project'), 'ABCDEFGHIJ');
  sort('model', 'credits'); assert.equal(names('model'), 'LKJIHGFE');
  sort('project', 'credits'); assert.equal(names('project'), 'LKJIHGFEDC');
  sort('model', 'requests'); assert.equal(names('model'), 'CABDEFGH');
  sort('project', 'requests'); assert.equal(names('project'), 'CABDEFGHIJ');
  sort('project', 'userPrompts'); assert.equal(names('project'), 'DBCEFGHIJK', 'known zero prompts sort ahead of unavailable');
  sort('model', 'name'); assert.equal(names('model'), 'ABCDEFGH');
  sort('project', 'name'); assert.equal(names('project'), 'ABCDEFGHIJ');
  sort('model', 'total'); sort('project', 'total');
  assert.equal(names('model'), 'ABCDEFGH'); assert.equal(names('project'), 'ABCDEFGHIJ');
  assert.equal(requests.length, before, 'sorting only renders loaded data');
  assert.equal(rows.map(r => r.name).join(''), 'ABCDEFGHIJKL', 'source report order stays intact');
  get('model').value = get('project').value = 'L';
  sort('model', 'name'); sort('project', 'name');
  assert.equal(names('model'), 'ABCDEFGHL'); assert.equal(names('project'), 'ABCDEFGHIJL');
  assert.match(get('models-summary').innerHTML, /data-usage-model="L"[^>]*aria-pressed="true"/);
  assert.match(get('projects-summary').innerHTML, /data-usage-project="L"[^>]*aria-pressed="true"/);
  await get('refresh').onclick();
  assert.equal(get('models-sort').value, 'name'); assert.equal(get('projects-sort').value, 'name');
  assert.equal(names('model'), 'ABCDEFGHL'); assert.equal(names('project'), 'ABCDEFGHIJL');
  report.usageChoices.models = rows.slice(0, 3);
  get('model').value = '';
  await get('refresh').onclick();
  sort('model', 'credits'); assert.equal(names('model'), 'CBA', 'known zero credits sort ahead of unavailable');
});

test('Usage token sorting keeps recorded zero totals ahead of unavailable totals at the cutoff', async () => {
  const { records, now } = await requestPanel();
  const data = Array.from({ length: 12 }, (_, i) => ({ ...records[0], key: `sort-${i}`, model: String.fromCharCode(65 + i), project: String.fromCharCode(65 + i),
    input: i ? 0 : null, inputTotal: i ? 0 : null, output: i ? 0 : null, cacheRead: 0, cacheWrite: 0 }));
  const report = { ...buildReport(data, { range: '7d' }, now), sources: [], coverage: {} };
  assert.equal(report.usageChoices.models.find(r => r.name === 'A').knownTokenRequests, 0);
  assert.equal(report.usageChoices.models.find(r => r.name === 'A').total, 0);
  const { get } = await mountPanel(report);
  const names = type => [...get(`${type}s-summary`).innerHTML.matchAll(new RegExp(`data-usage-${type}="([^"]+)"`, 'g'))].map(m => m[1]).join('');
  assert.equal(names('model'), 'BCDEFGHI');
  assert.equal(names('project'), 'BCDEFGHIJK');
});

test('shared chart tooltips keep their width and flip away from viewport edges', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, listeners, document, viewport, requests } = await mountPanel(report);
  const popup = get('tip');
  popup.style = {};
  Object.defineProperty(popup, 'offsetWidth', { get: () => Math.min(240, (document.documentElement.clientWidth || viewport.innerWidth) - 16) });
  Object.defineProperty(popup, 'offsetHeight', { get: () => 110 });
  const move = (x, y, title = 'Output') => listeners.get('pointermove')({ clientX: x, clientY: y, target: { closest: () => ({ dataset: { tip: JSON.stringify({ title, rows: [['Tokens', 4400], ['Share of recorded tokens', '0.4%']] }) } }) } });
  const before = requests.length;
  move(100, 100);
  assert.equal(popup.hidden, false);
  assert.equal(popup.style.left, '112px');
  assert.equal(popup.style.top, '112px');
  move(1180, 100);
  assert.equal(popup.style.left, '928px', 'whole popup moves left of the pointer with a gap');
  assert.equal(popup.style.top, '112px');
  move(1180, 790, '<Daily tokens>');
  assert.equal(popup.style.left, '928px');
  assert.equal(popup.style.top, '668px', 'popup flips above the pointer near the bottom');
  assert.match(popup.innerHTML, /&lt;Daily tokens&gt;/);
  assert.match(popup.innerHTML, /4\.4K/);
  move(0, 0);
  assert.equal(popup.style.left, '12px');
  assert.equal(popup.style.top, '12px');
  document.documentElement.clientWidth = 1185;
  move(940, 100);
  assert.equal(popup.style.left, '688px', 'placement excludes the scrollbar area');
  delete document.documentElement.clientWidth;
  viewport.innerWidth = 240;
  for (const x of [0, 120, 239]) {
    move(x, 100);
    assert.equal(popup.style.left, '8px', 'clamp within a viewport too narrow to fit on either side');
    assert.equal(popup.offsetWidth, 224, 'pointer movement does not change the width');
  }
  document.documentElement.clientWidth = 225;
  move(220, 100);
  assert.equal(popup.offsetWidth, 209, 'narrow canvas cap also excludes the scrollbar');
  assert.equal(popup.style.left, '8px');
  assert.equal(parseFloat(popup.style.left) + popup.offsetWidth, 217, 'right edge retains an eight-pixel margin before the scrollbar');
  delete document.documentElement.clientWidth;
  viewport.innerWidth = 1200;
  move(1180, 100, 'A different chart');
  assert.equal(popup.style.left, '928px', 'restored viewport uses the same shared placement');
  listeners.get('pointermove')({ target: { closest: () => null } });
  assert.equal(popup.hidden, true);
  move(100, 100);
  listeners.get('pointerleave')();
  assert.equal(popup.hidden, true);
  assert.equal(requests.length, before, 'hover and repositioning never fetch data');
});

test('tooltip movement reuses markup and dimensions until its content, viewport or formatting changes', async () => {
  const { get, listeners, viewport, requests } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} });
  const popup = get('tip');
  let markup = '', writes = 0, reads = 0;
  Object.defineProperty(popup, 'innerHTML', { get: () => markup, set(value) { markup = value; writes++; } });
  Object.defineProperty(popup, 'offsetWidth', { get() { reads++; return 240; } });
  Object.defineProperty(popup, 'offsetHeight', { get() { reads++; return 110; } });
  const mark = { dataset: { tip: JSON.stringify({ title: '<Tokens>', rows: [['Input', 2131]] }) } };
  const move = (x = 100) => listeners.get('pointermove')({ clientX: x, clientY: 100, target: { closest: () => mark } });
  const before = requests.length;
  for (let i = 0; i < 1000; i++) move(100 + i % 100);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(popup.style.left, '211px', 'placement still follows every pointer movement');
  assert.match(markup, /&lt;Tokens&gt;/);
  assert.match(markup, /2\.1K/);
  listeners.get('pointerleave')();
  move();
  assert.equal(writes, 1, 'reopening the same tooltip reuses the cached layout');
  mark.dataset.tip = JSON.stringify({ title: 'Changed', rows: [['Input', 2131]] });
  move();
  assert.equal(writes, 2);
  viewport.innerWidth = 800;
  move();
  assert.equal(writes, 3);
  assert.equal(reads, 6);
  assert.equal(requests.length, before, 'pointer movement never loads data');
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  await get('settings-save').onclick();
  move();
  assert.equal(writes, 4);
  assert.ok(markup.includes((2131).toLocaleString()));
  await get('settings-open').onclick();
  get('text-size').value = 'large';
  await get('settings-save').onclick();
  move();
  assert.equal(writes, 5);
  assert.equal(reads, 10);
});

test('daily keyboard focus shows values without fetching and hides them on blur or Escape', async () => {
  const { get, listeners, requests } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} });
  const popup = get('tip');
  Object.assign(popup, { style: {}, offsetWidth: 240, offsetHeight: 110 });
  let keyboard = true;
  const mark = {
    dataset: { tip: JSON.stringify({ title: 'Nov 14', rows: [['AI credits', '1.2']] }) },
    matches: selector => selector === ':focus-visible' && keyboard,
    getBoundingClientRect: () => ({ x: 1100, y: 100, width: 40 }),
  };
  const before = requests.length;
  const focus = () => get('daily').onfocusin({ target: { closest: () => mark } });
  focus();
  assert.equal(popup.hidden, false);
  assert.match(popup.innerHTML, /AI credits/);
  assert.match(popup.innerHTML, /1\.2/);
  assert.equal(popup.style.left, '868px', 'keyboard popup flips at the viewport edge too');
  listeners.get('keydown')({ key: 'Escape' });
  assert.equal(popup.hidden, true);
  focus();
  get('daily').onfocusout();
  assert.equal(popup.hidden, true);
  keyboard = false;
  focus();
  assert.equal(popup.hidden, true, 'pointer focus does not reopen a dismissed tooltip');
  assert.equal(requests.length, before);
});

test('footer actions share controls and logs copy safely with offline and clipboard fallbacks', async () => {
  const report = { ...buildReport([], { range: '7d' }), sources: [], coverage: {} };
  const { get, requests, server, windowListeners, document, timeouts } = await mountPanel(report);
  assert.equal(get('footer-refresh').onclick, get('refresh').onclick);
  assert.equal(get('footer-settings').onclick, get('settings-open').onclick);
  await finishReconnect(timeouts, get('footer-refresh').onclick());
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').method, 'usage.refresh');
  assert.equal(get('footer-refresh').disabled, false);
  await get('footer-settings').onclick();
  assert.equal(get('settings-dialog').open, true);
  get('settings-close').onclick();
  const feedback = new URL(get('feedback').href);
  assert.equal(feedback.origin + feedback.pathname, 'https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/new');
  assert.match(feedback.searchParams.get('body'), /Usage Insights v\d+\.\d+\.\d+/);
  assert.doesNotMatch(feedback.searchParams.get('body'), /history\.scan/);
  assert.equal(get('feedback').getAttribute('target'), '_blank');
  windowListeners.get('error')({ error: new TypeError('PRIVATE_PROMPT'), lineno: 20, colno: 7 });
  windowListeners.get('unhandledrejection')({ reason: new Error('SECRET_TOKEN') });
  await get('logs-open').onclick();
  assert.equal(get('logs-dialog').open, true);
  assert.match(get('logs-output').value, /history\.scan|durationMs/);
  assert.match(get('logs-output').value, /ui\.render/);
  assert.match(get('logs-output').value, /Load timing summary/);
  assert.match(get('logs-output').value, /Initial usage load.*finished/);
  assert.match(get('logs-output').value, /Response download and decoding/);
  assert.match(get('logs-output').value, /"loadKind":"manual"/);
  assert.match(get('logs-output').value, /ui\.error/);
  assert.match(get('logs-output').value, /ui\.rejection/);
  assert.doesNotMatch(get('logs-output').value, /PRIVATE|SECRET/);
  await get('logs-copy').onclick();
  assert.equal(server.copied.at(-1), get('logs-output').value);
  server.clipboardError = true;
  await get('logs-copy').onclick();
  assert.equal(get('logs-output').selected, true);
  assert.equal(document.activeElement, get('logs-output'));
  server.transportError = true;
  await finishReconnect(timeouts, get('footer-refresh').onclick());
  assert.equal(get('content').hidden, false);
  await get('logs-reload').onclick();
  assert.match(get('logs-status').textContent, /last server snapshot/);
  assert.match(get('logs-output').value, /diagnostics\.read/);
  assert.match(get('logs-output').value, /"event":"ui.load"[^\n]*"phase":"failed"/);
  assert.doesNotMatch(get('logs-output').value, /PRIVATE|SECRET/);
  assert.equal(get('logs-copy').disabled, false);
  get('logs-close').onclick();
  assert.equal(get('logs-dialog').open, false);
});

function releaseNavigation(get, document) {
  const lists = {};
  for (const [id, key] of [['release-families', 'releaseFamily'], ['release-versions', 'releaseVersion']]) {
    const node = get(id); let html = '', buttons = [];
    Object.defineProperty(node, 'innerHTML', { get: () => html, set(value) {
      html = value;
      buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(([, tag]) => {
        const attrs = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
        return { dataset: { [key]: attrs.get(key === 'releaseFamily' ? 'data-release-family' : 'data-release-version') },
          setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: k => attrs.get(k),
          focus() { document.activeElement = this; }, scrollIntoView() {},
          click() { this.focus(); node.onclick({ target: { closest: () => this } }); } };
      });
    } });
    node.querySelectorAll = () => buttons;
    node.querySelector = () => buttons.find(button => button.getAttribute('aria-pressed') === 'true');
    lists[key] = value => buttons.find(button => button.dataset[key] === value);
  }
  return lists;
}

test('footer version opens clickable local release history on every tab and restores focus on close', async () => {
  const { get, requests, document, server } = await requestPanel();
  const { releaseFamily, releaseVersion } = releaseNavigation(get, document);
  const notes = JSON.parse(await fs.readFile(new URL('../release-notes.json', import.meta.url), 'utf8'));
  const family = version => version.split('.').slice(0, 2).join('.');
  const installedFamily = family(notes[0].version);
  assert.equal(get('plugin-version').getAttribute('aria-haspopup'), 'dialog');
  assert.equal(get('plugin-version').getAttribute('aria-controls'), 'release-notes-dialog');
  const dialog = get('release-notes-dialog');
  dialog.close = () => { dialog.open = false; dialog.onclose(); };
  const before = requests.length;
  server.transportError = true;
  for (const view of ['usage', 'breakdown', 'efficiency']) {
    get('view').onclick({ target: { dataset: { view } } });
    get('plugin-version').onclick();
    assert.equal(dialog.open, true);
    assert.equal(get('release-note-title').textContent, `v${notes[0].version}`);
    assert.equal(get('release-summary').textContent, notes[0].summary);
    assert.equal(document.activeElement, releaseVersion(notes[0].version));
    assert.equal((get('release-versions').innerHTML.match(/data-release-version=/g) || []).length, notes.filter(note => family(note.version) === installedFamily).length);
    for (const release of notes) {
      if (!releaseVersion(release.version)) releaseFamily(family(release.version)).click();
      releaseVersion(release.version).click();
      assert.equal(get('release-summary').textContent, release.summary);
      assert.equal(get('release-note-title').textContent, `v${release.version}`);
      assert.equal(releaseVersion(release.version).getAttribute('aria-pressed'), 'true');
      assert.equal(document.activeElement, releaseVersion(release.version), 'selection keeps focus on the clicked version');
    }
    get('release-notes-close').onclick();
    assert.equal(dialog.open, false);
    assert.equal(document.activeElement, get('plugin-version'));
  }
  assert.equal(requests.length, before, 'release browsing remains offline on every tab');
  server.transportError = false;
  get('plugin-version').onclick();
  releaseFamily(family(notes.at(-1).version)).click();
  releaseVersion(notes.at(-1).version).click();
  await get('refresh').onclick();
  assert.equal(dialog.open, true);
  assert.equal(get('release-note-title').textContent, `v${notes.at(-1).version}`);
  assert.equal(get('release-summary').textContent, notes.at(-1).summary);
  assert.equal(document.activeElement, releaseVersion(notes.at(-1).version));
  dialog.onclose();
  assert.equal(document.activeElement, get('plugin-version'), 'native close events restore focus too');
});

test('release families show their versions without mixing notes or making requests', async () => {
  const { version } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const installedFamily = version.split('.').slice(0, 2).join('.');
  const notes = [{ version, summary: 'Current release' }, { version: '0.0.2', summary: '<b>Plain text</b>' }, { version: '0.0.1', summary: 'First preview' }];
  const { get, document, requests } = await mountPanel({ ...buildReport([], {}), sources: [], coverage: {} }, undefined, notes);
  const { releaseFamily, releaseVersion } = releaseNavigation(get, document);
  const before = requests.length;
  get('plugin-version').onclick();
  assert.ok(releaseFamily(installedFamily));
  assert.match(get('release-families').innerHTML, /data-release-family="0\.0"/);
  releaseFamily('0.0').click();
  assert.equal(releaseFamily('0.0').getAttribute('aria-pressed'), 'true');
  assert.equal(releaseFamily(installedFamily).getAttribute('aria-pressed'), 'false');
  assert.equal(releaseVersion(version), undefined);
  assert.equal(get('release-note-title').textContent, 'v0.0.2');
  assert.equal(get('release-summary').textContent, '<b>Plain text</b>');
  assert.equal(get('release-summary').innerHTML, '', 'notes are rendered as text');
  releaseVersion('0.0.1').click();
  assert.equal(get('release-summary').textContent, 'First preview');
  assert.equal(releaseVersion('0.0.2').getAttribute('aria-pressed'), 'false');
  get('release-notes-close').onclick();
  get('plugin-version').onclick();
  assert.equal(get('release-note-title').textContent, `v${version}`);
  assert.equal(releaseFamily(installedFamily).getAttribute('aria-pressed'), 'true');
  assert.equal(requests.length, before);
});

test('a stalled server log request times out while local logs remain copyable', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, timeouts } = await mountPanel(report);
  server.logsStalled = true;
  const loading = get('logs-open').onclick();
  const logsTimeout = timeouts.at(-1);
  assert.equal(get('logs-copy').disabled, false);
  get('logs-download').onclick();
  assert.match(await server.downloads[0].blob.text(), /ui\.started/);
  await get('logs-copy').onclick();
  assert.match(server.copied[0], /ui\.started/);
  assert.equal(logsTimeout.ms, 3000);
  logsTimeout.callback(); await loading;
  assert.match(get('logs-status').textContent, /Server logs are unavailable/);
  assert.match(get('logs-output').value, /AbortError/);
  assert.equal(get('logs-reload').disabled, false);
});
