import test from 'node:test';
import assert from 'node:assert/strict';
import { access, rm, realpath, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReviewService, hostRuntime, runtimeEnvironment, supportedSdk } from '../src/node/ai-review.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';
import { finalizeInsightReview } from '../src/node/review-insights.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

// Doubles for the desktop SDK generations, reduced to what the helper touches. Desktop 1.0.115 renamed
// the stdio factory, and its client rejects env and workingDirectory anywhere but on the connection.
const sdkContracts = {
  modern: {
    RuntimeConnection: { forSpawnedStdio: ({ path, args, env, workingDirectory, baseDirectory } = {}) => ({ kind: 'spawned-stdio', path, args, env, workingDirectory, baseDirectory }) },
    home(options) {
      if ('env' in options || 'workingDirectory' in options) throw new Error('PRIVATE-client-options');
      return options.runtime.baseDirectory;
    },
  },
  legacy: { RuntimeConnection: { forStdio: ({ path, args, env } = {}) => ({ kind: 'stdio', path, args, env }) }, home: options => options.baseDirectory },
  unknown: { RuntimeConnection: { forTcp: () => ({ kind: 'tcp' }) }, home: () => undefined },
};

function fixture(t, overrides = {}) {
  const state = { sdk: 'modern', login: 'person', tools: [], selected: 'model-a', provider: 'copilot', policy: 'enabled', sent: [], stopped: 0, prepared: 0, flushed: 0, ...overrides };
  const contract = sdkContracts[state.sdk];
  const models = () => ({ list: [{ id: 'model-a', name: 'Model A', provider: { kind: state.provider }, policy: { state: state.policy }, capabilities: { supports: { reasoningEffort: !!state.efforts } }, supportedReasoningEfforts: state.efforts }, ...(state.extraModels || [])] });
  const parent = { rpc: { model: { list: async () => models() }, gitHubAuth: { getStatus: async () => ({ isAuthenticated: true, login: 'person', host: 'github.com' }) } } };
  const sdk = {
    RuntimeConnection: contract.RuntimeConnection,
    CopilotClient: class {
      constructor(options) { state.home = contract.home(options); state.options = options; }
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
          return { data: { content: state.outputs?.shift() ?? state.output ?? 'Review response' } };
        } };
      }
    },
  };
  const diagnostics = createDiagnostics();
  const service = createReviewService(parent, { diagnostics, timeoutMs: state.timeoutMs, storageTimeoutMs: state.storageTimeoutMs,
    readSamples: state.readSamples,
    runtime: async () => ({ sdk, path: '/verified/copilot' }), recorder: async () => {
      state.preparing = true;
      if (state.prepareHold) await new Promise(resolve => { state.releaseStorage = resolve; });
      if (state.prepareFailure) throw new Error('PRIVATE-disk'); state.prepared++;
      return { record() { state.recorded = true; }, summary() { return { requests: state.sent.length, credits: 0, creditStatus: 'complete', tokens: 120, tokenStatus: 'complete' }; }, async flush() {
        state.flushed++;
        if (state.flushHold) await new Promise(resolve => { state.releaseStorage = resolve; });
        if (state.flushFailure) throw new Error('PRIVATE-flush');
      } };
    },
  });
  t.after(async () => {
    await service.close();
    if (state.home) {
      const folder = dirname(state.home);
      assert.equal(await realpath(dirname(folder)), await realpath(tmpdir()));
      await rm(folder, { recursive: true, force: true });
    }
  });
  return { state, service, diagnostics, parent };
}
const input = { model: 'model-a', prompt: 'Synthetic statistics only' };

