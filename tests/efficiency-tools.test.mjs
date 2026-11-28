import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolFootprint, TOOL_PROJECT_MIN_CALLS } from '../src/core/efficiency-tools.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';
import { demoData, demoContext } from '../scripts/demo-data.mjs';

const round = value => value == null ? 'Unavailable' : String(Math.round(value * 100) / 100);
const formats = { number: round, credits: round };
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const base = Date.UTC(2026, 5, 1, 12), DAY = 86_400_000;
const call = (extra = {}) => ({ inputTotal: 1000, toolTokenCount: 200, availableToolCount: 10, project: 'p', ...extra });
const run = records => { const t = createToolFootprint(); for (const r of records) t.add(r); return t.finish(); };
const repeat = (n, extra) => Array.from({ length: n }, () => call(extra));

test('calls are grouped by available tool count and need both figures to join a group', () => {
  const result = run([...repeat(3, { availableToolCount: 10, toolTokenCount: 100 }), ...repeat(3, { availableToolCount: 20, toolTokenCount: 300 }), ...repeat(3, { availableToolCount: 30, toolTokenCount: 600 }),
    call({ availableToolCount: null }), call({ toolTokenCount: null, availableToolCount: 20 }), call({ toolTokenCount: 2000 })]);
  assert.equal(result.requests, 12);
  // Counts of 10, 20 and 30 (with a 20 that lacks definition tokens and a 10 whose definitions exceed input).
  assert.equal(result.countCalls, 11);
  assert.equal(result.pairedCalls, 9);
  assert.deepEqual(result.buckets.map(b => [b.min, b.max, b.calls, b.measured, b.averageTokens, b.share]),
    [[10, 10, 4, 3, 100, 10], [20, 20, 4, 3, 300, 30], [30, 30, 3, 3, 600, 60]]);
  assert.equal(result.medianAvailable, 20);
});

test('one distinct count gives no groups, and nothing measured stays null', () => {
  const same = run(repeat(5));
  assert.deepEqual(same.buckets, []);
  assert.equal(same.medianAvailable, 10);
  const none = run([{}, { availableToolCount: null, toolTokenCount: null }]);
  assert.deepEqual([none.requests, none.countCalls, none.pairedCalls, none.medianAvailable, none.buckets, none.projects], [2, 0, 0, null, [], []]);
  const zero = run([call({ availableToolCount: 0, toolTokenCount: 0 }), call({ availableToolCount: 5, toolTokenCount: 0 })]);
  assert.equal(zero.buckets[0].averageTokens, 0);
  assert.equal(zero.medianAvailable, 0);
});

test('projects need the stated minimum and are ranked by definition tokens per call', () => {
  const records = [...repeat(TOOL_PROJECT_MIN_CALLS, { project: 'big', toolTokenCount: 900, availableToolCount: 40 }), ...repeat(TOOL_PROJECT_MIN_CALLS, { project: 'small', toolTokenCount: 100, availableToolCount: null }),
    ...repeat(TOOL_PROJECT_MIN_CALLS - 1, { project: 'few', toolTokenCount: 990 }), ...repeat(TOOL_PROJECT_MIN_CALLS, { project: 'unmeasured', toolTokenCount: null })];
  const result = run(records);
  assert.equal(result.measuredProjects, 3);
  assert.equal(result.listedProjects, 2);
  assert.deepEqual(result.projects.map(p => [p.name, p.calls, p.averageTokens, p.share, p.averageAvailable]), [['big', 20, 900, 90, 40], ['small', 20, 100, 10, null]]);
  const many = run(Array.from({ length: 8 }, (_, i) => repeat(TOOL_PROJECT_MIN_CALLS, { project: `p${i}`, toolTokenCount: 100 + i * 10 })).flat());
  assert.deepEqual(many.projects.map(p => p.name), ['p7', 'p6', 'p5', 'p4', 'p3']);
  assert.equal(many.listedProjects, 8);
});

const built = (records, query = { range: 'all' }) => buildReport(records, query, new Date(base + 40 * DAY));
const record = (n, extra = {}) => ({ key: `k${n}`, ms: base + n * 60_000, sessionId: 's', project: 'one', model: 'Alpha', initiator: 'user', inputTotal: 1000, input: 200, cacheRead: 700, cacheWrite: 100,
  output: 100, reasoning: 10, nanoAiu: 1e9, creditStatus: 'complete', toolTokenCount: 200, availableToolCount: 10, ...extra });

