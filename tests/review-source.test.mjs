import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSettings } from '../src/node/settings.mjs';
import { startServer } from '../src/node/canvas-server.mjs';
import { createUsageRecorder } from '../src/node/review-usage.mjs';

const now = new Date('2026-11-14T12:00:00.000Z');
const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const receipt = (sessionId, id, overrides = {}) => ({
  type: 'session.usage_record', id, timestamp: now.toISOString(), data: { usage: {
    model: 'fixture-model', provider: { id: 'copilot', kind: 'copilot' },
    inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10, reasoningTokens: 5,
    accounting: { sourceSessionId: sessionId, usageId: id, sequence: 1 },
    copilotUsage: { totalNanoAiu: 250000000 }, aiCreditsStatus: 'complete', ...overrides,
  } },
});

test('actual AI review writer feeds the existing scanner and remains separate from Enhance Prompt', async t => {
  const { home, dir, request } = await fixture(t);
  const enhance = path.join(dir, 'enhance');
  env(t, 'ENHANCE_PROMPT_DATA_DIR', enhance);
  const writer = await createUsageRecorder(firstId, home);
  const usage = receipt(firstId, 'one');
  writer.record({ ...usage, type: 'assistant.usage', data: { ...usage.data.usage, prompt: 'PRIVATE', content: 'PRIVATE' } });
  writer.record({ ...usage, id: 'durable-copy' }); await writer.flush();
  const report = await request();
  assert.equal(report.projects[0].name, 'Usage Insights AI Review');
  assert.equal(report.sessions[0].name.startsWith('Usage Insights AI Review'), true);
  assert.equal(report.totals.requests, 1); assert.equal(report.totals.credits, 0.25); assert.equal(report.totals.total, 120);
  assert.equal(report.projects[0].userPrompts, null);
  assert.doesNotMatch(await fs.readFile(path.join(home, 'session-state', firstId, 'events.jsonl'), 'utf8'), /PRIVATE/);
});
async function writeSession(home, id, receipts, name = `Usage Insights AI Review · ${now.toISOString()}`) {
  const dir = path.join(home, 'session-state', id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'workspace.yaml'), JSON.stringify({ id, name }));
  const events = [{ type: 'session.start', id: `start-${id}`, timestamp: now.toISOString(),
    data: { sessionId: id, context: { repository: 'Usage Insights AI Review' } } }, ...receipts];
  const file = path.join(dir, 'events.jsonl');
  await fs.writeFile(file + '.tmp', events.map(event => JSON.stringify(event)).join('\n') + '\n');
  await fs.rename(file + '.tmp', file);
}
function env(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}
async function fixture(t, location = 'override') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enhance-source-'));
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  env(t, 'USAGE_INSIGHTS_DATA_DIR', location === 'override' ? path.join(dir, 'custom-data') : undefined);
  env(t, 'LOCALAPPDATA', location === 'fallback' ? undefined : path.join(dir, 'local-data'));
  if (location === 'fallback') t.mock.method(os, 'homedir', () => dir);
  const data = location === 'override' ? path.join(dir, 'custom-data') : location === 'fallback'
    ? path.join(dir, '.local', 'share', 'copilot-usage-insights') : path.join(dir, 'local-data', 'copilot-usage-insights');
  const home = path.join(data, 'usage'), settings = createSettings(path.join(dir, 'settings'));
  const defaultHome = path.join(dir, 'copilot');
  await fs.mkdir(defaultHome);
  const server = await startServer({ settings, defaultHome, html: '<title>Fixture</title>', now: () => now });
  t.after(() => server.close());
  const request = async (method = 'usage.report', input = { range: 'all' }, refresh = false) => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, input, refresh }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  return { dir, home, defaultHome, settings, request };
}

test('automatic AI Review source groups helpers separately with exact tokens and credits', async t => {
  const { home, request } = await fixture(t);
  await writeSession(home, firstId, [receipt(firstId, 'first'), receipt(firstId, 'first'),
    receipt(firstId, 'byok', { isByok: true, provider: { kind: 'custom' } })], 'Usage Insights AI Review · 2026-11-14T11:00:00.000Z');
  await writeSession(home, secondId, [receipt(secondId, 'second', { inputTokens: 200, outputTokens: 40,
    accounting: { usageId: 'second', sequence: 1 },
    copilotUsage: { totalNanoAiu: 750000000 } })]);
  const report = await request();
  assert.deepEqual([report.totals.requests, report.totals.inputTotal, report.totals.input, report.totals.output,
    report.totals.cacheRead, report.totals.cacheWrite, report.totals.total, report.totals.credits], [2, 300, 160, 60, 120, 20, 360, 1]);
  assert.equal(report.projects.length, 1);
  assert.equal(report.projects[0].name, 'Usage Insights AI Review');
  assert.equal(report.projects[0].userPrompts, null, 'accounting-only exports do not invent human submissions');
  assert.equal(report.promptCredits.averageCredits, null);
  assert.equal(report.promptCredits.eligiblePrompts, 0);
  assert.deepEqual(new Set(report.sessions.map(session => session.id)), new Set([firstId, secondId]));
  assert.ok(report.sessions.every(session => session.name.startsWith('Usage Insights AI Review · ')));
  assert.equal(report.coverage.excluded, 1);
  const source = report.sources.find(source => source.path === home);
  assert.equal(source.state, 'ok');
  assert.equal(source.records, 2);
  const sessions = await request('usage.sessions', { range: 'all', model: 'fixture-model', project: 'Usage Insights AI Review' });
  assert.equal(sessions.total, 2);
  assert.deepEqual(sessions.rows.map(session => session.total).sort((a, b) => a - b), [120, 240]);
});

