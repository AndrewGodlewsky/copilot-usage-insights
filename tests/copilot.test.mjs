import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { usageValue } from '../src/panel/charts.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

const timestamp = new Date(2026, 10, 13, 10).toISOString();
const start = { type: 'session.start', data: { sessionId: 's1', context: { cwd: '/work/project', repository: 'example/project' } } };
const receipt = (over = {}, id = 'u1') => ({ id, timestamp, type: 'session.usage_record', data: { usage: {
  provider: { id: 'copilot', kind: 'copilot' }, model: 'test-model', inputTokens: 100,
  outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10, reasoningTokens: 5,
  accounting: { sourceSessionId: 's1', usageId: id, sequence: 1 },
  copilotUsage: { totalNanoAiu: 250000000 }, aiCreditsStatus: 'complete', ...over,
} } });
function parse(events) {
  const p = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  [start, ...events].forEach(e => p.push(JSON.stringify(e)));
  return p.snapshot();
}
test('Copilot receipts count inclusive input once and deduplicate replay, not checkpoints', () => {
  const result = parse([receipt(), receipt(), { type: 'session.usage_checkpoint', data: { totalNanoAiu: 250000000 } }]);
  assert.equal(result.records.length, 1);
  const r = result.records[0];
  assert.deepEqual([r.input, r.cacheRead, r.cacheWrite, r.output, r.total, r.reasoning], [30, 60, 10, 20, 120, 5]);
  assert.equal(r.nanoAiu, 250000000);
  assert.equal(r.project, 'example/project');
});
test('unknown charges remain null, partial amounts retain their status, custom providers are excluded', () => {
  const result = parse([
    receipt({ copilotUsage: undefined, aiCreditsStatus: undefined }, 'unknown'),
    receipt({ aiCreditsStatus: 'partial' }, 'partial'),
    receipt({ isByok: true }, 'byok'),
    receipt({ provider: { id: 'custom', kind: 'custom' } }, 'custom'),
    receipt({ provider: undefined, copilotUsage: undefined }, 'unclassified'),
  ]);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].nanoAiu, null);
  assert.equal(result.records[1].creditStatus, 'partial');
  assert.equal(result.excluded, 2);
  assert.equal(result.unclassified, 1);
});
test('malformed counts, missing counts and invalid timestamps are not invented', () => {
  const result = parse([receipt({ inputTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined }),
    { ...receipt({}, 'bad-date'), timestamp: 'invalid' }, receipt({ inputTokens: -1 }, 'negative')]);
  assert.equal(result.records[0].total, null);
  assert.equal(result.records[0].input, null);
  assert.ok(result.invalid >= 1);
  assert.equal(result.records.find(r => r.key.includes('negative'))?.total, null);
});
test('reports sum actual credits, flag partial coverage, and respect local dates and model filters', () => {
  const records = parse([receipt(), receipt({ copilotUsage: undefined, aiCreditsStatus: undefined, model: 'second' }, 'u2')]).records;
  const now = new Date(2026, 10, 13, 12);
  const r = buildReport(records, { range: '1d' }, now);
  assert.equal(r.totals.total, 240);
  assert.equal(r.totals.credits, 0.25);
  assert.equal(r.totals.missingCredits, 1);
  assert.equal(r.totals.requests, 2);
  assert.equal(r.calendar.length, 182);
  assert.equal(r.rhythm.length, 168);
  assert.equal(buildReport(records, { range: '1d', models: ['second'] }, now).totals.credits, null);
  assert.equal(buildReport(records, { range: '1d', includeCache: false }, now).totals.total, 100);
  assert.equal(buildReport(records, { range: 'custom', startDate: '2026-11-12', endDate: '2026-11-12' }, now).totals.requests, 0);
});

