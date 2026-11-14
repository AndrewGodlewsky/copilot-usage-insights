import { startServer } from '../src/node/canvas-server.mjs';
import { demoData } from './demo-data.mjs';
const demo = process.argv.includes('--demo');
let config = { extraHomes: [], disabledHomes: [] };
const server = await startServer(demo ? {
  defaultHome: 'Synthetic demo',
  settings: { get: async () => config, set: async input => (config = { ...config, ...input }) },
  scanner: { scan: async () => demoData() },
} : {});
console.log(`${demo ? 'Demo' : 'Local Copilot usage'} preview: ${server.url}`);
console.log('Open in your browser. Press Ctrl+C to stop.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
