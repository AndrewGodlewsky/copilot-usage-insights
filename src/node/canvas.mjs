// The dashboard server brings the journal parser, YAML and SQLite with it. It is loaded when a
// dashboard is first opened, not for every Copilot session that merely has the plugin installed.
const startUsageServer = async options => (await import('./canvas-server.mjs')).startServer(options);
import { createIntegrationReader } from './integrations.mjs';
import { createContextReader } from './context.mjs';

export async function registerCanvas({ createCanvas, joinSession, startServer = startUsageServer }) {
  const instances = new Map();
  let session, queue = Promise.resolve();
  const readIntegrations = createIntegrationReader(() => session);
  const readContext = createContextReader(() => session);
  const enqueue = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const dispose = () => enqueue(async () => { const servers = [...instances.values()]; instances.clear(); await Promise.all(servers.map(server => server.close())); });
  session = await joinSession({
    tools: [{
      name: 'open_usage_insights',
      description: 'Open the Usage Insights dashboard in the Copilot desktop app to inspect local GitHub Copilot tokens, AI credits, models, projects, and activity.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => {
        await session.rpc.canvas.open({ canvasId: 'usage-insights', instanceId: 'usage-insights', input: {} });
        return 'Opened Usage Insights in the Copilot canvas.';
      },
    }],
    canvases: [createCanvas({
      id: 'usage-insights', displayName: 'Usage Insights', description: 'Local GitHub Copilot token usage, reported AI credits, and activity.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      open: ctx => enqueue(async () => {
        if (ctx.sessionId && ctx.sessionId !== session.sessionId) throw new Error('This canvas belongs to another session.');
        let server = instances.get(ctx.instanceId);
        if (!server) { server = await startServer({ readIntegrations, readContext, session }); instances.set(ctx.instanceId, server); }
        return { title: 'Usage Insights', status: 'GitHub Copilot', url: server.url };
      }),
      onClose: ctx => enqueue(async () => {
        const server = instances.get(ctx.instanceId); instances.delete(ctx.instanceId);
        await server?.close();
      }),
    })],
  });
  return { dispose };
}
