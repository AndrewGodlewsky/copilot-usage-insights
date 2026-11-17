import { registerHooks } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const loaded = new Set();
registerHooks({ load(url, context, next) { if (url.includes('/src/')) loaded.add(url.split('/src/')[1]); return next(url, context); } });
const start = performance.now(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-startup-host-'));
const { registerCanvas } = await import('../../src/node/canvas.mjs');
let canvas, scans = 0;
const extension = await registerCanvas({ createCanvas: x => x, joinSession: async config => { canvas = config.canvases[0]; return { sessionId: 'fixture' }; },
  endpointDirectory: directory, serverOptions: {
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => { scans++; return { records: [], sources: [], coverage: {} }; } },
    reviewService: { catalog: async () => ({ models: [] }), close: async () => {} },
  },
});
try {
  const opened = await canvas.open({ instanceId: 'fixture' }), openMs = performance.now() - start;
  const page = await (await fetch(opened.url)).text(), pageMs = performance.now() - start;
  const shellModules = [...loaded], shellScans = scans;
  const call = method => fetch(opened.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }) }).then(r => r.json());
  await call('diagnostics.get'); await call('settings.get');
  const lightweightModules = [...loaded];
  const report = await call('usage.report'), usageModules = [...loaded];
  await call('review.catalog');
  console.log(JSON.stringify({ openMs, pageMs, pageBytes: Buffer.byteLength(page), shellModules, shellScans, lightweightModules, usageModules, reviewModules: [...loaded], reportRequests: report.totals.requests }));
} finally { await extension.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
