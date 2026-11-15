import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildSessionModels } from '../src/core/copilot-report.mjs';
import { mergeMcpInventory } from '../src/core/integrations.mjs';
import { TOKEN_TOPICS, tokenTopicIcon } from '../src/panel/token-topics.mjs';

async function mountPanel(report, config = { textSize: 'small', extraHomes: [], disabledHomes: [] }, releaseNotes, inventory) {
  let html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  if (releaseNotes) html = html.replace(/const RELEASE_NOTES = .*;/, () => `const RELEASE_NOTES = ${JSON.stringify(releaseNotes).replaceAll('<', '\\u003c')};`);
  const nodes = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const attrs = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    return [id, { value: '', dataset: {}, href: attrs.get('href'), innerHTML: '', textContent: '', clientWidth: 500, clientHeight: 155, hidden: /\shidden\b/.test(tag),
      setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k),
      addEventListener(name, callback) { this[`on${name}`] = callback; },
      style: { setProperty(key, value) { this[key] = String(value); } },
      before() {},
      focus() { document.activeElement = this; },
      select() { this.selected = true; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelectorAll: () => [], querySelector: () => null, contains: () => false }];
  }));
  const get = id => { assert.ok(nodes.has(id), `Element ${id} exists`); return nodes.get(id); };
  // Model the persistent navigation children without running a browser.
  for (const id of ['token-topic-stops', 'token-track-nodes', 'token-overview-insight']) {
    let markup = '', children = [];
    Object.defineProperty(get(id), 'innerHTML', { get: () => markup, set(value) {
      markup = value;
      children = [...value.matchAll(/<(?:button|span) data-token-(stop|node|jump)="([^"]+)"([^>]*)>/g)].map(([, kind, topic, rest]) => {
        const attrs = new Map([...rest.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
        return { dataset: { [{ stop: 'tokenStop', node: 'tokenNode', jump: 'tokenJump' }[kind]]: topic },
          focus() { document.activeElement = this; },
          setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k),
          classList: { toggle(key, on) { this[key] = on; } },
        };
      });
    } });
    get(id).querySelectorAll = () => children;
    get(id).querySelector = selector => children.find(child => Object.values(child.dataset).includes(selector.match(/="([^"]+)"/)?.[1])) || null;
  }
  for (const [, id, choices] of html.matchAll(/<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...choices.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
    get(id).value = (options.find(([, , attrs]) => /\bselected\b/.test(attrs)) || options[0])?.[1] || '';
  }
  get('cache').checked = true;
  const requests = [], intervals = [], timeouts = [], listeners = new Map(), windowListeners = new Map(), rootStyle = new Map(), server = { config, saveError: '', copied: [], inventory };
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
      if (message.method.startsWith('review.')) return { ok: !server.reviewError, json: async () => server.reviewError ? { error: server.reviewError } : server.review ? server.review(message) : { models: [{ id: 'fixture-model', label: 'Fixture model' }], verified: true } };
      if (message.method === 'settings.get') return { ok: true, json: async () => ({ ...server.config, defaultHome: '/copilot' }) };
      if (message.method === 'efficiency.context') return { ok: true, json: async () => server.contextSnapshot || { available: false, reason: 'unsupported' } };
      if (message.method === 'usage.inventory') {
        if (server.inventory) return { ok: true, json: async () => server.inventory() };
        const fields = ['name', 'displayName', 'enabled', 'status', 'source', 'plugin', 'version', 'toolsLoaded', 'error'];
        return { ok: true, json: async () => ({ mcp: { available: report.mcp?.available === true, rows: report.mcp?.available ? report.mcp.rows.map(row => Object.fromEntries(fields.filter(k => k in row).map(k => [k, row[k]]))) : [] }, plugins: report.plugins || { available: false, rows: [] } }) };
      }
      if (message.method === 'settings.set') {
        if (server.saveError) return { ok: false, json: async () => ({ error: server.saveError }) };
        server.config = { ...server.config, ...message.input };
        report.preferences = { textSize: server.config.textSize, simplifyNumbers: server.config.simplifyNumbers ?? true };
        return { ok: true, json: async () => server.config };
      }
      if (message.method === 'usage.sessionModels') {
        if (server.sessionModelsError) return { ok: false, json: async () => ({ error: server.sessionModelsError }) };
        return { ok: true, json: async () => server.sessionModels(message.input) };
      }
      if (message.method === 'usage.sessions') {
        if (server.sessionError) return { ok: false, json: async () => ({ error: server.sessionError }) };
        return { ok: true, json: async () => server.sessionPage(message.input) };
      }
      if (message.method === 'usage.requests') {
        if (server.requestError) return { ok: false, json: async () => ({ error: server.requestError }) };
        return { ok: true, json: async () => server.requestPage(message.input) };
      }
      assert.ok(['usage.report', 'usage.refresh'].includes(message.method));
      return { ok: true, json: async () => server.report ? server.report(message.input) : report };
    },
  });
  new Script(html.match(/<script>([\s\S]*)<\/script>/)[1]).runInContext(context);
  await new Promise(setImmediate);
  return { get, nodes, requests, rootStyle, server, document, intervals, listeners, windowListeners, timeouts, viewport: context };
}

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
  report.usageChoices.models = rows.slice(0, 3);
  sort('model', 'credits'); assert.equal(names('model'), 'CBA', 'known zero credits sort ahead of unavailable');
  report.usageChoices.models = rows;
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
  const built = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  assert.match(built, /\.tip\{[^}]*\bwidth:max-content(?:;|})/, 'popup width must not depend on its positioned left edge');
  assert.match(built, /max-width:min\(260px,calc\(100% - 16px\)\)/, 'width cap excludes the scrollbar just like placement');
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
  const { get, requests, server, windowListeners, document } = await mountPanel(report);
  assert.equal(get('footer-refresh').onclick, get('refresh').onclick);
  assert.equal(get('footer-settings').onclick, get('settings-open').onclick);
  await get('footer-refresh').onclick();
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
  panel.server.sessionPage = input => buildModelSessionPage(records, input, now);
  panel.server.sessionModels = input => buildSessionModels(records, input, now);
  panel.server.requestPage = input => ({ ...buildRequestPage(records, input, now), rows: buildRequestPage(records, input, now).rows.map(r => ({ ...r,
    ...(input.id ? { prompt: { available: true, text: '<script>unsafe()</script> Full original prompt', truncated: false } } : {}),
  })) });
  const click = dataset => panel.get('breakdown').onclick({ target: { closest: () => ({ dataset }) } });
  return { ...panel, click, report, records, now };
}

