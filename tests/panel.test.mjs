import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport, buildRequestPage } from '../src/core/copilot-report.mjs';
import { mergeMcpInventory } from '../src/core/integrations.mjs';

async function mountPanel(report, config = { textSize: 'small', extraHomes: [], disabledHomes: [] }) {
  const html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  const nodes = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const attrs = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    return [id, { value: '', dataset: {}, href: attrs.get('href'), innerHTML: '', textContent: '', clientWidth: 500, clientHeight: 155, hidden: /\shidden\b/.test(tag),
      setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k),
      focus() { document.activeElement = this; },
      select() { this.selected = true; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelectorAll: () => [], querySelector: () => null, contains: () => false }];
  }));
  const get = id => { assert.ok(nodes.has(id), `Element ${id} exists`); return nodes.get(id); };
  for (const [, id, choices] of html.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...choices.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
    get(id).value = (options.find(([, , attrs]) => /\bselected\b/.test(attrs)) || options[0])?.[1] || '';
  }
  get('cache').checked = true;
  const requests = [], intervals = [], timeouts = [], listeners = new Map(), windowListeners = new Map(), rootStyle = new Map(), server = { config, saveError: '', copied: [] };
  const document = { getElementById: get, activeElement: null, hidden: false, addEventListener: (name, callback) => listeners.set(name, callback), documentElement: {
      classList: { toggle() {} }, style: { setProperty: (k, v) => rootStyle.set(k, String(v)) },
  } };
  const context = createContext({
    innerWidth: 1200, innerHeight: 800,
    document,
    window: { addEventListener: (name, callback) => windowListeners.set(name, callback) }, matchMedia: () => ({ matches: false }), setInterval: (callback, ms) => intervals.push({ callback, ms }),
    navigator: { clipboard: { writeText: async text => { if (server.clipboardError) throw new Error('Clipboard unavailable'); server.copied.push(text); } } },
    AbortController, setTimeout: (callback, ms) => { const timer = { callback, ms }; timeouts.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cleared = true; },
    fetch: async (url, options) => {
      const message = JSON.parse(options.body); requests.push(message);
      if (server.transportError) throw new Error('PRIVATE_NETWORK_ERROR');
      if (message.method === 'diagnostics.get' && server.logsStalled) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))));
      if (message.method === 'diagnostics.get') return { ok: true, json: async () => ({ version: 'test-version', runtime: { node: 'v24', platform: 'win32', arch: 'x64' }, startedAt: new Date().toISOString(), limit: 300, dropped: 0, entries: [{ at: new Date().toISOString(), level: 'info', event: 'history.scan', durationMs: 25 }] }) };
      if (message.method === 'settings.get') return { ok: true, json: async () => ({ ...server.config, defaultHome: '/copilot' }) };
      if (message.method === 'efficiency.context') return { ok: true, json: async () => server.contextSnapshot || { available: false, reason: 'unsupported' } };
      if (message.method === 'settings.set') {
        if (server.saveError) return { ok: false, json: async () => ({ error: server.saveError }) };
        server.config = { ...server.config, ...message.input };
        report.preferences = { textSize: server.config.textSize, simplifyNumbers: server.config.simplifyNumbers ?? true };
        return { ok: true, json: async () => server.config };
      }
      if (message.method === 'usage.requests') {
        if (server.requestError) return { ok: false, json: async () => ({ error: server.requestError }) };
        return { ok: true, json: async () => server.requestPage(message.input) };
      }
      assert.ok(['usage.report', 'usage.refresh'].includes(message.method));
      return { ok: true, json: async () => report };
    },
  });
  new Script(html.match(/<script>([\s\S]*)<\/script>/)[1]).runInContext(context);
  await new Promise(setImmediate);
  return { get, nodes, requests, rootStyle, server, document, intervals, listeners, windowListeners, timeouts };
}

test('footer actions share controls and logs copy safely with offline and clipboard fallbacks', async () => {
  const report = { ...buildReport([], { range: '7d' }), sources: [], coverage: {} };
  const { get, requests, server, windowListeners, document } = await mountPanel(report);
  assert.equal(get('footer-refresh').onclick, get('refresh').onclick);
  assert.equal(get('footer-settings').onclick, get('settings-open').onclick);
  await get('footer-refresh').onclick();
  assert.equal(requests.at(-1).method, 'usage.refresh');
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
  await get('footer-refresh').onclick();
  assert.equal(get('content').hidden, true);
  await get('logs-reload').onclick();
  assert.match(get('logs-status').textContent, /Server logs are unavailable/);
  assert.match(get('logs-output').value, /diagnostics\.read/);
  assert.doesNotMatch(get('logs-output').value, /PRIVATE|SECRET/);
  assert.equal(get('logs-copy').disabled, false);
  get('logs-close').onclick();
  assert.equal(get('logs-dialog').open, false);
});

test('a stalled server log request times out while local logs remain copyable', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, timeouts } = await mountPanel(report);
  server.logsStalled = true;
  const loading = get('logs-open').onclick();
  assert.equal(get('logs-copy').disabled, false);
  await get('logs-copy').onclick();
  assert.match(server.copied[0], /ui\.started/);
  assert.equal(timeouts.at(-1).ms, 3000);
  timeouts.at(-1).callback(); await loading;
  assert.match(get('logs-status').textContent, /Server logs are unavailable/);
  assert.match(get('logs-output').value, /AbortError/);
  assert.equal(get('logs-reload').disabled, false);
});

async function requestPanel() {
  const now = new Date(2026, 10, 14, 12), parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  for (let i = 0; i < 28; i++) parser.push(JSON.stringify({ type: 'session.usage_record', id: `call-${i}`, timestamp: now.toISOString(), data: { usage: {
    provider: { kind: 'copilot' }, model: '<Sonnet>', inputTokens: 100, outputTokens: 20, reasoningTokens: 5,
    cacheReadTokens: 60, cacheWriteTokens: 10, copilotUsage: { totalNanoAiu: 250000000 }, duration: 1000, initiator: 'agent', isAuto: false,
  } } }));
  const records = parser.snapshot().records.map(r => ({ ...r, sessionName: '<Session>' }));
  const report = { ...buildReport(records, {}, now), sources: [], coverage: {} };
  const panel = await mountPanel(report);
  panel.server.requestPage = input => ({ ...buildRequestPage(records, input, now), rows: buildRequestPage(records, input, now).rows.map(r => ({ ...r,
    ...(input.id ? { prompt: { available: true, text: '<script>unsafe()</script> Full original prompt', truncated: false } } : {}),
  })) });
  const click = dataset => panel.get('breakdown').onclick({ target: { closest: () => ({ dataset }) } });
  return { ...panel, click, report, records, now };
}

