// Heavy use: tens of thousands of requests, as someone working with Copilot all day builds up.
// The history is synthetic and its totals are counted by the generator, independently of the
// parser and report code, so these tests check the answers and retained memory.
//   USAGE_SCALE_RECORDS=100000 node --test tests/scale.test.mjs   runs a larger history.
// Measure timing separately: node --expose-gc scripts/benchmark-performance.mjs --scale --records=30000
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { writeSyntheticHome } from '../scripts/synthetic-history.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildSessionModels } from '../src/core/copilot-report.mjs';
import { startServer } from '../src/node/canvas-server.mjs';

const RECORDS = Number(process.env.USAGE_SCALE_RECORDS) || 30000;
const now = new Date(2026, 10, 15, 12);
const timeout = 600_000;
v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc');
const heapUsed = () => { collect(); collect(); return process.memoryUsage().heapUsed; };

let root, truth, active, originalJournal, scanner, first, firstHeap, baseHeap;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-scale-test-'));
  const written = await writeSyntheticHome(root, { seed: 11, records: RECORDS, days: 120, now, emptyDirs: 1500 });
  truth = written.truth;
  active = written.sessions.reduce((a, b) => b.lines > a.lines ? b : a);
  originalJournal = await fs.readFile(active.file, 'utf8');
  baseHeap = heapUsed();
  scanner = createScanner();
  first = await scanner.scan([root]);
  firstHeap = heapUsed();
}, { timeout });
after(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

const view = scan => ({ records: scan.records, skills: scan.skills, interactions: scan.interactions, tools: scan.tools, promptEvents: scan.promptEvents, skillExcludedSessions: scan.skillExcludedSessions, sources: scan.sources, coverage: scan.coverage });
const filters = scan => {
  const model = scan.records[0].model, project = scan.records[0].project, session = scan.records.at(-1).sessionId;
  return [{ range: 'all' }, { range: '7d' }, { range: '30d' }, { range: '90d', includeCache: false }, { range: 'all', models: [model] }, { range: 'all', project }, { range: 'all', session },
    { range: 'custom', startDate: '2026-09-01', endDate: '2026-10-15' }];
};

test('a long history reuses an unchanged scan', { timeout }, async () => {
  assert.ok(first.records.length > RECORDS * .9, `${first.records.length} requests were read`);
  assert.equal(await scanner.scan([root]), first, 'an unchanged history returns the very same result');
});

test('memory per recorded request stays bounded', { timeout }, () => {
  const perRequest = (firstHeap - baseHeap) / first.records.length;
  assert.ok(perRequest < 8000, `${Math.round(perRequest)} bytes are kept per request`);
});

test('a history built up from appends equals one read afresh, and matches the known totals', { timeout }, async context => {
  context.after(() => fs.writeFile(active.file, originalJournal));
  const lines = originalJournal.split('\n').filter(Boolean), held = lines.splice(-60);
  await fs.writeFile(active.file, lines.join('\n') + '\n');
  const scanner = createScanner(), first = await scanner.scan([root]);
  const before = new Set(first.records);
  await fs.appendFile(active.file, held.splice(0, 30).join('\n') + '\n');
  const appended = await scanner.scan([root]);
  assert.notEqual(appended, first);
  assert.ok(appended.records.length > first.records.length, 'the new requests are present');
  assert.equal(appended.records.filter(r => before.has(r)).length, first.records.length, 'no earlier request was read again');
  await fs.appendFile(active.file, held.join('\n') + '\n');
  const scan = await scanner.scan([root]), fresh = await createScanner().scan([root]);
  assert.deepEqual(view(scan), view(fresh));
  for (const filter of filters(scan)) assert.deepEqual(buildReport(scan.records, filter, now, scan), buildReport(fresh.records, filter, now, fresh), JSON.stringify(filter));
  const model = scan.records[0].model, project = scan.records[0].project, session = scan.records[0].sessionId;
  assert.deepEqual(buildModelSessionPage(scan.records, { range: 'all', model }, now, scan), buildModelSessionPage(fresh.records, { range: 'all', model }, now, fresh));
  assert.deepEqual(buildRequestPage(scan.records, { range: 'all', model, session }, now), buildRequestPage(fresh.records, { range: 'all', model, session }, now));
  assert.deepEqual(buildSessionModels(scan.records, { range: 'all', project, session }, now, scan), buildSessionModels(fresh.records, { range: 'all', project, session }, now, fresh));

  const report = buildReport(scan.records, { range: 'all' }, now, scan);
  const credits = nano => Number(nano) / 1e9, near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const wrong = [];
  const same = (name, actual, expected, equal = Object.is) => { if (!equal(actual, expected)) wrong.push(`${name}: ${actual} instead of ${expected}`); };
  const t = report.totals;
  same('requests read', scan.records.length, truth.records);
  for (const [name, expected] of Object.entries({ requests: truth.records, sessions: truth.sessions, inputTotal: truth.inputTotal, output: truth.output, cacheRead: truth.cacheRead, cacheWrite: truth.cacheWrite,
    reasoning: truth.reasoning, total: truth.total, missingCredits: truth.missingCredits, partialCredits: truth.partialCredits, missingCache: truth.missingCache, missingTokens: truth.missingTokens })) same(`total ${name}`, t[name], expected);
  same('total credits', t.credits, credits(truth.nano), near);
  same('custom-provider requests', scan.coverage.excluded, truth.excluded);
  same('unattributed requests', scan.coverage.unclassified, truth.unclassified);
  same('malformed lines', scan.coverage.invalid, truth.invalidLines);
  same('models', report.models.length, truth.byModel.size);
  for (const row of report.models) {
    const expected = truth.byModel.get(row.name);
    same(`${row.name} requests`, row.requests, expected?.requests); same(`${row.name} tokens`, row.total, expected?.total); same(`${row.name} credits`, row.credits, credits(expected?.nano ?? 0n), near);
  }
  same('projects', report.projects.length, truth.byProject.size);
  for (const row of report.projects) { const expected = truth.byProject.get(row.name); same(`${row.name} requests`, row.requests, expected?.requests); same(`${row.name} tokens`, row.total, expected?.total); }
  same('days with usage', report.daily.filter(day => day.requests).length, truth.byDay.size);
  for (const day of report.daily) if (day.requests) { const expected = truth.byDay.get(day.day); same(`${day.day} requests`, day.requests, expected?.requests); same(`${day.day} tokens`, day.total, expected?.total); }
  same('tool calls', report.tools.calls, truth.tools.calls);
  same('tool calls left out', report.tools.omitted, truth.tools.omitted);
  same('failed tool calls', report.tools.rows.reduce((n, row) => n + row.failures, 0), truth.tools.failures);
  same('MCP calls', report.mcp.calls, truth.tools.mcpCalls);
  same('skill uses', report.skills.invocations, truth.skills.invocations);
  same('skill uses left out', report.skills.omitted, truth.skills.omitted);
  const interactions = report.efficiency.interactions;
  same('prompts sent', interactions.prompts, truth.interactions.prompts);
  same('agent turns', interactions.turns, truth.interactions.turns);
  same('session errors', interactions.sessionErrors, truth.interactions.errors);
  const p = report.promptCredits, expected = truth.prompts;
  same('prompts', p.prompts, expected.prompts);
  same('prompts with complete costs', p.eligiblePrompts, expected.eligible);
  same('prompts with uncertain links', p.excluded.attribution, expected.attribution);
  same('prompts with incomplete charges', p.excluded.accounting, expected.accounting);
  same('unfinished prompts', p.excluded.unfinished, expected.unfinished);
  same('credits of complete prompts', p.credits, expected.eligible ? credits(expected.nano) : null, (a, b) => a === b || near(a, b));
  same('requests of complete prompts', p.work.requests, expected.requests);
  same('prompts with measured tokens', p.work.tokenPrompts, expected.tokenPrompts);
  same('tokens of complete prompts', p.work.tokens, expected.tokens);
  same('requests without a prompt', p.unlinkedRequests, 0);
  same('prompts counted by project', report.projects.reduce((n, row) => n + (row.userPrompts || 0), 0), expected.prompts - expected.attribution);
  assert.deepEqual(wrong, []);
});

test('the dashboard is told when nothing changed instead of being sent the report again', { timeout }, async t => {
  t.after(() => fs.writeFile(active.file, originalJournal));
  let clock = now;
  const server = await startServer({ html: '', defaultHome: root, scanner: createScanner(), now: () => clock, settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    readIntegrations: async () => ({ mcp: { available: false, rows: [] }, plugins: { available: false, rows: [] } }) });
  try {
    const call = async body => {
      for (let attempt = 0; attempt < 1000; attempt++) {
        const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), text = await response.text();
        assert.equal(response.status, 200, text.slice(0, 200));
        const result = JSON.parse(text);
        if (!result.loading) return { bytes: text.length, body: result };
        body = { ...body, method: 'usage.report', refresh: false };
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail('Synthetic history did not finish loading');
    };
    const input = { range: 'all' };
    const opened = await call({ method: 'usage.report', input });
    assert.equal(opened.body.totals.requests, truth.records);
    assert.equal(typeof opened.body.revision, 'string');
    clock = new Date(now.getTime() + 60_000);
    const quiet = await call({ method: 'usage.report', input, refresh: true, known: opened.body.revision });
    assert.deepEqual(Object.keys(quiet.body).sort(), ['generatedAt', 'revision', 'scanId', 'scannedAt', 'unchanged']);
    assert.equal(quiet.body.unchanged, true);
    assert.equal(quiet.body.generatedAt, clock.toISOString());
    assert.ok(quiet.bytes < 400, `an unchanged refresh sent ${quiet.bytes} bytes`);
    // The same request without a fingerprint, or with a stale one, still gets the whole report.
    const whole = await call({ method: 'usage.report', input, refresh: true });
    assert.equal(whole.body.revision, opened.body.revision);
    const { generatedAt: a, scannedAt: b, scanId: e, ...shown } = opened.body, { generatedAt: c, scannedAt: d, scanId: f, ...sent } = whole.body;
    assert.deepEqual(sent, shown);
    assert.equal((await call({ method: 'usage.report', input, refresh: true, known: 'stale' })).body.totals.requests, truth.records);
    // A different filter never matches the fingerprint of another.
    const week = await call({ method: 'usage.report', input: { range: '7d' }, known: opened.body.revision });
    assert.equal(week.body.unchanged, undefined);
    assert.notEqual(week.body.revision, opened.body.revision);
    // New activity changes the fingerprint, and the full report arrives.
    const journal = path.join(root, 'session-state', path.basename(path.dirname(active.file)), 'events.jsonl');
    const last = (await fs.readFile(journal, 'utf8')).split('\n').filter(line => line.includes('"session.usage_record"')).at(-1), extra = JSON.parse(last);
    extra.id += '-later'; extra.data.usage.accounting.usageId += '-later'; extra.data.usage.apiCallId += '-later';
    await fs.appendFile(journal, JSON.stringify(extra) + '\n');
    clock = new Date(now.getTime() + 120_000);
    const busy = await call({ method: 'usage.report', input, refresh: true, known: opened.body.revision });
    assert.equal(busy.body.unchanged, undefined);
    assert.equal(busy.body.totals.requests, truth.records + 1);
    assert.notEqual(busy.body.revision, opened.body.revision);
  } finally { await server.close(); }
});