test('both Breakdown hierarchies keep aligned columns, repeated headings, and alternating level backgrounds', async () => {
  const { get, click, records, requests } = await requestPanel();
  const html = () => get('breakdown').innerHTML;
  const layout = () => html().match(/<table[^>]*>/)[0] + html().match(/<colgroup>[\s\S]*?<\/colgroup>/)?.[0];
  const initialLayout = layout();
  const check = headings => {
    assert.equal((html().match(/<table\b/g) || []).length, 1, 'expanded metrics share the original table');
    assert.equal((html().match(/<thead>/g) || []).length, 1, 'one table head with section headings inside the body');
    const headers = [...html().matchAll(/<tr class="usage-header" data-depth="(\d)"[^>]*>([\s\S]*?)<\/tr>/g)];
    assert.deepEqual(headers.map(m => m[1]), ['0', '1', '2']);
    const labels = headers.map(([, , cells]) => [...cells.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(m => m[1]));
    assert.deepEqual(labels.map(row => row[0]), headings);
    for (const row of labels) assert.deepEqual(row.slice(1), ['Requests', 'Input', 'Output', 'Reasoning', 'Cache read', 'Cache write', 'Avg. tokens / request', 'Tokens', 'AI credits']);
    assert.equal(layout(), initialLayout, 'expansion does not recalculate column widths');
    const rows = [...html().matchAll(/<tr class="usage-row" data-depth="(\d)"[^>]*>([\s\S]*?)<\/tr>/g)];
    assert.deepEqual([...new Set(rows.map(m => m[1]))].sort(), ['0', '1', '2']);
    for (const [, , cells] of rows) assert.equal((cells.match(/<td\b/g) || []).length, 10);
    const ids = [...html().matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, 'row IDs remain unique across hierarchy levels');
    for (const [, controlled] of html().matchAll(/aria-controls="([^"]+)"/g)) {
      for (const id of controlled.split(' ')) assert.ok(ids.includes(id), `expanded control references an existing element: ${id}`);
    }
  };
  await click({ requestModel: '<Sonnet>' });
  await click({ requestSession: 's1' });
  check(['Model', 'Session', 'Time']);
  await click({ requestId: records[0].key });
  check(['Model', 'Session', 'Time']);
  assert.match(html(), /<tr class="usage-context" data-depth="3"[^>]*><td colspan="10"><div id="request-detail" class="request-detail"/);
  assert.match(html(), /Full original prompt/);
  get('group').value = 'projects'; get('group').onchange();
  await click({ projectName: records[0].project });
  await click({ projectSession: 's1' });
  check(['Project', 'Session', 'Model']);
  assert.doesNotMatch(html(), /id="request-detail"/);
  const before = requests.length;
  await click({ projectSession: 's1' });
  assert.equal(layout(), initialLayout);
  assert.equal(requests.length, before, 'collapse remains local');
  const built = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  assert.match(built, /\.usage-table\{[^}]*table-layout:fixed/);
  assert.match(built, /\[data-depth="1"\][^}]*background:var\(--bg\)/);
  assert.match(built, /\[data-depth="2"\][^}]*background:var\(--card\)/);
  assert.match(built, /\[data-depth="3"\][^}]*background:var\(--bg\)/);
});