test('model request expansion loads on demand, pages safely, and refreshes selected details', async () => {
  const { get, requests, click, server } = await requestPanel();
  const html = () => get('breakdown').innerHTML;
  assert.equal(requests.filter(r => r.method === 'usage.requests').length, 0);
  assert.match(html(), /data-request-model="&lt;Sonnet&gt;" aria-expanded="false"/);
  await click({ requestModel: '<Sonnet>' });
  assert.match(html(), /28 model requests/);
  assert.match(html(), /1–25/);
  assert.match(html(), /&lt;Session&gt;/);
  assert.match(html(), /<th>Started by<\/th>/);
  assert.doesNotMatch(html(), /<th>Prompt<\/th>|Prompt unavailable|<img|<script|Full original prompt/);
  assert.equal(requests.at(-1).input.model, '<Sonnet>');
  await click({ requestPage: '25' });
  assert.match(html(), /26–28/);
  const requestId = JSON.stringify(['receipt', 's1', 'call-7']);
  await click({ requestId });
  assert.match(html(), /Original prompt/);
  assert.match(html(), /&lt;script&gt;unsafe\(\)&lt;\/script&gt; Full original prompt/);
  assert.match(html(), /Reasoning \(part of output\)/);
  assert.match(html(), /Agent continuation/);
  assert.doesNotMatch(html(), /<script/);
  const original = server.requestPage;
  server.requestPage = input => {
    const page = original(input);
    return { ...page, rows: page.rows.map(r => ({ ...r, duration: 2000, prompt: { available: false, text: '', truncated: false } })) };
  };
  await get('refresh').onclick();
  await new Promise(setImmediate);
  assert.match(html(), /26–28/);
  assert.match(html(), /Prompt unavailable: the local log/);
  assert.match(html(), /<dt>Duration<\/dt><dd>2 s<\/dd>/);
  assert.doesNotMatch(html(), /Full original prompt/);
  await click({ requestId });
  assert.doesNotMatch(html(), /Full original prompt/);
  get('session').value = 'another-session';
  await get('session').onchange();
  assert.doesNotMatch(html(), /model request[s<]|Full original prompt/);
  assert.match(html(), /aria-expanded="false"/);
});

test('request expansion handles retry and ignores responses after collapse or filter changes', async () => {
  const { get, server, click } = await requestPanel();
  server.requestError = '<Request failed>';
  await click({ requestModel: '<Sonnet>' });
  assert.match(get('breakdown').innerHTML, /Could not load requests: &lt;Request failed&gt;/);
  server.requestError = '';
  await click({ requestPage: '0' });
  assert.match(get('breakdown').innerHTML, /28 model requests/);
  const original = server.requestPage;
  let resolve;
  server.requestPage = input => new Promise(done => { resolve = () => done(original(input)); });
  const loading = click({ requestId: JSON.stringify(['receipt', 's1', 'call-0']) });
  await new Promise(setImmediate);
  assert.match(get('breakdown').innerHTML, /Loading request details/);
  await click({ requestModel: '<Sonnet>' });
  resolve(); await loading;
  assert.doesNotMatch(get('breakdown').innerHTML, /Full original prompt|Original prompt/);
  const reopening = click({ requestModel: '<Sonnet>' });
  await new Promise(setImmediate);
  get('project').value = 'different-project';
  await get('project').onchange();
  resolve(); await reopening;
  assert.doesNotMatch(get('breakdown').innerHTML, /28 model requests|Preview/);
});

