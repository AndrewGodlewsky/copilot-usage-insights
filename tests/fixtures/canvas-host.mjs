import { startCanvasServer } from '../../src/node/canvas-endpoint.mjs';

const server = await startCanvasServer({ endpointDirectory: process.argv[2], session: { sessionId: 'fixture-session' }, instanceId: 'fixture-canvas',
  html: '<title>Fixture</title>', settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
  scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) } });
process.send(server.url);