test('today retains the same counts in every preset across month, year, and daylight-saving boundaries', () => {
  for (const now of [new Date(2026, 10, 15, 12), new Date(2026, 10, 1, 12), new Date(2026, 2, 8, 12), new Date(2026, 0, 1, 12)]) {
    const records = parse([
      { ...receipt({ inputTokens: 100_000_000 }, 'earlier'), timestamp: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 10).toISOString() },
      { ...receipt({ inputTokens: 8000, outputTokens: 900 }, 'today'), timestamp: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10).toISOString() },
    ]).records;
    const today = buildReport(records, { range: '1d' }, now).daily[0];
    assert.equal(today.total, 8900);
    assert.equal(today.credits, .25);
    for (const range of ['7d', 'mtd', '30d', '90d']) {
      assert.deepEqual(buildReport(records, { range }, now).daily.at(-1), today, `${range} retains today's full usage`);
    }
  }
});

test('incomplete token records use the same known subtotal across every report view', () => {
  const records = parse([receipt({ cacheReadTokens: undefined })]).records;
  const now = new Date(2026, 10, 13, 12);
  const r = buildReport(records, { range: '1d', includeCache: false }, now);
  assert.equal(r.totals.total, 20);
  assert.equal(r.totals.missingTokens, 1);
  assert.equal(r.totals.missing.input, 1);
  assert.equal(r.totals.missing.output, 0);
  assert.equal(r.daily[0].total, r.rhythm.reduce((sum, n) => sum + n, 0));
  assert.equal(r.models[0].total, 20);
  const missingOutput = buildReport(parse([receipt({ outputTokens: undefined })]).records, { range: '1d' }, now);
  assert.equal(missingOutput.totals.total, 100);
  assert.equal(missingOutput.totals.missing.output, 1);
  assert.equal(missingOutput.rhythm.reduce((sum, n) => sum + n, 0), 100);
});
test('inclusive input shows missing coverage without counting cached tokens twice', () => {
  const now = new Date(2026, 10, 13, 12);
  const known = parse([receipt()]).records;
  const unknown = parse([receipt({ inputTokens: undefined }, 'unknown')]).records;
  const partial = buildReport([...known, ...unknown], { range: '1d' }, now).totals;
  assert.equal(partial.missing.inputTotal, 1);
  assert.equal(usageValue(partial, 'inputTotal'), '100 *');
  assert.equal(usageValue(buildReport(unknown, { range: '1d' }, now).totals, 'inputTotal'), 'Unavailable');
  assert.equal(usageValue(buildReport([], { range: '1d' }, now).totals, 'inputTotal'), '0');
  const complete = buildReport(known, { range: '1d' }, now).totals;
  assert.equal(complete.inputTotal, complete.input + complete.cacheRead + complete.cacheWrite);
  assert.equal(complete.total, complete.inputTotal + complete.output);
  const excluding = buildReport(known, { range: '1d', includeCache: false }, now).totals;
  assert.equal(excluding.total, complete.input + complete.output);
  assert.equal(excluding.inputTotal, complete.inputTotal);
});

test('reasoning stays within output and token averages use only complete requests', () => {
  const now = new Date(2026, 10, 13, 12);
  const records = parse([receipt(), receipt({ inputTokens: 200, outputTokens: 40, reasoningTokens: 10 }, 'second'),
    receipt({ outputTokens: undefined, reasoningTokens: undefined }, 'partial')]).records;
  const r = buildReport(records, { range: '1d' }, now);
  assert.equal(r.totals.reasoning, 15);
  assert.equal(r.totals.missing.reasoning, 1);
  assert.equal(r.totals.total, 460, 'reasoning is not added to total tokens again');
  assert.equal(r.totals.averageTokens, 180);
  assert.equal(r.totals.completeTokenRequests, 2);
  assert.equal(usageValue(r.totals, 'reasoning'), '15 *');
  assert.equal(usageValue(r.totals, 'averageTokens'), '180 *');
  assert.equal(r.models[0].averageTokens, 180);
  assert.equal(r.projects[0].reasoning, 15);
  assert.equal(r.sessions[0].averageTokens, 180);
  const noCache = buildReport(records, { range: '1d', includeCache: false }, now);
  assert.equal(noCache.totals.averageTokens, 110);
  assert.equal(noCache.totals.reasoning, 15);
  const missing = buildReport(parse([receipt({ cacheReadTokens: undefined, reasoningTokens: undefined })]).records, { range: '1d', includeCache: false }, now).totals;
  assert.equal(missing.averageTokens, null);
  assert.equal(usageValue(missing, 'averageTokens'), 'Unavailable');
  assert.equal(usageValue(missing, 'reasoning'), 'Unavailable');
  const zero = buildReport(parse([receipt({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })]).records, { range: '1d' }, now).totals;
  assert.equal(zero.averageTokens, 0);
  assert.equal(usageValue(zero, 'reasoning'), '0');
  assert.equal(buildReport([], { range: '1d' }, now).totals.averageTokens, null);
});

