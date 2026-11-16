import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createVSCodeParser } from '../src/core/vscode.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { normalizeDatabaseRows } from '../src/node/copilot-db.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { mergeCoverage } from '../src/core/coverage.mjs';

const now = new Date(2026, 10, 15, 12);
const at = (day, hour = 10) => new Date(2026, 10, day, hour).toISOString();
const start = { type: 'session.start', timestamp: at(1), data: { sessionId: 's', context: { repository: 'project' } } };
const rejected = (id, timestamp = at(15)) => ({ type: 'session.usage_record', id, timestamp, data: { usage: { model: 'Model', secret: 'PRIVATE' } } });
const summary = timestamp => ({ type: 'session.shutdown', timestamp, data: { content: 'PRIVATE', totalNanoAiu: 400 } });
function parse(events, skipUnused = false) {
  const parser = createReceiptParser({ sessionId: 's', source: '/home', logFile: '/home/events.jsonl', skipUnused });
  for (const e of events) parser.push(typeof e === 'string' ? e : JSON.stringify(e));
  return parser.snapshot();
}
const report = (snapshot, query = { range: '7d' }) => buildReport(snapshot.records || [], query, now, snapshot).coverageDetails;

test('coverage dates follow local inclusive boundaries, all presets, and custom dates', () => {
  const snapshot = parse([start, rejected('old', at(-60)), rejected('before', at(8, 23)), rejected('first', at(9, 0)), rejected('today'), rejected('future', at(16))]);
  assert.equal(report(snapshot).counts.unclassified, 2);
  assert.equal(report(snapshot, { range: '1d' }).counts.unclassified, 1);
  assert.equal(report(snapshot, { range: 'mtd' }).counts.unclassified, 3);
  assert.equal(report(snapshot, { range: '30d' }).counts.unclassified, 3);
  assert.equal(report(snapshot, { range: '90d' }).counts.unclassified, 4);
  assert.equal(report(snapshot, { range: 'all' }).counts.unclassified, 4);
  assert.equal(report(snapshot, { range: 'custom', startDate: '2026-11-08', endDate: '2026-11-08' }).counts.unclassified, 1);
  assert.equal(report(snapshot).rows.filter(r => r.scope === 'outside').reduce((n, r) => n + r.count, 0), 3);
});

test('undated problems and unknown filter metadata never claim a match; known mismatches disappear', () => {
  const snapshot = parse([start, rejected('current'), rejected('bad-date', 'no date'), '{PRIVATE invalid json', '{another bad line']);
  snapshot.sources = [{ path: '/home', environment: 'windows', state: 'ok' }, { path: '/wsl', environment: 'wsl:Ubuntu', state: 'error' }];
  assert.equal(report(snapshot).counts.unclassified, 1);
  assert.equal(report(snapshot).counts.invalid, undefined);
  assert.equal(report(snapshot).rows.find(r => r.kind === 'invalid').count, 2);
  assert.equal(report(snapshot, { range: '7d', models: ['Other'] }).counts.unclassified, undefined);
  assert.equal(report(snapshot, { range: '7d', project: 'other' }).rows.some(r => r.kind === 'unclassified'), false);
  assert.equal(report(snapshot, { range: '7d', session: 'other' }).rows.some(r => r.kind === 'unclassified'), false);
  assert.equal(report(snapshot, { range: '7d', environment: 'wsl:Ubuntu' }).rows.length, 0);
  assert.equal(report(snapshot, { range: '7d', environment: 'windows' }).unreadable.length, 0);
  assert.equal(report(snapshot).unreadable.length, 1);
  assert.equal(report(snapshot, { range: '7d', models: ['Model'] }).counts.unclassified, 1);
  assert.doesNotMatch(JSON.stringify(snapshot.coverageEntries), /PRIVATE|secret|content/);
});

test('summary sessions use observed start and summary dates, preserve fast parsing, and defer unknown model scope', () => {
  const events = [start, summary(at(15))];
  assert.deepEqual(parse(events, true).coverageEntries, parse(events).coverageEntries);
  const reordered = [start, { type: 'session.shutdown', data: { content: 'PRIVATE' }, timestamp: at(15) }];
  assert.deepEqual(parse(reordered, true).coverageEntries, parse(reordered).coverageEntries);
  assert.equal(report(parse(events)).counts.aggregateOnly, 1);
  assert.equal(report(parse([{ ...start, timestamp: at(-60) }, summary(at(-59))])).counts.aggregateOnly, undefined);
  assert.equal(report(parse([summary(at(15))])).rows[0].scope, 'unknown');
  assert.equal(report(parse(events), { range: '7d', models: ['Model'] }).rows[0].scope, 'unknown');
  assert.equal(mergeCoverage([...parse(events).coverageEntries, ...parse(events).coverageEntries]).length, 1);
  assert.equal(mergeCoverage(parse(events).coverageEntries, new Set(['s'])).length, 0);
  const copies = mergeCoverage([...parse([start, summary(at(2))]).coverageEntries, ...parse(events).coverageEntries]);
  assert.equal(report({ coverageEntries: copies }).counts.aggregateOnly, 1, 'a later summary in a copy extends the observed span');
});

