import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { mergeMcpInventory } from '../src/core/integrations.mjs';
import { createIntegrationReader } from '../src/node/integrations.mjs';
import { startServer } from '../src/node/canvas-server.mjs';

const now = new Date(2026, 10, 14, 12);
function activity() {
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  const event = (type, id, data, date = now) => parser.push(JSON.stringify({ type, id, timestamp: date.toISOString(), data }));
  event('session.start', 'session', { sessionId: 's1', context: { repository: 'project-one' } });
  event('session.usage_record', 'usage', { usage: { provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20 } });
  for (const [id, server, success, date = now] of [['a', 'test', true], ['b', 'test', false], ['c', 'test', null], ['d', '', true], ['e', 'other', true], ['old', 'test', false, new Date(2026, 10, 12, 12)]]) {
    event('tool.execution_start', id, { toolCallId: id, toolName: id, mcpConfigServerName: server, mcpServerName: server ? 'runtime-alias' : undefined, model: 'model-a' }, date);
    if (success !== null) event('tool.execution_complete', `end-${id}`, { toolCallId: id, success }, date);
  }
  return parser.snapshot();
}

test('MCP statistics aggregate only identified server calls and retain date/model/project/session filters', () => {
  const scan = activity();
  const report = input => buildReport(scan.records, { range: '1d', ...input }, now, scan);
  const mcp = report().mcp;
  assert.equal(mcp.calls, 4);
  assert.equal(mcp.rows.length, 2);
  const row = mcp.rows.find(r => r.name === 'test');
  assert.deepEqual([row.calls, row.successes, row.failures, row.unknown, row.successRate], [3, 1, 1, 1, 50]);
  assert.equal(row.lastUsed, now.toISOString());
  assert.equal(row.status, 'unavailable');
  assert.equal(report({ range: '7d' }).mcp.calls, 5);
  assert.equal(report({ range: 'custom', startDate: '2026-11-12', endDate: '2026-11-12' }).mcp.calls, 1);
  for (const input of [{ project: 'missing' }, { session: 'missing' }, { models: ['missing'] }]) assert.equal(report(input).mcp.calls, 0);
  scan.skillExcludedSessions = ['s1'];
  assert.equal(report().mcp.calls, 0);
  assert.equal(report().mcp.omitted, 4, 'coverage excludes non-MCP tool calls');
});

test('current MCP inventory survives empty date ranges without claiming history-only servers are connected', () => {
  const scan = activity(), report = buildReport(scan.records, { range: '1d' }, now, scan);
  const inventory = { available: true, sessionId: 'current', rows: [
    { name: 'test', displayName: 'Test server', status: 'connected', enabled: true, source: 'user' },
    { name: 'unused', status: 'needs-auth', enabled: true, source: 'plugin', plugin: 'team-tools', version: '2.0' },
  ] };
  const mcp = mergeMcpInventory(report.mcp, inventory);
  assert.equal(mcp.rows.find(r => r.name === 'test').calls, 3);
  assert.equal(mcp.rows.find(r => r.name === 'test').status, 'connected');
  assert.equal(mcp.rows.find(r => r.name === 'other').status, 'not-in-session');
  assert.equal(mcp.rows.find(r => r.name === 'unused').successRate, null);
  assert.equal(mcp.rows.find(r => r.name === 'unused').lastUsed, null);
  assert.equal(mergeMcpInventory(buildReport([], {}, now).mcp, inventory).rows.length, 2);
  assert.equal(report.mcp.rows.find(r => r.name === 'test').status, 'unavailable', 'merge does not mutate history');
});