test('model sessions expand into matching request columns and on-demand original prompts', async () => {
  const { get, requests, click, server } = await requestPanel();
  const html = () => get('breakdown').innerHTML;
  assert.equal(requests.filter(r => r.method === 'usage.requests' || r.method === 'usage.sessions').length, 0);
  await click({ requestModel: '<Sonnet>' });
  assert.match(html(), /data-request-session="s1" aria-expanded="false"/);
  assert.match(html(), /&lt;Session&gt;/);
  assert.equal(requests.at(-1).method, 'usage.sessions');
  assert.equal(requests.filter(r => r.method === 'usage.requests').length, 0);
  await click({ requestSession: 's1' });
  assert.match(html(), /28 model requests/);
  assert.match(html(), /1–25/);
  const headers = [...html().matchAll(/<thead>(.*?)<\/thead>/g)].map(([, h]) => [...h.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(([, text]) => text));
  assert.deepEqual(headers.map(h => h[0]), ['Model']);
  for (const h of headers) assert.deepEqual(h.slice(1), ['Requests', 'Input', 'Output', 'Reasoning', 'Cache read', 'Cache write', 'Avg. tokens / request', 'Tokens', 'AI credits']);
  assert.doesNotMatch(html(), /<th>Started by<\/th>|Full original prompt|<script/);
  assert.equal(requests.at(-1).input.session, 's1');
  await click({ requestPage: '25' });
  assert.match(html(), /26–28/);
  const requestId = JSON.stringify(['receipt', 's1', 'call-7']);
  await click({ requestId });
  assert.match(html(), /Original prompt/);
  assert.match(html(), /&lt;script&gt;unsafe\(\)&lt;\/script&gt; Full original prompt/);
  assert.doesNotMatch(html(), /request-metrics|<script/);
  const count = requests.length;
  await click({ requestId });
  await click({ requestId });
  assert.equal(requests.length, count, 'reopening a prompt in the same page uses its bounded cache');
  const original = server.requestPage;
  server.requestPage = input => ({ ...original(input), rows: original(input).rows.map(r => ({ ...r, prompt: { available: false, text: '', truncated: false } })) });
  await get('refresh').onclick(); await new Promise(setImmediate);
  assert.match(html(), /26–28/);
  assert.match(html(), /Prompt unavailable: the local log/);
  assert.doesNotMatch(html(), /Full original prompt/);
  get('session').value = 'another-session'; await get('session').onchange();
  assert.doesNotMatch(html(), /data-request-session|model requests|Original prompt/);
});

test('nested expansion retries failures and ignores late prompt and session responses', async () => {
  const { get, server, click } = await requestPanel();
  server.sessionError = '<Session failed>';
  await click({ requestModel: '<Sonnet>' });
  assert.match(get('breakdown').innerHTML, /Could not load sessions: &lt;Session failed&gt;/);
  server.sessionError = '';
  await click({ modelSessionPage: '0' });
  server.requestError = '<Request failed>';
  await click({ requestSession: 's1' });
  assert.match(get('breakdown').innerHTML, /Could not load requests: &lt;Request failed&gt;/);
  server.requestError = '';
  await click({ requestPage: '0' });
  const original = server.requestPage;
  let resolve;
  server.requestPage = input => new Promise(done => { resolve = () => done(original(input)); });
  const loading = click({ requestId: JSON.stringify(['receipt', 's1', 'call-0']) });
  await new Promise(setImmediate);
  assert.match(get('breakdown').innerHTML, /Loading original prompt/);
  await click({ requestSession: 's1' });
  resolve(); await loading;
  assert.doesNotMatch(get('breakdown').innerHTML, /Full original prompt|Original prompt/);
  await click({ requestModel: '<Sonnet>' });
  const sessions = server.sessionPage;
  server.sessionPage = input => new Promise(done => { resolve = () => done(sessions(input)); });
  const reopening = click({ requestModel: '<Sonnet>' });
  await new Promise(setImmediate);
  get('project').value = 'different-project'; await get('project').onchange();
  resolve(); await reopening;
  assert.doesNotMatch(get('breakdown').innerHTML, /data-request-session|model requests|Original prompt/);
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
  await click({ requestSession: 's1' });
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

test('model sessions page independently, sort before paging, and discard removed descendants on refresh', async () => {
  const { get, report, records, now, server, requests, click } = await requestPanel();
  let history = Array.from({ length: 52 }, (_, i) => ({ ...records[0], key: `r-${i}`, sessionId: `s${i}`,
    sessionName: `Session ${String(i).padStart(2, '0')}`, output: i, nanoAiu: (52 - i) * 1e9 }));
  Object.assign(report, buildReport(history, {}, now));
  server.sessionPage = input => buildModelSessionPage(history, input, now);
  server.requestPage = input => buildRequestPage(history, input, now);
  await get('refresh').onclick();
  await click({ requestModel: '<Sonnet>' });
  const html = () => get('breakdown').innerHTML;
  const ids = () => [...html().matchAll(/data-request-session="([^"]+)"/g)].map(([, id]) => id);
  assert.equal(ids().length, 25); assert.equal(ids()[0], 's51');
  await click({ requestSession: 's51' });
  assert.match(html(), /1 model request/);
  assert.equal(requests.at(-1).input.session, 's51');
  await click({ modelSessionPage: '25' });
  assert.equal(ids()[0], 's26');
  assert.doesNotMatch(html(), /id="session-requests"/);
  await click({ modelSessionPage: '50' });
  assert.deepEqual(ids(), ['s1', 's0']);
  await click({ requestSession: 's1' });
  get('sort').value = 'credits'; await get('sort').onchange();
  assert.equal(requests.at(-1).input.sort, 'credits'); assert.equal(ids()[0], 's0');
  assert.doesNotMatch(html(), /id="session-requests"/);
  await click({ modelSessionPage: '50' });
  await click({ requestSession: 's51' });
  history = [{ ...history[0], sessionName: '<Renamed session>' }];
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick(); await new Promise(setImmediate);
  assert.deepEqual(ids(), ['s0']);
  assert.match(html(), /&lt;Renamed session&gt;/);
  assert.doesNotMatch(html(), /id="session-requests"|<Renamed session>/);
});

test('project sessions expand and page locally, sort the full set, and reset or clamp pages as needed', async () => {
  const { get, report, records, now, requests, click, document, server } = await requestPanel();
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
  const html = () => node.innerHTML;
  const rowCount = () => [...html().matchAll(/<tr class="usage-row" data-depth="1"/g)].length;
  const before = requests.length;
  assert.doesNotMatch(html(), /<th>Session<\/th>/);
  const project = sessions[0].project;
  buttons.find(b => b.dataset.projectName === project).focus();
  await click({ projectName: project });
  assert.equal(document.activeElement.dataset.projectName, project, 'expanding keeps the project toggle focused');
  server.sessionModels = input => buildSessionModels(sessions, input, now);
  buttons.find(b => b.dataset.projectSession === 'session-51').focus();
  await click({ projectSession: 'session-51' });
  assert.equal(document.activeElement.dataset.projectSession, 'session-51', 'opening models preserves session focus');
  await click({ projectSession: 'session-51' });
  assert.equal(document.activeElement.dataset.projectSession, 'session-51', 'collapsing models preserves session focus');
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
  assert.equal(requests.length, before + 1, 'only the model expansion makes an API request');
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
  assert.match(html(), /data-project-name="&lt;Project &quot;A&quot;&gt;" aria-expanded="true" aria-controls="project-sessions [^"]+"/);
  assert.match(html(), /id="project-sessions" class="request-list"/);
  assert.match(html(), /&lt;Session A&gt;/);
  assert.doesNotMatch(html(), /Session B|<Session A>|<Project/);
  const headers = [...html().matchAll(/<thead>([\s\S]*?)<\/thead>/g)].map(([, value]) => value.replace(/<th>[^<]+<\/th>/, ''));
  assert.equal(headers.length, 1, 'projects and sessions share the same header');
  await click({ projectName: 'Project B' });
  assert.match(html(), /Session B/);
  assert.doesNotMatch(html(), /&lt;Session A&gt;/);
  report.sessions.find(s => s.id === 'b1').name = 'Renamed session';
  await get('refresh').onclick();
  assert.match(html(), /Renamed session/);
  assert.equal(requests.length, before + 2, 'explicit refresh loads usage and inventory independently');
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

test('project sessions expand into filtered model metrics, sort locally, and refresh without prompt reads', async () => {
  const { get, report, records, now, server, click, requests } = await requestPanel();
  const history = [
    { ...records[0], key: 'a', project: '<Project>', sessionId: 's1', sessionName: '<Session>', model: '<Model A>', output: 500, nanoAiu: 1e9 },
    { ...records[0], key: 'b', project: '<Project>', sessionId: 's1', sessionName: '<Session>', model: '<Model B>', nanoAiu: 2e9 },
    { ...records[0], key: 'c', project: 'Other', sessionId: 's1', model: 'Excluded project' },
    { ...records[0], key: 'd', project: '<Project>', sessionId: 's2', sessionName: 'Other session', model: 'Excluded session' },
  ];
  server.sessionModels = input => buildSessionModels(history, input, now);
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  const html = () => get('breakdown').innerHTML;
  await click({ projectName: '<Project>' });
  const before = requests.length;
  await click({ projectSession: 's1' });
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).method, 'usage.sessionModels');
  assert.equal(requests.at(-1).input.project, '<Project>');
  assert.equal(requests.at(-1).input.session, 's1');
  assert.match(html(), /data-project-session="s1" aria-expanded="true" aria-controls="session-models [^"]+"/);
  assert.match(html(), /id="session-models" class="request-list" aria-label="Models for &lt;Session&gt;"/);
  assert.match(html(), /2 models/);
  assert.match(html(), /&lt;Model A&gt;/);
  assert.match(html(), /&lt;Model B&gt;/);
  assert.doesNotMatch(html(), /Excluded project|Excluded session|<Model|data-request-model|data-request-session|data-request-id/);
  const headers = [...html().matchAll(/<tr class="usage-header"[^>]*><th[^>]*>[^<]*<\/th>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  assert.equal(headers.length, 3);
  assert.ok(headers.every(h => h === headers[0]));
  const modelNames = () => [...html().slice(html().indexOf('id="session-models"')).matchAll(/<tr class="usage-row" data-depth="2"[^>]*><td class="text-cell"[^>]*><span[^>]*>(.*?)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(modelNames(), ['&lt;Model A&gt;', '&lt;Model B&gt;']);
  const beforeSort = requests.length;
  get('sort').value = 'credits'; get('sort').onchange();
  assert.deepEqual(modelNames(), ['&lt;Model B&gt;', '&lt;Model A&gt;']);
  assert.equal(requests.length, beforeSort, 'model sorting is local');
  history.push({ ...history[0], key: 'new', model: 'New model' });
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick(); await new Promise(setImmediate);
  assert.match(html(), /3 models/);
  assert.match(html(), /New model/);
  assert.ok(!requests.some(r => r.method === 'usage.requests'), 'no prompt reads or request fetches');
  get('model').value = '<Model A>'; get('cache').checked = false;
  get('model').onchange(); await new Promise(setImmediate);
  assert.doesNotMatch(html(), /id="session-models"/);
  await click({ projectName: '<Project>' }); await click({ projectSession: 's1' });
  assert.deepEqual(requests.at(-1).input.models, ['<Model A>']);
  assert.equal(requests.at(-1).input.includeCache, false);
  assert.match(html(), /1 model<\/strong>/);
});

test('project session model loading retries and ignores stale results after collapse or switching groups', async () => {
  const { get, records, server, click } = await requestPanel();
  get('group').value = 'projects'; get('group').onchange();
  const html = () => get('breakdown').innerHTML;
  await click({ projectName: records[0].project });
  server.sessionModelsError = '<offline>';
  await click({ projectSession: 's1' });
  assert.match(html(), /Could not load models: &lt;offline&gt;/);
  assert.match(html(), /data-session-model-retry="true"/);
  server.sessionModelsError = '';
  await click({ projectSession: 's1', sessionModelRetry: 'true' });
  assert.match(html(), /&lt;Sonnet&gt;/);
  await click({ projectSession: 's1' });
  assert.doesNotMatch(html(), /id="session-models"/);
  let resolve;
  server.sessionModels = () => new Promise(r => { resolve = r; });
  const pending = click({ projectSession: 's1' }); await new Promise(setImmediate);
  assert.match(html(), /Loading session models/);
  await click({ projectName: records[0].project });
  await click({ projectName: records[0].project });
  resolve({ rows: [{ name: 'Stale model' }] }); await pending;
  assert.doesNotMatch(html(), /Stale model|id="session-models"/);
  const later = click({ projectSession: 's1' }); await new Promise(setImmediate);
  get('group').value = 'models'; get('group').onchange();
  resolve({ rows: [{ name: 'Stale model' }] }); await later;
  assert.doesNotMatch(html(), /Stale model|id="session-models"/);
  assert.match(html(), /data-request-model=/);
  get('group').value = 'projects'; get('group').onchange();
  await click({ projectName: records[0].project });
  server.sessionModels = () => ({ rows: [] });
  await click({ projectSession: 's1' });
  assert.match(html(), /No matching models remain/);
});

test('project session models close on paging and when refresh removes the selected session', async () => {
  const { get, records, report, now, server, click } = await requestPanel();
  const history = Array.from({ length: 26 }, (_, i) => ({ ...records[0], key: `r${i}`, sessionId: `s${i}`, sessionName: `Session ${i}`, output: 100 - i }));
  Object.assign(report, buildReport(history, {}, now));
  server.sessionModels = input => buildSessionModels(history, input, now);
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  await click({ projectName: records[0].project }); await click({ projectSession: 's0' });
  assert.match(get('breakdown').innerHTML, /id="session-models"/);
  await click({ sessionPage: '25' });
  assert.doesNotMatch(get('breakdown').innerHTML, /id="session-models"/);
  await click({ projectSession: 's25' });
  assert.match(get('breakdown').innerHTML, /id="session-models"/);
  Object.assign(report, buildReport(history.slice(0, 5), {}, now));
  await get('refresh').onclick();
  assert.doesNotMatch(get('breakdown').innerHTML, /id="session-models"/);
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

test('token type order and shares follow the selected day, filters, and cache inclusion', async () => {
  const { get, report, records, now } = await requestPanel();
  const earlier = new Date(2026, 10, 13, 12);
  const history = [records[0], { ...records[0], key: 'yesterday', ms: earlier.getTime(), ts: earlier.toISOString(),
    input: 80, inputTotal: 100, cacheRead: 10, cacheWrite: 10, output: 80 }];
  Object.assign(report, buildReport(history, { range: '7d' }, now));
  await get('refresh').onclick();
  const order = () => [...get('token-legend').innerHTML.matchAll(/<i[^>]*><\/i>(.*?) <b>/g)].map(m => m[1]);
  assert.deepEqual(order(), ['Uncached input', 'Cache read', 'Cache write', 'Output']);
  assert.match(get('token-bar').innerHTML, /Uncached input 36\.7%; Cache read 23\.3%; Cache write 6\.7%; Output 33\.3%/);
  assert.doesNotMatch(get('token-bar').innerHTML, /Reasoning/);
  get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.match(get('token-bar').innerHTML, /Uncached input 25%; Cache read 50%; Cache write 8\.3%; Output 16\.7%/);
  get('all-days').onclick();
  assert.match(get('token-bar').innerHTML, /Uncached input 36\.7%/);
  Object.assign(report, buildReport(history, { range: '1d', includeCache: false }, now));
  await get('refresh').onclick();
  assert.deepEqual(order(), ['Uncached input', 'Output']);
  assert.match(get('token-bar').innerHTML, /Uncached input 60%; Output 40%/);
  const unknown = { ...records[0], input: null, inputTotal: 100, cacheRead: null, cacheWrite: null, output: 100 };
  Object.assign(report, buildReport([unknown], {}, now));
  await get('refresh').onclick();
  assert.deepEqual(order(), ['Uncached input', 'Cache read', 'Cache write', 'Input (cache split unknown)', 'Output']);
  assert.match(get('token-bar').innerHTML, /Input \(cache split unknown\) 50%; Output 50%/);
  assert.match(get('token-note').textContent, /Percentages show shares of recorded tokens/);
});

test('credit rate cards replace streak and models, preserve coverage, and follow number settings', async () => {
  const { get, report, records, now } = await requestPanel();
  const card = index => get('tiles').innerHTML.split('<div class="tile">')[index + 1].split('</div>')[0];
  assert.equal(get('tiles').innerHTML.match(/class="tile"/g).length, 4);
  assert.doesNotMatch(get('tiles').innerHTML, /Current streak|>Models</);
  assert.match(card(2), /<span class="label">AI credits \/ prompt<\/span>.*>Unavailable<\/strong>.*<span class="sub">0 prompts<\/span>/);
  assert.match(card(3), /<span class="label">AI credit \/ 1M tokens<\/span>.*>2\.1K<\/strong>/);
  assert.match(card(3), /<span class="sub">input \+ output \+ cache<\/span>/);
  Object.assign(report.promptCredits, { prompts: 1, eligiblePrompts: 1, credits: 0.0678776, averageCredits: 0.0678776 });
  report.promptCredits.unlinkedRequests = 0;
  await get('refresh').onclick();
  assert.match(card(2), />0\.068<\/strong>.*<span class="sub">1 prompts<\/span>/);
  assert.equal(get('prompt-coverage-note').hidden, true);
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  await get('settings-save').onclick();
  await new Promise(setImmediate);
  assert.match(card(2), />0\.0678776<\/strong>/);
  assert.ok(card(3).includes(`>${(7 / 3360 * 1e6).toLocaleString(undefined, { maximumFractionDigits: 9 })}</strong>`));
  Object.assign(report, buildReport(records, { range: '7d', includeCache: false }, now));
  await get('refresh').onclick();
  assert.ok(card(3).includes(`>${(5000).toLocaleString()}</strong>`));
  assert.match(card(3), /excluding cache/);
  const incomplete = [{ ...records[0], nanoAiu: null, creditStatus: 'unavailable' }, records[1], { ...records[2], output: null }];
  Object.assign(report, buildReport(incomplete, { range: '7d' }, now));
  Object.assign(report.promptCredits, { prompts: 2, eligiblePrompts: 1, credits: 0.25, averageCredits: 0.25, modelFiltered: true, excluded: { attribution: 0, accounting: 1, unfinished: 0 } });
  await get('refresh').onclick();
  assert.match(card(2), />0\.25<\/strong>.*1 prompts · selected-model contribution/);
  assert.equal(get('prompt-coverage-note').hidden, false);
  assert.match(get('prompt-coverage-note').textContent, /^\* AI credits \/ prompt: 1 of 2 prompts/);
  assert.match(get('prompt-coverage-note').textContent, /1 incomplete charges/);
  assert.match(card(2), /1 incomplete charges/);
  assert.match(card(3), /1 of 3 requests/);
  assert.match(card(3), /\*<\/strong>.*<span class="sub">input \+ output \+ cache<\/span>/);
  Object.assign(report, buildReport([incomplete[0]], { range: '7d' }, now));
  await get('refresh').onclick();
  assert.match(card(2), />Unavailable<\/strong>.*<span class="sub">0 prompts<\/span>/);
  assert.match(card(3), /0 of 1 requests.*>Unavailable<\/strong>/);
  Object.assign(report, buildReport([{ ...records[0], nanoAiu: 0 }], { range: '7d' }, now));
  Object.assign(report.promptCredits, { prompts: 1, eligiblePrompts: 1, credits: 0, averageCredits: 0 });
  await get('refresh').onclick();
  for (const index of [2, 3]) assert.match(card(index), /data-measure="credits".*>0<\/strong>/);
  Object.assign(report, buildReport([], { range: '1d' }, now));
  await get('refresh').onclick();
  for (const index of [2, 3]) assert.match(card(index), />Unavailable<\/strong>/);
  assert.equal(get('prompt-coverage-note').hidden, true, 'empty filtered data clears the note');
  Object.assign(report.promptCredits, { unlinkedRequests: 2 });
  await get('refresh').onclick();
  assert.equal(get('prompt-coverage-note').hidden, false, 'unlinked calls remain disclosed without known prompts');
  assert.match(get('prompt-coverage-note').textContent, /2 model calls could not be linked to prompts/);
});

test('metric buttons toggle emphasis off without changing chart units or loading data', async () => {
  const { get, requests } = await requestPanel();
  const html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  for (const metric of ['tokens', 'credits']) assert.ok(html.includes(`data-metric="${metric}" aria-pressed="false"`));
  const buttons = ['tokens', 'credits'].map(metric => ({ dataset: { metric }, 'aria-pressed': 'false',
    setAttribute(name, value) { this[name] = value; } }));
  get('metric').querySelectorAll = () => buttons;
  const press = metric => get('metric').onclick({ target: { dataset: { metric } } });
  const selected = () => buttons.map(b => b['aria-pressed']);
  const before = requests.length;
  assert.equal(get('content').dataset.metric, undefined, 'initial load is neutral');
  press('tokens');
  assert.equal(get('content').dataset.metric, 'tokens');
  press('tokens');
  assert.equal(get('content').dataset.metric, undefined, 'removing the attribute disables both accent and neutral-gray CSS');
  assert.deepEqual(selected(), ['false', 'false']);
  assert.equal(get('daily-title').textContent, 'Daily tokens');
  press('tokens');
  assert.equal(get('content').dataset.metric, 'tokens');
  assert.deepEqual(selected(), ['true', 'false']);
  press('credits');
  assert.equal(get('content').dataset.metric, 'credits');
  assert.deepEqual(selected(), ['false', 'true']);
  assert.equal(get('daily-title').textContent, 'Daily AI credits');
  const chart = get('daily').innerHTML;
  press('credits');
  assert.equal(get('content').dataset.metric, undefined);
  assert.deepEqual(selected(), ['false', 'false']);
  assert.equal(get('daily').innerHTML, chart, 'clearing credit emphasis keeps the current chart');
  press('invalid');
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.equal(get('content').dataset.metric, undefined);
  assert.equal(requests.length, before, 'toggling emphasis is entirely local');
  await get('refresh').onclick();
  get('range').value = '1d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(get('content').dataset.metric, undefined, 'neutral display survives refreshes and filter changes');
  assert.deepEqual(selected(), ['false', 'false']);
  press('credits');
  assert.equal(get('content').dataset.metric, 'credits');
  press('tokens');
  assert.equal(get('content').dataset.metric, 'tokens');
  assert.deepEqual(selected(), ['true', 'false']);
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
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').method, 'usage.report');
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').refresh, true);
  document.hidden = true;
  const count = requests.length;
  intervals[0].callback(); listeners.get('visibilitychange')();
  await new Promise(setImmediate);
  assert.equal(requests.length, count);
  document.hidden = false;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').refresh, true);
  await get('refresh').onclick();
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').method, 'usage.refresh');
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
  assert.match(get('breakdown').innerHTML, / &lt;Planning &quot;work&quot;&gt;<\/button>/);
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
  await new Promise(setImmediate);
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
  assert.equal(requests.length, 2, 'sorting uses the current report and inventory without extra requests');
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
  await click({ requestSession: 's1' });
  await click({ requestId: large[0].key });
  assert.match(get('breakdown').innerHTML.split('<tr class="usage-row" data-depth="2"')[1], /<td data-measure="tokens">2\.1K<\/td>/);
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
  assert.match(get('breakdown').innerHTML.split('<tr class="usage-row" data-depth="2"')[1], /<td data-measure="credits">12\.3<\/td>/);
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

function jumpTokenTopic(get, id) {
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: id } }) } });
}

test('token insights reuse the explicit snapshot across sections and filters without hidden reads', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests, server, document } = await mountPanel(report);
  assert.match(get('token-overview-insight').innerHTML, /data-token-jump="prompts"/);
  get('token-overview-panel').onclick({ target: { closest: () => ({ dataset: { tokenJump: 'prompts' } }) } });
  assert.equal(get('token-selected-title').textContent, 'Work behind each prompt');
  assert.equal(document.activeElement, get('efficiency-topic'));
  const before = requests.length;
  jumpTokenTopic(get, 'skills');
  assert.match(get('token-topic-body').innerHTML, /not been measured/);
  get('token-detail-panel').onclick({ target: { closest: () => ({ dataset: { tokenContext: 'true' } }) } });
  assert.equal(requests.length, before, 'opening the inspector is local navigation');
  server.contextSnapshot = { available: true, checkedAt: '2026-11-14T12:00:00Z', totalTokens: 1000, limit: 10000,
    categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 750 },
    entries: [{ id: 'skill', kind: 'skill', label: '<Snapshot skill>', tokens: 50 }, { id: 'tool', kind: 'tool', label: '<Snapshot result>', tokens: 100 }], omitted: 0 };
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-result').innerHTML, /Instructions \+ definitions/);
  assert.match(get('efficiency-context-result').innerHTML, />250<\/strong>/);
  const inspected = requests.length;
  jumpTokenTopic(get, 'skills');
  assert.match(get('token-topic-body').innerHTML, /&lt;Snapshot skill&gt;/);
  assert.doesNotMatch(get('token-topic-body').innerHTML, /Snapshot result/);
  jumpTokenTopic(get, 'results');
  assert.match(get('token-topic-body').innerHTML, /&lt;Snapshot result&gt;/);
  assert.doesNotMatch(get('token-topic-body').innerHTML, /Snapshot skill/);
  assert.equal(requests.length, inspected);
  get('efficiency-topic').focus();
  await get('refresh').onclick();
  get('model').value = 'Another model';
  await get('model').onchange();
  assert.equal(get('token-selected-title').textContent, 'Files, searches, and tool results');
  assert.equal(document.activeElement, get('efficiency-topic'));
  assert.match(get('token-topic-body').innerHTML, /&lt;Snapshot result&gt;/);
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 1);
  server.contextSnapshot = { available: false, reason: 'empty' };
  await get('efficiency-context-read').onclick();
  assert.doesNotMatch(get('token-topic-body').innerHTML, /Snapshot result/);
  assert.match(get('token-topic-body').innerHTML, /not been measured/);
  jumpTokenTopic(get, 'overview');
  const shortcut = get('token-overview-insight').querySelector('[data-token-jump="output"]');
  shortcut.focus();
  await get('refresh').onclick();
  assert.equal(document.activeElement.dataset.tokenJump, 'output');
});

test('slow inventory does not hide usage and merges into the latest filtered history', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, requests } = await mountPanel(report, undefined, undefined, () => pending);
  assert.equal(get('content').hidden, false);
  assert.equal(get('refresh').disabled, false);
  assert.match(get('plugins').innerHTML, /Loading current plugin inventory/);
  report.mcp = { available: false, calls: 7, omitted: 0, rows: [{ name: 'one', calls: 7, failures: 1, successes: 6, unknown: 0, successRate: 6 / 7 * 100, status: 'unavailable' }] };
  get('model').value = 'Filtered model';
  await get('model').onchange();
  assert.equal(requests.filter(r => r.method === 'usage.inventory').length, 1);
  finish({ mcp: { available: true, rows: [{ name: 'one', status: 'connected' }] }, plugins: { available: true, rows: [{ name: '<Plugin>', installed: true, enabled: true }] } });
  await new Promise(setImmediate);
  assert.equal(get('model').value, 'Filtered model');
  assert.match(get('mcp-summary').textContent, /7 calls/);
  assert.match(get('mcp').innerHTML, /Connected/);
  assert.match(get('plugins').innerHTML, /&lt;Plugin&gt;/);
  server.inventory = () => { throw new Error('unavailable'); };
  await get('refresh').onclick();
  await new Promise(setImmediate);
  assert.equal(get('content').hidden, false);
  assert.match(get('mcp-summary').textContent, /7 calls/);
  assert.match(get('plugins').innerHTML, /unavailable/i);
});

