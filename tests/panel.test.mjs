import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Script, createContext } from 'node:vm';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

test('dashboard hides skill details until toggled, keeps trigger counts, and separates request/tool metrics', async () => {
  const now = new Date(2026, 10, 13, 12), timestamp = now.toISOString();
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  const events = [
    { type: 'session.usage_record', id: 'u1', timestamp, data: { usage: { provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 60, cacheWriteTokens: 10 } } },
    ...['user-invoked', 'agent-invoked', 'context-load', undefined].map((trigger, i) => ({ type: 'skill.invoked', id: `s${i}`, timestamp, data: { name: '<hello-test>', path: '/skills/hello/SKILL.md', pluginName: '<team-tools>', pluginVersion: '2.0', trigger } })),
    ...[true, false, null].flatMap((success, i) => [
      { type: 'tool.execution_start', id: `start-${i}`, timestamp, data: { toolName: '<view>', toolCallId: `c${i}`, model: 'model-a' } },
      ...(success === null ? [] : [{ type: 'tool.execution_complete', id: `end-${i}`, timestamp, data: { toolCallId: `c${i}`, success } }]),
    ]),
  ];
  events.forEach(e => parser.push(JSON.stringify(e)));
  const snapshot = parser.snapshot();
  const report = { ...buildReport(snapshot.records, { range: '1d' }, now, snapshot), sources: [], coverage: {} };
  report.skills.rows[0].installedVersion = { value: '1.0.1', status: 'available' };
  const html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  const nodes = new Map([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => {
    const attrs = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    return [id, { value: '', innerHTML: '', textContent: '', clientWidth: 500, hidden: /\shidden\b/.test(tag),
      setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k),
      querySelectorAll: () => [], querySelector: () => null, contains: () => false }];
  }));
  const get = id => { assert.ok(nodes.has(id), `Element ${id} exists`); return nodes.get(id); };
  get('cache').checked = true; get('group').value = 'models'; get('sort').value = 'total';
  const context = createContext({
    document: { getElementById: get, activeElement: null, hidden: false, addEventListener() {}, documentElement: { classList: { toggle() {} } } },
    window: { addEventListener() {} }, matchMedia: () => ({ matches: false }), setInterval() {},
    fetch: async () => ({ ok: true, json: async () => report }),
  });
  new Script(html.match(/<script>([\s\S]*)<\/script>/)[1]).runInContext(context);
  await new Promise(setImmediate);
  assert.ok(get('skills').innerHTML.includes('&lt;hello-test&gt;'), get('status').textContent);
  assert.match(get('skills').innerHTML, /Manual 1/);
  assert.match(get('skills').innerHTML, /Agent 1/);
  assert.match(get('skills').innerHTML, /Preloaded 1/);
  assert.match(get('skills').innerHTML, /Unknown 1/);
  assert.doesNotMatch(get('skills').innerHTML, /Source plugin|Plugin version|Skill version|Reasoning|Success rate|Failures|<hello-test>/);
  assert.equal(get('skill-details').getAttribute('aria-expanded'), 'false');
  get('skill-details').onclick();
  assert.equal(get('skill-details').getAttribute('aria-expanded'), 'true');
  assert.match(get('skills').innerHTML, /Source plugin/);
  assert.match(get('skills').innerHTML, /&lt;team-tools&gt;/);
  assert.match(get('skills').innerHTML, /1\.0\.1/);
  await get('refresh').onclick();
  assert.match(get('skills').innerHTML, /Source plugin/);
  get('skill-details').onclick();
  assert.equal(get('skill-details').getAttribute('aria-expanded'), 'false');
  assert.doesNotMatch(get('skills').innerHTML, /Source plugin/);
  assert.match(get('breakdown').innerHTML, /Reasoning/);
  assert.match(get('breakdown').innerHTML, /Avg\. tokens \/ request/);
  assert.match(get('tools').innerHTML, /Failures/);
  assert.match(get('tools').innerHTML, /Success rate/);
  assert.match(get('tools').innerHTML, /Unknown/);
  assert.match(get('tools').innerHTML, /50%/);
  assert.match(get('tools').innerHTML, /&lt;view&gt;/);
  assert.doesNotMatch(get('tools').innerHTML, /<view>/);
});
