import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport, buildRequestPage } from '../src/core/copilot-report.mjs';
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

test('request API exposes only selected local prompts and rechecks filters and enabled sources', async t => {
  const { home } = await fixture(t, [user('p1', 'i1', 'Selected prompt'), receipt('call1'), assistant('call1', 'i1'),
    user('p2', 'i2', 'Unselected secret'), receipt('call2', { model: 'Other' }), assistant('call2', 'i2')]);
  const settings = createSettings(path.join(home, 'settings'));
  const server = await startServer({ settings, defaultHome: home, now: () => now, html: 'test' });
  t.after(() => server.close());
  const call = input => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const report = await (await call({ method: 'usage.report' })).json();
  assert.doesNotMatch(JSON.stringify(report), /Selected prompt|Unselected secret/);
  const page = await (await call({ method: 'usage.requests', input: { model: 'Sonnet' } })).json();
  assert.equal(page.total, 1);
  assert.equal(page.rows[0].prompt.text, 'Selected prompt');
  assert.doesNotMatch(JSON.stringify(page), /Unselected secret|logFile|apiCallId/);
  const input = { model: 'Sonnet', id: page.rows[0].id };
  assert.equal((await (await call({ method: 'usage.requests', input: { ...input, session: 'other' } })).json()).total, 0);
  assert.equal((await call({ method: 'usage.requests', input: { ...input, logFile: 'C:/secret' } })).status, 400);
  await settings.set({ disabledHomes: [home] });
  assert.equal((await (await call({ method: 'usage.requests', input })).json()).total, 0);
});