test('refresh during pending inventory queues one new read while filters coalesce', async () => {
  let finish, reads = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const inventory = name => ({ mcp: { available: true, rows: [] }, plugins: { available: true, rows: [{ name, installed: true, enabled: true }] } });
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get } = await mountPanel(report, undefined, undefined, () => ++reads === 1 ? pending : inventory('Fresh plugin'));
  await get('refresh').onclick();
  await get('refresh').onclick();
  await get('model').onchange();
  assert.equal(reads, 1, 'pending reads are not duplicated');
  finish(inventory('Old plugin'));
  await new Promise(setImmediate);
  assert.equal(reads, 2, 'multiple refreshes queue one follow-up inventory read');
  assert.match(get('plugins').innerHTML, /Fresh plugin/);
  assert.doesNotMatch(get('plugins').innerHTML, /Old plugin/);
});

test('inventory updates restore server focus or fall back to the MCP sort control', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, document, server } = await mountPanel(report);
  const summary = { focus() { document.activeElement = this; }, closest: () => ({ dataset: { server: 'fixture' } }) };
  get('mcp').querySelectorAll = () => [{ dataset: { server: 'fixture' }, querySelector: () => summary }];
  let finish;
  server.inventory = () => new Promise(resolve => { finish = resolve; });
  await get('refresh').onclick();
  await new Promise(setImmediate);
  document.activeElement = { closest: () => ({ dataset: { server: 'fixture' } }) };
  finish({ mcp: { available: true, rows: [{ name: 'fixture' }] }, plugins: { available: true, rows: [] } });
  await new Promise(setImmediate);
  assert.equal(document.activeElement, summary, 'retained server keeps focus');
  document.activeElement = null;
  await get('refresh').onclick();
  await new Promise(setImmediate);
  document.activeElement = summary;
  get('mcp').querySelectorAll = () => [];
  finish({ mcp: { available: false, rows: [] }, plugins: { available: false, rows: [] } });
  await new Promise(setImmediate);
  assert.equal(document.activeElement, get('mcp-sort'), 'removed server has a stable focus destination');
});

