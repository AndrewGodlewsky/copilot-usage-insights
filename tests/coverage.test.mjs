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