test('the report carries the footprint and the view shows every part', () => {
  const records = [];
  const day = i => base + (i % 6) * DAY + i * 60_000;
  for (let i = 0; i < 30; i++) records.push(record(i, { ms: day(i), availableToolCount: 10, toolTokenCount: 100 }), record(100 + i, { ms: day(i), availableToolCount: 30, toolTokenCount: 200 }), record(200 + i, { ms: day(i), availableToolCount: 50, toolTokenCount: 400, project: "two" }));
  const report = built(records);
  assert.equal(report.efficiency.toolFootprint.buckets.length, 3);
  const html = renderTokenTopic('tools', report, { ...formats, context: demoContext() }), words = text(html);
  assert.match(words, /Footprint by how many tools were available/);
  assert.match(words, /Calls with 50 tools carried 400 definition tokens each, against 100 on calls with 10 tools/);
  assert.match(words, /Projects with the largest footprint per call/);
  assert.match(words, /Available against executed/);
  assert.match(words, /not a count of unused or wasted tools/);
  assert.match(words, /Definition tokens per call by day/);
  assert.match(words, /Compare afterward/);
  assert.doesNotMatch(words, /NaN|undefined|Infinity|—/);
});

test('missing counts show as unavailable, not zero', () => {
  const records = Array.from({ length: 5 }, (_, i) => record(i, { availableToolCount: null, toolTokenCount: null }));
  const words = text(renderTokenTopic('tools', built(records), { ...formats, context: { available: false } }));
  assert.match(words, /No calls in these filters record how many tools were available/);
  assert.match(words, /No project has at least 20 calls/);
  assert.match(words, /Tools available, half of calls Unavailable/);
  assert.doesNotMatch(words, /NaN|undefined|Infinity/);
  const empty = text(renderTokenTopic('tools', { efficiency: { summary: {}, models: [] } }, { ...formats, context: { available: false } }));
  assert.match(empty, /No calls in these filters record/);
  assert.match(empty, /Different tools executed Unavailable/);
  assert.doesNotMatch(empty, /NaN|undefined|Infinity/);
});

test('project and model names are escaped', () => {
  const hostile = '<img src=x>';
  const records = Array.from({ length: 25 }, (_, i) => record(i, { project: hostile, model: hostile }));
  const html = renderTokenTopic('tools', built(records), { ...formats, context: demoContext() });
  assert.ok(!html.includes(hostile));
  assert.ok(html.includes('&lt;img src=x&gt;'));
});

test('the demo history renders a complete view', () => {
  const data = demoData(), report = buildReport(data.records, { range: '30d' }, new Date(), data);
  const words = text(renderTokenTopic('tools', report, { ...formats, context: demoContext() }));
  assert.match(words, /Tools available/);
  assert.doesNotMatch(words, /NaN|undefined|Infinity/);
  assert.ok(JSON.stringify(report.efficiency.toolFootprint).length < 4000);
});

test('executed MCP server count excludes zero-call inventory rows and lists connected unused servers', () => {
  const report = {
    efficiency: { summary: { requests: 10, toolRequests: 10, averageToolTokens: 500, toolShare: 15, toolTokens: 5000, toolCountRequests: 10, averageAvailableTools: 20 }, models: [], toolFootprint: run(repeat(10)) },
    tools: { calls: 4, rows: [{ name: 'github-search', server: 'github', mcpTool: 'search', calls: 4 }] },
    mcp: {
      available: true,
      rows: [
        { name: 'github', calls: 4, status: 'connected', toolsLoaded: true },
        { name: 'unused-db', displayName: '<Unused DB>', calls: 0, status: 'connected', toolsLoaded: true },
        { name: 'no-tools', calls: 0, status: 'connected', toolsLoaded: false },
        { name: 'offline', calls: 0, status: 'disabled', toolsLoaded: false },
      ],
    },
  };
  const html = renderTokenTopic('tools', report, { ...formats, context: { available: false } }), words = text(html);
  assert.match(words, /MCP servers with executed tools 1 Whole selected history/);
  assert.match(words, /Connected MCP servers 3 Current session/);
  assert.match(words, /Connected MCP servers with no calls in these filters/);
  assert.match(html, /&lt;Unused DB&gt;/);
  assert.doesNotMatch(html, /<Unused DB>|no-tools|offline/);
  assert.match(words, /Showing 1 of 1 connected server with no recorded calls/);

  // Unavailable live inventory hides connected server counts and still counts only calls > 0.
  const offline = text(renderTokenTopic('tools', { ...report, mcp: { available: false, rows: report.mcp.rows } }, { ...formats, context: { available: false } }));
  assert.match(offline, /MCP servers with executed tools 1 Whole selected history/);
  assert.doesNotMatch(offline, /Connected MCP servers/);
});
