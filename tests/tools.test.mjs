import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

const now = new Date(2026, 10, 13, 12);
const timestamp = new Date(2026, 10, 13, 10).toISOString();
const session = { type: 'session.start', data: { sessionId: 's1', context: { repository: 'project-one' } } };
const usage = (extra = {}) => ({ id: 'usage', type: 'session.usage_record', timestamp, data: { usage: {
  provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20, ...extra,
} } });
const start = (id, extra = {}) => ({ id: `start-${id}`, type: 'tool.execution_start', timestamp,
  data: { toolCallId: id, toolName: 'view', model: 'model-a', arguments: 'PRIVATE ARGS', ...extra } });
const end = (id, success = true) => ({ id: `end-${id}`, type: 'tool.execution_complete', timestamp,
  data: { toolCallId: id, success, result: { content: 'PRIVATE RESULT' }, error: { message: 'PRIVATE ERROR' } } });
const parse = events => {
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  [session, ...events].forEach(e => parser.push(JSON.stringify(e)));
  return parser.snapshot();
};
const report = (snapshot, input = {}) => buildReport(snapshot.records, { range: '1d', ...input }, now, snapshot);

test('tool metadata joins outcomes by call ID, deduplicates replay, and discards payloads', () => {
  const snapshot = parse([usage(), end('a', false), start('a'), start('a'), end('a', false),
    start('b'), end('b', true), start('c'), start('d'), end('d', 'false'), end('orphan'),
    { ...start('live'), ephemeral: true }, { ...start('invalid'), timestamp: 'invalid' },
    start('unnamed', { toolName: '' }), end('', true)]);
  assert.equal(snapshot.tools?.length, 4);
  assert.deepEqual(snapshot.tools.map(t => t.success), [false, true, null, null]);
  assert.equal(snapshot.invalidTools, 3);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  const r = report(snapshot).tools;
  assert.equal(r.calls, 4);
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.rows[0].calls, r.rows[0].successes, r.rows[0].failures, r.rows[0].unknown, r.rows[0].successRate], [4, 1, 1, 2, 50]);
  assert.equal(report(parse([usage(), start('pending')])).tools.rows[0].successRate, null);
});

test('tool reports use call dates and explicit models, distinguish MCP servers, and apply attribution', () => {
  const snapshot = parse([usage(), start('a'), end('a'), start('b', { model: 'model-b' }), end('b', false),
    start('no-model', { model: undefined }),
    start('mcp-one', { mcpServerName: 'one', mcpToolName: 'fetch' }),
    start('mcp-two', { mcpServerName: 'two', mcpToolName: 'fetch' }),
    { ...start('yesterday'), timestamp: new Date(2026, 10, 12, 10).toISOString() },
    { ...start('future'), timestamp: new Date(2026, 10, 13, 13).toISOString() },
    { type: 'session.context_changed', data: { repository: 'project-two' } }, start('other-project'),
    { ...end('other-project', false), timestamp: new Date(2026, 10, 13, 13).toISOString() }]);
  assert.equal(report(snapshot).tools?.calls, 6);
  assert.equal(report(snapshot).tools.rows.length, 3);
  assert.equal(report(snapshot, { range: 'all' }).tools.calls, 7);
  assert.equal(report(snapshot, { models: ['model-b'] }).tools.calls, 1);
  assert.equal(report(snapshot, { models: ['missing-model'] }).tools.calls, 0);
  const project = report(snapshot, { project: 'project-two' }).tools;
  assert.equal(project.calls, 1);
  assert.equal(project.rows[0].unknown, 1, 'future completion must not become a current failure');
  assert.equal(report(snapshot, { session: 'other-session' }).tools.calls, 0);
  assert.equal(report(parse([start('a')])).tools.omitted, 1);
  assert.equal(report(parse([usage({ isByok: true }), start('a')])).tools.calls, 0);
  assert.equal(report(parse([usage(), { ...usage({ provider: { kind: 'custom' } }), id: 'custom' }, start('a')])).tools.calls, 0);
});

test('tool model filters resolve request display labels to recorded IDs within the same session', () => {
  const snapshot = parse([usage({ model: 'model-id', modelDisplayName: 'Model One' }), start('a', { model: 'model-id' }), end('a'),
    { type: 'session.start', data: { sessionId: 's2', context: { repository: 'project-two' } } },
    { ...usage({ model: 'model-id', modelDisplayName: 'Model Two' }), id: 'second' }, start('b', { model: 'model-id' }), end('b', false)]);
  const one = report(snapshot, { models: ['Model One'] });
  assert.equal(one.totals.requests, 1);
  assert.equal(one.tools.calls, 1);
  assert.equal(one.tools.rows[0].successRate, 100);
  const two = report(snapshot, { models: ['Model Two'] });
  assert.equal(two.tools.calls, 1);
  assert.equal(two.tools.rows[0].successRate, 0);
  assert.equal(report(snapshot, { models: ['Model One', 'Model Two'] }).tools.calls, 2);
});

test('scanner retains new outcomes, deduplicates copies, and rebuilds tool history after deletion', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homes = [path.join(root, 'a'), path.join(root, 'b')];
  const files = homes.map(home => path.join(home, 'session-state', 's1', 'events.jsonl'));
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  for (const file of files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, lines([session, usage(), start('a')]));
  }
  const scanner = createScanner();
  assert.equal(report(await scanner.scan(homes)).tools?.calls, 1);
  await fs.appendFile(files[1], lines([end('a', false)]));
  assert.equal(report(await scanner.scan(homes)).tools.rows[0].failures, 1);
  assert.equal(report(await scanner.scan(homes, { force: true })).tools.calls, 1);
  await fs.unlink(files[1]);
  assert.equal(report(await scanner.scan(homes)).tools.rows[0].unknown, 1);
  await fs.writeFile(files[0], lines([session, usage(), start('b'), end('b')]));
  assert.equal(report(await scanner.scan(homes)).tools.rows[0].successRate, 100);
});