test('request paging keeps keyboard focus during loading and moves to an enabled control at page edges', async () => {
  const { get, server, click, document } = await requestPanel();
  const node = get('breakdown');
  let markup = node.innerHTML, buttons = [];
  document.body = { dataset: {} };
  Object.defineProperty(node, 'innerHTML', { get: () => markup, set(value) {
    if (buttons.includes(document.activeElement)) document.activeElement = document.body;
    markup = value;
    buttons = [...value.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => ({
      dataset: Object.fromEntries([...attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      disabled: /\sdisabled(?:\s|$)/.test(attrs), focus() { if (!this.disabled) document.activeElement = this; },
    }));
  } });
  node.querySelectorAll = selector => selector === 'button' ? buttons : [];
  await click({ requestModel: '<Sonnet>' });
  const original = server.requestPage;
  let resolve;
  server.requestPage = input => new Promise(done => { resolve = () => done(original(input)); });
  for (const [direction, offset, expected] of [['next', '25', 'previous'], ['previous', '0', 'next']]) {
    buttons.find(b => b.dataset.requestPageDirection === direction).focus();
    const loading = click({ requestPage: offset, requestPageDirection: direction });
    await new Promise(setImmediate);
    assert.equal(document.activeElement.dataset.requestPageDirection, direction, 'loading does not remove focus');
    assert.equal(document.activeElement.disabled, false);
    resolve(); await loading;
    assert.equal(document.activeElement.dataset.requestPageDirection, expected, 'page edge restores focus to an enabled paging action');
    assert.equal(document.activeElement.disabled, false);
  }
});

test('project sessions expand and page locally, sort the full set, and reset or clamp pages as needed', async () => {
  const { get, report, records, now, requests, click, document } = await requestPanel();
  const sessions = Array.from({ length: 52 }, (_, i) => ({ ...records[0], key: `request-${i}`, sessionId: `session-${i}`,
    sessionName: `Session ${String(i).padStart(2, '0')}`, output: i, inputTotal: 100, input: 30 }));
  Object.assign(report, buildReport(sessions, {}, now));
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  const node = get('breakdown');
  let markup = node.innerHTML, buttons = [];
  document.body = { dataset: {} };
  Object.defineProperty(node, 'innerHTML', { get: () => markup, set(value) {
    if (buttons.includes(document.activeElement)) document.activeElement = document.body;
    markup = value;
    buttons = [...value.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => ({
      dataset: Object.fromEntries([...attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      disabled: /\sdisabled(?:\s|$)/.test(attrs), focus() { if (!this.disabled) document.activeElement = this; },
    }));
  } });
  node.querySelectorAll = selector => selector === 'button' ? buttons : [];
  get('sort').value = 'total'; get('sort').onchange();
  const html = () => node.innerHTML, sessionTable = () => html().match(/<table><thead><tr><th>Session<\/th>[\s\S]*?<\/table>/)?.[0] || '';
  const rowCount = () => [...sessionTable().matchAll(/<tr>/g)].length - 1;
  const before = requests.length;
  assert.doesNotMatch(html(), /<th>Session<\/th>/);
  const project = sessions[0].project;
  buttons.find(b => b.dataset.projectName === project).focus();
  await click({ projectName: project });
  assert.equal(document.activeElement.dataset.projectName, project, 'expanding keeps the project toggle focused');
  assert.match(html(), /52 sessions/);
  assert.match(html(), /1–25/);
  assert.equal(rowCount(), 25);
  assert.match(html(), /Session 51/);
  assert.doesNotMatch(html(), /Session 00/);
  await click({ sessionPage: '25' });
  assert.match(html(), /26–50/);
  buttons.find(b => b.dataset.sessionPageDirection === 'next').focus();
  await click({ sessionPage: '50' });
  assert.match(html(), /51–52/);
  assert.equal(rowCount(), 2);
  assert.equal(document.activeElement.dataset.sessionPageDirection, 'previous');
  assert.equal(requests.length, before, 'project expansion and session paging make no API requests');
  get('sort').value = 'output'; get('sort').onchange();
  assert.match(html(), /1–25/);
  await click({ sessionPage: '50' });
  Object.assign(report, buildReport(sessions.slice(0, 30), {}, now));
  await get('refresh').onclick();
  assert.match(html(), /26–30/);
  assert.equal(rowCount(), 5);
  get('range').value = '1d'; get('range').onchange();
  await new Promise(setImmediate);
  assert.doesNotMatch(html(), /id="project-sessions"/);
  await click({ projectName: project });
  assert.match(html(), /1–25/);
  await click({ sessionPage: '25' });
  buttons.find(b => b.dataset.sessionPageDirection === 'previous').focus();
  Object.assign(report, buildReport(sessions.slice(0, 2), {}, now));
  await get('refresh').onclick();
  assert.equal(rowCount(), 2);
  assert.doesNotMatch(html(), /data-session-page/);
  assert.equal(document.activeElement.dataset.projectName, project, 'focus returns to the project when paging controls disappear');
  await click({ projectName: project });
  assert.doesNotMatch(html(), /id="project-sessions"/);
  assert.equal(document.activeElement.dataset.projectName, project, 'collapse preserves focus');
});

test('project expansion isolates sessions, escapes names, and shares metric columns and shading', async () => {
  const { get, report, records, now, click, requests } = await requestPanel();
  const projects = [
    { ...records[0], key: 'a1', project: '<Project "A">', sessionId: 'a1', sessionName: '<Session A>' },
    { ...records[0], key: 'b1', project: 'Project B', sessionId: 'b1', sessionName: 'Session B' },
  ];
  Object.assign(report, buildReport(projects, {}, now));
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  const before = requests.length, html = () => get('breakdown').innerHTML;
  await click({ projectName: projects[0].project });
  assert.match(html(), /data-project-name="&lt;Project &quot;A&quot;&gt;" aria-expanded="true" aria-controls="project-sessions"/);
  assert.match(html(), /id="project-sessions" class="request-list"/);
  assert.match(html(), /&lt;Session A&gt;/);
  assert.doesNotMatch(html(), /Session B|<Session A>|<Project/);
  const headers = [...html().matchAll(/<thead>([\s\S]*?)<\/thead>/g)].map(([, value]) => value.replace(/<th>[^<]+<\/th>/, ''));
  assert.equal(headers[0], headers[1], 'project and session tables have the same metric columns');
  await click({ projectName: 'Project B' });
  assert.match(html(), /Session B/);
  assert.doesNotMatch(html(), /&lt;Session A&gt;/);
  report.sessions.find(s => s.id === 'b1').name = 'Renamed session';
  await get('refresh').onclick();
  assert.match(html(), /Renamed session/);
  assert.equal(requests.length, before + 1, 'only explicit refresh fetched data');
  Object.assign(report, buildReport(projects.slice(0, 1), {}, now));
  await get('refresh').onclick();
  assert.doesNotMatch(html(), /id="project-sessions"/);
  await click({ projectName: projects[0].project });
  get('group').value = 'models'; get('group').onchange();
  assert.doesNotMatch(html(), /id="project-sessions"/);
  assert.match(html(), /data-request-model=/);
  get('group').value = 'projects'; get('group').onchange();
  assert.doesNotMatch(html(), /id="project-sessions"/);
});

test('Efficiency shows evidence safely, persists across refresh, and drills into the correct filtered breakdown', async () => {
  const { get, report, records, now, requests } = await requestPanel();
  const model = '<Model "A">';
  const history = Array.from({ length: 12 }, (_, i) => ({ ...records[0], key: `eff-${i}`, model: i < 7 ? model : 'Model B',
    ms: now.getTime() - (100 - i) * 1000, initiator: 'user', project: '<Project>', sessionId: 's1', sessionName: '<Session>',
    inputTotal: i < 3 ? 10000 : 40000, cacheRead: 1000, cacheWrite: 1000, nanoAiu: i < 7 ? 3000000000 : 1000000000 }));
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick();
  const before = requests.length;
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('usage-view').hidden, true);
  assert.equal(get('breakdown-view').hidden, true);
  assert.equal(get('efficiency-view').hidden, false);
  assert.match(get('efficiency-summary').innerHTML, /12 of 12 requests/);
  assert.match(get('efficiency-insights').innerHTML, /&lt;Session&gt;|&lt;Model &quot;A&quot;&gt;/);
  assert.match(get('efficiency-insights').innerHTML, /larger input|reuse context|credits concentrate/);
  assert.doesNotMatch(get('efficiency-insights').innerHTML, /<Session>|<Model/);
  assert.match(get('efficiency-models').innerHTML, /Cache reuse|Credits \/ request/);
  assert.equal(requests.length, before, 'switching tabs reads no additional files or API data');
  await get('refresh').onclick();
  assert.equal(get('efficiency-view').hidden, false);
  await get('efficiency-insights').onclick({ target: { closest: () => ({ dataset: { efficiencyInsight: '0' } }) } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(get('efficiency-view').hidden, true);
  assert.equal(get('group').value, 'models');
  assert.deepEqual(requests.at(-1).input.models, [model]);
  assert.equal(requests.at(-1).input.project, '<Project>');
  assert.equal(requests.at(-1).input.session, 's1');
  assert.equal(requests.filter(r => r.method === 'usage.requests').length, 0, 'inspection does not read prompts');
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await get('efficiency-models').onclick({ target: { closest: () => ({ dataset: { efficiencyModel: 'Model B' } }) } });
  assert.deepEqual(requests.at(-1).input.models, ['Model B']);
  assert.equal(requests.at(-1).input.project, '<Project>', 'model inspection preserves existing scope');
  assert.equal(requests.at(-1).input.session, 's1');
});

test('Efficiency distinguishes empty data and tiny credit values and preserves focused actions on refresh', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, document } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.match(get('efficiency-models').innerHTML, /No matching model requests/);
  assert.match(get('efficiency-insights').innerHTML, /More recorded requests/);
  const row = { name: 'Tiny model', requests: 1, inputRequests: 0, outputRequests: 0, cacheRequests: 0, creditRequests: 1,
    averageInput: null, averageOutput: null, cacheHitRate: null, averageCredits: .000000001 };
  report.efficiency = { summary: row, models: [row], insights: [] };
  const dataset = { efficiencyModel: 'Tiny model' };
  const restored = { dataset, focus() { document.activeElement = this; } };
  get('efficiency-view').querySelectorAll = () => [restored];
  document.activeElement = { dataset };
  await get('refresh').onclick();
  assert.equal(document.activeElement, restored);
  assert.match(get('efficiency-summary').innerHTML, /0\.000000001/);
  assert.match(get('efficiency-summary').innerHTML, /Unavailable/);
  assert.match(get('efficiency-models').innerHTML, /title="0\.000000001/);
});

test('efficiency context is explicit, escaped and independent of refresh; review stays frozen with copy fallback', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests, server } = await mountPanel(report);
  assert.equal(requests.some(r => r.method === 'efficiency.context'), false);
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-result').innerHTML, /not available|unavailable/i);
  server.contextSnapshot = { available: true, checkedAt: '2026-11-14T12:00:00Z', totalTokens: 1000, limit: 10000, modelId: '<PRIVATE-MODEL>', modelSource: 'autoResolved',
    categories: { customInstructions: 100, messages: 900 }, entries: [{ id: 's', kind: 'skill', label: '<PRIVATE>', tokens: 100 }], omitted: 0 };
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-result').innerHTML, /&lt;PRIVATE&gt;/);
  assert.match(get('efficiency-context-result').innerHTML, /Auto-resolved model: &lt;PRIVATE-MODEL&gt;/);
  assert.doesNotMatch(get('efficiency-context-result').innerHTML, /<PRIVATE>/);
  get('project').value = 'new filter not yet loaded';
  get('efficiency-review-open').onclick();
  const frozen = get('efficiency-review-output').value;
  assert.match(frozen, /"projectFiltered": false/);
  assert.doesNotMatch(frozen, /PRIVATE/);
  report.efficiency.summary.requests = 50;
  await get('refresh').onclick();
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 2);
  assert.equal(get('efficiency-review-output').value, frozen);
  await get('efficiency-review-copy').onclick();
  assert.equal(server.copied.at(-1), frozen);
  server.clipboardError = true;
  await get('efficiency-review-copy').onclick();
  assert.equal(get('efficiency-review-output').selected, true);
});

test('MCP efficiency findings use known outcomes and open the existing filtered MCP panel', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  report.mcp.rows = [{ name: '<server>', calls: 55, failures: 3, successes: 2, unknown: 50, successRate: 40, lastUsed: null, status: 'unavailable' }];
  const { get, requests } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('tiles').hidden, true);
  assert.match(get('efficiency-insights').innerHTML, /3 of 5.*60%.*50 outcomes/);
  assert.doesNotMatch(get('efficiency-insights').innerHTML, /More recorded requests|<server>/);
  const before = requests.length;
  get('efficiency-insights').onclick({ target: { closest: () => ({ dataset: { efficiencyMcp: 'true' } }) } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(get('mcp-panel').hidden, false);
  assert.equal(get('tiles').hidden, false);
  assert.equal(requests.length, before);
});

test('header credits follow filtered totals, keep fractions, and preserve unavailable or partial coverage', async () => {
  const { get, report, records, now, server } = await requestPanel();
  const earlier = new Date(2026, 10, 13, 12);
  const history = [...records, { ...records[0], key: 'earlier', ms: earlier.getTime(), ts: earlier.toISOString(), project: 'Another project' }];
  Object.assign(report, buildReport(history, { range: '7d' }, now));
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, '7.3');
  get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.equal(get('hero-credits').textContent, '7.3', 'daily selection does not replace the filter total');
  get('metric').onclick({ target: { dataset: { metric: 'credits' } } });
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.equal(get('hero-credits').textContent, '7.3');
  Object.assign(report, buildReport(history, { range: '7d', project: 'Another project' }, now));
  get('project').value = 'Another project'; await get('project').onchange();
  assert.equal(get('hero-credits').textContent, '0.25');
  Object.assign(report, buildReport(history, { range: '1d', project: 'Another project' }, now));
  get('range').value = '1d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(get('hero-credits').textContent, '0', 'no matching usage shows zero');
  Object.assign(report.totals, { requests: 2, credits: null, missingCredits: 2 });
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, 'Unavailable');
  Object.assign(report.totals, { credits: 0.25, missingCredits: 1 });
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, '0.25 *');
  assert.match(get('hero-credits').title, /incomplete credit coverage/);
  server.transportError = true;
  get('project').value = 'Unloaded project'; await get('project').onchange();
  assert.equal(get('hero-credits').textContent, 'Unavailable');
  assert.match(get('hero-credits').title, /could not be loaded/);
  get('view').onclick({ target: { dataset: { view: 'usage' } } });
  assert.equal(get('hero-credits').textContent, 'Unavailable', 'switching tabs does not restore stale credits');
  server.transportError = false;
  Object.assign(report.totals, { credits: 1.5, missingCredits: 0 });
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, '1.5');
});

