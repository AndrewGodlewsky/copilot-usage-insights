import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport, buildRequestPage } from '../src/core/copilot-report.mjs';
import * as reportApi from '../src/core/copilot-report.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { readRequestPrompts } from '../src/node/request-prompts.mjs';
import { createSettings } from '../src/node/settings.mjs';
import { startServer } from '../src/node/canvas-server.mjs';

const now = new Date(2026, 10, 14, 12);
const receipt = (id, overrides = {}) => ({ type: 'session.usage_record', id, timestamp: now.toISOString(), data: { usage: {
  model: 'Sonnet', provider: { kind: 'copilot' }, inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10,
  reasoningTokens: 5, copilotUsage: { totalNanoAiu: 250000000 }, apiCallId: id, duration: 940.5, isAuto: false, initiator: 'agent', ...overrides,
} } });
function parse(events) {
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  for (const event of events) parser.push(JSON.stringify(event));
  return parser.snapshot().records;
}
const user = (id, interactionId, content) => ({ type: 'user.message', id, data: { interactionId, content } });
const assistant = (apiCallId, interactionId) => ({ type: 'assistant.message', data: { apiCallId, interactionId, content: 'Private response' } });
async function fixture(t, events) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-requests-'));
  assert.equal(path.dirname(path.resolve(home)), path.resolve(os.tmpdir()));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const file = path.join(home, 'session-state', 's1', 'events.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return { home, file };
}

test('request pages follow report filters, totals, missing coverage, and stable pagination', () => {
  const records = parse(Array.from({ length: 28 }, (_, i) => receipt(`call-${i}`)));
  records.push(...parse([receipt('other', { model: 'Other' }), receipt('missing', { inputTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined, copilotUsage: undefined })]));
  records[0].sessionId = 's2'; records[0].project = 'Other project'; records[0].sessionName = 'Renamed session';
  for (const filters of [{ range: '1d' }, { range: 'all', includeCache: false }, { range: '7d', session: 's2' }, { range: '90d', project: 'Other project' }, { range: 'custom', startDate: '2026-11-13', endDate: '2026-11-13' }]) {
    const query = { ...filters, models: ['Sonnet'], model: 'Sonnet' };
    const first = buildRequestPage(records, query, now);
    const rows = first.total > first.limit ? [...first.rows, ...buildRequestPage(records, { ...query, offset: 25 }, now).rows] : first.rows;
    const report = buildReport(records, query, now);
    assert.equal(rows.length, report.totals.requests);
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
    for (const field of ['total', 'reasoning', 'cacheRead', 'cacheWrite', 'inputTotal']) assert.equal(rows.reduce((sum, r) => sum + r[field], 0), report.totals[field]);
  }
  const row = buildRequestPage(records, { model: 'Sonnet', session: 's2' }, now).rows[0];
  assert.equal(row.sessionName, 'Renamed session');
  assert.equal(row.duration, 940.5);
  assert.equal(row.initiator, 'agent');
  assert.equal(row.isAuto, false);
  assert.equal(buildRequestPage(records, { model: 'Sonnet', models: ['Other'] }, now).total, 0);
  assert.equal(buildRequestPage(records, { model: 'Sonnet', id: row.id, session: 's1' }, now).total, 0);
  assert.equal(buildRequestPage(records, { model: 'Sonnet', offset: 1000 }, now).offset, 25);
  assert.doesNotMatch(JSON.stringify(row), /apiCallId|logFile|source/);
  for (const input of [{}, { model: 'Sonnet', offset: -1 }, { model: 'Sonnet', offset: 1.2 }, { model: 'Sonnet', id: {} }, { model: 'Sonnet', path: '/secret' }]) assert.throws(() => buildRequestPage(records, input, now), TypeError);
});

