import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

test('local MCP test server negotiates stdio and returns real success and deliberate failure results', async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/mcp-test-server.mjs', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  const request = async (method, params) => {
    const requestId = ++id;
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    const line = await lines.next();
    assert.equal(line.done, false, 'server responded');
    const response = JSON.parse(line.value);
    assert.equal(response.id, requestId);
    return response;
  };
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'usage-insights-test');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listing = await request('tools/list');
  assert.deepEqual(listing.result.tools.map(tool => tool.name), ['hello', 'intentional_failure']);
  assert.equal((await request('tools/call', { name: 'hello', arguments: {} })).result.content[0].text, 'Hello! Your MCP test server is connected.');
  assert.equal((await request('tools/call', { name: 'intentional_failure', arguments: {} })).result.isError, true);
  assert.equal((await request('tools/call', { name: 'unknown' })).error.code, -32602);
  assert.deepEqual((await request('ping')).result, {});
  assert.equal((await request('unknown')).error.code, -32601);
  child.stdin.end();
});