test('token total card follows the loaded date range and filters instead of today', async () => {
  const { get, report, records, now } = await requestPanel();
  const earlier = new Date(2026, 10, 13, 12);
  const history = [...records, ...records.map(r => ({ ...r, key: r.key + '-earlier', ms: earlier.getTime(), ts: earlier.toISOString(), project: 'Earlier project' }))];
  const tile = () => get('tiles').innerHTML.split('<div class="tile">')[2].split('</div>')[0];
  for (const [range, label, total] of [['1d', 'Today', '3.4K'], ['7d', 'Last 7 days', '6.7K'], ['30d', 'Last 30 days', '6.7K'], ['90d', 'Last 90 days', '6.7K'], ['all', 'All history', '6.7K'], ['custom', 'Custom dates', '3.4K']]) {
    Object.assign(report, buildReport(history, { range, ...(range === 'custom' ? { startDate: '2026-11-13', endDate: '2026-11-13' } : {}) }, now));
    await get('refresh').onclick();
    assert.ok(tile().includes('<span class="label">Tokens</span>'), range);
    assert.ok(tile().includes(`<span class="sub">${label}</span>`), range);
    assert.ok(tile().includes(`>${total}</strong>`), range);
  }
  Object.assign(report, buildReport(history, { range: '7d', project: 'Earlier project', includeCache: false }, now));
  await get('refresh').onclick();
  assert.ok(tile().includes('>1.4K</strong>'), 'project and cache filters apply to the total');
  get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.ok(tile().includes('>1.4K</strong>'), 'daily chart selection does not narrow the filter total');
});

test('credit rate cards replace streak and models, preserve coverage, and follow number settings', async () => {
  const { get, report, records, now } = await requestPanel();
  const card = index => get('tiles').innerHTML.split('<div class="tile">')[index + 1].split('</div>')[0];
  assert.equal(get('tiles').innerHTML.match(/class="tile"/g).length, 4);
  assert.doesNotMatch(get('tiles').innerHTML, /Current streak|>Models</);
  assert.match(card(2), /<span class="label">Credits \/ request<\/span>.*>0\.25<\/strong>/);
  assert.match(card(3), /<span class="label">Credits \/ 1M tokens<\/span>.*>2\.1K<\/strong>/);
  assert.match(card(3), /Input \+ output · including cache/);
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  await get('settings-save').onclick();
  await new Promise(setImmediate);
  assert.ok(card(3).includes(`>${(7 / 3360 * 1e6).toLocaleString(undefined, { maximumFractionDigits: 9 })}</strong>`));
  Object.assign(report, buildReport(records, { range: '7d', includeCache: false }, now));
  await get('refresh').onclick();
  assert.ok(card(3).includes(`>${(5000).toLocaleString()}</strong>`));
  assert.match(card(3), /excluding cache/);
  const incomplete = [{ ...records[0], nanoAiu: null, creditStatus: 'unavailable' }, records[1], { ...records[2], output: null }];
  Object.assign(report, buildReport(incomplete, { range: '7d' }, now));
  await get('refresh').onclick();
  assert.match(card(2), />0\.25 \*<\/strong>.*2 of 3 requests with complete charges/);
  assert.match(card(3), /\*<\/strong>.*1 of 3 requests · including cache/);
  Object.assign(report, buildReport([incomplete[0]], { range: '7d' }, now));
  await get('refresh').onclick();
  for (const index of [2, 3]) assert.match(card(index), />Unavailable<\/strong>.*0 of 1 requests/);
  Object.assign(report, buildReport([{ ...records[0], nanoAiu: 0 }], { range: '7d' }, now));
  await get('refresh').onclick();
  for (const index of [2, 3]) assert.match(card(index), /data-measure="credits".*>0<\/strong>/);
  Object.assign(report, buildReport([], { range: '1d' }, now));
  await get('refresh').onclick();
  for (const index of [2, 3]) assert.match(card(index), />Unavailable<\/strong>/);
});