test('catalog recommends exact eligible Sonnet 5.5, with no automatic model substitute', async t => {
  const f = fixture(t, { extraModels: [
    { id: 'claude-opus-5.5', name: 'Opus', provider: { kind: 'copilot' } },
    { id: 'private-model', name: 'Claude Sonnet 5.5', provider: { kind: 'copilot' } },
    { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', provider: { kind: 'copilot' }, policy: { state: 'enabled' } },
  ] });
  assert.equal((await f.service.catalog()).recommendedModel, 'claude-sonnet-5.5');
  f.state.extraModels[2].policy.state = 'disabled';
  assert.equal((await f.service.catalog()).recommendedModel, '');
  assert.equal(f.state.sent.length, 0);
});

test('frozen references are sent unchanged and refreshed or changed metadata requires re-preparation', async t => {
  const publicRow = { id: 'gpt-5.3-codex', provider: { kind: 'copilot' }, capabilities: { supports: { vision: true } } };
  for (const change of ['none', 'capability', 'policy', 'refresh', 'account']) {
    await t.test(change, async t => {
      const f = fixture(t, { extraModels: [structuredClone(publicRow)], outputs: [JSON.stringify({ cards: [], emptyReason: 'Limited evidence', followUp: null })] });
      const catalog = await f.service.catalog();
      const records = reviewFixture(); records.user('p'); records.call('p', 'a');
      const snapshot = await prepareInsightReview(records.scan(), { range: 'all' }, reviewNow, null, { catalog: catalog.reference });
      snapshot.catalogToken = catalog.token;
      await finalizeInsightReview(snapshot, false);
      if (change === 'capability') f.state.extraModels[0].capabilities.supports.vision = false;
      if (change === 'policy') f.state.extraModels[0].policy = { state: 'disabled' };
      if (change === 'refresh') await f.service.catalog();
      if (change === 'account') { f.state.login = 'other'; f.parent.rpc.gitHubAuth.getStatus = async () => ({ isAuthenticated: true, login: 'other', host: 'github.com' }); }
      const review = f.service.review({ model: 'model-a', analysis: snapshot, allowSamples: false });
      if (change === 'none') {
        await review; assert.equal(f.state.sent[0].prompt, snapshot.preview);
        assert.match(f.state.config.systemMessage.content, /modelReference/);
      } else { await assert.rejects(review, { code: 'REVIEW_SNAPSHOT' }); assert.equal(f.state.sent.length, 0); }
    });
  }
});

test('reasoning capabilities are preserved and unsupported effort fails before inference', async t => {
  const f = fixture(t, { efforts: ['low', 'medium', 'high'] });
  assert.deepEqual((await f.service.catalog()).models[0].reasoningEfforts, ['medium', 'high']);
  await f.service.review({ ...input, reasoningEffort: 'high' });
  assert.equal(f.state.config.reasoningEffort, 'high');
  const unsupported = fixture(t);
  await assert.rejects(unsupported.service.review({ ...input, reasoningEffort: 'medium' }), { code: 'REVIEW_EFFORT' });
  assert.equal(unsupported.state.sent.length, 0);
});

test('structured analysis uses the isolated helper and returns reconciled usage without a plain-text retry', async t => {
  const { prepareInsightReview } = await import('../src/node/review-evidence.mjs');
  const { reviewFixture, reviewNow } = await import('./fixtures/review.mjs');
  const data = reviewFixture(); data.user('p'); data.call('p', 'a');
  const analysis = await prepareInsightReview(data.scan(), { range: 'all' }, reviewNow);
  const f = fixture(t, { efforts: ['medium'], output: JSON.stringify({ cards: [], emptyReason: 'Only one recorded prompt.', followUp: null }) });
  const result = await f.service.review({ model: 'model-a', reasoningEffort: 'medium', analysis, allowSamples: false });
  assert.equal(result.cards.length, 0); assert.equal(result.usage.credits, 0); assert.equal(result.usage.creditStatus, 'complete');
  assert.equal(f.state.sent.length, 1); assert.equal(f.state.sent[0].responseSchema.type, 'object');
  assert.equal(f.state.config.enableSkills, false); assert.deepEqual(f.state.config.availableTools, []);
  assert.equal(f.state.flushed, 1); assert.equal(f.state.stopped, 1);
  const bad = fixture(t, { output: 'bad JSON' });
  await assert.rejects(bad.service.review({ model: 'model-a', analysis }), { code: 'REVIEW_RESPONSE' });
  assert.equal(bad.state.sent.length, 1, 'one failed call, no repair retry');
});

test('optional enrichment stays in one helper and records both structured submissions', async t => {
  const { prepareInsightReview } = await import('../src/node/review-evidence.mjs');
  const { reviewFixture, reviewNow } = await import('./fixtures/review.mjs');
  const source = await mkdtemp(join(tmpdir(), 'sdk-review-samples-'));
  t.after(() => rm(source, { recursive: true, force: true }));
  const data = reviewFixture({ source }); data.user('p'); data.call('p', 'a');
  const log = join(source, 'session-state', 'session-a', 'events.jsonl'); await mkdir(dirname(log), { recursive: true });
  await writeFile(log, data.events.map(e => JSON.stringify(e)).join('\n'));
  const analysis = await prepareInsightReview(data.scan(), { range: 'all' }, reviewNow);
  const first = { cards: [], emptyReason: 'One prompt is a limited sample.', followUp: { category: 'prompts-sessions', hypothesis: 'The prompt may state an acceptance check.', why: 'See whether a visible check already exists.', candidates: ['prompt-1'] } };
  const f = fixture(t, { outputs: [JSON.stringify(first), JSON.stringify({ ...first, followUp: null })] });
  const result = await f.service.review({ model: 'model-a', analysis, allowSamples: true });
  assert.equal(result.passes, 2); assert.equal(result.enrichment, 'complete'); assert.equal(result.samples, 1);
  assert.equal(f.state.prepared, 1); assert.equal(f.state.sent.length, 2); assert.equal(f.state.stopped, 1);
  assert.equal(result.usage.requests, 2); assert.ok(f.state.sent.every(p => p.responseSchema));
  assert.doesNotMatch(JSON.stringify(f.diagnostics.snapshot()), /PRIVATE|session-a/);
});

test('cancelling or timing out a stalled sample read returns baseline and cleans up the helper', async t => {
  const { prepareInsightReview } = await import('../src/node/review-evidence.mjs');
  const { reviewFixture, reviewNow } = await import('./fixtures/review.mjs');
  const data = reviewFixture(); data.user('p'); data.call('p', 'a');
  const analysis = await prepareInsightReview(data.scan(), { range: 'all' }, reviewNow);
  const first = { cards: [], emptyReason: 'One prompt is a limited sample.', followUp: { category: 'prompts-sessions', hypothesis: 'A check may already be present.', why: 'Test the hypothesis.', candidates: ['prompt-1'] } };
  for (const timeout of [false, true]) {
    let reading = false;
    const f = fixture(t, { timeoutMs: timeout ? 250 : 2000, output: JSON.stringify(first), readSamples: () => { reading = true; return new Promise(() => {}); } });
    const work = f.service.review({ model: 'model-a', analysis, allowSamples: true });
    await waitFor(() => reading);
    if (!timeout) f.service.cancel();
    const result = await work;
    assert.equal(result.enrichment, timeout ? 'timed-out' : 'cancelled');
    assert.equal(result.emptyReason, first.emptyReason); assert.equal(result.usage.credits, 0);
    assert.equal(f.state.sent.length, 1); assert.equal(f.state.flushed, 1); assert.equal(f.state.stopped, 1);
    await assert.rejects(access(f.state.home));
  }
});
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
test('the SDK check accepts both desktop generations and rejects a build without a client or a stdio factory', () => {
  const CopilotClient = class {};
  assert.equal(supportedSdk({ CopilotClient, RuntimeConnection: { forSpawnedStdio() {} } }), true);
  assert.equal(supportedSdk({ CopilotClient, RuntimeConnection: { forStdio() {} } }), true);
  assert.equal(supportedSdk({ CopilotClient, RuntimeConnection: { forTcp() {}, forInProcess() {} } }), false);
  assert.equal(supportedSdk({ CopilotClient }), false);
  assert.equal(supportedSdk({ RuntimeConnection: { forSpawnedStdio() {} } }), false);
});
test('desktop 1.0.115 SDK: the spawned stdio connection carries the helper executable, sanitized environment and isolated directories', async t => {
  process.env.USAGE_INSIGHTS_TEST_MARKER = 'PRIVATE-env'; t.after(() => { delete process.env.USAGE_INSIGHTS_TEST_MARKER; });
  const { state, service } = fixture(t);
  assert.deepEqual(await service.review(input), { text: 'Review response', model: 'model-a' });
  const { runtime } = state.options;
  assert.equal(runtime.kind, 'spawned-stdio'); assert.equal(runtime.path, '/verified/copilot'); assert.deepEqual(runtime.args, ['--no-auto-update']);
  assert.ok(runtime.env && !('USAGE_INSIGHTS_TEST_MARKER' in runtime.env));
  assert.equal(basename(runtime.workingDirectory), 'workspace'); assert.equal(basename(runtime.baseDirectory), 'home');
  assert.equal(dirname(runtime.workingDirectory), dirname(runtime.baseDirectory));
  assert.equal(state.options.mode, 'empty');
  assert.equal(state.options.github.useLoggedInUser, true); assert.deepEqual(state.options.plugins.builtinDirectories, []);
});
test('desktop 1.0.106 SDK: the earlier stdio factory and client-level process options still start the helper', async t => {
  process.env.USAGE_INSIGHTS_TEST_MARKER = 'PRIVATE-env'; t.after(() => { delete process.env.USAGE_INSIGHTS_TEST_MARKER; });
  const { state, service } = fixture(t, { sdk: 'legacy' });
  assert.deepEqual(await service.review(input), { text: 'Review response', model: 'model-a' });
  const { connection } = state.options;
  assert.equal(connection.kind, 'stdio'); assert.equal(connection.path, '/verified/copilot'); assert.deepEqual(connection.args, ['--no-auto-update']);
  assert.ok(state.options.env && !('USAGE_INSIGHTS_TEST_MARKER' in state.options.env));
  assert.equal(basename(state.options.workingDirectory), 'workspace'); assert.equal(basename(state.options.baseDirectory), 'home');
  assert.equal(dirname(state.options.workingDirectory), dirname(state.options.baseDirectory));
  assert.equal(state.options.mode, 'empty');
  assert.equal(state.options.useLoggedInUser, true); assert.deepEqual(state.options.builtinPluginDirectories, []);
});
test('an SDK with no known stdio factory is reported as incompatible before any helper is created', async t => {
  const { state, service } = fixture(t, { sdk: 'unknown' });
  await assert.rejects(service.review(input), { code: 'REVIEW_SDK' });
  assert.equal(state.options, undefined); assert.equal(state.sent.length, 0); assert.equal(state.prepared, 0);
});
test('catalog filters attribution/policy; reconnect checks a new helper without inference or saved prompts', async t => {
  const { state, service } = fixture(t);
  assert.equal((await service.catalog()).models.length, 1);
  assert.equal(state.options, undefined);
  assert.equal((await service.reconnect('model-a')).verified, true);
  assert.equal(state.sent.length, 0); assert.equal(state.prepared, 0); assert.equal(state.stopped, 1);
  await assert.rejects(access(state.home));
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
  await assert.rejects(access(state.home));
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
  await assert.rejects(access(state.home));
});
test('shutdown waits for owned work and timeout cannot return a partial success', async t => {
  const { state, service } = fixture(t, { hold: true, timeoutMs: 60 });
  await assert.rejects(service.review(input), { code: 'REVIEW_TIMEOUT' }); assert.equal(state.stopped, 1);
  state.timeoutMs = 1000;
  const other = fixture(t, { hold: true });
  const rejected = assert.rejects(other.service.review(input), { code: 'REVIEW_CANCELLED' });
  await waitFor(() => other.state.sent.length); await other.service.close(); await rejected;
  assert.ok(other.state.flushed); await assert.rejects(access(other.state.home));
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
  await access(dirname(state.home));
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
  await service.close(); await access(dirname(state.home)); state.releaseStorage();
});
