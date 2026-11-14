import test from 'node:test';
import assert from 'node:assert/strict';
import { createContextReader } from '../src/node/context.mjs';

const snapshot = { totalTokens: 1000, limit: 10000, modelId: '<model>', modelSource: 'autoResolved', categories: { systemPrompt: 100, customInstructions: 100, systemTools: 100, mcpTools: 200, messages: 500, freeSpace: 9000, buffer: 0 },
  entries: [{ kind: 'plugin', id: 'parent', label: 'Example', tokens: 200, attributes: { private: 'SECRET' } },
    { kind: 'skill', id: 'child', parentId: 'parent', label: 'Skill', tokens: 100 }], secret: 'SECRET' };
const session = fn => ({ rpc: { metadata: { getContextAttribution: fn } } });

test('context snapshot is on demand, bounded and allowlisted without summing nested entries', async () => {
  let calls = 0;
  const read = createContextReader(() => session(async () => { calls++; return { contextAttribution: snapshot }; }));
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.totalTokens, 1000);
  assert.equal(a.modelId, '<model>');
  assert.equal(a.modelSource, 'autoResolved');
  assert.equal(a.entries[1].parentId, 'parent');
  assert.doesNotMatch(JSON.stringify(a), /SECRET|attributes|freeSpace/);
  await read(); assert.equal(calls, 2, 'a new explicit inspection refreshes the snapshot');
  const many = await createContextReader(() => session(async () => ({ contextAttribution: { ...snapshot,
    entries: Array.from({ length: 400 }, (_, i) => ({ id: String(i), kind: 'skill', label: 'x'.repeat(500), tokens: i })) } })))();
  assert.equal(many.entries.length, 100);
  assert.equal(many.omitted, 300);
  assert.equal(many.entries[0].tokens, 399);
  assert.ok(many.entries[0].label.length <= 160);
});

test('unsupported, empty, invalid, rejected and timed out context calls degrade without raw errors', async () => {
  assert.equal((await createContextReader(() => undefined)()).reason, 'unsupported');
  assert.equal((await createContextReader(() => session(async () => ({ contextAttribution: null })))()).reason, 'empty');
  assert.equal((await createContextReader(() => session(async () => ({ contextAttribution: { totalTokens: -1 } })))()).reason, 'invalid');
  const failed = await createContextReader(() => session(async () => { throw new Error('PRIVATE'); }))();
  assert.equal(failed.reason, 'unavailable'); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE/);
  let calls = 0;
  const stalled = createContextReader(() => session(() => { calls++; return new Promise(() => {}); }), { timeoutMs: 5 });
  assert.equal((await stalled()).reason, 'timeout');
  assert.equal((await stalled()).reason, 'timeout');
  assert.equal(calls, 1, 'a timed out RPC remains single-flight until it settles');
});