test('filters reuse history while the 60-second timer and visibility changes request fresh data', async () => {
  const { get, requests, intervals, listeners, document } = await requestPanel();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 60000);
  assert.match(get('updated').textContent, /60 seconds/);
  get('range').value = '1d'; get('range').onchange();
  await new Promise(setImmediate);
  assert.equal(requests.at(-1).refresh, undefined);
  intervals[0].callback(); await new Promise(setImmediate);
  assert.equal(requests.at(-1).method, 'usage.report');
  assert.equal(requests.at(-1).refresh, true);
  document.hidden = true;
  const count = requests.length;
  intervals[0].callback(); listeners.get('visibilitychange')();
  await new Promise(setImmediate);
  assert.equal(requests.length, count);
  document.hidden = false;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.at(-1).refresh, true);
  await get('refresh').onclick();
  assert.equal(requests.at(-1).method, 'usage.refresh');
});

test('banner renders each report range and keeps the full scene width in narrow canvases', async () => {
  const now = new Date(2026, 10, 14, 22);
  const report = { ...buildReport([], { range: '7d' }, now), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  for (const width of [1080, 500, 280]) {
    get('banner').clientWidth = width;
    for (const [range, count] of [['1d', 1], ['7d', 1], ['30d', 1], ['90d', 1], ['all', 4], ['custom', 0]]) {
      const query = range === 'custom' ? { range, startDate: '2026-11-01', endDate: '2026-11-14' } : { range };
      Object.assign(report, buildReport([], query, now));
      await get('refresh').onclick();
      const svg = get('banner').innerHTML;
      const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
      assert.ok(w / h <= width / get('banner').clientHeight, 'the SVG must not crop buildings horizontally');
      const buildings = [...svg.matchAll(/<rect x="\d+" y="(\d+)" width="\d+" height="1" fill="#12152c"\/>/g)].filter(([, y]) => Number(y) === h - 1);
      assert.equal(buildings.length, count, `${range} at width ${width}`);
    }
  }
});

test('banner cycles three patterns per building only when it reappears', async () => {
  const now = new Date(2026, 10, 14, 22);
  const report = { ...buildReport([], { range: '7d' }, now), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  const show = async range => {
    const query = range === 'custom' ? { range, startDate: '2026-11-01', endDate: '2026-11-14' } : { range };
    Object.assign(report, buildReport([], query, now));
    get('range').value = range;
    if (range === 'custom') get('apply-dates').onclick();
    else get('range').onchange();
    await new Promise(setImmediate);
    return get('banner').innerHTML;
  };
  for (const range of ['1d', '7d', '30d', '90d']) {
    const visits = [];
    for (let i = 0; i < 4; i++) {
      await show('custom');
      visits.push(await show(range));
      report.generatedAt = new Date(2026, 10, 14, 22, 15).toISOString();
      await get('refresh').onclick();
      get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
      get('metric').onclick({ target: { dataset: { metric: 'credits' } } });
      assert.equal(get('banner').innerHTML, visits[i], 'refreshes and other view changes keep the current pattern');
    }
    assert.equal(new Set(visits.slice(0, 3)).size, 3, range + ' rotates through three patterns');
    assert.equal(visits[3], visits[0], range + ' repeats its first pattern on the fourth visit');
  }
  const lights = svg => [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="\d+" height="1" fill="#ffd27a"\/>/g)].map(([, x, y]) => [Number(x), Number(y)]);
  const lastBuilding = lights(get('banner').innerHTML);
  const all = lights(await show('all'));
  assert.deepEqual(all.filter(([x]) => x >= 100), lastBuilding, 'entering All history keeps an already-visible building unchanged');
  assert.deepEqual(lights(await show('90d')), lastBuilding, 'leaving All history keeps the remaining building unchanged');
  await show('custom');
  const next = lights(await show('all'));
  for (const [left, right] of [[24, 38], [45, 59], [65, 79], [105, 119]]) {
    const within = ([x]) => x >= left && x <= right;
    assert.notDeepEqual(next.filter(within), all.filter(within), 'each hidden building advances when returning to All history');
  }
});

test('dashboard keeps skill and request metrics separate from MCP activity', async () => {
  const now = new Date(2026, 10, 13, 22, 49, 37), timestamp = now.toISOString();
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  const events = [
    { type: 'session.usage_record', id: 'u1', timestamp, data: { usage: { provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 60, cacheWriteTokens: 10 } } },
    ...['user-invoked', 'user-invoked', 'agent-invoked', 'context-load', undefined].map((trigger, i) => ({ type: 'skill.invoked', id: `s${i}`, timestamp, data: { name: '<hello-test>', path: '/skills/hello/SKILL.md', pluginName: '<team-tools>', pluginVersion: '2.0', trigger } })),
    ...[true, false, null].flatMap((success, i) => [
      { type: 'tool.execution_start', id: `start-${i}`, timestamp, data: { toolName: '<view>', toolCallId: `c${i}`, model: 'model-a' } },
      ...(success === null ? [] : [{ type: 'tool.execution_complete', id: `end-${i}`, timestamp, data: { toolCallId: `c${i}`, success } }]),
    ]),
  ];
  events.forEach(e => parser.push(JSON.stringify(e)));
  const snapshot = parser.snapshot();
  snapshot.records[0].sessionName = '<Planning "work">';
  const report = { ...buildReport(snapshot.records, { range: '1d' }, now, snapshot), sources: [], coverage: {} };
  report.skills.rows[0].installedVersion = { value: '1.0.1', status: 'available' };
  const { get, nodes, requests } = await mountPanel(report);
  assert.ok(get('skills').innerHTML.includes('&lt;hello-test&gt;'), get('status').textContent);
  const headers = [...get('skills').innerHTML.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(([, value]) => value);
  assert.deepEqual(headers, ['Skill', 'Uses', 'By user', 'By agent', 'Sessions', 'Failures', 'Source plugin', 'Plugin version', 'Skill version (installed)', 'Last used']);
  const cells = [...get('skills').innerHTML.matchAll(/<td(?:\s[^>]*)?>(.*?)<\/td>/g)].map(([, value]) => value.replace(/<\/?span[^>]*>/g, ''));
  assert.equal(cells.length, headers.length);
  assert.deepEqual(cells.slice(1, 9), ['5', '2', '1', '1', '0', '&lt;team-tools&gt;', '2.0', '1.0.1']);
  assert.equal(cells.at(-1), '11/13/26, 10:49 PM');
  assert.equal(get('skills-summary').textContent, '5 uses · 0 failures · 1 session');
  assert.ok(get('skills').innerHTML.includes(`title="${now.toLocaleString()}"`), 'full timestamp stays available on hover');
  assert.match(get('skills').innerHTML, /title="By user: 2; By agent: 1; Preloaded: 1; Unknown: 1"/);
  assert.doesNotMatch(get('skills').innerHTML, /Reasoning|Success rate|Projects|<hello-test>/);
  assert.ok(!nodes.has('skill-details'));
  await get('refresh').onclick();
  assert.match(get('skills').innerHTML, /Source plugin/);
  assert.match(get('breakdown').innerHTML, /Reasoning/);
  assert.match(get('breakdown').innerHTML, /Avg\. tokens \/ request/);
  assert.ok(!nodes.has('tools'));
  assert.doesNotMatch(get('mcp').innerHTML, /&lt;view&gt;/);
  assert.match(get('session').innerHTML, /value="s1"[^>]*>&lt;Planning &quot;work&quot;&gt;<\/option>/);
  get('group').value = 'projects';
  get('group').onchange();
  await get('breakdown').onclick({ target: { closest: () => ({ dataset: { projectName: report.projects[0].name } }) } });
  assert.match(get('breakdown').innerHTML, />&lt;Planning &quot;work&quot;&gt;<\//);
  assert.match(get('breakdown').innerHTML, /title="[^"]*s1[^"]*"/);
  get('session').value = 's1';
  await get('session').onchange();
  assert.equal(requests.at(-1).input.session, 's1');
  report.sessions[0].name = report.options.sessions[0].name = 'Renamed session';
  await get('refresh').onclick();
  assert.equal(get('session').value, 's1');
  assert.match(get('session').innerHTML, />Renamed session<\/option>/);
});

test('skills table keeps ten aligned columns and makes unresolved failures readable without folder actions', async () => {
  const { get, report, records, now } = await requestPanel();
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  const timestamp = now.toISOString(), missingName = '<missing-skill-with-a-long-requested-name>';
  const events = [{ type: 'skill.invoked', id: 'success', timestamp, data: { name: 'known', trigger: 'user-invoked', path: '/skills/known/SKILL.md' } },
    ...['known', missingName].flatMap((name, i) => [
      { type: 'tool.execution_start', id: `start-${i}`, timestamp, data: { toolName: 'skill', toolCallId: `load-${i}`, arguments: { skill: name } } },
      { type: 'tool.execution_complete', id: `end-${i}`, timestamp, data: { toolCallId: `load-${i}`, success: false } },
    ])];
  events.forEach(e => parser.push(JSON.stringify(e)));
  report.skills = buildReport(records, {}, now, parser.snapshot()).skills;
  await get('refresh').onclick();
  const html = get('skills').innerHTML;
  assert.ok(html.includes('title="Recorded failed attempts to load this skill.">Failures</th>'));
  const rows = html.split('<tbody>')[1].split('</tbody>')[0].split('<tr>').slice(1);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.split('<td').length - 1, 10, 'every row keeps a cell beneath each header');
  assert.ok(rows[0].includes('data-skill-action="open"'));
  assert.ok(rows[1].includes('&lt;missing-skill-with-a-long-requested-name&gt;'));
  assert.ok(rows[1].includes('(unresolved)'));
  assert.ok(!rows[1].includes('data-skill-action='), 'missing locations have no open or copy actions');
  assert.ok(rows[1].includes('<td>0</td><td>0</td><td>1</td><td>1</td>'), 'failure-only row shows zero trigger counts, one session, and one failure');
  assert.ok(get('skills-summary').textContent.includes('2 failures'));
  assert.ok(!html.includes('<th>Projects</th>'));
});

test('MCP and plugin tables distinguish live inventory from filtered usage and escape metadata', async () => {
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {} };
  const history = { calls: 3, omitted: 0, rows: [{ name: '<server>', calls: 3, successes: 1, failures: 1, unknown: 1, successRate: 50, lastUsed: '2026-11-14T03:00:00Z' }] };
  report.mcp = mergeMcpInventory(history, { available: true, sessionId: 'current', rows: [
    { name: '<server>', status: 'failed', error: '<connection failed>', source: 'plugin', plugin: '<supplier>', version: '1.0' },
    { name: 'unused', status: 'connected' },
  ] });
  report.plugins = { available: true, rows: [
    { name: '<test-plugin>', version: '1.0', marketplace: '<marketplace>', enabled: true, installed: true, managed: false },
    { name: 'Disabled plugin', enabled: false, installed: true },
    { name: 'Managed pending', enabled: true, installed: false, managed: true },
  ] };
  const { get } = await mountPanel(report);
  assert.match(get('mcp').innerHTML, /&lt;server&gt;/);
  assert.match(get('mcp').innerHTML, /50%/);
  assert.match(get('mcp').innerHTML, /Connected/);
  assert.match(get('mcp').innerHTML, /&lt;connection failed&gt;/);
  assert.match(get('mcp').innerHTML, /&lt;supplier&gt;/);
  assert.match(get('mcp').innerHTML, /Unknown outcomes: 1/);
  assert.match(get('mcp-note').textContent, /current session/);
  assert.match(get('plugins').innerHTML, /&lt;test-plugin&gt;/);
  assert.match(get('plugins').innerHTML, /&lt;marketplace&gt;/);
  assert.match(get('plugins').innerHTML, /Disabled/);
  assert.match(get('plugins').innerHTML, /Not installed/);
  assert.match(get('plugins').innerHTML, /Managed/);
  assert.doesNotMatch(get('mcp').innerHTML + get('plugins').innerHTML, /<server>|<supplier>|<test-plugin>|<marketplace>/);
  report.mcp = mergeMcpInventory(history, { available: false, rows: [] });
  report.plugins = { available: false, rows: [] };
  await get('refresh').onclick();
  assert.match(get('mcp').innerHTML, /Unavailable/);
  assert.match(get('mcp').innerHTML, /50%/);
  assert.match(get('plugins').innerHTML, /unavailable/i);
});

test('detail panels sort independently and preserve choices and report data across refreshes', async () => {
  const older = '2026-11-13T10:00:00Z', newer = '2026-11-14T10:00:00Z';
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {} };
  report.skills = { invocations: 16, sessions: 8, rows: [
    { id: 'a', name: 'Alpha skill', invocations: 2, sessions: 2, projects: 1, lastUsed: newer },
    { id: 'z', name: 'Zulu skill', invocations: 12, sessions: 1, projects: 1, lastUsed: older },
    { id: 'b', name: 'Beta skill', invocations: 2, sessions: 5, projects: 1, lastUsed: older },
  ] };
  report.mcp = { available: true, calls: 12, rows: [
    { name: 'Alpha server', displayName: 'Omega server', calls: 0, failures: 0, successes: 0, unknown: 0, successRate: null, lastUsed: null },
    { name: 'Zulu server', calls: 10, failures: 0, successes: 10, unknown: 0, successRate: 100, lastUsed: older },
    { name: 'Beta server', calls: 2, failures: 1, successes: 1, unknown: 0, successRate: 50, lastUsed: newer },
  ] };
  report.plugins = { available: true, rows: [
    { name: 'Zulu plugin', enabled: true, installed: true, marketplace: 'Alpha marketplace' },
    { name: 'Alpha plugin', enabled: false, installed: true, marketplace: 'Zulu marketplace' },
    { name: 'Beta plugin', enabled: true, installed: false, source: 'builtin' },
  ] };
  const original = structuredClone(report);
  const { get, requests } = await mountPanel(report);
  const names = id => [...get(id).innerHTML.matchAll(/<tr><td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => id === 'mcp' ? cell.match(/<summary[^>]*>(.*?)<\/summary>/)[1] : cell.replace(/<[^>]*>/g, ''));
  const sort = (id, key) => { get(`${id}-sort`).value = key; get(`${id}-sort`).onchange(); };
  assert.deepEqual(names('skills'), ['Zulu skill', 'Alpha skill', 'Beta skill']);
  assert.deepEqual(names('plugins'), ['Alpha plugin', 'Beta plugin', 'Zulu plugin']);
  assert.deepEqual(names('mcp'), ['Zulu server', 'Beta server', 'Omega server']);
  sort('skills', 'name'); assert.deepEqual(names('skills'), ['Alpha skill', 'Beta skill', 'Zulu skill']);
  sort('skills', 'lastUsed'); assert.deepEqual(names('skills'), ['Alpha skill', 'Beta skill', 'Zulu skill']);
  sort('skills', 'sessions'); assert.deepEqual(names('skills'), ['Beta skill', 'Alpha skill', 'Zulu skill']);
  sort('plugins', 'enabled'); assert.deepEqual(names('plugins'), ['Zulu plugin', 'Alpha plugin', 'Beta plugin']);
  sort('plugins', 'marketplace'); assert.deepEqual(names('plugins'), ['Zulu plugin', 'Beta plugin', 'Alpha plugin']);
  sort('mcp', 'name'); assert.deepEqual(names('mcp'), ['Beta server', 'Omega server', 'Zulu server']);
  sort('mcp', 'lastUsed'); assert.deepEqual(names('mcp'), ['Beta server', 'Zulu server', 'Omega server']);
  sort('mcp', 'failures'); assert.deepEqual(names('mcp'), ['Beta server', 'Omega server', 'Zulu server']);
  assert.equal(requests.length, 1, 'sorting uses the current report without extra requests');
  get('breakdown-sections').onclick({ target: { dataset: { section: 'plugins' } } });
  await get('refresh').onclick();
  assert.equal(get('plugins-panel').hidden, false);
  assert.equal(get('skills-panel').hidden, true);
  assert.deepEqual(names('skills'), ['Beta skill', 'Alpha skill', 'Zulu skill']);
  assert.deepEqual(names('plugins'), ['Zulu plugin', 'Beta plugin', 'Alpha plugin']);
  assert.deepEqual(names('mcp'), ['Beta server', 'Omega server', 'Zulu server']);
  assert.deepEqual(report, original, 'sorting never mutates the report or counts');
});

test('long selected filter names remain readable in full and keep their original filter IDs', async () => {
  const name = 'Planning <release> ' + 'LongUnbrokenName'.repeat(30);
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {} };
  report.options.sessions = [{ id: 'session-long', name }];
  report.options.projects = [name];
  report.options.models = [name];
  const { get, requests } = await mountPanel(report);
  for (const id of ['session', 'project', 'model']) {
    get(id).value = id === 'session' ? 'session-long' : name;
    await get(id).onchange();
    assert.equal(get(id).title, id === 'session' ? `${name} — session-long` : name);
    assert.ok(get(id).innerHTML.includes(name.replace('<release>', '&lt;release&gt;')));
    assert.ok(!get(id).innerHTML.includes('<release>'));
  }
  assert.equal(requests.at(-1).input.session, 'session-long');
  get('clear-filters').onclick();
  await new Promise(setImmediate);
  assert.equal(get('session').title, 'All sessions');
});