test('credit rates use complete charges and matched tokens instead of incomplete report totals', () => {
  const now = new Date(2026, 10, 13, 12);
  const records = parse([receipt(), receipt({ inputTokens: 880, outputTokens: 0, copilotUsage: { totalNanoAiu: 750000000 } }, 'large'),
    receipt({ aiCreditsStatus: 'partial', copilotUsage: { totalNanoAiu: 100000000000 } }, 'partial'),
    receipt({ copilotUsage: undefined, aiCreditsStatus: undefined }, 'unknown'),
    receipt({ outputTokens: undefined, copilotUsage: { totalNanoAiu: 500000000 } }, 'missing-output')]).records;
  const report = buildReport(records, { range: '1d' }, now), t = report.totals;
  assert.equal(t.requests, 5);
  assert.equal(t.completeCreditRequests, 3);
  assert.equal(t.averageCredits, 0.5);
  assert.equal(t.averageCredits, report.efficiency.summary.averageCredits);
  assert.equal(t.creditTokenRequests, 2);
  assert.equal(t.creditsPerMillionTokens, 1000, 'ratio of summed charges to summed tokens, not an average of individual ratios');
  assert.doesNotThrow(() => JSON.stringify(report), 'internal BigInt accumulators stay out of the report');
  const noCache = buildReport(records, { range: '1d', includeCache: false }, now).totals;
  assert.equal(noCache.averageCredits, 0.5);
  assert.equal(noCache.creditsPerMillionTokens, 1 / 860 * 1e6);
});

