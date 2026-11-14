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
      if (message.method === 'settings.set') {
        if (server.saveError) return { ok: false, json: async () => ({ error: server.saveError }) };
        server.config = { ...server.config, ...message.input };
        report.preferences = { textSize: server.config.textSize };
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
  assert.deepEqual(headers, ['Skill', 'Uses', 'By user', 'By agent', 'Sessions', 'Projects', 'Source plugin', 'Plugin version', 'Skill version (installed)', 'Last used']);
  const cells = [...get('skills').innerHTML.matchAll(/<td(?:\s[^>]*)?>(.*?)<\/td>/g)].map(([, value]) => value.replace(/<\/?span[^>]*>/g, ''));
  assert.equal(cells.length, headers.length);
  assert.deepEqual(cells.slice(1, 9), ['5', '2', '1', '1', '1', '&lt;team-tools&gt;', '2.0', '1.0.1']);
  assert.equal(cells.at(-1), '11/13/26, 10:49 PM');
  assert.equal(get('skills-summary').textContent, '5 uses · 1 session');
  assert.ok(get('skills').innerHTML.includes(`title="${now.toLocaleString()}"`), 'full timestamp stays available on hover');
  assert.match(get('skills').innerHTML, /title="By user: 2; By agent: 1; Preloaded: 1; Unknown: 1"/);
  assert.doesNotMatch(get('skills').innerHTML, /Reasoning|Success rate|Failures|<hello-test>/);
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
  assert.deepEqual(requests.find(r => r.method === 'settings.set').input, { textSize: 'medium', extraHomes: ['/backup'], disabledHomes: ['/disabled'] });
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
