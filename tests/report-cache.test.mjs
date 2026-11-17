import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportCache, startServer } from '../src/node/canvas-server.mjs';
import { createDiagnostics } from '../src/core/diagnostics.mjs';

test('report cache evicts by byte budget and promotes recently read entries', () => {
  const cache = createReportCache({ maxEntries: 12, maxBytes: 10 });
  cache.set('a', { name: 'a' }, 4);
  cache.set('b', { name: 'b' }, 4);
  assert.equal(cache.get('a').name, 'a');
  cache.set('c', { name: 'c' }, 4);
  assert.equal(cache.get('b'), undefined, 'the least recently used report is evicted');
  assert.equal(cache.get('a').name, 'a');
  assert.equal(cache.get('c').name, 'c');
  assert.equal(cache.size, 2);
  assert.equal(cache.bytes, 8);
  cache.set('a', { name: 'replacement' }, 7);
  assert.equal(cache.get('c'), undefined);
  assert.equal(cache.get('a').name, 'replacement');
  assert.equal(cache.bytes, 7, 'replacement removes the old weight before eviction');
  cache.delete('a');
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});

test('report cache retains at most twelve entries and oversized reports do not evict useful reports', () => {
  const cache = createReportCache();
  for (let i = 0; i < 12; i++) cache.set(i, i, 1);
  assert.equal(cache.get(0), 0);
  cache.set(12, 12, 1);
  assert.equal(cache.get(1), undefined);
  assert.equal(cache.get(0), 0);
  assert.equal(cache.size, 12);
  cache.set('oversized', 'not retained', 16 * 1024 * 1024 + 1);
  assert.equal(cache.get('oversized'), undefined);
  assert.equal(cache.size, 12);
  assert.equal(cache.bytes, 12);
  cache.set(0, 'oversized replacement', 16 * 1024 * 1024 + 1);
  assert.equal(cache.get(0), undefined, 'a rejected replacement cannot leave a stale entry');
  assert.equal(cache.size, 11);
  assert.equal(cache.bytes, 11);
});

test('oversized reports still return complete data and honor unchanged revisions without retaining the report', async t => {
  // One synthetic field crosses the budget; there is no large history scan or disk I/O.
  const sourcePath = 'x'.repeat(16 * 1024 * 1024);
  const scan = { records: [], sources: [{ path: sourcePath, state: 'ok' }], coverage: {} };
  const diagnostics = createDiagnostics();
  const server = await startServer({ html: '<title>Fixture</title>', defaultHome: '/synthetic', diagnostics,
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => scan }, now: () => new Date('2026-11-17T12:00:00Z') });
  t.after(() => server.close());
  const request = async known => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'usage.report', input: { range: '30d' }, ...(known ? { known } : {}) }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const first = await request();
  assert.equal(first.sources[0].path.length, sourcePath.length);
  assert.equal(first.sources[0].path, sourcePath);
  const second = await request(first.revision);
  assert.equal(second.unchanged, true);
  assert.equal(second.revision, first.revision);
  assert.equal(second.sources, undefined);
  assert.ok(JSON.stringify(second).length < 400);
  const builds = diagnostics.snapshot().entries.filter(entry => entry.event === 'report.build' && entry.phase === 'finished');
  assert.deepEqual(builds.map(entry => entry.cacheHit), [false, false]);
});

test('overlapping reports share their calculation and release it when version checks fail', { timeout: 5000 }, async t => {
  let unblock, entered, waiting = 0, block = true;
  const gate = new Promise(resolve => { unblock = resolve; });
  const bothEntered = new Promise(resolve => { entered = resolve; });
  const diagnostics = createDiagnostics(), measure = diagnostics.measure.bind(diagnostics);
  diagnostics.measure = (event, fields, work) => measure(event, fields, event === 'skills.versions' ? async () => {
    if (block) {
      if (++waiting === 2) entered();
      await gate;
      throw new Error('Synthetic version lookup failure');
    }
    return work();
  } : work);
  const scan = { records: [], sources: [], coverage: {} };
  const server = await startServer({ html: '<title>Fixture</title>', defaultHome: '/synthetic', diagnostics,
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) }, scanner: { scan: async () => scan },
    now: () => new Date('2026-11-17T12:00:00Z') });
  t.after(() => { unblock(); return server.close(); });
  const request = () => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'usage.report', input: { range: '30d' } }) });
  const first = request(), second = request();
  await bothEntered;
  const hits = () => diagnostics.snapshot().entries.filter(entry => entry.event === 'report.build' && entry.phase === 'finished').map(entry => entry.cacheHit);
  assert.deepEqual(hits(), [false, true], 'the second pending request reuses the first calculation');
  unblock();
  for (const response of await Promise.all([first, second])) { assert.equal(response.status, 500); await response.text(); }
  block = false;
  const retried = await request();
  assert.equal(retried.status, 200); await retried.json();
  assert.deepEqual(hits(), [false, true, false], 'failed requests leave no unbudgeted pending report');
  const cached = await request();
  assert.equal(cached.status, 200); await cached.json();
  assert.deepEqual(hits(), [false, true, false, true]);
});