test('credit rates distinguish zero charges, zero tokens, missing data, and unknown cache splits', () => {
  const now = new Date(2026, 10, 13, 12);
  const totals = (events, query = {}) => buildReport(parse(events).records, { range: '1d', ...query }, now).totals;
  const free = totals([receipt({ copilotUsage: { totalNanoAiu: 0 } })]);
  assert.equal(free.averageCredits, 0);
  assert.equal(free.creditsPerMillionTokens, 0);
  const noTokens = receipt({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 'zero-tokens');
  assert.equal(totals([noTokens]).averageCredits, 0.25);
  assert.equal(totals([noTokens]).creditsPerMillionTokens, null);
  assert.equal(totals([noTokens, receipt()]).creditsPerMillionTokens, 0.5 / 120 * 1e6, 'charged zero-token requests remain in the numerator');
  for (const events of [[], [receipt({ aiCreditsStatus: 'partial' })], [receipt({ copilotUsage: undefined })]]) {
    const t = totals(events);
    assert.equal(t.averageCredits, null);
    assert.equal(t.creditsPerMillionTokens, null);
  }
  const unknownCache = [receipt({ cacheReadTokens: undefined })];
  assert.equal(totals(unknownCache).creditsPerMillionTokens, 0.25 / 120 * 1e6);
  assert.equal(totals(unknownCache, { includeCache: false }).creditsPerMillionTokens, null);
  assert.equal(totals(unknownCache, { includeCache: false }).averageCredits, 0.25);
});

test('credit rates follow date, model, project, and session filters', () => {
  const now = new Date(2026, 10, 13, 12);
  const records = parse([receipt(), receipt({ model: 'second', inputTokens: 3000, outputTokens: 0, copilotUsage: { totalNanoAiu: 1500000000 } }, 'second'),
    receipt({ model: 'second', inputTokens: 8000, outputTokens: 0, copilotUsage: { totalNanoAiu: 500000000 } }, 'past')]).records;
  records[0].project = 'A';
  Object.assign(records[1], { project: 'B', sessionId: 's2' });
  Object.assign(records[2], { project: 'A', sessionId: 's3', ms: new Date(2026, 10, 12, 10).getTime() });
  for (const [query, selected] of [[{ range: '1d' }, [0, 1]], [{ range: '7d' }, [0, 1, 2]],
    [{ range: '7d', models: ['second'] }, [1, 2]], [{ range: '7d', project: 'A' }, [0, 2]],
    [{ range: '7d', session: 's2' }, [1]], [{ range: 'custom', startDate: '2026-11-12', endDate: '2026-11-12' }, [2]]]) {
    const t = buildReport(records, query, now).totals;
    const charges = selected.reduce((sum, i) => sum + records[i].nanoAiu, 0) / 1e9;
    const tokens = selected.reduce((sum, i) => sum + records[i].inputTotal + records[i].output, 0);
    assert.equal(t.averageCredits, charges / selected.length, JSON.stringify(query));
    assert.equal(t.creditsPerMillionTokens, charges / tokens * 1e6, JSON.stringify(query));
    assert.equal(t.creditTokenRequests, selected.length);
  }
});

test('project session totals stay scoped to their project and follow every usage filter', () => {
  const now = new Date(2026, 10, 13, 12);
  const base = parse([receipt(), receipt({ inputTokens: 200, outputTokens: 40 }, 'second'),
    receipt({ model: 'second', outputTokens: undefined, copilotUsage: undefined }, 'partial')]).records;
  const records = base.map((r, i) => ({ ...r, project: i === 1 ? 'B' : 'A', sessionId: i === 2 ? 'other' : 'shared', sessionName: i === 2 ? 'Other session' : 'Shared session' }));
  records.push({ ...records[0], key: 'yesterday', ms: new Date(2026, 10, 12, 10).getTime() });
  for (const query of [{ range: '1d' }, { range: '7d', includeCache: false }, { range: '1d', models: ['second'] },
    { range: '1d', project: 'B' }, { range: '1d', session: 'shared' }]) {
    const report = buildReport(records, query, now);
    for (const project of report.projects) {
      const children = report.sessions.filter(s => s.project === project.name);
      assert.equal(children.length, project.sessions);
      for (const key of ['requests', 'total', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'missingCredits', 'missingTokens']) {
        assert.equal(children.reduce((sum, row) => sum + row[key], 0), project[key], `${project.name}: ${key}`);
      }
    }
  }
  const sessions = buildReport(records, { range: '1d' }, now).sessions;
  assert.equal(sessions.length, 3);
  const shared = sessions.filter(s => s.id === 'shared');
  assert.equal(shared.length, 2, 'a session spanning projects has separate accounting in each');
  assert.equal(shared.find(s => s.project === 'A').total, 120);
  assert.equal(shared.find(s => s.project === 'B').total, 240);
  assert.ok(shared.every(s => s.name === 'Shared session'));
  const missing = sessions.find(s => s.id === 'other');
  assert.equal(missing.averageTokens, null);
  assert.equal(missing.credits, null);
});

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-insights-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'session-state', 's1');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  return { home, file };
}

