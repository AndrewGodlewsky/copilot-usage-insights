import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

async function mountPanel(report, config = { textSize: 'small', extraHomes: [], disabledHomes: [] }) {
  const html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  const nodes = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const attrs = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    return [id, { value: '', innerHTML: '', textContent: '', clientWidth: 500, hidden: /\shidden\b/.test(tag),
      setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k),
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelectorAll: () => [], querySelector: () => null, contains: () => false }];
  }));
  const get = id => { assert.ok(nodes.has(id), `Element ${id} exists`); return nodes.get(id); };
  get('cache').checked = true; get('group').value = 'models'; get('sort').value = 'total';
  const requests = [], rootStyle = new Map(), server = { config, saveError: '' };
  const context = createContext({
    document: { getElementById: get, activeElement: null, hidden: false, addEventListener() {}, documentElement: {
      classList: { toggle() {} }, style: { setProperty: (k, v) => rootStyle.set(k, String(v)) },
    } },
    window: { addEventListener() {} }, matchMedia: () => ({ matches: false }), setInterval() {},
    fetch: async (url, options) => {
      const message = JSON.parse(options.body); requests.push(message);
      if (message.method === 'settings.get') return { ok: true, json: async () => ({ ...server.config, defaultHome: '/copilot' }) };
      if (message.method === 'settings.set') {
        if (server.saveError) return { ok: false, json: async () => ({ error: server.saveError }) };
        server.config = { ...server.config, ...message.input };
        report.preferences = { textSize: server.config.textSize };
        return { ok: true, json: async () => server.config };
      }
      assert.ok(['usage.report', 'usage.refresh'].includes(message.method));
      return { ok: true, json: async () => report };
    },
  });
  new Script(html.match(/<script>([\s\S]*)<\/script>/)[1]).runInContext(context);
  await new Promise(setImmediate);
  return { get, nodes, requests, rootStyle, server };
}

test('dashboard shows skill versions and separate trigger counts, with last use last and request/tool metrics separate', async () => {
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
  assert.deepEqual(headers, ['Skill', 'Activations', 'By user', 'By agent', 'Sessions', 'Projects', 'Source plugin', 'Plugin version', 'Skill version (installed)', 'Last used']);
  const cells = [...get('skills').innerHTML.matchAll(/<td(?:\s[^>]*)?>(.*?)<\/td>/g)].map(([, value]) => value.replace(/<\/?span[^>]*>/g, ''));
  assert.equal(cells.length, headers.length);
  assert.deepEqual(cells.slice(1, 9), ['5', '2', '1', '1', '1', '&lt;team-tools&gt;', '2.0', '1.0.1']);
  assert.equal(cells.at(-1), '11/13/26, 10:49 PM');
  assert.ok(get('skills').innerHTML.includes(`title="${now.toLocaleString()}"`), 'full timestamp stays available on hover');
  assert.match(get('skills').innerHTML, /title="By user: 2; By agent: 1; Preloaded: 1; Unknown: 1"/);
  assert.doesNotMatch(get('skills').innerHTML, /Reasoning|Success rate|Failures|<hello-test>/);
  assert.ok(!nodes.has('skill-details'));
  await get('refresh').onclick();
  assert.match(get('skills').innerHTML, /Source plugin/);
  assert.match(get('breakdown').innerHTML, /Reasoning/);
  assert.match(get('breakdown').innerHTML, /Avg\. tokens \/ request/);
  assert.match(get('tools').innerHTML, /Failures/);
  assert.match(get('tools').innerHTML, /Success rate/);
  assert.match(get('tools').innerHTML, /Unknown/);
  assert.match(get('tools').innerHTML, /50%/);
  assert.match(get('tools').innerHTML, /&lt;view&gt;/);
  assert.doesNotMatch(get('tools').innerHTML, /<view>/);
  assert.match(get('session').innerHTML, /value="s1"[^>]*>&lt;Planning &quot;work&quot;&gt;<\/option>/);
  get('group').value = 'sessions';
  get('group').onchange();
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
