import { startServer as startUsageServer } from './canvas-server.mjs';
import { createIntegrationReader } from './integrations.mjs';

export async function registerCanvas({ createCanvas, joinSession, startServer = startUsageServer }) {
  const instances = new Set();
  let server, session, queue = Promise.resolve();
  const readIntegrations = createIntegrationReader(() => session);
  const enqueue = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const dispose = () => enqueue(async () => { instances.clear(); const old = server; server = null; await old?.close(); });
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
        server ??= await startServer({ readIntegrations }); instances.add(ctx.instanceId);
        return { title: 'Usage Insights', status: 'GitHub Copilot', url: server.url };
      }),
      onClose: ctx => enqueue(async () => {
        instances.delete(ctx.instanceId);
        if (!instances.size) { const old = server; server = null; await old?.close(); }
      }),
    })],
  });
  return { dispose };
}