test('source failures remain distinct from absent sources and known availability limitations', () => {
  const snapshot = { sources: [
    { path: 'absent', state: 'missing', diagnostic: { errorCode: 'ENOENT' } },
    { path: 'absent-vscode', state: 'warning', diagnostic: { errorCode: 'ENOENT' } },
    { path: 'stopped', state: 'warning' },
    { path: 'unreadable', state: 'error', diagnostic: { code: 'EACCES' } },
    { path: 'db-error', state: 'warning', diagnostic: { code: 'SQLITE_CORRUPT' } },
  ] };
  assert.deepEqual(report(snapshot).unreadable.map(s => [s.file, s.failed]), [
    ['absent', false], ['absent-vscode', false], ['stopped', false], ['unreadable', true], ['db-error', true],
  ]);
});

test('empty zero-credit checkpoints do not imply missing usage, while uncertain or active summaries still do', () => {
  const empty = { totalNanoAiu: 0, totalPremiumRequests: 0, totalApiDurationMs: 0, conversationTokens: 0, modelMetrics: {} };
  const cases = [
    ['empty', empty, false], ['minimal empty', { totalNanoAiu: 0 }, false],
    ['charged', { ...empty, totalNanoAiu: 1 }, true], ['unknown', {}, true],
    ...[null, false, '', '0', -1].map(value => ['invalid credit total', { ...empty, totalNanoAiu: value }, true]),
    ['premium request', { ...empty, totalPremiumRequests: 1 }, true],
    ['unknown premium requests', { ...empty, totalPremiumRequests: null }, true],
    ['free tokens', { ...empty, conversationTokens: 300 }, true],
    ['model call duration', { ...empty, totalApiDurationMs: 12 }, true],
    ['model metrics', { ...empty, modelMetrics: { Model: { inputTokens: 300 } } }, true],
    ['unknown model metrics', { ...empty, modelMetrics: null }, true],
    ['empty provider metrics', { ...empty, providerModelMetrics: [] }, false],
    ['provider usage', { ...empty, providerModelMetrics: [{ modelId: 'free-model', metrics: { requests: { count: 1 } } }] }, true],
    ['unknown provider metrics', { ...empty, providerModelMetrics: null }, true],
    ['malformed provider metrics', { ...empty, providerModelMetrics: {} }, true],
    ...['agentMetrics', 'tokenDetails', 'usageAccountingWatermarks'].flatMap(key => [
      ['empty ' + key, { ...empty, [key]: {} }, false],
      ['recorded ' + key, { ...empty, [key]: { main: 1 } }, true],
      ['unknown ' + key, { ...empty, [key]: null }, true],
    ]),
    ['nested zero is not a total', { payload: empty }, true],
  ];
  for (const [name, data, expected] of cases) for (const type of ['session.shutdown', 'session.usage_checkpoint']) {
    const events = [start, { type: 'permission.requested', data: { kind: 'extension-permission-access' } }, { type, timestamp: at(15), data }];
    const full = parse(events), fast = parse(events, true);
    assert.deepEqual(fast.coverageEntries, full.coverageEntries, name);
    for (const snapshot of [full, fast]) {
      assert.equal(snapshot.aggregateOnly, expected, name);
      assert.equal(snapshot.coverageEntries.filter(e => e.kind === 'aggregateOnly').length, Number(expected), name);
      assert.equal(snapshot.records.length, 0, 'summaries never become receipts');
    }
  }
  const zero = { type: 'session.shutdown', timestamp: at(15), data: empty };
  for (const skipUnused of [false, true]) {
    for (const type of ['user.message', 'assistant.message', 'assistant.turn_start', 'tool.execution_start', 'session.compaction_start', 'session.compaction_complete']) {
      for (const events of [[start, { type, timestamp: at(15), data: {} }, zero], [start, zero, { type, timestamp: at(15), data: {} }]]) {
        assert.equal(parse(events, skipUnused).aggregateOnly, true, type + ' is not an empty session');
      }
    }
    for (const data of [{ totalNanoAiu: 7 }, {}]) {
      const warning = { ...zero, data };
      assert.equal(parse([start, zero, warning, zero], skipUnused).aggregateOnly, true, 'later zeros do not erase earlier usage or uncertainty');
    }
    const padded = { ...zero, data: { padding: 'PRIVATE'.repeat(10000), ...empty } };
    assert.equal(parse([start, padded], skipUnused).aggregateOnly, false, 'compact summaries inspect fields beyond a fixed prefix');
    assert.equal(parse([start, JSON.stringify(padded, null, 1)], skipUnused).aggregateOnly, false, 'field order, payload length and whitespace do not change the classification');
    const receipt = { type: 'session.usage_record', id: 'r', timestamp: at(15), data: { usage: {
      model: 'Model', provider: { kind: 'copilot' }, inputTokens: 3, outputTokens: 2, copilotUsage: { totalNanoAiu: 0 },
    } } };
    const snapshot = parse([start, zero, receipt, summary(at(15))], skipUnused);
    assert.equal(snapshot.aggregateOnly, false);
    assert.equal(snapshot.records.length, 1);
    assert.equal(snapshot.records[0].nanoAiu, 0, 'free itemized usage is retained');
  }
});