test('inactive token details are not regenerated until selected', async () => {
  const { get } = await requestPanel();
  assert.equal(get('token-cache-detail').innerHTML, '');
  jumpTokenTopic(get, 'cache');
  assert.match(get('token-cache-detail').innerHTML, /Uncached input/);
  jumpTokenTopic(get, 'tools');
  get('token-cache-detail').innerHTML = 'retained hidden cache';
  await get('refresh').onclick();
  assert.equal(get('token-cache-detail').innerHTML, 'retained hidden cache');
  jumpTokenTopic(get, 'cache');
  assert.match(get('token-cache-detail').innerHTML, /Uncached input/);
});

test('Efficiency section pickers separate topics, switch locally, and retain independent selections', async () => {
  const { get, requests, windowListeners, timeouts, document } = await requestPanel();
  const tokenPanels = ['overview', 'context', 'cache', 'detail'];
  const tokenTopics = TOKEN_TOPICS.map(topic => topic.id);
  const patternPanels = ['findings', 'habits', 'recovery', 'models', 'detail'];
  const patternTopics = ['findings', 'habits', 'growth', 'compaction', 'recovery', 'transitions', 'repetition', 'models'];
  const choose = (picker, id) => {
    if (picker === 'efficiency-topic') jumpTokenTopic(get, id);
    else { get(picker).value = id; get(picker).onchange(); }
  };
  const visible = (prefix, panels) => panels.filter(id => !get(prefix + '-' + id + '-panel').hidden);
  const switchTab = efficiencySection => get('efficiency-sections').onclick({ target: { dataset: { efficiencySection } } });
  assert.deepEqual(visible('token', tokenPanels), ['overview']);
  assert.deepEqual(visible('pattern', patternPanels), ['findings']);
  assert.equal(get('token-topic-stops').querySelectorAll('[data-token-stop]').length, 10);
  assert.equal((get('efficiency-pattern-topic').innerHTML.match(/<option /g) || []).length, 8);
  const before = requests.length;
  for (const topic of tokenTopics) {
    choose('efficiency-topic', topic);
    assert.deepEqual(visible('token', tokenPanels), [tokenPanels.includes(topic) ? topic : 'detail']);
    assert.equal(get('efficiency-topic').value, String(tokenTopics.indexOf(topic)));
    assert.equal(get('token-selected-title').textContent, TOKEN_TOPICS[tokenTopics.indexOf(topic)].label);
    if (!tokenPanels.includes(topic)) assert.ok(get('token-topic-body').innerHTML.length > 0);
  }
  switchTab('patterns');
  for (const topic of patternTopics) {
    choose('efficiency-pattern-topic', topic);
    assert.deepEqual(visible('pattern', patternPanels), [patternPanels.includes(topic) ? topic : 'detail']);
    assert.equal(get('efficiency-pattern-topic').value, topic);
    if (!patternPanels.includes(topic)) assert.ok(get('pattern-topic-body').innerHTML.length > 0);
    assert.equal(get('efficiency-topic').value, '9');
  }
  choose('efficiency-topic', 'growth');
  choose('efficiency-pattern-topic', 'cache');
  assert.equal(get('efficiency-topic').value, '9', 'wrong dashboard topic is ignored');
  assert.equal(get('efficiency-pattern-topic').value, 'models');
  assert.equal(requests.length, before, 'navigation never loads logs, inspects context, or invokes AI');
  switchTab('review');
  assert.equal(get('efficiency-patterns-panel').hidden, true);
  assert.equal(get('efficiency-tokens-panel').hidden, true);
  switchTab('patterns');
  get('efficiency-pattern-topic').focus();
  await get('refresh').onclick();
  assert.equal(get('efficiency-pattern-topic').value, 'models');
  assert.equal(document.activeElement, get('efficiency-pattern-topic'));
  choose('efficiency-pattern-topic', 'growth');
  const oldGrowth = get('pattern-topic-body').innerHTML;
  get('model').value = 'Alpha';
  await get('model').onchange();
  assert.equal(get('efficiency-pattern-topic').value, 'growth');
  assert.equal(get('efficiency-topic').value, '9');
  assert.ok(oldGrowth.length && get('pattern-topic-body').innerHTML.length);
  windowListeners.get('resize')();
  timeouts.at(-1).callback();
  assert.equal(get('efficiency-pattern-topic').value, 'growth');
  await get('settings-open').onclick();
  get('text-size').value = 'large';
  await get('settings-save').onclick();
  assert.equal(get('efficiency-pattern-topic').value, 'growth');
  const contextBefore = requests.length;
  choose('efficiency-pattern-topic', 'habits');
  get('efficiency-inspect-instructions').onclick();
  assert.equal(get('efficiency-tokens-panel').hidden, false);
  assert.equal(get('efficiency-topic').value, '1');
  assert.equal(get('efficiency-pattern-topic').value, 'habits');
  assert.equal(document.activeElement, get('efficiency-context-read'));
  assert.equal(requests.length, contextBefore, 'opening the inspector does not run it');
  assert.equal(get('token-selected-title').textContent, 'Always-loaded context');
  assert.equal(get('token-topic-position').textContent, 'Context · 2 of 10');
  assert.equal(get('efficiency-topic').getAttribute('aria-valuetext'), 'Always-loaded context, section 2 of 10');
  assert.equal(get('token-topic-stops').querySelector('[data-token-stop="context"]').getAttribute('aria-current'), 'true');
});