test('model sessions reconcile with model requests across filters without merging identical names', () => {
  assert.equal(typeof reportApi.buildModelSessionPage, 'function');
  const records = parse([receipt('a'), receipt('b'), receipt('c', { model: 'Other' }),
    receipt('missing', { inputTokens: undefined, copilotUsage: undefined }), receipt('partial', { aiCreditsStatus: 'partial' })]);
  for (const [i, r] of records.entries()) Object.assign(r, { sessionId: i % 2 ? 's2' : 's1', sessionName: 'Same name', project: i < 2 ? 'A' : 'B' });
  records.push({ ...records[0], key: 'yesterday', ms: new Date(2026, 10, 13, 23, 59).getTime(), ts: new Date(2026, 10, 13, 23, 59).toISOString() });
  records.push({ ...records[0], key: 'future', ms: now.getTime() + 1000 });
  for (const filters of [{ range: '1d' }, { range: 'all', includeCache: false }, { range: '7d', project: 'A' }, { range: 'all', session: 's2' }, { range: 'custom', startDate: '2026-11-13', endDate: '2026-11-13' }]) {
    const input = { ...filters, model: 'Sonnet' };
    const page = reportApi.buildModelSessionPage(records, input, now);
    const parent = buildReport(records, { ...filters, models: ['Sonnet'] }, now).totals;
    for (const field of ['requests', 'input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total', 'credits', 'missingTokens', 'partialCredits', 'completeTokenRequests']) {
      assert.equal(page.rows.reduce((sum, r) => sum + (r[field] ?? 0), 0), parent[field] ?? 0, field);
    }
    for (const row of page.rows) {
      const requests = buildRequestPage(records, { ...input, session: row.id }, now).rows;
      assert.equal(requests.length, row.requests);
      assert.equal(requests.reduce((sum, r) => sum + r.total, 0), row.total);
      const known = requests.filter(r => r.completeTokenRequests);
      assert.equal(row.averageTokens, known.length ? known.reduce((sum, r) => sum + r.total, 0) / known.length : null);
    }
  }
  const page = reportApi.buildModelSessionPage(records, { model: 'Sonnet', range: 'all' }, now);
  assert.equal(page.total, 2);
  assert.deepEqual(new Set(page.rows.map(r => r.id)), new Set(['s1', 's2']));
  assert.ok(page.rows.every(r => r.name.startsWith('Same name')));
  assert.doesNotMatch(JSON.stringify(page), /logFile|apiCallId|source|prompt/);
  assert.equal(reportApi.buildModelSessionPage(records, { model: 'Sonnet', models: ['Other'] }, now).total, 0);
});

test('model session pages sort the complete set, clamp offsets, and validate options', () => {
  assert.equal(typeof reportApi.buildModelSessionPage, 'function');
  const base = parse([receipt('base')])[0];
  const records = Array.from({ length: 52 }, (_, i) => ({ ...base, key: `r${i}`, sessionId: `s${i}`, sessionName: `Session ${String(i).padStart(2, '0')}`, output: i, nanoAiu: (52 - i) * 1e9 }));
  const page = reportApi.buildModelSessionPage(records, { model: 'Sonnet', sort: 'total' }, now);
  assert.equal(page.limit, 25); assert.equal(page.total, 52); assert.equal(page.rows[0].id, 's51');
  assert.equal(reportApi.buildModelSessionPage(records, { model: 'Sonnet', sort: 'credits' }, now).rows[0].id, 's0');
  assert.equal(reportApi.buildModelSessionPage(records, { model: 'Sonnet', sort: 'requests' }, now).rows[0].id, 's0');
  assert.equal(reportApi.buildModelSessionPage(records, { model: 'Sonnet', offset: 1000 }, now).offset, 50);
  for (const input of [{}, { model: 'Sonnet', offset: -1 }, { model: 'Sonnet', sort: 'unknown' }, { model: 'Sonnet', id: 'r1' }]) {
    assert.throws(() => reportApi.buildModelSessionPage(records, input, now), TypeError);
  }
});