test('zero-summary classification updates incrementally even when the checkpoint timestamp stays the same', () => {
  for (const skipUnused of [false, true]) {
    const parser = createReceiptParser({ sessionId: 's', source: '/home', skipUnused });
    parser.push(JSON.stringify(start));
    const zero = { type: 'session.shutdown', timestamp: at(15), data: { totalNanoAiu: 0 } };
    parser.push(JSON.stringify(zero));
    assert.equal(parser.snapshot().aggregateOnly, false);
    const before = parser.revision();
    parser.push(JSON.stringify({ ...zero, data: { totalNanoAiu: 1 } }));
    assert.ok(parser.revision() > before, 'coverage-only changes invalidate the scanner snapshot');
    assert.equal(parser.snapshot().aggregateOnly, true);
    const after = parser.revision();
    parser.push(JSON.stringify(zero));
    assert.equal(parser.revision(), after, 'replays do not repeatedly invalidate the snapshot');
    assert.equal(parser.snapshot().aggregateOnly, true);
  }
});

test('scanner omits empty summaries from coverage, deduplicates real gaps and picks up resumed activity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-summary-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const zero = { type: 'session.shutdown', timestamp: at(15), data: { totalNanoAiu: 0, totalPremiumRequests: 0 } };
  const write = async (folder, id, data) => {
    const file = path.join(root, 'session-state', folder, 'events.jsonl');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, [JSON.stringify({ ...start, data: { ...start.data, sessionId: id } }), JSON.stringify({ ...zero, data })].join('\n') + '\n');
    return file;
  };
  const file = await write('s', 's', zero.data);
  await write('empty-copy', 's', zero.data);
  const scanner = createScanner({ skipUnused: true });
  const empty = await scanner.scan([root]);
  assert.equal(empty.coverage.aggregateOnly, 0);
  assert.equal(report(empty).rows.length, 0, 'empty sessions are absent from the read-only coverage list');
  assert.equal(empty.records.length, 0);
  assert.strictEqual(await scanner.scan([root]), empty);
  await write('charged', 'charged', { totalNanoAiu: 30 });
  await write('charged-copy', 'charged', { totalNanoAiu: 30 });
  await write('unknown', 'unknown', {});
  const gaps = await scanner.scan([root]);
  assert.equal(gaps.coverage.aggregateOnly, 2);
  assert.equal(report(gaps).counts.aggregateOnly, 2);
  await fs.appendFile(file, JSON.stringify({ ...zero, data: { totalNanoAiu: 50 } }) + '\n');
  const resumed = await scanner.scan([root]);
  assert.equal(resumed.coverage.aggregateOnly, 3, 'an unchanged zero-only copy does not hide resumed usage');
  assert.equal(report(resumed).counts.aggregateOnly, 3);
  assert.strictEqual(await scanner.scan([root]), resumed);
  const partial = await write('partial-summary', 'partial', zero.data);
  const activityFile = path.join(root, 'session-state', 'partial-activity', 'events.jsonl');
  await fs.mkdir(path.dirname(activityFile), { recursive: true });
  await fs.writeFile(activityFile, [
    { ...start, data: { ...start.data, sessionId: 'partial' } },
    { type: 'user.message', id: 'message', timestamp: at(15), data: { content: 'PRIVATE' } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');
  const split = await scanner.scan([root]);
  assert.equal(split.coverage.aggregateOnly, 4, 'activity in a partial copy prevents classifying the session as empty');
  assert.equal(report(split).rows.some(r => r.file === partial), true);
  const receipt = { type: 'session.usage_record', id: 'r', timestamp: at(15), data: { usage: {
    model: 'Model', provider: { kind: 'copilot' }, inputTokens: 3, outputTokens: 2, copilotUsage: { totalNanoAiu: 0 },
  } } };
  await fs.appendFile(activityFile, JSON.stringify(receipt) + '\n');
  const accounted = await scanner.scan([root]);
  assert.equal(accounted.coverage.aggregateOnly, 3, 'receipts in another copy still take precedence');
  const fresh = await createScanner({ skipUnused: true }).scan([root]);
  assert.deepEqual(accounted.coverage, fresh.coverage);
  assert.deepEqual(report(accounted), report(fresh));
  assert.equal(buildReport(resumed.records, {}, now, resumed).totals.requests, 0, 'summaries do not invent model turns or charges');
});

test('rejected receipts use their accounting session rather than their containing journal', () => {
  const event = rejected('shared');
  event.data.usage.accounting = { sourceSessionId: 'origin' };
  const snapshot = parse([start, event, event]);
  assert.equal(report(snapshot, { range: '7d', session: 'origin' }).counts.unclassified, 1);
  assert.equal(report(snapshot, { range: '7d', session: 's' }).rows.length, 0);
});

test('VS Code and database exclusions retain dates and locations, without raw payloads', () => {
  const parser = createVSCodeParser({ source: '/vscode', logFile: '/vscode/debug.jsonl' });
  const e = { type: 'llm_request', sid: 's', spanId: 'span', ts: Date.parse(at(15)), attrs: { model: 'Model', prompt: 'PRIVATE' } };
  parser.push(JSON.stringify(e)); parser.push(JSON.stringify(e));
  assert.equal(report(parser.snapshot()).counts.unclassified, 1);
  assert.equal(report(parser.snapshot()).rows[0].file, '/vscode/debug.jsonl');
  const result = normalizeDatabaseRows([{ id: 1, session_id: 's', model: 'Model', created_at: at(15), total_nano_aiu: null }], new Map(), new Set(), '/home', true);
  assert.equal(report(result).counts.unclassified, 1);
  assert.match(report(result).rows[0].file, /session-store\.db$/);
  assert.doesNotMatch(JSON.stringify(parser.snapshot().coverageEntries), /PRIVATE|prompt/);
  const later = normalizeDatabaseRows([{ id: 1, session_id: 's', model: 'Model', created_at: at(14), total_nano_aiu: null }], new Map(), new Set(), '/copy', true);
  assert.equal(mergeCoverage([...result.coverageEntries, ...later.coverageEntries]).length, 2, 'database-local row IDs are not globally unique');
  assert.equal(mergeCoverage([...result.coverageEntries, ...result.coverageEntries]).length, 1, 'copied database rows count once');
});

test('scanner deduplicates rejected receipts, removes recovered summaries, and refreshes coverage-only changes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = async (folder, events) => {
    const file = path.join(root, 'session-state', folder, 'events.jsonl');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    return file;
  };
  const file = await write('s', [start, rejected('one'), rejected('one')]);
  await write('copy', [start, rejected('one')]);
  await write('fallback', [{ ...start, data: { ...start.data, sessionId: 'fallback' } }, summary(at(15))]);
  await fs.writeFile(path.join(root, 'session-store.db'), 'fixture');
  const scanner = createScanner({ skipUnused: true, readDatabase: async () => normalizeDatabaseRows([{ id: 1, session_id: 'fallback', model: 'Model', created_at: at(15), total_nano_aiu: 0 }], new Map(), new Set(), root, true) });
  const first = await scanner.scan([root]);
  assert.equal(first.coverage.unclassified, 1);
  assert.equal(first.coverage.aggregateOnly, 0);
  assert.equal(first.records.length, 1);
  assert.strictEqual(await scanner.scan([root]), first);
  assert.equal(report(first).counts.unclassified, 1);
  await fs.appendFile(file, JSON.stringify(rejected('two', at(-60))) + '\n');
  const second = await scanner.scan([root]);
  assert.notStrictEqual(second, first);
  assert.equal(second.coverage.unclassified, 2);
  assert.equal(report(second).counts.unclassified, 1);
  assert.equal(report(second).rows.find(r => r.scope === 'outside').count, 1);
});