test('token explorer maps every stop, preserves its focused lens, and only rerenders changed selections', async () => {
  const { get, requests, document } = await requestPanel();
  const lens = get('efficiency-topic'), stops = get('token-topic-stops').querySelectorAll('[data-token-stop]');
  const nodes = get('token-track-nodes').querySelectorAll('[data-token-node]');
  assert.equal(lens.getAttribute('type'), 'range');
  assert.equal(lens.getAttribute('step'), '1');
  assert.equal(lens.getAttribute('min'), '0');
  assert.equal(lens.max, '9');
  assert.equal(lens.getAttribute('aria-label'), 'Token usage section');
  assert.equal(lens.value, '0');
  assert.equal(get('token-topic-prev').disabled, true);
  assert.equal(get('token-topic-next').disabled, false);
  const before = requests.length;
  lens.focus();
  for (const [index, topic] of TOKEN_TOPICS.entries()) {
    lens.value = String(index); lens.oninput();
    assert.equal(document.activeElement, lens);
    assert.equal(get('token-selected-title').textContent, topic.label);
    assert.equal(lens.getAttribute('aria-valuetext'), `${topic.label}, section ${index + 1} of 10`);
    assert.equal(lens.title, topic.label);
    assert.equal(lens.style['--lens-icon'], `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(topic, true))}")`);
    assert.equal(stops[index].getAttribute('aria-label'), topic.label);
    assert.equal(stops[index].getAttribute('title'), topic.label, 'icon buttons retain full hover names');
    assert.equal(stops.filter(b => b.getAttribute('aria-current') === 'true').length, 1);
    assert.equal(stops[index].getAttribute('aria-current'), 'true');
    assert.deepEqual(nodes.map(n => n.classList.current), TOKEN_TOPICS.map((_, i) => i === index));
    const panel = ['overview', 'context', 'cache'].includes(topic.id) ? topic.id : 'detail';
    assert.equal(get(`token-${panel}-panel`).hidden, false);
    if (panel === 'detail') assert.equal(get('token-topic-title').textContent, topic.label);
  }
  assert.equal(get('token-topic-next').disabled, true);
  jumpTokenTopic(get, 'tools');
  let renders = 0, body = get('token-topic-body').innerHTML;
  Object.defineProperty(get('token-topic-body'), 'innerHTML', { get: () => body, set(value) { renders++; body = value; } });
  lens.oninput(); lens.oninput(); jumpTokenTopic(get, 'tools');
  assert.equal(renders, 0, 'repeated input on the same stop does not rerender');
  jumpTokenTopic(get, 'results');
  assert.equal(renders, 1);
  assert.equal(requests.length, before, 'navigation never fetches or inspects context');
  await get('refresh').onclick();
  get('model').value = 'Alpha'; await get('model').onchange();
  assert.equal(lens.value, '3');
  assert.equal(lens.style['--lens-icon'], `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(TOKEN_TOPICS[3], true))}")`);
  assert.equal(document.activeElement, lens);
  assert.equal(renders, 3, 'fresh reports update the selected content');
  assert.equal(get('token-topic-stops').querySelectorAll('[data-token-stop]')[0], stops[0], 'stop nodes are never rebuilt');
});

