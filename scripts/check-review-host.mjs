// Read-only host/SDK compatibility fixture: synthetic account/catalog, no model inference.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

const sdkDirectory = process.env.COPILOT_SDK_DIR, runtime = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && runtime, 'Set the installed desktop SDK and runtime paths.');
const temporary = await mkdtemp(join(tmpdir(), 'review-host-fixture-')), entry = join(temporary, 'probe.mjs');
try {
  await writeFile(join(temporary, 'extension_bootstrap.mjs'), 'process.exit(42)');
  await writeFile(entry, `
    import { createReviewService } from ${JSON.stringify(new URL('../src/node/ai-review.mjs', import.meta.url).href)};
    const parent = { rpc: {
      model: { list: async () => ({ list: [{ id: 'fixture', provider: { kind: 'copilot' } }] }) },
      gitHubAuth: { getStatus: async () => ({ isAuthenticated: true, login: 'fixture', host: 'github.com' }) },
    } };
    const service = createReviewService(parent);
    try {
      for (let i = 0; i < 2; i++) if ((await service.catalog()).models[0]?.id !== 'fixture') throw new Error('Invalid fixture catalog');
      console.log('HOST_FIXTURE_PASSED');
    } catch { console.log('HOST_FIXTURE_FAILED'); process.exitCode = 1; }
    finally { await service.close(); process.exit(process.exitCode || 0); }
  `);
  for (const bootstrap of [join(sdkDirectory, 'preloads', 'extension_bootstrap.mjs'), 'extension_bootstrap.mjs']) {
    const { stdout } = await promisify(execFile)(runtime, [bootstrap], {
      cwd: temporary, windowsHide: true, timeout: 15_000,
      env: { ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined,
        COPILOT_SDK_PATH: sdkDirectory, COPILOT_EXTENSION_PARENT_PID: String(process.pid), COPILOT_EXTENSION_SANDBOXED: '0', EXTENSION_PATH: entry },
    }).catch(() => { throw new Error('Host fixture failed; raw output withheld.'); });
    assert.match(stdout, /HOST_FIXTURE_PASSED/);
  }
  console.log('Desktop host: embedded and absolute bootstrap resolve the SDK and refresh synthetic models. No account lookup or inference.');
} finally {
  assert.equal(await realpath(dirname(temporary)), await realpath(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
}