test('simplified numbers apply across views and context, persist, and only change after saving', async () => {
  const { get, report, records, now, requests, server, click, listeners } = await requestPanel();
  const large = [{ ...records[0], inputTotal: 42_242_785, input: 42_242_785, cacheRead: 0, cacheWrite: 0, output: 2131,
    reasoning: 1000, toolTokenCount: 2131, nanoAiu: 2_131_000_000_000 }];
  Object.assign(report, buildReport(large, {}, now));
  report.skills = { invocations: 2131, sessions: 1, rows: [{ id: 'skill', name: 'Skill', invocations: 2131, sessions: 1, projects: 1, lastUsed: now.toISOString(), version: '1.2.3' }] };
  report.mcp.rows = [{ name: 'Server', calls: 2131, failures: 0, successes: 2131, unknown: 0, successRate: 100, lastUsed: null, status: 'unavailable' }];
  report.sources = [{ state: 'ok', path: '/fixture', records: 2131, files: 1_000_000 }];
  server.requestPage = input => buildRequestPage(large, input, now);
  server.contextSnapshot = { available: true, checkedAt: now.toISOString(), totalTokens: 2_131_000_000_000, limit: null,
    categories: { messages: 2_131_000_000_000 }, entries: [], omitted: 0 };
  await get('refresh').onclick();
  await get('efficiency-context-read').onclick();
  const snapshot = JSON.stringify(report);
  assert.equal(get('hero-credits').textContent, '2.1K');
  assert.equal(get('token-total').textContent, '42.2M');
  for (const id of ['breakdown', 'token-stats', 'token-legend', 'efficiency-summary', 'mcp', 'sources']) assert.match(get(id).innerHTML, /2\.1K/, id);
  for (const id of ['daily', 'models-summary']) assert.match(get(id).innerHTML, /42\.2M/, id);
  assert.match(get('skills').innerHTML, /2\.1K/);
  assert.match(get('skills').innerHTML, /1\.2\.3/, 'versions remain intact');
  assert.match(get('efficiency-context-result').innerHTML, /2\.1T/);
  get('tip').style = {};
  const tooltip = total => listeners.get('pointermove')({ clientX: 0, clientY: 0, target: { closest: () => ({ dataset: { tip: JSON.stringify({ title: 'Tokens', rows: [['Input', 2131]], total }) } }) } });
  tooltip('42.2M');
  assert.match(get('tip').innerHTML, /2\.1K/);
  assert.match(get('tip').innerHTML, /42\.2M/);
  assert.doesNotMatch(get('tip').innerHTML, /Unavailable/);
  await click({ requestModel: '<Sonnet>' });
  await click({ requestId: large[0].key });
  assert.match(get('breakdown').innerHTML, /<dt>Output<\/dt><dd data-measure="tokens">2\.1K<\/dd>/);
  await get('settings-open').onclick();
  assert.equal(get('simplify-numbers').checked, true);
  get('simplify-numbers').checked = false;
  get('settings-close').onclick();
  assert.equal(get('token-total').textContent, '42.2M', 'cancel does not apply a draft');
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  server.saveError = 'Could not save';
  await get('settings-save').onclick();
  assert.equal(get('token-total').textContent, '42.2M', 'failure does not apply a draft');
  server.saveError = '';
  const beforeSave = requests.length;
  await get('settings-save').onclick();
  await new Promise(setImmediate);
  assert.equal(server.config.simplifyNumbers, false);
  assert.ok(!requests.slice(beforeSave).some(r => r.method === 'usage.refresh'), 'display-only settings do not force a rescan');
  assert.equal(get('hero-credits').textContent, (2131).toLocaleString());
  assert.equal(get('token-total').textContent, (42_244_916).toLocaleString());
  for (const id of ['daily', 'models-summary']) assert.ok(get(id).innerHTML.includes((42_244_916).toLocaleString()), id);
  for (const id of ['breakdown', 'skills', 'efficiency-summary', 'mcp', 'sources']) assert.ok(get(id).innerHTML.includes((2131).toLocaleString()), id);
  tooltip(42_244_916);
  assert.ok(get('tip').innerHTML.includes((2131).toLocaleString()));
  assert.ok(get('tip').innerHTML.includes((42_244_916).toLocaleString()));
  assert.ok(get('efficiency-context-result').innerHTML.includes((2_131_000_000_000).toLocaleString()));
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 1, 'formatting reuses the captured context');
  const { preferences, ...after } = report;
  assert.deepEqual(after, JSON.parse(snapshot), 'formatting leaves raw measurements intact');
  const reopened = await mountPanel(report, server.config);
  assert.equal(reopened.get('token-total').textContent, (42_244_916).toLocaleString());
  await get('settings-open').onclick();
  assert.equal(get('simplify-numbers').checked, false);
  get('simplify-numbers').checked = true;
  await get('settings-save').onclick();
  assert.equal(get('token-total').textContent, '42.2M');
  assert.match(get('efficiency-context-result').innerHTML, /2\.1T/);

  large[0].nanoAiu = 12_345_678_901;
  Object.assign(report, buildReport(large, {}, now));
  await get('refresh').onclick();
  await new Promise(setImmediate);
  get('metric').onclick({ target: { dataset: { metric: 'credits' } } });
  assert.equal(get('hero-credits').textContent, '12.3');
  for (const id of ['tiles', 'projects-summary', 'breakdown', 'efficiency-summary', 'efficiency-models', 'daily']) {
    assert.match(get(id).innerHTML, /12\.3/, id);
    assert.doesNotMatch(get(id).innerHTML, /12\.345678901/, id);
  }
  assert.match(get('breakdown').innerHTML, /<dt>AI credits<\/dt><dd data-measure="credits">12\.3<\/dd>/);
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  await get('settings-save').onclick();
  await new Promise(setImmediate);
  assert.equal(get('hero-credits').textContent, '12.345678901');
  for (const id of ['tiles', 'projects-summary', 'breakdown', 'efficiency-summary', 'efficiency-models', 'daily']) {
    assert.match(get(id).innerHTML, /12\.345678901/, id);
  }
  assert.equal(report.totals.credits, 12.345678901);
});

