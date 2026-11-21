import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolMaterial } from '../src/core/efficiency-results.mjs';
import { createEfficiencyTopics } from '../src/core/efficiency-topics.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { demoData, demoContext } from '../scripts/demo-data.mjs';

const base = Date.UTC(2026, 5, 1, 12), S = 1000;
const call = (at, input, output, extra = {}) => ({ sessionId: 's', ms: base + at * S, initiator: 'agent', inputTotal: input, output, ...extra });
const tool = (at, name, extra = {}) => ({ sessionId: 's', ms: base + at * S, name, server: '', mcpTool: '', completedMs: null, ...extra });
const build = (calls, tools, context = {}) => {
  const topic = createToolMaterial({ now: new Date(base + 86_400_000), ...context });
  for (const r of calls) topic.add(r, 0);
  for (const t of tools) topic.addTool(t, null);
  return topic.finish();
};
const formats = { number: (value, options = {}) => String(options.maximumFractionDigits === undefined ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10), credits: String };

test('tool calls are grouped by recorded name, with MCP identified by the server field', () => {
  const result = build([], [tool(0, 'view'), tool(1, 'VIEW'), tool(2, 'grep'), tool(3, 'bash'), tool(4, 'edit'), tool(5, 'create'), tool(6, 'github-search', { server: 'github', mcpTool: 'search' }),
    tool(7, 'view', { server: 'docs', mcpTool: 'view' }), tool(8, 'mystery'), tool(9, 'mystery'), tool(10, 'task')]);
  const family = id => result.families.find(row => row.id === id);
  assert.equal(result.calls, 11);
  assert.deepEqual(['read', 'search', 'command', 'edit', 'mcp', 'other'].map(id => family(id).calls), [2, 1, 1, 2, 2, 3]);
  assert.equal(family('read').share, 2 / 11 * 100);
  assert.deepEqual(result.otherNames, [{ name: 'mystery', calls: 2 }, { name: 'task', calls: 1 }]);
});

test('durations use only calls with a recorded completion and report the middle and the total', () => {
  const done = (at, took, extra = {}) => tool(at, 'view', { completedMs: base + (at + took) * S, ...extra });
  const result = build([], [done(0, 1), done(1, 3), done(2, 100), tool(3, 'view'), done(4, -1 + 0, { completedMs: base + 3 * S }), tool(5, 'bash', { completedMs: base + 5 * S })]);
  const read = result.families.find(row => row.id === 'read'), command = result.families.find(row => row.id === 'command');
  assert.equal(read.calls, 5);
  assert.equal(read.timedCalls, 3);
  assert.equal(read.middleMs, 3 * S);
  assert.equal(read.totalMs, 104 * S);
  // A call that finished at the instant it started has a duration of zero, not an unknown one.
  assert.equal(command.timedCalls, 1);
  assert.equal(command.middleMs, 0);
  const none = build([], [tool(0, 'view')]);
  assert.equal(none.families.find(row => row.id === 'read').middleMs, null);
  assert.equal(none.families.find(row => row.id === 'read').totalMs, null);
  const future = build([], [tool(0, 'view', { completedMs: base + 2 * 86_400_000 })]);
  assert.equal(future.timedCalls, 0);
});

test('input added between calls is the next input minus the earlier input and output, grouped by tool calls in between', () => {
  // Steps: 0 tools (+500), 1 tool (+300), 2 tools (+700), 4 tools (+1000), 1 tool that shrank.
  const calls = [call(0, 1000, 100), call(10, 1600, 50), call(20, 1950, 50), call(30, 2700, 100), call(40, 3800, 100), call(50, 1000, 10)];
  const tools = [tool(11, 'view'), tool(21, 'view'), tool(22, 'grep'), tool(31, 'view'), tool(32, 'view'), tool(33, 'view'), tool(34, 'view'), tool(45, 'bash')];
  const { added } = build(calls, tools);
  assert.equal(added.steps, 5);
  assert.deepEqual(added.groups.map(row => [row.id, row.steps, row.grew, row.shrunk, row.middle]), [['none', 1, 1, 0, 500], ['one', 2, 1, 1, 300], ['few', 1, 1, 0, 700], ['many', 1, 1, 0, 1000]]);
  assert.equal(added.shrunk, 1);
  assert.equal(added.grew, 4);
  assert.equal(added.middle, 600);
  assert.deepEqual(added.sessions, { total: 1, used: 1, subagent: 0, unknownInitiator: 0, noToolEvents: 0, tooShort: 0 });
});

test('a tool that starts at the time of the earlier call belongs to the step after it, and one at the next call does not', () => {
  const { added } = build([call(0, 1000, 0), call(10, 1100, 0)], [tool(0, 'view'), tool(10, 'view')]);
  assert.equal(added.groups.find(row => row.id === 'one').steps, 1);
});

test('records and tool events in any order give the same steps', () => {
  const calls = [call(0, 1000, 100), call(10, 1600, 50), call(20, 1950, 50), call(30, 2700, 100)];
  const tools = [tool(11, 'view'), tool(21, 'view'), tool(22, 'grep')];
  const ordered = build(calls, tools);
  assert.deepEqual(build([calls[2], calls[0], calls[3], calls[1]], [tools[2], tools[0], tools[1]]), ordered);
});