test('delivery and stops survive incremental refresh and copied journals without retaining prompt text', async t => {
  const one = await fixture(t), copy = await fixture(t);
  const f = reviewFixture({ sessionId: 's1' });
  f.user('first', { delivery: 'idle' }); f.call('first', 'first'); f.push('abort', { reason: 'user_initiated' });
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  await fs.writeFile(one.file, lines(f.events)); await fs.writeFile(copy.file, lines(f.events));
  const scanner = createScanner();
  const read = async force => {
    const scan = await scanner.scan([one.home, copy.home], { force });
    assert.doesNotMatch(JSON.stringify(scan.promptEvents), /PRIVATE PROMPT/);
    return buildReport(scan.records, { range: 'all' }, reviewNow, scan).efficiency.conversations.delivery;
  };
  const before = await read(false);
  assert.equal(before.idle, 1); assert.equal(before.userStops, 1);
  assert.deepEqual(await read(true), before);
  const index = f.events.length;
  f.user('second', { delivery: 'steering' }); f.call('second', 'second');
  await fs.appendFile(one.file, lines(f.events.slice(index)));
  const after = await read(false);
  assert.equal(after.idle, 1); assert.equal(after.steering, 1); assert.equal(after.userStops, 1);
  assert.deepEqual(await read(true), after);
});
test('scanner tails complete lines, handles truncation, deduplicates roots, and drops deleted logs', async t => {
  const { home, file } = await fixture(t);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt()));
  const scan = createScanner();
  assert.equal((await scan.scan([home, home])).records.length, 0);
  await fs.appendFile(file, '\n');
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.appendFile(file, JSON.stringify(receipt({}, 'u2')) + '\n');
  assert.equal((await scan.scan([home])).records.length, 2);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt({}, 'replacement')) + '\n');
  const replaced = await scan.scan([home], { force: true });
  assert.equal(replaced.records.length, 1);
  assert.match(replaced.records[0].key, /replacement/);
  await fs.unlink(file);
  assert.equal((await scan.scan([home])).records.length, 0);
});
test('scanner detects rewritten prefixes even when a growing log keeps the old suffix', async t => {
  const { home, file } = await fixture(t);
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  const finalMessage = { type: 'assistant.message', data: { content: 'private conversation content '.repeat(20) } };
  const scan = createScanner();
  await fs.writeFile(file, lines([start, receipt({}, 'old'), finalMessage]));
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.writeFile(file, lines([start, receipt({}, 'new'), finalMessage, receipt({}, 'add')]));
  const result = await scan.scan([home]);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.some(r => r.key.includes('new')));
  assert.ok(!result.records.some(r => r.key.includes('old')));
  assert.ok(!JSON.stringify(result).includes('private conversation content'));
});
function database(home) {
  const db = new DatabaseSync(path.join(home, 'session-store.db'));
  db.exec('CREATE TABLE sessions (id TEXT, cwd TEXT, repository TEXT); CREATE TABLE assistant_usage_events (id INTEGER, session_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_nano_aiu INTEGER, created_at TEXT)');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('s1', '/work/project', 'example/project');
  db.prepare('INSERT INTO assistant_usage_events VALUES (1, ?, ?, 100, 20, 60, 10, 250000000, ?)').run('s1', 'test-model', timestamp);
  db.close();
}
test('SQLite is fallback only; an excluded receipt never leaks back in through the fallback', async t => {
  const { home, file } = await fixture(t);
  database(home);
  const scan = createScanner();
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt()) + '\n');
  assert.equal((await scan.scan([home])).records.length, 1);
  await fs.writeFile(file, JSON.stringify(start) + '\n' + JSON.stringify(receipt({ isByok: true })) + '\n');
  assert.equal((await scan.scan([home], { force: true })).records.length, 0);
});
test('missing sources and unsupported SQLite schemas are visible', async t => {
  const { home } = await fixture(t);
  const db = new DatabaseSync(path.join(home, 'session-store.db')); db.exec('CREATE TABLE unrelated (id TEXT)'); db.close();
  const result = await createScanner().scan([home, path.join(home, 'missing')]);
  assert.ok(result.sources.some(s => /schema/i.test(s.message)));
  assert.ok(result.sources.some(s => s.state === 'missing'));
});