test('Efficiency subviews switch locally, retain selection on refresh, and expose scoped habits and outcomes', async () => {
  const { get, requests, report, server } = await requestPanel();
  const buttons = ['tokens', 'patterns', 'review'].map(efficiencySection => ({ dataset: { efficiencySection }, setAttribute(key, value) { this[key] = value; } }));
  get('efficiency-sections').querySelectorAll = () => buttons;
  const choose = efficiencySection => get('efficiency-sections').onclick({ target: { dataset: { efficiencySection } } });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('efficiency-tokens-panel').hidden, false);
  assert.equal(get('efficiency-patterns-panel').hidden, true);
  assert.equal(get('efficiency-review-panel').hidden, true);
  const before = requests.length;
  choose('patterns'); choose('review'); choose('invalid');
  assert.equal(requests.length, before, 'subview selection never loads data or invokes AI');
  assert.equal(get('efficiency-review-panel').hidden, false);
  assert.equal(buttons[2]['aria-pressed'], 'true');
  await get('refresh').onclick();
  assert.equal(get('efficiency-review-panel').hidden, false);
  report.efficiency.interactions = { prompts: 6, promptSamples: 6, promptSessions: 2, averagePromptChars: 1250,
    averagePromptsPerSession: 3, turns: 12, turnSessions: 2, averageTurnsPerSession: 6, observedSessions: 2, sessionErrors: 1 };
  report.tools.rows = [{ name: '<private tool>', calls: 4, successes: 2, failures: 1, unknown: 1 },
    { name: 'mcp-tool', server: '<server>', calls: 2, successes: 0, failures: 2, unknown: 0 }];
  await get('refresh').onclick();
  choose('patterns');
  assert.match(get('efficiency-habits').innerHTML, /1\.3K/);
  assert.match(get('efficiency-habits').innerHTML, /Messages \/ session|Agent turns \/ session/);
  assert.match(get('efficiency-reliability').innerHTML, /66\.7%|0%/);
  assert.match(get('efficiency-reliability').innerHTML, /&lt;private tool&gt;|&lt;server&gt;/);
  assert.doesNotMatch(get('efficiency-reliability').innerHTML, /<private tool>|<server>/);
  assert.match(get('efficiency-reliability').innerHTML, /1 recorded root-session error/);
  get('efficiency-inspect-instructions').onclick();
  assert.equal(get('efficiency-tokens-panel').hidden, false);
  server.contextSnapshot = { available: true, checkedAt: new Date().toISOString(), totalTokens: 1000, categories: { customInstructions: 500 }, entries: [], omitted: 0 };
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-instructions').innerHTML, /500 estimated tokens/);
  assert.match(get('efficiency-instructions').innerHTML, /not whether the instructions were followed/);
  report.efficiency.interactions = { observedSessions: 0, omitted: 3 };
  await get('refresh').onclick();
  assert.match(get('efficiency-habits').innerHTML, /3 events excluded because Copilot attribution was missing or mixed/);
  assert.doesNotMatch(get('efficiency-habits').innerHTML, /No matching message or turn metadata was recorded/);
  report.efficiency.interactions = { reason: 'model-filter' };
  await get('refresh').onclick();
  assert.match(get('efficiency-habits').innerHTML, /Clear the model filter/);
  assert.match(get('efficiency-reliability').innerHTML, /unavailable under a model filter/);
  choose('review'); get('efficiency-review-open').onclick();
  assert.match(get('efficiency-review-output').value, /"reason": "model-filter"/);
  assert.match(get('efficiency-review-output').value, /Planning versus coding cannot be inferred/);
});