test('compact token explorer retains keyboard, direct jumps, and endpoint focus', async () => {
  const { get, requests, document } = await requestPanel();
  const lens = get('efficiency-topic');
  lens.focus();
  const before = requests.length;
  const key = (name, expected) => {
    let prevented = false;
    lens.onkeydown({ key: name, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(lens.value, String(expected));
    assert.equal(document.activeElement, lens);
  };
  key('ArrowLeft', 0); key('ArrowDown', 0); key('ArrowRight', 1); key('ArrowUp', 2);
  key('End', 9); key('ArrowRight', 9); key('ArrowUp', 9);
  assert.equal(get('token-topic-next').disabled, true);
  key('Home', 0);
  assert.equal(get('token-topic-prev').disabled, true);
  lens.onkeydown({ key: 'Tab', preventDefault() { assert.fail('Tab keeps native focus navigation'); } });
  get('token-topic-next').onclick();
  assert.equal(lens.value, '1');
  let previousDisabled = get('token-topic-prev').disabled;
  Object.defineProperty(get('token-topic-prev'), 'disabled', { get: () => previousDisabled, set(value) {
    previousDisabled = value;
    if (value && document.activeElement === get('token-topic-prev')) document.activeElement = null;
  } });
  get('token-topic-prev').focus();
  get('token-topic-prev').onclick(); get('token-topic-prev').onclick();
  assert.equal(lens.value, '0');
  assert.equal(get('token-topic-prev').disabled, true);
  assert.equal(document.activeElement, lens, 'endpoint button hands focus to the lens before it becomes unavailable');
  lens.value = '9'; lens.oninput();
  assert.equal(get('token-selected-title').textContent, 'Biggest spend drivers', 'input changes the content immediately');
  assert.equal(document.activeElement, lens);
  jumpTokenTopic(get, 'overview');
  assert.equal(lens.value, '0');
  assert.equal(get('token-topic-announcement').textContent, 'Showing Overview');
  key('End', 9);
  get('token-topic-next').onclick();
  assert.equal(lens.value, '9');
  assert.equal(requests.length, before);
});

test('Efficiency panels live only in their assigned dashboard and AI review stays separate', async () => {
  const html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  const tokens = html.split('<section id="efficiency-tokens-panel"')[1].split('<section id="efficiency-patterns-panel"')[0];
  const patterns = html.split('<section id="efficiency-patterns-panel"')[1].split('<section id="efficiency-review-panel"')[0];
  const review = html.split('<section id="efficiency-review-panel"')[1].split('<details class="efficiency-method"')[0];
  assert.match(tokens, /id="token-context-panel"/);
  assert.doesNotMatch(tokens, /id="efficiency-reliability"|id="efficiency-habits"|id="efficiency-models"/);
  for (const id of ['efficiency-reliability', 'efficiency-habits', 'efficiency-models']) assert.match(patterns, new RegExp('id="' + id + '"'));
  assert.match(patterns, /<h2[^>]*>Findings<\/h2>/);
  assert.match(patterns, /<h2[^>]*>Model comparisons<\/h2>/);
  assert.match(review, /id="efficiency-review-open"/);
  assert.doesNotMatch(review, /id="(?:token|pattern)-|id="efficiency-(?:topic|pattern-topic|habits|models|insights|reliability)"/);
});

test('token topic inspector links retain keyboard focus through refresh and section changes', async () => {
  const { get, document } = await requestPanel();
  const body = get('token-topic-body');
  let markup = '', button;
  Object.defineProperty(body, 'innerHTML', { get: () => markup, set(value) {
    if (document.activeElement === button) document.activeElement = null;
    markup = value;
    button = value.includes('data-token-context') ? { dataset: { tokenContext: 'true' }, focus() { document.activeElement = this; } } : null;
  } });
  body.querySelector = () => button;
  for (const topic of ['tools', 'results', 'skills']) {
    jumpTokenTopic(get, topic);
    button.focus();
    const previous = button;
    await get('refresh').onclick();
    assert.notEqual(button, previous);
    assert.equal(document.activeElement, button, topic + ' restores its recreated action');
  }
  jumpTokenTopic(get, 'output');
  assert.equal(document.activeElement, get('efficiency-topic'), 'removed action returns focus to the lens');
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
  assert.equal(get('efficiency-method').hidden, true);
  assert.equal(buttons[2]['aria-pressed'], 'true');
  await get('refresh').onclick();
  assert.equal(get('efficiency-review-panel').hidden, false);
  report.efficiency.interactions = { prompts: 6, promptSamples: 6, promptSessions: 2, averagePromptChars: 1250,
    averagePromptsPerSession: 3, turns: 12, turnSessions: 2, averageTurnsPerSession: 6, observedSessions: 2, sessionErrors: 1 };
  report.tools.rows = [{ name: '<private tool>', calls: 4, successes: 2, failures: 1, unknown: 1 },
    { name: 'mcp-tool', server: '<server>', calls: 2, successes: 0, failures: 2, unknown: 0 }];
  await get('refresh').onclick();
  choose('patterns');
  assert.equal(get('efficiency-method').hidden, false);
  assert.match(get('efficiency-habits').innerHTML, /1\.3K/);
  assert.match(get('efficiency-habits').innerHTML, /Input tokens \/ call/);
  assert.equal((get('efficiency-habits').innerHTML.match(/Characters \/ prompt/g) || []).length, 1);
  assert.match(get('efficiency-habits').innerHTML, /separate averages, not a matched ratio/);
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
  assert.match(get('efficiency-habits').innerHTML, /Input tokens \/ call:/);
  assert.doesNotMatch(get('efficiency-habits').innerHTML, /No matching message or turn metadata was recorded/);
  report.efficiency.interactions = { reason: 'model-filter' };
  await get('refresh').onclick();
  assert.match(get('efficiency-habits').innerHTML, /Clear the model filter/);
  assert.doesNotMatch(get('efficiency-habits').innerHTML, /Characters \/ prompt|Input tokens \/ call/);
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
  assert.deepEqual(requests.find(r => r.method === 'settings.set').input, { textSize: 'medium', simplifyNumbers: true, extraHomes: ['/backup'], disabledHomes: ['/disabled'], reviewModel: '' });
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

test('AI review requires a saved model and explicit send, keeps its snapshot and safely renders responses', async () => {
  const { report } = await requestPanel();
  const { get, requests, server } = await mountPanel(report);
  assert.ok(!requests.some(r => r.method.startsWith('review.')));
  await get('efficiency-review-open').onclick();
  assert.equal(get('review-send').disabled, true);
  await get('settings-open').onclick();
  await get('review-models-refresh').onclick();
  assert.match(get('review-model').innerHTML, /Fixture model/);
  assert.ok(!requests.some(r => r.method === 'review.run'));
  get('review-model').value = 'fixture-model';
  await get('settings-save').onclick(); assert.equal(server.config.reviewModel, 'fixture-model');
  await get('review-reconnect').onclick(); assert.match(get('review-connection-status').textContent, /Connection verified/);
  get('project').value = 'Existing project'; await get('project').onchange();
  await get('efficiency-review-open').onclick();
  const snapshot = get('efficiency-review-output').value;
  assert.equal(get('review-send').disabled, false);
  server.review = () => ({ text: '<script>untrusted</script>\nA useful observation', model: 'fixture-model' });
  const beforeSend = requests.length;
  await get('review-send').onclick();
  assert.ok(requests.slice(beforeSend).some(r => r.method === 'usage.report' && r.refresh === true), 'finished reviews refresh recorded usage immediately');
  assert.equal(requests.findLast(r => r.method === 'usage.report').input.project, 'Existing project', 'review refresh preserves the selected filters');
  assert.deepEqual(requests.find(r => r.method === 'review.run').input, { prompt: snapshot, expectedModel: 'fixture-model' });
  assert.equal(get('review-answer').textContent, '<script>untrusted</script>\nA useful observation');
  assert.equal(get('review-answer').innerHTML, '');
  assert.equal(get('review-result').hidden, false);
  await get('refresh').onclick();
  assert.equal(requests.filter(r => r.method === 'review.run').length, 1);
  assert.match(get('review-result-context').textContent, /Later filter changes/);
});

test('AI review cancellation and errors keep the response area honest and restore controls', async () => {
  const { report } = await requestPanel();
  const { get, server, requests } = await mountPanel(report, { reviewModel: 'fixture-model', extraHomes: [], disabledHomes: [] });
  await get('efficiency-review-open').onclick();
  let release;
  server.review = message => message.method === 'review.run' ? new Promise(resolve => { release = resolve; }) : { ok: true };
  const pending = get('review-send').onclick();
  await new Promise(setImmediate);
  assert.equal(get('review-cancel').hidden, false); assert.equal(get('review-send').disabled, true);
  await get('review-cancel').onclick();
  assert.equal(requests.at(-1).method, 'review.cancel');
  release({ text: 'Completed before cancellation', model: 'fixture-model' }); await pending;
  assert.equal(get('review-cancel').hidden, true);
  await get('efficiency-review-open').onclick();
  server.reviewError = 'Same-account verification failed.';
  await get('review-send').onclick();
  assert.equal(get('efficiency-review-status').textContent, server.reviewError);
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').method, 'usage.report');
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').refresh, true, 'failed reviews may still have usage to refresh');
  assert.equal(get('review-send').disabled, false);
  await get('settings-open').onclick(); await get('review-models-refresh').onclick();
  assert.equal(get('review-connection-status').textContent, server.reviewError);
});
