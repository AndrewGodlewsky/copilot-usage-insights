import test from 'node:test';
import assert from 'node:assert/strict';
import { access, rm, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReviewService, hostRuntime, runtimeEnvironment } from '../src/node/ai-review.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';

function fixture(t, overrides = {}) {
  const state = { login: 'person', tools: [], selected: 'model-a', provider: 'copilot', policy: 'enabled', sent: [], stopped: 0, prepared: 0, flushed: 0, ...overrides };
  const models = () => ({ list: [{ id: 'model-a', name: 'Model A', provider: { kind: state.provider }, policy: { state: state.policy } }] });
  const parent = { rpc: { model: { list: async () => models() }, gitHubAuth: { getStatus: async () => ({ isAuthenticated: true, login: 'person', host: 'github.com' }) } } };
  const sdk = {
    RuntimeConnection: { forStdio: options => options },
    CopilotClient: class {
      constructor(options) { state.options = options; }
      async start() { if (state.startFailure) throw new Error('PRIVATE-start'); }
      async forceStop() { state.stopped++; state.release?.(); if (state.stopFailure) throw new Error('PRIVATE-stop'); }
      async createSession(config) {
        state.config = config;
        return { sessionId: state.badId ? 'other' : config.sessionId, rpc: {
          model: { list: async () => models(), getCurrent: async () => ({ modelId: state.selected }) },
          gitHubAuth: { getStatus: async () => ({ isAuthenticated: true, login: state.login, host: 'github.com' }) },
          metadata: { snapshot: async () => ({ workingDirectory: config.workingDirectory, isRemote: !!state.remote }) },
          tools: { initializeAndValidate: async () => {}, getCurrentMetadata: async () => ({ tools: state.tools }) },
        }, sendAndWait: async input => {
          assert.equal(state.prepared, 1); state.sent.push(input);
          config.onEvent({ type: 'assistant.usage' });
          if (state.hold) await new Promise(resolve => { state.release = resolve; });
          if (state.generateFailure) throw new Error('PRIVATE-prompt-token');
          return { data: { content: state.output ?? 'Review response' } };
        } };
      }
    },
  };
  const diagnostics = createDiagnostics();
  const service = createReviewService(parent, { diagnostics, timeoutMs: state.timeoutMs, storageTimeoutMs: state.storageTimeoutMs,
    runtime: async () => ({ sdk, path: '/verified/copilot' }), recorder: async () => {
      state.preparing = true;
      if (state.prepareHold) await new Promise(resolve => { state.releaseStorage = resolve; });
      if (state.prepareFailure) throw new Error('PRIVATE-disk'); state.prepared++;
      return { record() { state.recorded = true; }, async flush() {
        state.flushed++;
        if (state.flushHold) await new Promise(resolve => { state.releaseStorage = resolve; });
        if (state.flushFailure) throw new Error('PRIVATE-flush');
      } };
    },
  });
  t.after(async () => {
    await service.close();
    if (state.options) {
      const folder = dirname(state.options.baseDirectory);
      assert.equal(await realpath(dirname(folder)), await realpath(tmpdir()));
      await rm(folder, { recursive: true, force: true });
    }
  });
  return { state, service, diagnostics, parent };
}
const input = { model: 'model-a', prompt: 'Synthetic statistics only' };
async function waitFor(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(predicate());
}
test('host accepts only tested desktop bootstrap forms and sanitizes inherited environment', () => {
  const exe = join(tmpdir(), 'copilot.exe'), env = { COPILOT_SDK_PATH: '/sdk', COPILOT_EXTENSION_PARENT_PID: '42' };
  for (const entry of ['extension_bootstrap.mjs', join(tmpdir(), 'extension_bootstrap.mjs')]) assert.equal(hostRuntime(exe, [entry], 42, env), exe);
  for (const args of [[exe, ['relative/extension_bootstrap.mjs'], 42, env], [exe, ['extension_bootstrap.mjs'], 43, env], [join(tmpdir(), 'node.exe'), ['extension_bootstrap.mjs'], 42, env]]) assert.throws(() => hostRuntime(...args), { code: 'REVIEW_RUNTIME' });
  assert.deepEqual(runtimeEnvironment({ PATH: 'path', GH_TOKEN: 'secret', NODE_OPTIONS: '--inject', COPILOT_CLI_PATH: 'other', COPILOT_SDK_PATH: 'sdk', OPENAI_API_KEY: 'secret' }), { PATH: 'path', GH_TOKEN: 'secret' });
});
test('catalog filters attribution/policy; reconnect checks a new helper without inference or saved prompts', async t => {
  const { state, service } = fixture(t);
  assert.equal((await service.catalog()).models.length, 1);
  assert.equal(state.options, undefined);
  assert.equal((await service.reconnect('model-a')).verified, true);
  assert.equal(state.sent.length, 0); assert.equal(state.prepared, 0); assert.equal(state.stopped, 1);
  await assert.rejects(access(state.options.baseDirectory));
  state.provider = 'custom'; await assert.rejects(service.catalog(), { code: 'REVIEW_CATALOG' });
});
test('review uses only selected Copilot model and explicit snapshot; accounts before send, retention before cleanup', async t => {
  const { state, service } = fixture(t);
  assert.deepEqual(await service.review(input), { text: 'Review response', model: 'model-a' });
  assert.deepEqual(state.sent, [{ prompt: input.prompt }]);
  assert.equal(state.config.model, 'model-a'); assert.equal(state.options.mode, 'empty');
  assert.deepEqual(state.config.availableTools, []); assert.deepEqual(state.config.mcpServers, {});
  for (const key of ['requestExtensions', 'enableConfigDiscovery', 'enableSkills', 'enableFileHooks', 'enableSessionStore', 'enableSessionTelemetry', 'interactiveUser']) assert.equal(state.config[key], false);
  assert.equal(state.config.enableManagedSettings, true); assert.equal(state.config.enforceManagedModelDefaults, true);
  assert.equal(state.config.onPermissionRequest().kind, 'denied-by-rules');
  assert.equal(state.recorded, true); assert.ok(state.flushed); assert.equal(state.stopped, 1);
  await assert.rejects(access(state.options.baseDirectory));
});
for (const [changes, code] of [
  [{ login: 'other' }, 'ACCOUNT'], [{ provider: 'custom' }, 'MODEL'], [{ policy: 'disabled' }, 'MODEL'],
  [{ tools: ['read'] }, 'ISOLATION'], [{ tools: null }, 'ISOLATION'], [{ selected: 'other-model' }, 'ISOLATION'],
  [{ remote: true }, 'ISOLATION'], [{ badId: true }, 'ISOLATION'], [{ prepareFailure: true }, 'USAGE'],
]) test(`rejects ${JSON.stringify(changes)} before sending`, async t => {
  const { state, service } = fixture(t, changes);
  await assert.rejects(service.review(input), { code: `REVIEW_${code}` });
  assert.equal(state.sent.length, 0); assert.equal(state.stopped, 1);
});
test('rechecks identity immediately before generation', async t => {
  const { state, service, parent } = fixture(t);
  let calls = 0;
  parent.rpc.gitHubAuth.getStatus = async () => ({ isAuthenticated: true, login: ++calls === 1 ? 'person' : 'changed', host: 'github.com' });
  await assert.rejects(service.review(input), { code: 'REVIEW_ACCOUNT' }); assert.equal(state.sent.length, 0);
});
test('cancel rejects promptly, stops only its helper, flushes and removes owned temporary data', async t => {
  const { state, service } = fixture(t, { hold: true });
  const run = service.review(input); const rejected = assert.rejects(run, { code: 'REVIEW_CANCELLED' });
  await waitFor(() => state.sent.length);
  await assert.rejects(service.review(input), { code: 'REVIEW_BUSY' });
  service.cancel(); await rejected; assert.equal(state.stopped, 1); assert.ok(state.flushed);
  await assert.rejects(access(state.options.baseDirectory));
});
test('shutdown waits for owned work and timeout cannot return a partial success', async t => {
  const { state, service } = fixture(t, { hold: true, timeoutMs: 60 });
  await assert.rejects(service.review(input), { code: 'REVIEW_TIMEOUT' }); assert.equal(state.stopped, 1);
  state.timeoutMs = 1000;
  const other = fixture(t, { hold: true });
  const rejected = assert.rejects(other.service.review(input), { code: 'REVIEW_CANCELLED' });
  await waitFor(() => other.state.sent.length); await other.service.close(); await rejected;
  assert.ok(other.state.flushed); await assert.rejects(access(other.state.options.baseDirectory));
});
test('generation errors are sanitized and any recorded usage is flushed', async t => {
  const { state, service, diagnostics } = fixture(t, { generateFailure: true });
  await assert.rejects(service.review(input), error => error.code === 'REVIEW_FAILED' && !error.message.includes('PRIVATE'));
  assert.ok(state.flushed); assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /PRIVATE|person|Synthetic/);
  assert.ok(diagnostics.snapshot().entries.some(e => e.stage === 'generate' && e.errorCode === 'REVIEW_FAILED'));
});
for (const [changes, code] of [[{ flushFailure: true }, 'USAGE'], [{ stopFailure: true }, 'CLEANUP']]) test(`preserves recovery files on ${code.toLowerCase()} failure`, async t => {
  const { state, service } = fixture(t, changes);
  await assert.rejects(service.review(input), { code: `REVIEW_${code}` });
  await access(dirname(state.options.baseDirectory));
});
test('missing and oversized answers fail without retry or exposing response text', async t => {
  for (const output of [' ', 'x'.repeat(65537)]) {
    const { state, service } = fixture(t, { output });
    await assert.rejects(service.review(input), { code: 'REVIEW_RESPONSE' }); assert.equal(state.sent.length, 1);
  }
});
test('cancellation during accounting preparation never starts inference or blocks close', async t => {
  const { state, service } = fixture(t, { prepareHold: true });
  const rejected = assert.rejects(service.review(input), { code: 'REVIEW_CANCELLED' });
  await waitFor(() => state.preparing); await service.close(); await rejected;
  assert.equal(state.sent.length, 0); state.releaseStorage();
});
test('stalled final accounting has a bounded wait and preserves recovery files', async t => {
  const { state, service } = fixture(t, { flushHold: true, storageTimeoutMs: 30 });
  await assert.rejects(service.review(input), { code: 'REVIEW_USAGE' });
  await service.close(); await access(dirname(state.options.baseDirectory)); state.releaseStorage();
});