test('settings restore saved text size and apply changes only after a successful save', async () => {
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {}, preferences: { textSize: 'large' } };
  const { get, requests, rootStyle, server } = await mountPanel(report, { textSize: 'large', extraHomes: ['/backup'], disabledHomes: ['/disabled'] });
  assert.equal(rootStyle.get('--text-scale'), '1.3');
  await get('settings-open').onclick();
  assert.equal(get('text-size').value, 'large');
  get('text-size').value = 'small';
  get('settings-close').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1.3');
  assert.ok(!requests.some(r => r.method === 'settings.set'));
  await get('settings-open').onclick();
  get('text-size').value = 'medium';
  await get('settings-save').onclick();
  assert.deepEqual(requests.find(r => r.method === 'settings.set').input, { textSize: 'medium', simplifyNumbers: true, extraHomes: ['/backup'], disabledHomes: ['/disabled'] });
  assert.equal(rootStyle.get('--text-scale'), '1.15');
  assert.equal(get('settings-dialog').open, false);
  await get('settings-open').onclick();
  server.saveError = 'Cannot save settings';
  get('text-size').value = 'small';
  await get('settings-save').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1.15');
  assert.equal(get('settings-dialog').open, true);
  assert.equal(get('settings-error').hidden, false);
  server.saveError = '';
  await get('settings-save').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1');
  delete report.preferences;
  await get('refresh').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1');
});
