// Heavy use: tens of thousands of requests, as someone working with Copilot all day builds up.
// The history is synthetic and its totals are counted by the generator, independently of the
// parser and report code, so these tests check the answers as well as the cost.
//   USAGE_SCALE_RECORDS=100000 node --test tests/scale.test.mjs   runs a larger history.
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
const time = async fn => { const started = performance.now(); const value = await fn(); return { ms: performance.now() - started, value }; };
v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc');
const heapUsed = () => { collect(); collect(); return process.memoryUsage().heapUsed; };

let root, truth, active, held, scanner, first, firstMs, firstHeap, baseHeap;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-scale-test-'));
  const written = await writeSyntheticHome(root, { seed: 11, records: RECORDS, days: 120, now, emptyDirs: 1500 });
  truth = written.truth;
  // The busiest journal starts short of its last lines, which arrive later as live activity.
  active = written.sessions.reduce((a, b) => b.lines > a.lines ? b : a);
  const lines = (await fs.readFile(active.file, 'utf8')).split('\n').filter(Boolean);
  held = lines.splice(-60);
  await fs.writeFile(active.file, lines.join('\n') + '\n');
  baseHeap = heapUsed();
  scanner = createScanner();
  ({ ms: firstMs, value: first } = await time(() => scanner.scan([root])));
  firstHeap = heapUsed();
}, { timeout });
after(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

const view = scan => ({ records: scan.records, skills: scan.skills, interactions: scan.interactions, tools: scan.tools, promptEvents: scan.promptEvents, skillExcludedSessions: scan.skillExcludedSessions, sources: scan.sources, coverage: scan.coverage });
const filters = scan => {
  const model = scan.records[0].model, project = scan.records[0].project, session = scan.records.at(-1).sessionId;
  return [{ range: 'all' }, { range: '7d' }, { range: '30d' }, { range: '90d', includeCache: false }, { range: 'all', models: [model] }, { range: 'all', project }, { range: 'all', session },
    { range: 'custom', startDate: '2026-09-01', endDate: '2026-10-15' }];
};

test('a long history is read once: later scans reuse it and stay cheap', { timeout }, async () => {
  assert.ok(first.records.length > RECORDS * .9, `${first.records.length} requests were read`);
  const again = await time(() => scanner.scan([root]));
  assert.equal(again.value, first, 'an unchanged history returns the very same result');
  const third = await time(() => scanner.scan([root]));
  const rescan = Math.min(again.ms, third.ms);
  assert.ok(rescan < firstMs * .35, `rescanning an unchanged history took ${rescan.toFixed(0)} ms against ${firstMs.toFixed(0)} ms for the first read`);
});

test('memory per recorded request stays bounded', { timeout }, () => {
  const perRequest = (firstHeap - baseHeap) / first.records.length;
  assert.ok(perRequest < 8000, `${Math.round(perRequest)} bytes are kept per request`);
});

test('reports for every range come from one pass and stay quick at this size', { timeout }, () => {
  const opening = performance.now();
  buildReport(first.records, { range: 'all' }, now, first);
  const openingMs = performance.now() - opening;
  for (const filter of filters(first)) {
    const started = performance.now(), report = buildReport(first.records, filter, now, first), ms = performance.now() - started;
    assert.ok(report.totals.requests >= 0);
    // Generous for a slow machine, yet far below what rebuilding prompt links for each report costs.
    assert.ok(ms < 2000, `${JSON.stringify(filter)} took ${ms.toFixed(0)} ms`);
  }
  assert.ok(openingMs < 15000, `the first report took ${openingMs.toFixed(0)} ms`);
});

test('new activity in one session leaves every other session untouched', { timeout }, async () => {
  const before = new Set(first.records);
  await fs.appendFile(active.file, held.splice(0, 30).join('\n') + '\n');
  const appended = await time(() => scanner.scan([root]));
  assert.notEqual(appended.value, first);
  assert.ok(appended.value.records.length > first.records.length, 'the new requests are present');
  const kept = appended.value.records.filter(r => before.has(r)).length;
  assert.equal(kept, first.records.length, 'no earlier request was read again');
  assert.ok(appended.ms < firstMs * .5, `picking up new activity took ${appended.ms.toFixed(0)} ms against ${firstMs.toFixed(0)} ms for the first read`);
  await fs.appendFile(active.file, held.splice(0).join('\n') + '\n');
});

test('a history built up from appends equals one read afresh, and matches the known totals', { timeout }, async () => {
  const scan = await scanner.scan([root]), fresh = await createScanner().scan([root]);
  assert.deepEqual(view(scan), view(fresh));
  for (const filter of filters(scan)) assert.deepEqual(buildReport(scan.records, filter, now, scan), buildReport(fresh.records, filter, now, fresh), JSON.stringify(filter));
  const model = scan.records[0].model, project = scan.records[0].project, session = scan.records[0].sessionId;
  assert.deepEqual(buildModelSessionPage(scan.records, { range: 'all', model }, now, scan), buildModelSessionPage(fresh.records, { range: 'all', model }, now));
  assert.deepEqual(buildRequestPage(scan.records, { range: 'all', model, session }, now), buildRequestPage(fresh.records, { range: 'all', model, session }, now));
  assert.deepEqual(buildSessionModels(scan.records, { range: 'all', project, session }, now), buildSessionModels(fresh.records, { range: 'all', project, session }, now));

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

test('the dashboard is told when nothing changed instead of being sent the report again', { timeout }, async () => {
  let clock = now;
  const server = await startServer({ html: '', defaultHome: root, scanner: createScanner(), now: () => clock, settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    readIntegrations: async () => ({ mcp: { available: false, rows: [] }, plugins: { available: false, rows: [] } }) });
  try {
    const call = async body => {
      const started = performance.now();
      const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), text = await response.text();
      assert.equal(response.status, 200, text.slice(0, 200));
      return { ms: performance.now() - started, bytes: text.length, body: JSON.parse(text) };
    };
    const input = { range: 'all' };
    const opened = await call({ method: 'usage.report', input });
    assert.equal(opened.body.totals.requests, truth.records);
    assert.equal(typeof opened.body.revision, 'string');
    clock = new Date(now.getTime() + 60_000);
    const quiet = await call({ method: 'usage.report', input, refresh: true, known: opened.body.revision });
    assert.deepEqual(Object.keys(quiet.body).sort(), ['generatedAt', 'revision', 'scannedAt', 'unchanged']);
    assert.equal(quiet.body.unchanged, true);
    assert.equal(quiet.body.generatedAt, clock.toISOString());
    assert.ok(quiet.bytes < 400, `an unchanged refresh sent ${quiet.bytes} bytes`);
    assert.ok(quiet.ms < opened.ms * .5, `an unchanged refresh took ${quiet.ms.toFixed(0)} ms against ${opened.ms.toFixed(0)} ms to open`);
    // The same request without a fingerprint, or with a stale one, still gets the whole report.
    const whole = await call({ method: 'usage.report', input, refresh: true });
    assert.equal(whole.body.revision, opened.body.revision);
    const { generatedAt: a, scannedAt: b, ...shown } = opened.body, { generatedAt: c, scannedAt: d, ...sent } = whole.body;
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
