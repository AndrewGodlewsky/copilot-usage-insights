// The dashboard server brings the journal parser, YAML and SQLite with it. It is loaded when a
// dashboard is first opened, not for every Copilot session that merely has the plugin installed.
const startUsageServer = options => options.diagnostics.measure('server.start', {}, async () => (await import('./canvas-endpoint.mjs')).startCanvasServer(options));
import { createIntegrationReader } from './integrations.mjs';
import { createContextReader } from './context.mjs';
import { createDiagnostics, diagnosticError } from '../core/diagnostics.mjs';

export async function registerCanvas({ createCanvas, joinSession, startServer = startUsageServer, diagnostics = createDiagnostics(), endpointDirectory, serverOptions = {} }) {
  const instances = new Map();
  let session, queue = Promise.resolve();
  const readIntegrations = createIntegrationReader(() => session);
  const readContext = createContextReader(() => session);
  const enqueue = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const dispose = () => enqueue(async () => { diagnostics.record('info', 'canvas.dispose', { activeCanvases: instances.size }); const servers = [...instances.values()]; instances.clear(); await Promise.allSettled(servers.map(server => server.close())); });
  session = await diagnostics.measure('extension.join', {}, () => joinSession({
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
      open: ctx => {
        const queuedAt = performance.now(), fields = {};
        return diagnostics.measure('canvas.open', fields, () => enqueue(async () => {
          diagnostics.record('info', 'canvas.queue', { phase: 'finished', durationMs: performance.now() - queuedAt });
          if (ctx.sessionId && ctx.sessionId !== session.sessionId) throw new Error('This canvas belongs to another session.');
          let server = instances.get(ctx.instanceId);
          Object.assign(fields, { reused: !!server, activeCanvases: instances.size });
          if (!server) {
            server = await startServer({ ...serverOptions, readIntegrations, readContext, session, diagnostics, instanceId: ctx.instanceId, extensionId: ctx.extensionId, endpointDirectory });
            instances.set(ctx.instanceId, server);
          }
          return { title: 'Usage Insights', status: 'GitHub Copilot', url: server.url };
        }));
      },
      onClose: ctx => enqueue(async () => {
        if (ctx.sessionId && ctx.sessionId !== session.sessionId) throw new Error('This canvas belongs to another session.');
        diagnostics.record('info', 'canvas.close', { activeCanvases: instances.size });
        const server = instances.get(ctx.instanceId); instances.delete(ctx.instanceId);
        try { await server?.close(); }
        finally {
          // Closing the tab is an explicit reset, including when its open callback failed.
          // Extension disposal keeps the endpoint instead, so the retained tab can reconnect.
          try {
            const { forgetCanvasEndpoint } = await import('./canvas-endpoint.mjs');
            await forgetCanvasEndpoint({ session, instanceId: ctx.instanceId, extensionId: ctx.extensionId, endpointDirectory });
            diagnostics.record('info', 'server.endpointReset');
          } catch (error) { diagnostics.record('warn', 'server.endpointReset', diagnosticError(error)); }
        }
      }),
    })],
  }));
  diagnostics.record('info', 'extension.joined');
  return { dispose };
}
