import { startServer } from '../src/node/canvas-server.mjs';
import { demoData, demoContext } from './demo-data.mjs';

export function defaultDemoSettings() {
  return {
    extraHomes: [],
    disabledHomes: [],
    extraVSCodeHomes: [],
    includeWsl: true,
    readWslDatabases: true,
    includeVSCode: true,
    simplifyNumbers: true,
    textSize: 'small',
    paused: false,
    reviewAllowSamples: true,
    reviewModel: 'claude-sonnet-5.5',
    reviewReasoning: 'high',
  };
}

export function applyDemoSettings(current, input = {}) {
  const next = { ...current };
  if (input.textSize !== undefined) {
    if (!['small', 'medium', 'large'].includes(input.textSize)) throw new TypeError('Invalid text size');
    next.textSize = input.textSize;
  }
  for (const key of ['includeWsl', 'readWslDatabases', 'includeVSCode', 'simplifyNumbers', 'paused', 'reviewAllowSamples']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new TypeError(`Invalid ${key}`);
      next[key] = input[key];
    }
  }
  for (const key of ['extraHomes', 'disabledHomes', 'extraVSCodeHomes']) {
    if (input[key] !== undefined) {
      if (!Array.isArray(input[key]) || input[key].some(v => typeof v !== 'string')) throw new TypeError(`Invalid ${key}`);
      next[key] = [...input[key]];
    }
  }
  for (const key of ['reviewModel', 'reviewReasoning']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new TypeError(`Invalid ${key}`);
      next[key] = input[key];
    }
  }
  return next;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/').replace(/^([^/])/, '/$1')}`).href) {
  const demo = process.argv.includes('--demo');
  let config = defaultDemoSettings();
  // One scan for the whole preview: the server keeps reports for as long as the same lists are current.
  const data = demo ? demoData() : null;
  const server = await startServer(demo ? {
    defaultHome: 'Synthetic demo',
    settings: { get: async () => config, set: async input => (config = applyDemoSettings(config, input)) },
    scanner: { scan: async () => data },
    readContext: async () => demoContext(),
  } : {});
  console.log(`${demo ? 'Demo' : 'Local Copilot usage'} preview: ${server.url}`);
  console.log('Open in your browser. Press Ctrl+C to stop.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
}
