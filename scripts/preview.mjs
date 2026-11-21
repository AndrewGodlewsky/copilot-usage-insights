import { startServer } from '../src/node/canvas-server.mjs';
import { demoData, demoContext } from './demo-data.mjs';
const demo = process.argv.includes('--demo');
let config = { extraHomes: [], disabledHomes: [] };
// One scan for the whole preview: the server keeps reports for as long as the same lists are current.
const data = demo ? demoData() : null;
const server = await startServer(demo ? {
  defaultHome: 'Synthetic demo',
  settings: { get: async () => config, set: async input => (config = { ...config, ...input }) },
  scanner: { scan: async () => data },
  readContext: async () => demoContext(),
} : {});
console.log(`${demo ? 'Demo' : 'Local Copilot usage'} preview: ${server.url}`);
console.log('Open in your browser. Press Ctrl+C to stop.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
