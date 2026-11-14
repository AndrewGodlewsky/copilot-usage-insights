// Optional local fixture. Copilot owns this stdio process; it never reads files or uses the network.
import { createInterface } from 'node:readline';

const tools = [
  { name: 'hello', description: 'Return a greeting to test the Usage Insights MCP dashboard.' },
  { name: 'intentional_failure', description: 'Return an intentional test error to verify MCP failure statistics. No side effects.' },
].map(tool => ({ ...tool, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
const reply = response => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...response }) + '\n');
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message;
  try { message = JSON.parse(line); }
  catch { reply({ id: null, error: { code: -32700, message: 'Invalid JSON' } }); continue; }
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    reply({ id: null, error: { code: -32600, message: 'Invalid request' } }); continue;
  }
  if (!Object.hasOwn(message, 'id')) continue;
  const { id, method, params } = message;
  if (method === 'initialize') reply({ id, result: {
    protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(params?.protocolVersion) ? params.protocolVersion : '2025-06-18',
    capabilities: { tools: {} }, serverInfo: { name: 'usage-insights-test', version: '1.0.0' },
  } });
  else if (method === 'ping') reply({ id, result: {} });
  else if (method === 'tools/list') reply({ id, result: { tools } });
  else if (method === 'tools/call') {
    if (!tools.some(tool => tool.name === params?.name)) reply({ id, error: { code: -32602, message: 'Unknown test tool' } });
    else {
      const failure = params.name === 'intentional_failure';
      reply({ id, result: { isError: failure, content: [{ type: 'text', text: failure
        ? 'Intentional test failure. The MCP connection is working; this tool returned an error on purpose.'
        : 'Hello! Your MCP test server is connected.' }] } });
    }
  } else reply({ id, error: { code: -32601, message: 'Method not found' } });
}
