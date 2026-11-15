import { createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { registerCanvas } from './node/canvas.mjs';
import { readFileSync } from 'node:fs';
import { diagnosticError } from './core/diagnostics.mjs';
import { createRuntimeDiagnostics } from './node/runtime-diagnostics.mjs';

const diagnostics = createRuntimeDiagnostics();
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
diagnostics.record('info', 'extension.started', { pluginVersion: version, nodeVersion: process.version, platform: process.platform, arch: process.arch });
process.once('exit', exitCode => diagnostics.record('info', 'extension.exit', { exitCode }));
// Observe crashes without suppressing Node's normal termination behavior.
process.on('uncaughtExceptionMonitor', error => diagnostics.record('error', 'extension.crash', diagnosticError(error)));
const extension = await registerCanvas({ createCanvas, joinSession, diagnostics });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  diagnostics.record('info', 'extension.signal', { signal });
  await extension.dispose();
  process.exit(0);
});