test('prompts join by API call and interaction IDs, deduplicate messages, and stay out of accounting', async t => {
  const content = '<script>alert("hello")</script> ' + 'Long prompt '.repeat(100);
  const events = [user('prompt1', 'i1', content), receipt('call1'), assistant('call1', 'i1'), assistant('call1', 'i1'),
    receipt('call2'), assistant('call2', 'i1'), user('prompt2', 'i2', 'Different prompt'),
    receipt('call3'), assistant('call3', 'i2'), receipt('no-message'), receipt('excluded', { isByok: true })];
  const { home, file } = await fixture(t, events);
  const scan = await createScanner().scan([home]);
  assert.doesNotMatch(JSON.stringify(scan), /Long prompt|Different prompt|Private response/);
  const previews = await readRequestPrompts(scan.records);
  assert.equal(previews.get(scan.records[0].key).text, content.slice(0, 160));
  assert.equal(previews.get(scan.records[0].key).truncated, true);
  assert.deepEqual(previews.get(scan.records[0].key), previews.get(scan.records[1].key));
  assert.equal(previews.get(scan.records[2].key).text, 'Different prompt');
  assert.equal(previews.get(scan.records[3].key).available, false);
  const full = await readRequestPrompts([scan.records[0]], { maxChars: 12000 });
  assert.equal(full.get(scan.records[0].key).text, content);
  await fs.appendFile(file, JSON.stringify(user('ambiguous', 'i1', 'Another prompt')) + '\n');
  assert.equal((await readRequestPrompts([scan.records[0]])).get(scan.records[0].key).available, false);
  await fs.unlink(file);
  assert.equal((await readRequestPrompts([scan.records[0]])).get(scan.records[0].key).available, false);
});

test('prompt lookup handles missing links, malformed lines, bounded text, and conflicting correlations', async t => {
  const { home, file } = await fixture(t, [user('p1', 'i1', 'x'.repeat(13000)), receipt('call1'), assistant('call1', 'i1'),
    receipt('call2'), assistant('call2', 'i1'), assistant('call2', 'i2'), user('p2', 'i2', 'Other')]);
  await fs.appendFile(file, '{bad json}\nnull\n[]\n');
  const scan = await createScanner().scan([home]);
  const prompts = await readRequestPrompts(scan.records, { maxChars: 12000 });
  assert.equal(prompts.get(scan.records[0].key).text.length, 12000);
  assert.equal(prompts.get(scan.records[0].key).truncated, true);
  assert.equal(prompts.get(scan.records[1].key).available, false);
  const dbOnly = { ...scan.records[0], key: 'db-only', logFile: '' };
  assert.equal((await readRequestPrompts([dbOnly])).get('db-only').available, false);
});

