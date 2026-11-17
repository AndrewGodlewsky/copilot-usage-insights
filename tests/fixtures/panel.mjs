import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Script, createContext } from 'node:vm';

export async function mountPanel(report, config = { textSize: 'small', extraHomes: [], disabledHomes: [] }, releaseNotes, inventory, initial = {}) {
  let html = await fs.readFile(new URL('../../panel/index.html', import.meta.url), 'utf8');
  if (initial.transformHtml) html = initial.transformHtml(html);
  if (releaseNotes) html = html.replace(/const RELEASE_NOTES = .*;/, () => `const RELEASE_NOTES = ${JSON.stringify(releaseNotes).replaceAll('<', '\\u003c')};`);
  const nodes = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const attrs = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    return [id, { value: '', dataset: {}, href: attrs.get('href'), innerHTML: '', textContent: '', clientWidth: 500, clientHeight: 155, hidden: /\shidden\b/.test(tag),
      setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k),
      addEventListener(name, callback) { this[`on${name}`] = callback; },
      getBoundingClientRect: () => ({ top: 0 }),
      style: { setProperty(key, value) { this[key] = String(value); } },
      before(node) { node.nextElementSibling = this; },
      focus() { document.activeElement = this; },
      select() { this.selected = true; },
      click() { this.clicked = true; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelectorAll: () => [], querySelector: () => null, contains: () => false }];
  }));
  const get = id => { assert.ok(nodes.has(id), `Element ${id} exists`); return nodes.get(id); };
  get('initial-diagnostics').textContent = initial.diagnostics ? JSON.stringify(initial.diagnostics) : 'null';
  // Model the persistent navigation children without running a browser.
  for (const id of ['token-topic-stops', 'token-track-nodes', 'token-overview-insight', 'pattern-topic-stops', 'pattern-track-nodes']) {
    let markup = '', children = [];
    Object.defineProperty(get(id), 'innerHTML', { get: () => markup, set(value) {
      markup = value;
      children = [...value.matchAll(/<(?:button|span) data-(token|pattern)-(stop|node|jump)="([^"]+)"([^>]*)>/g)].map(([, prefix, kind, topic, rest]) => {
        const attrs = new Map([...rest.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
        return { dataset: { [prefix + { stop: 'Stop', node: 'Node', jump: 'Jump' }[kind]]: topic },
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
  let activityMarkup = '', activityMarks = [];
  Object.defineProperty(get('activity-chart'), 'innerHTML', { get: () => activityMarkup, set(value) {
    activityMarkup = value;
    activityMarks = [...value.matchAll(/<(?:rect|g)[^>]*data-inspect="(\d+)"([^>]*)>/g)].map(([, index, rest]) => {
      const attrs = new Map([...rest.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
      return { dataset: { inspect: index }, focus() { document.activeElement = this; }, closest() { return this; },
        setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k) };
    });
  } });
  get('activity-chart').querySelectorAll = () => activityMarks;
  get('activity-chart').querySelector = selector => activityMarks.find(mark => mark.dataset.inspect === selector.match(/="(\d+)"/)?.[1]) || null;
  const requests = [], intervals = [], timeouts = [], listeners = new Map(), windowListeners = new Map(), rootStyle = new Map(), server = { config, saveError: '', copied: [], inventory, now: Date.now(), transportError: initial.transportError };
  const objectUrls = new Map(), revoked = [];
  server.downloads = [];
  const document = { getElementById: get, activeElement: null, hidden: false,
    body: { appendChild(node) { node.attached = true; } },
    createElement(tag) {
      assert.equal(tag, 'a');
      return { click() {
        assert.equal(this.attached, true);
        if (server.downloadError) throw new Error('PRIVATE download failure');
        server.downloads.push({ name: this.download, blob: objectUrls.get(this.href) });
      }, remove() { this.attached = false; } };
    },
    addEventListener: (name, callback) => listeners.set(name, callback), documentElement: {
      classList: { toggle() {} }, style: { setProperty: (k, v) => rootStyle.set(k, String(v)) },
  } };
  const motion = { matches: initial.reducedMotion === true, addEventListener(type, callback) { this.changed = callback; } };
  const context = createContext({
    TextEncoder,
    Date: class extends Date { static now() { return server.now; } },
    innerWidth: 1200, innerHeight: 800,
    document,
    Blob, URL: class extends URL { static createObjectURL(blob) { const url = `blob:synthetic-${objectUrls.size}`; objectUrls.set(url, blob); return url; } static revokeObjectURL(url) { revoked.push(url); objectUrls.delete(url); } },
    window: { addEventListener: (name, callback) => windowListeners.set(name, callback) }, matchMedia: query => query.includes('prefers-reduced-motion') ? motion : ({ matches: false }), setInterval: (callback, ms) => intervals.push({ callback, ms }),
    navigator: { clipboard: { writeText: async text => { if (server.clipboardError) throw new Error('Clipboard unavailable'); server.copied.push(text); } } },
    AbortController, setTimeout: (callback, ms) => { const timer = { callback, ms }; timeouts.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cleared = true; },
    fetch: async (url, options) => {
      const message = JSON.parse(options.body); requests.push(message);
      if (server.transportError) throw new TypeError('PRIVATE_NETWORK_ERROR');
      if (server.config.paused && !['settings.get', 'settings.set', 'diagnostics.get', 'review.cancel'].includes(message.method)) return { ok: false, status: 423, json: async () => ({ code: 'paused', paused: true, error: 'Usage Insights is paused. Resume it in Settings.' }) };
      if (message.method === 'diagnostics.get' && server.logsStalled) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))));
      if (message.method === 'diagnostics.get') return { ok: true, json: async () => ({ version: 'test-version', runtime: { node: 'v24', platform: 'win32', arch: 'x64' }, startedAt: new Date().toISOString(), limit: 300, dropped: 0, entries: [{ at: new Date().toISOString(), level: 'info', event: 'history.scan', durationMs: 25 }] }) };
      if (message.method === 'review.prepare') return { ok: true, json: async () => server.prepare ? server.prepare(message) : ({ id: 'fixture-snapshot', preview: JSON.stringify({ scope: message.input.filters, limits: ['Session measures unavailable with a model filter.'] }), model: server.config.reviewModel || '', reasoningEffort: server.config.reviewReasoning || 'default', allowSamples: server.config.reviewAllowSamples !== false, hasEvidence: true, scope: { range: message.input.filters.range, startDate: '2026-11-09', endDate: '2026-11-15' } }) };
      if (message.method.startsWith('review.')) return { ok: !server.reviewError, json: async () => server.reviewError ? { error: server.reviewError } : server.review ? server.review(message) : { models: [{ id: 'fixture-model', label: 'Fixture model', reasoningEfforts: ['medium', 'high'] }], verified: true } };
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
      if (message.method === 'usage.modelProjects') {
        if (server.modelProjectsError) return { ok: false, json: async () => ({ error: server.modelProjectsError }) };
        return { ok: true, json: async () => server.modelProjects(message.input) };
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
  if (initial.serializedResponses) {
    const fixtureFetch = context.fetch;
    context.fetch = async (...args) => {
      const response = await fixtureFetch(...args);
      return { ...response, json: async () => {
        context.__fixtureResponse = JSON.stringify(await response.json());
        try { return new Script('JSON.parse(__fixtureResponse)').runInContext(context); }
        finally { delete context.__fixtureResponse; }
      } };
    };
  }
  new Script(html.match(/<script>([\s\S]*)<\/script>/)[1]).runInContext(context);
  if (!initial.beforeLoad) {
    windowListeners.get('load')?.();
    const startup = timeouts.find(timer => timer.ms === 0);
    await startup?.callback();
  }
  await new Promise(setImmediate);
  return { get, nodes, requests, rootStyle, server, document, intervals, listeners, windowListeners, timeouts, motion, viewport: context, objectUrls, revoked };
}
