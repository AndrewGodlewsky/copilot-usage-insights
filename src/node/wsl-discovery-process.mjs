import { createDirectWslDiscovery } from './wsl-sources.mjs';
import { createDiagnostics } from '../core/diagnostics.mjs';

try {
  const { disabled, timeoutMs } = JSON.parse(process.env.WSL_DISCOVERY_INPUT);
  const diagnostics = createDiagnostics();
  const result = await createDirectWslDiscovery({ diagnostics, timeoutMs })({ disabled });
  const counts = diagnostics.snapshot().entries.at(-1);
  // Explicit exit also terminates filesystem probes that outlived their deadline.
  process.stdout.write(JSON.stringify({ result, counts }), () => process.exit(0));
} catch { process.exit(1); }
