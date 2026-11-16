import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configDir } from './settings.mjs';
import { diagnosticError } from '../core/diagnostics.mjs';

export function validEndpoint(endpoint) {
  return endpoint?.version === 1 && Number.isInteger(endpoint.port) && endpoint.port >= 1024 && endpoint.port <= 65535
    && typeof endpoint.token === 'string' && /^[a-f0-9]{64}$/.test(endpoint.token);
}

function endpointFile({ session, instanceId, extensionId = '', endpointDirectory = path.join(configDir(), 'canvas-endpoints') }) {
  if (!session?.sessionId || !instanceId) throw new TypeError('A dashboard needs a session and instance');
  const key = createHash('sha256').update(JSON.stringify([session.sessionId, extensionId, instanceId])).digest('hex');
  return path.join(endpointDirectory, `${key}.json`);
}

export async function forgetCanvasEndpoint(identity) {
  try { await fs.unlink(endpointFile(identity)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

// Copilot can replace an extension while retaining its canvas renderer. Preserve that
// renderer's private loopback address; never share it with another session or instance.
export async function startCanvasServer({ session, instanceId, extensionId = '', endpointDirectory = path.join(configDir(), 'canvas-endpoints'), ...options }) {
  const { startServer } = await import('./canvas-server.mjs');
  const file = endpointFile({ session, instanceId, extensionId, endpointDirectory });
  async function savedEndpoint() {
    try {
      const endpoint = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!validEndpoint(endpoint)) throw new TypeError('Invalid saved dashboard endpoint');
      return endpoint;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let endpoint;
  try {
    await fs.mkdir(endpointDirectory, { recursive: true, mode: 0o700 });
    endpoint = await savedEndpoint();
  } catch (error) {
    // Recovery metadata is optional: a damaged or unwritable file must not prevent opening.
    options.diagnostics?.record('warn', 'server.endpoint', { phase: 'failed', ...diagnosticError(error) });
    return startServer({ ...options, session });
  }
  for (let attempt = 0; ; attempt++) {
    let server;
    try {
      server = await startServer({ ...options, session, endpoint });
      if (!endpoint) {
        const url = new URL(server.url);
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify({ version: 1, port: Number(url.port), token: url.pathname.slice(1, -1) }), { flag: 'wx', mode: 0o600 });
          // Publish a complete record without overwriting another opener's address.
          await fs.link(temporary, file);
        } catch (error) {
          if (error.code !== 'EEXIST') {
            options.diagnostics?.record('warn', 'server.endpoint', { phase: 'failed', ...diagnosticError(error) });
            return server;
          }
          await server.close();
          endpoint = await savedEndpoint();
          if (!endpoint) throw error;
          continue;
        } finally { await fs.unlink(temporary).catch(() => {}); }
      }
      options.diagnostics?.record('info', 'server.endpoint', { reused: !!endpoint, phase: 'finished' });
      return server;
    } catch (error) {
      // A host handoff may open the replacement just before stopping the old process.
      // The OS owns the port lock. Do not kill its owner or silently choose a new URL.
      if (!endpoint || error.code !== 'EADDRINUSE' || attempt >= 20) {
        options.diagnostics?.record('error', 'server.endpoint', { phase: 'failed', ...diagnosticError(error) });
        throw error;
      }
      if (!attempt) options.diagnostics?.record('info', 'server.endpoint', { reused: true, phase: 'started' });
      await delay(250);
    }
  }
}