for (const location of ['localappdata', 'fallback']) test(`automatic source discovers the ${location} data directory`, async t => {
  const { home, request } = await fixture(t, location);
  await writeSession(home, firstId, [receipt(firstId, 'first')]);
  const report = await request();
  assert.equal(report.totals.requests, 1);
  assert.ok(report.sources.some(source => source.path === home));
});

test('optional home stays quiet until it appears and disappears cleanly on refresh', async t => {
  const { home, defaultHome, settings, request } = await fixture(t);
  const missing = await request();
  assert.deepEqual(missing.sources.map(source => source.path), [defaultHome]);
  await writeSession(home, firstId, [receipt(firstId, 'first')]);
  assert.equal((await request('usage.report', { range: 'all' }, true)).totals.requests, 1);
  await fs.rm(home, { recursive: true, force: true });
  const removed = await request('usage.refresh');
  assert.equal(removed.totals.requests, 0);
  assert.deepEqual(removed.sources.map(source => source.path), [defaultHome]);
  await settings.set({ extraHomes: [home] });
  const explicit = await request();
  assert.equal(explicit.sources.find(source => source.path === home)?.state, 'missing', 'explicit sources retain diagnostics');
  assert.equal(explicit.sources.filter(source => source.path === home).length, 1);
});

test('manual copies and repeated atomic rewrites do not double-count retained accounting', async t => {
  const { dir, home, settings, request } = await fixture(t);
  await writeSession(home, firstId, [receipt(firstId, 'first')]);
  const copy = path.join(dir, 'copied-home');
  await fs.cp(home, copy, { recursive: true });
  await settings.set({ extraHomes: [home, copy] });
  for (const [method, refresh] of [['usage.report', false], ['usage.report', true], ['usage.refresh', false]]) {
    const report = await request(method, { range: 'all' }, refresh);
    assert.equal(report.totals.requests, 1);
    assert.equal(report.totals.credits, 0.25);
    assert.equal(report.sources.filter(source => source.path === home).length, 1);
  }
  await writeSession(home, firstId, [receipt(firstId, 'first'), receipt(firstId, 'first'), receipt(firstId, 'next')]);
  const changed = await request('usage.report', { range: 'all' }, true);
  assert.equal(changed.totals.requests, 2);
  assert.equal(changed.totals.total, 240);
  assert.equal(changed.totals.credits, 0.5);
});

test('automatic source respects disabledHomes and resumes after re-enabling', async t => {
  const { home, settings, request } = await fixture(t);
  await writeSession(home, firstId, [receipt(firstId, 'first')]);
  await settings.set({ disabledHomes: [home] });
  const disabled = await request();
  assert.equal(disabled.totals.requests, 0);
  assert.equal(disabled.sources.find(source => source.path === home)?.state, 'off');
  await settings.set({ disabledHomes: [] });
  assert.equal((await request()).totals.requests, 1);
});

test('retained incomplete credits stay distinct from zero and private payloads do not enter reports', async t => {
  const { home, request } = await fixture(t);
  await writeSession(home, firstId, [receipt(firstId, 'missing', { copilotUsage: undefined, aiCreditsStatus: 'unavailable' }),
    receipt(firstId, 'zero', { copilotUsage: { totalNanoAiu: 0 } }),
    receipt(firstId, 'partial', { aiCreditsStatus: 'partial', prompt: 'PRIVATE_PROMPT', response: 'PRIVATE_RESPONSE',
      account: 'PRIVATE_ACCOUNT', endpoint: 'https://PRIVATE_ENDPOINT.invalid', unknown: 'PRIVATE_UNKNOWN' })]);
  const report = await request();
  assert.equal(report.totals.requests, 3);
  assert.equal(report.totals.credits, 0.25);
  assert.equal(report.totals.missingCredits, 1);
  assert.equal(report.totals.partialCredits, 1);
  assert.equal(report.totals.completeCreditRequests, 1);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  const page = await request('usage.requests', { range: 'all', model: 'fixture-model' });
  assert.doesNotMatch(JSON.stringify(page), /PRIVATE_/);
  const detail = await request('usage.requests', { range: 'all', model: 'fixture-model', id: page.rows[0].id });
  assert.equal(detail.rows[0].prompt.available, false);
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_/);
});