test('request API reuses history, reads prompts only for details, and rechecks enabled sources', async t => {
  const { home, file } = await fixture(t, [user('p1', 'i1', 'Selected prompt'), receipt('call1'), assistant('call1', 'i1'),
    user('p2', 'i2', 'Unselected secret'), receipt('call2', { model: 'Other' }), assistant('call2', 'i2')]);
  const settings = createSettings(path.join(home, 'settings'));
  const base = createScanner(), scans = [];
  const scanner = { scan(roots, options) { scans.push(options); return base.scan(roots, options); } };
  let clock = now;
  const server = await startServer({ settings, scanner, defaultHome: home, now: () => clock, html: 'test' });
  t.after(() => server.close());
  const call = input => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const report = await (await call({ method: 'usage.report' })).json();
  assert.doesNotMatch(JSON.stringify(report), /Selected prompt|Unselected secret/);
  await fs.rename(file, file + '.moved');
  const sessionResponse = await call({ method: 'usage.sessions', input: { model: 'Sonnet' } });
  assert.equal(sessionResponse.status, 200);
  const sessions = await sessionResponse.json();
  assert.equal(sessions.total, 1); assert.equal(sessions.rows[0].id, 's1');
  assert.doesNotMatch(JSON.stringify(sessions), /Selected prompt|Unselected secret|logFile|apiCallId/);
  const page = await (await call({ method: 'usage.requests', input: { model: 'Sonnet' } })).json();
  assert.equal(page.total, 1);
  assert.doesNotMatch(JSON.stringify(page), /prompt|Selected prompt|Unselected secret|logFile|apiCallId/);
  const input = { model: 'Sonnet', id: page.rows[0].id };
  assert.equal((await (await call({ method: 'usage.requests', input })).json()).rows[0].prompt.available, false);
  await fs.rename(file + '.moved', file);
  const detail = await (await call({ method: 'usage.requests', input })).json();
  assert.equal(detail.rows[0].prompt.text, 'Selected prompt');
  assert.doesNotMatch(JSON.stringify(detail), /Unselected secret|logFile|apiCallId/);
  assert.equal((await (await call({ method: 'usage.requests', input: { ...input, session: 'other' } })).json()).total, 0);
  assert.equal((await call({ method: 'usage.requests', input: { ...input, logFile: 'C:/secret' } })).status, 400);
  clock = new Date(now.getTime() + 60000);
  for (const range of ['1d', '7d', 'all']) {
    const cached = await (await call({ method: 'usage.report', input: { range } })).json();
    assert.equal(cached.scannedAt, report.scannedAt, 'filtering keeps the history timestamp');
  }
  assert.equal(scans.length, 1, 'paging, details, and filtering reuse the first scan');
  await fs.appendFile(file, JSON.stringify(receipt('new-call')) + '\n');
  assert.equal((await (await call({ method: 'usage.requests', input: { model: 'Sonnet' } })).json()).total, 1);
  const updated = await (await call({ method: 'usage.report', refresh: true })).json();
  assert.equal(updated.totals.requests, 3);
  assert.equal(updated.scannedAt, clock.toISOString());
  assert.equal(scans.length, 2);
  assert.equal(scans.at(-1).force, false, 'automatic refresh keeps the incremental parser');
  assert.equal((await (await call({ method: 'usage.requests', input: { model: 'Sonnet' } })).json()).total, 2);
  await call({ method: 'usage.refresh' });
  assert.equal(scans.length, 3);
  assert.equal(scans.at(-1).force, true, 'manual refresh still forces a full scan');
  await settings.set({ disabledHomes: [home] });
  assert.equal((await (await call({ method: 'usage.requests', input })).json()).total, 0);
  assert.equal(scans.length, 4, 'changing sources immediately invalidates cached history');
  await settings.set({ disabledHomes: [], extraHomes: [path.join(home, 'another-home')] });
  assert.equal((await (await call({ method: 'usage.requests', input })).json()).total, 1);
  assert.equal(scans.length, 5);
});

test('history shares pending scans, retries errors, and cannot reuse a superseded source snapshot', async t => {
  const config = { extraHomes: [], disabledHomes: [] }, pending = [];
  const scanner = { scan(roots) { return new Promise((resolve, reject) => pending.push({ roots, resolve, reject })); } };
  const server = await startServer({ settings: { get: async () => ({ ...config }) }, scanner, defaultHome: 'fixture', html: 'test', now: () => now });
  t.after(() => server.close());
  const call = () => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.requests', input: { model: 'Sonnet' } }) });
  const first = call(), second = call();
  while (!pending.length) await new Promise(setImmediate);
  pending[0].resolve({ records: parse([receipt('old')]) });
  assert.equal((await (await first).json()).total, 1);
  assert.equal((await (await second).json()).total, 1);
  assert.equal(pending.length, 1);
  config.extraHomes = ['source-two'];
  const failed = call();
  while (pending.length < 2) await new Promise(setImmediate);
  pending[1].reject(new Error('Temporary scan error'));
  assert.equal((await failed).status, 500);
  const retry = call();
  while (pending.length < 3) await new Promise(setImmediate);
  config.extraHomes = ['source-three'];
  const newer = call();
  while (pending.length < 4) await new Promise(setImmediate);
  pending[3].resolve({ records: [] });
  assert.equal((await (await newer).json()).total, 0);
  pending[2].resolve({ records: parse([receipt('late')]) });
  await retry;
  assert.equal((await (await call()).json()).total, 0);
  assert.equal(pending.length, 4, 'a late scan does not replace the current source snapshot');
});
