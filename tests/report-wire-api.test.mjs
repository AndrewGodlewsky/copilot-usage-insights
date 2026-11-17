import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/node/canvas-server.mjs';
import { normalizeUsage } from '../src/core/copilot.mjs';
import { decodeReportWire } from '../src/core/report-wire.mjs';

async function fixture(t) {
  const now = new Date('2026-11-17T12:00:00Z');
  const records = Array.from({ length: 200 }, (_, i) => normalizeUsage({ provider: { kind: 'copilot' }, model: `model-${i % 3}`,
    inputTokens: i, outputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 1,
    copilotUsage: { totalNanoAiu: 1000000 },
  }, { key: String(i), timestamp: now.toISOString(), sessionId: `session-${i}`, project: `project-${i % 4}`, source: 'fixture' }).record);
  const scan = { records, sources: [], coverage: {} };
  const server = await startServer({ html: '<title>Fixture</title>', defaultHome: '/synthetic', now: () => now,
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) }, scanner: { scan: async () => scan } });
  t.after(() => server.close());
  return async message => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), bytes: Buffer.byteLength(text) };
  };
}

test('compact reports are opt-in and preserve every decoded field, filter, and revision hint', async t => {
  const call = await fixture(t), message = { method: 'usage.report', input: { range: 'all' } };
  const plain = await call(message);
  assert.equal(plain.status, 200);
  assert.ok(Array.isArray(plain.body.sessions));
  assert.equal(plain.body.reportWireVersion, undefined);
  const compact = await call({ ...message, compact: true, known: plain.body.revision });
  assert.equal(compact.status, 200);
  assert.equal(compact.body.unchanged, undefined, 'a legacy revision cannot suppress compact content');
  assert.equal(compact.body.reportWireVersion, 1);
  assert.ok(compact.bytes < plain.bytes * .75);
  const { revision: compactRevision, ...decoded } = decodeReportWire(compact.body);
  const { revision: plainRevision, ...expected } = plain.body;
  assert.notEqual(compactRevision, plainRevision);
  assert.deepEqual(decoded, expected);
  const quiet = await call({ ...message, compact: true, known: compactRevision });
  assert.equal(quiet.body.unchanged, true);
  assert.equal(quiet.body.revision, compactRevision);
  assert.ok(quiet.bytes < 400);
  const legacy = await call({ ...message, known: compactRevision });
  assert.ok(Array.isArray(legacy.body.sessions));
  assert.equal(legacy.body.revision, plainRevision);
  assert.equal((await call({ ...message, compact: false, known: plainRevision })).body.unchanged, true);
  const filtered = await call({ ...message, input: { range: 'all', project: 'project-1' }, compact: true, known: compactRevision });
  const report = decodeReportWire(filtered.body);
  assert.equal(report.unchanged, undefined);
  assert.equal(report.totals.requests, 50);
  assert.equal(report.sessions.length, 50);
  assert.ok(report.sessions.every(row => row.project === 'project-1'));
  const refreshed = await call({ ...message, method: 'usage.refresh', compact: true, known: compactRevision });
  assert.equal(refreshed.body.unchanged, true);
});

test('compact is a boolean option only for usage report endpoints', async t => {
  const call = await fixture(t);
  for (const compact of ['true', 1, null, {}]) assert.equal((await call({ method: 'usage.report', input: {}, compact })).status, 400);
  for (const method of ['settings.get', 'usage.requests', 'review.catalog', 'diagnostics.get']) {
    assert.equal((await call({ method, input: {}, compact: true })).status, 400);
  }
});