test('unknown counts are not zero and steps without a full measurement are counted apart', () => {
  const { added } = build([call(0, 1000, 100), call(10, 1500, null), call(20, 2000, 100), call(30, null, 10), call(40, 3000, 10)], [tool(5, 'view'), tool(15, 'view'), tool(25, 'view')]);
  // 0->10 measured (+400); 10->20 has no earlier output; 20->30 has no later input; 30->40 has no earlier input.
  assert.equal(added.steps, 1);
  assert.equal(added.unmeasured, 3);
  assert.equal(added.groups.find(row => row.id === 'one').middle, 400);
  assert.equal(added.groups.find(row => row.id === 'none').middle, null);
  // A step that added nothing is zero, and only a step that shrank is set apart.
  const zero = build([call(0, 1000, 100), call(10, 1100, 0)], [tool(5, 'view')]).added;
  assert.equal(zero.groups.find(row => row.id === 'one').middle, 0);
  assert.equal(zero.shrunk, 0);
});

test('conversations that cannot be told from subagent work, or have no tool events, are left out and counted', () => {
  const topic = createToolMaterial({ now: new Date(base + 86_400_000), query: { models: ['M'] } });
  const put = (sessionId, at, input, initiator = 'agent', extra = {}) => topic.add({ sessionId, ms: base + at * S, initiator, inputTotal: input, output: 10, ...extra }, 0);
  const touch = sessionId => topic.addTool({ sessionId, ms: base + 5 * S, name: 'view', server: '' }, null);
  for (const id of ['good', 'delegating', 'unlabelled', 'silent', 'single', 'compacting']) { put(id, 0, 1000); if (id !== 'single') put(id, 10, 1500); }
  put('delegating', 3, 100, 'sub-agent'); put('unlabelled', 4, 100, ''); put('compacting', 5, 100, 'agent', { origin: 'compaction' });
  for (const id of ['good', 'delegating', 'unlabelled', 'single', 'compacting']) touch(id);
  topic.add({ ms: base, initiator: 'agent', inputTotal: 5 }, 0);
  const { added } = topic.finish();
  assert.deepEqual(added.sessions, { total: 6, used: 2, subagent: 1, unknownInitiator: 1, noToolEvents: 1, tooShort: 1 });
  assert.equal(added.steps, 2);
  assert.equal(added.modelFiltered, true);
});

test('registered under toolMaterial, the topic sees both calls and tool events once and stays small', () => {
  const topics = createEfficiencyTopics({ now: new Date(base + 86_400_000) });
  const calls = [];
  for (let i = 0; i < 2000; i++) { const r = call(i * 10, 1000 + i * 40, 20); calls.push(r); topics.addRequest(r, 0); topics.addTool(tool(i * 10 + 5, i % 2 ? 'view' : `tool-${i}`, { completedMs: base + (i * 10 + 6) * S }), true); }
  const result = topics.finish();
  assert.equal(result.toolMaterial.calls, 2000);
  assert.equal(result.toolMaterial.added.steps, 1999);
  assert.ok(JSON.stringify(result.toolMaterial).length < 5000);
  assert.equal(result.toolMaterial.otherDistinct, 201);
  assert.equal(result.toolMaterial.otherNames.length, 5);
});

test('the demo history yields a bounded report and a readable view', () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now), report = buildReport(data.records, { range: '30d' }, now, data);
  const material = report.efficiency.toolMaterial;
  assert.equal(material.calls, report.tools.calls);
  assert.ok(material.added.steps > 0 && material.added.sessions.used > 0);
  assert.ok(JSON.stringify(material).length < 5000);
  const html = renderTokenTopic('results', report, { ...formats, context: demoContext(now) });
  assert.match(html, /What the agent ran/);
  assert.match(html, /grouped by the recorded tool name only/);
  assert.match(html, /Input added between model calls/);
  assert.match(html, /An estimate, not a measurement/);
  assert.match(html, /not time spent waiting/);
  assert.match(html, /Compare afterward:/);
  assert.match(html, /Largest tool-attributed context sources/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the view escapes names, shows unknown as Unavailable and handles a report with no measurements', () => {
  const material = build([call(0, 1000, 10), call(10, 1200, 10)], [tool(5, '<img src=x>', { completedMs: null }), tool(6, 'view')]);
  const report = { efficiency: { toolMaterial: material }, tools: { calls: 2, rows: [] } };
  const html = renderTokenTopic('results', report, { ...formats, context: { available: false } });
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  for (const bare of [{ tools: { calls: 0, rows: [] } }, { efficiency: { toolMaterial: build([], []) }, tools: { calls: 0, rows: [] } }, {}]) {
    const view = renderTokenTopic('results', bare, { ...formats, context: { available: false } });
    assert.match(view, /Compare afterward:/);
    assert.doesNotMatch(view, /NaN|undefined|Infinity/);
  }
  const none = renderTokenTopic('results', { efficiency: { toolMaterial: build([], []) } }, { ...formats, context: { available: false } });
  assert.match(none, /No tool calls match these filters/);
  assert.match(none, /input added between calls cannot be estimated|No main-conversation model calls/);
});