test('inventory reads are passive, independent, bounded, and keep only selected metadata', async () => {
  const session = { sessionId: 'current', rpc: {
    mcp: { list: () => { throw new Error('Must not initialize servers'); }, listConfigured: async () => ({ servers: [
      { name: 'test', enabled: true, source: 'plugin', sourcePlugin: 'team-tools', sourcePluginVersion: '2.0', live: { status: 'connected', toolsLoaded: true }, env: { SECRET: 'PRIVATE' } },
      { name: 'old-runtime', enabled: false },
      { name: 'bad', enabled: true, live: { status: 'failed', error: 'Authorization: Bearer SECRET_TOKEN https://user:pass@example.com/mcp?key=SECRET_QUERY' } },
    ] }) },
    plugins: { list: async () => ({ plugins: [
      { name: 'installed', marketplace: 'team', version: '1.2', enabled: true, installedFrom: 'PRIVATE' },
      { name: 'disabled', marketplace: '', enabled: false, source: 'builtin' },
      { name: 'desired', marketplace: 'team', enabled: true, managed: true, installed: false },
    ] }) },
  } };
  const read = createIntegrationReader(() => session, { timeoutMs: 15 });
  const result = await read();
  assert.equal(result.mcp.sessionId, 'current');
  assert.equal(result.mcp.rows[0].status, 'connected');
  assert.equal(result.mcp.rows[1].status, 'unavailable');
  assert.equal(result.mcp.rows[0].plugin, 'team-tools');
  assert.equal(result.plugins.rows.find(p => p.name === 'disabled').enabled, false);
  assert.equal(result.plugins.rows.find(p => p.name === 'desired').installed, false);
  assert.ok(!JSON.stringify(result).match(/PRIVATE|SECRET_TOKEN|SECRET_QUERY|user:pass/));
  session.rpc.plugins.list = async () => { throw new Error('PRIVATE ERROR'); };
  assert.equal((await read()).mcp.available, true);
  assert.equal((await read()).plugins.available, false);
  let calls = 0;
  session.rpc.mcp.listConfigured = () => { calls++; return new Promise(() => {}); };
  assert.equal((await read()).mcp.available, false);
  assert.equal((await read()).mcp.available, false);
  assert.equal(calls, 1, 'a stalled RPC does not multiply on refresh');
  assert.equal((await createIntegrationReader(() => undefined)()).mcp.available, false);
});

test('dashboard refreshes both inventories without date-filtering them or changing token and skill reports', async t => {
  const scan = activity();
  let status = 'connected', version = '1.0';
  const session = { sessionId: 'live', rpc: {
    mcp: { listConfigured: async () => ({ servers: [{ name: 'test', enabled: true, live: { status } }] }) },
    plugins: { list: async () => ({ plugins: [{ name: 'test-plugin', enabled: true, version, marketplace: 'test-marketplace' }] }) },
  } };
  const server = await startServer({ html: '', defaultHome: 'fixture', now: () => now,
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => ({ ...scan, sources: [], coverage: {} }) },
    readIntegrations: createIntegrationReader(() => session),
  });
  t.after(() => server.close());
  const request = async (input, method = 'usage.report') => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  let result = await request({ range: '1d' });
  const original = buildReport(scan.records, { range: '1d' }, now, scan);
  assert.deepEqual(result.totals, original.totals);
  assert.deepEqual(result.skills, original.skills);
  assert.equal(result.mcp.rows.find(row => row.name === 'test').status, 'connected');
  assert.equal(result.plugins.rows[0].version, '1.0');
  status = 'needs-auth'; version = '2.0';
  result = await request({ range: 'custom', startDate: '2026-11-01', endDate: '2026-11-01' }, 'usage.refresh');
  assert.equal(result.mcp.calls, 0);
  assert.equal(result.mcp.rows[0].status, 'needs-auth');
  assert.equal(result.plugins.rows[0].version, '2.0');
  session.rpc.mcp.listConfigured = async () => { throw new Error('Unavailable runtime'); };
  result = await request({ range: '1d' });
  assert.equal(result.mcp.available, false);
  assert.equal(result.mcp.calls, 4);
  assert.equal(result.plugins.available, true);
  assert.deepEqual(result.totals, original.totals);
});

test('connection errors redact quoted credential fields and command-line credentials before reaching the dashboard', async () => {
  for (const error of [
    'Connection rejected: {"api_key":"PRIVATE_KEY","token":"PRIVATE_TOKEN","cookie":"PRIVATE_COOKIE"}',
    "Auth failed: {'access_token': 'PRIVATE_ACCESS', 'refreshToken': 'PRIVATE_REFRESH', 'client_secret': 'PRIVATE_CLIENT'}",
    'Failed --api-key PRIVATE_CLI_KEY --password="PRIVATE PASSWORD" --token PRIVATE_TOKEN',
    'Cookie: session=PRIVATE_SESSION; other=PRIVATE_OTHER\nAuthorization: Basic PRIVATE_BASIC',
    String.raw`Rejected {"password":"PRIVATE\" PASSWORD"} --client-secret 'PRIVATE SECRET'`,
    'Request rejected: password=PRIVATE_PASSWORD, accessToken=PRIVATE_ACCESS',
  ]) {
    const session = { rpc: { mcp: { listConfigured: async () => ({ servers: [{ name: 'test', live: { status: 'failed', error } }] }) } } };
    const result = await createIntegrationReader(() => session)();
    assert.equal(result.mcp.available, true);
    assert.doesNotMatch(result.mcp.rows[0].error, /PRIVATE/, error);
    assert.match(result.mcp.rows[0].error, /redacted/);
  }
  const error = 'Connection refused: server exited with code 1';
  const session = { rpc: { mcp: { listConfigured: async () => ({ servers: [{ name: 'test', live: { status: 'failed', error } }] }) } } };
  assert.equal((await createIntegrationReader(() => session)()).mcp.rows[0].error, error);
});
