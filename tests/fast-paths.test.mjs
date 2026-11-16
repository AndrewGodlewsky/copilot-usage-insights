// The shortcuts that keep large histories fast must give the answers the plain route gives.
// Each test pins one of them with an input chosen so that taking the shortcut wrongly shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { dayOfMs, localDay } from '../src/core/query.mjs';
import { writeSyntheticHome } from '../scripts/synthetic-history.mjs';

const now = new Date(2026, 10, 13, 12);
const at = (hour, date = 13) => new Date(2026, 10, date, hour).toISOString();
const begin = (sessionId = 's1', repository = 'project-one') => ({ type: 'session.start', data: { sessionId, context: { repository } } });
const usage = (id, timestamp = at(10), extra = {}) => ({ id, type: 'session.usage_record', timestamp,
  data: { usage: { provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20, ...extra } } });
const toolStart = (call, timestamp = at(10)) => ({ id: `start-${call}`, type: 'tool.execution_start', timestamp, data: { toolCallId: call, toolName: 'view' } });
const toolEnd = (call, success, timestamp = at(10)) => ({ id: `end-${call}`, type: 'tool.execution_complete', timestamp, data: { toolCallId: call, success } });
const skill = (id, timestamp = at(10)) => ({ id, type: 'skill.invoked', timestamp, data: { name: 'lint', trigger: 'user-invoked' } });
const prompt = (id, timestamp = at(10)) => ({ id, type: 'user.message', timestamp, data: { interactionId: id, messageId: `${id}-prompt`, source: 'user', content: 'PRIVATE' } });
const lines = events => events.map(e => (typeof e === 'string' ? e : JSON.stringify(e)) + '\n').join('');
const parse = (events, sessionId = 's1') => {
  const parser = createReceiptParser({ sessionId, source: 'fixture' });
  for (const e of events) parser.push(JSON.stringify(e));
  return parser.snapshot();
};
const report = (history, at = now, query = { range: 'all' }) => buildReport(history.records, query, at, history);
// Copilot homes on disk: { homeName: { sessionId: [events] } }.
async function homes(t, layout) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-fast-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = (home, session) => path.join(root, home, 'session-state', session, 'events.jsonl');
  const write = async (home, session, events) => { await fs.mkdir(path.dirname(file(home, session)), { recursive: true }); await fs.writeFile(file(home, session), lines(events)); };
  for (const [home, sessions] of Object.entries(layout)) for (const [session, events] of Object.entries(sessions)) await write(home, session, events);
  return { root, file, write, roots: Object.keys(layout).map(home => path.join(root, home)) };
}
const history = scan => ({ records: scan.records, skills: scan.skills, interactions: scan.interactions, promptEvents: scan.promptEvents, tools: scan.tools,
  skillExcludedSessions: scan.skillExcludedSessions, coverage: scan.coverage });

// Instants around every local midnight, each day visited once before its edges are asked for.
function sweep(dayOfMs, localDay, year) {
  const wrong = [], check = ms => { if (!Object.is(dayOfMs(ms), localDay(new Date(ms)))) wrong.push(ms); };
  for (let pass = 0; pass < 2; pass++) for (let d = 0; d < 800; d++) {
    const midnight = new Date(year, 0, 1 + d).getTime();
    if (!pass) { check(midnight + 43_200_000); continue; }
    for (const ms of [midnight - 3_600_001, midnight - 1, midnight, midnight + 1, midnight + 1_799_999, midnight + 3_600_000, midnight + 86_399_999]) check(ms);
  }
  for (const ms of [NaN, Infinity, -Infinity, 8.64e15, -8.64e15, 8.64e15 + 1]) check(ms);
  return wrong;
}

test('the day of an instant matches the calendar at every boundary and in other time zones', () => {
  assert.deepEqual(sweep(dayOfMs, localDay, 2025), []);
  // Where the platform honours TZ, repeat under half-hour offsets, daylight saving and a skipped day.
  const module = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/core/query.mjs')).href;
  const script = `import { dayOfMs, localDay } from ${JSON.stringify(module)};\nconst sweep = ${sweep};\nconst wrong = [2011, 2025].flatMap(year => sweep(dayOfMs, localDay, year));\nif (wrong.length) { console.error(wrong.slice(0, 5).join(' ')); process.exit(1); }`;
  for (const TZ of ['America/New_York', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'Pacific/Apia', 'UTC']) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(run.status, 0, `${TZ}: ${run.stderr}`);
  }
});

test('credit totals stay exact beyond the range plain numbers add exactly', () => {
  // One finished prompt per request, so the prompt and efficiency totals are held to it as well.
  let tick = Date.parse(at(9));
  const asked = (id, nano) => {
    const turn = { interactionId: id, turnId: '0' }, timestamp = new Date(tick += 1000).toISOString();
    return [prompt(id, timestamp), { id: `${id}-turn`, type: 'assistant.turn_start', timestamp, data: turn },
      usage(`${id}-usage`, timestamp, { apiCallId: `${id}-api`, initiator: 'user', accounting: { sourceSessionId: 's1', usageId: `${id}-usage` }, copilotUsage: { totalNanoAiu: nano }, aiCreditsStatus: 'complete', cacheReadTokens: 0, cacheWriteTokens: 0 }),
      { id: `${id}-answer`, type: 'assistant.message', timestamp, data: { ...turn, apiCallId: `${id}-api`, phase: 'final_answer', toolRequests: [] } },
      { id: `${id}-done`, type: 'assistant.turn_end', timestamp, data: { turnId: '0' } }];
  };
  const big = Number.MAX_SAFE_INTEGER, events = [begin(), ...asked('a', big), ...asked('b', big)];
  // Added one at a time, 200 single units vanish from a running total this large.
  for (let i = 0; i < 200; i++) events.push(...asked(`unit-${i}`, 1));
  const r = report(parse(events)), exact = Number(2n * BigInt(big) + 200n) / 1e9;
  assert.notEqual(exact, Number(2n * BigInt(big)) / 1e9, 'the fixture distinguishes an exact total from a rounded one');
  for (const [name, bucket] of Object.entries({ totals: r.totals, today: r.today, model: r.models[0], project: r.projects[0], day: r.daily.at(-1), session: r.sessions[0],
    prompts: r.promptCredits, efficiency: r.efficiency.summary })) {
    assert.equal(bucket.credits, exact, name);
  }
  assert.equal(r.promptCredits.eligiblePrompts, 202);
  assert.equal(r.totals.averageCredits, exact / 202);
});

test('a streak counts the days before the calendar that is drawn', () => {
  const events = [begin()];
  for (let d = 0; d < 200; d++) events.push(usage(`day-${d}`, new Date(2026, 10, 13 - d, 9).toISOString()));
  const r = report(parse(events));
  assert.equal(r.calendar.length, 182);
  assert.equal(r.streak.current, 200);
  // A gap inside the older part still ends it.
  events.splice(191, 1);
  assert.equal(report(parse(events)).streak.current, 190);
});

test('activity of a session whose only usage is dated later is not attributed until it is due', () => {
  const s = parse([begin(), skill('skill-1', at(9)), toolStart('call-1', at(9)), prompt('ask-1', at(9)), usage('late', at(18))]);
  const early = report(s);
  assert.deepEqual([early.totals.requests, early.skills.invocations, early.tools.calls, early.efficiency.interactions.prompts], [0, 1, 0, 0]);
  assert.equal(early.skills.unattributedUses, 1, 'saved skill activity is visible without using a future receipt as provider evidence');
  const due = report(s, new Date(2026, 10, 13, 20));
  assert.deepEqual([due.totals.requests, due.skills.invocations, due.tools.calls, due.efficiency.interactions.prompts], [1, 1, 1, 1]);
  assert.equal(due.skills.unattributedUses, 0);
});

test('a call started in one journal and finished only in a copy of it reports that outcome', async t => {
  const h = await homes(t, { a: { s1: [begin(), usage('u1'), toolStart('call-1'), toolStart('call-2')] },
    b: { s1: [begin('s1', 'project-two'), toolEnd('call-1', false, at(11)), toolStart('call-2'), toolEnd('call-2', true, at(11))] } });
  const scanner = createScanner(), scan = await scanner.scan(h.roots);
  assert.equal(scan.tools.length, 2);
  assert.deepEqual([scan.tools[0].project, scan.tools[0].success, scan.tools[0].completedMs], ['project-one', false, Date.parse(at(11))]);
  // Of two whole copies of a call, the one that saw the latest completion is reported.
  assert.deepEqual([scan.tools[1].project, scan.tools[1].success], ['project-two', true]);
  const row = report(scan).tools.rows[0];
  assert.deepEqual([row.calls, row.failures, row.successes], [2, 1, 1]);
  // A later outcome in the first journal replaces it.
  await fs.appendFile(h.file('a', 's1'), lines([toolEnd('call-1', true, at(11.5))]));
  assert.equal(report(await scanner.scan(h.roots)).tools.rows[0].successes, 2);
});

test('journals with sessions of their own are joined in order and a copied session counts once', async t => {
  const one = [begin('s1'), prompt('p1'), usage('u1'), toolStart('c1'), skill('k1'), usage('u2'), toolEnd('c1', true)];
  const two = [begin('s2', 'project-two'), prompt('p2'), usage('u1'), usage('u3'), toolStart('c1'), skill('k1')];
  const three = [begin('s3'), usage('u1'), prompt('p3'), toolStart('c9'), toolEnd('c9', false)];
  // Home b repeats s1 from its second line on and adds to it; s3 exists only there.
  const copy = [...one.slice(1), usage('u4'), toolStart('c2'), skill('k2'), prompt('p4')];
  // The copy sits in a folder that is not named after the session it declares.
  // A third holds part of s1 again, without any usage of its own.
  const echo = [begin('s1'), prompt('p1'), toolStart('c1'), skill('k1')];
  const h = await homes(t, { a: { s1: one, s2: two }, b: { moved: [begin('s1'), ...copy], s3: three }, c: { echo } });
  const scan = await createScanner().scan(h.roots);
  // The plain route: every entry keyed, first copy kept, in the order the journals are read.
  const expected = { records: new Map(), skills: new Map(), interactions: new Map(), tools: new Map() };
  for (const [session, events] of [['s1', one], ['s2', two], ['moved', [begin('s1'), ...copy]], ['s3', three], ['echo', echo]]) {
    const snapshot = parse(events, session);
    for (const name of Object.keys(expected)) for (const item of snapshot[name]) if (!expected[name].has(item.key)) expected[name].set(item.key, item);
  }
  for (const name of Object.keys(expected)) assert.deepEqual(scan[name].map(item => item.key), [...expected[name].keys()], name);
  assert.deepEqual(scan.records.map(r => r.sessionId), ['s1', 's1', 's2', 's2', 's1', 's3']);
  assert.equal(new Set(scan.promptEvents.map(e => JSON.stringify(e))).size, scan.promptEvents.length, 'no prompt event is kept twice');
  assert.equal(scan.promptEvents.filter(e => e.sessionId === 's1').length, parse([begin('s1'), ...one.slice(1), ...copy], 's1').promptEvents.length);
  assert.deepEqual(scan.sources.map(source => source.records), [4, 2, 0]);
  const r = report(scan);
  assert.equal(r.totals.requests, 6);
  assert.deepEqual([r.tools.calls, r.skills.invocations], [4, 3]);
});

test('usage that only a copy of a session holds is titled from the copy\'s own home', async t => {
  // The first home ends on session s1 and the second begins with it.
  const h = await homes(t, { a: { s1: [begin(), usage('u1')] }, b: { s1: [begin(), usage('u1'), usage('u2')] } });
  for (const [home, title] of [['a', 'Title in the first home'], ['b', 'Title in the second home']]) {
    const db = new DatabaseSync(path.join(h.root, home, 'data.db'));
    try { db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT)'); db.prepare('INSERT INTO sessions VALUES (?, ?)').run('s1', title); } finally { db.close(); }
  }
  const scan = await createScanner().scan(h.roots);
  assert.deepEqual(scan.records.map(r => r.sessionName), ['Title in the first home', 'Title in the second home']);
});

test('a receipt filed under another session counts once when both journals hold it', async t => {
  const receipt = (id, source) => usage(id, at(10), { apiCallId: 'api-1', accounting: { sourceSessionId: source, usageId: 'shared-usage' }, copilotUsage: { totalNanoAiu: 2_000_000_000 } });
  const h = await homes(t, { a: { child: [begin('child'), receipt('in-child', 'child')], parent: [begin('parent'), usage('own'), receipt('in-parent', 'child')] } });
  const scan = await createScanner().scan(h.roots);
  assert.deepEqual(scan.records.map(r => r.sessionId).sort(), ['child', 'parent']);
  assert.equal(report(scan).totals.credits, 2);
});

test('prompt work is recomputed, not reused, for a session with later-dated entries', async t => {
  const receipt = (timestamp, input) => ({ id: 'receipt', type: 'session.usage_record', timestamp, data: { usage: { apiCallId: 'api-1', provider: { kind: 'copilot' }, model: 'model-a', initiator: 'user',
    accounting: { sourceSessionId: 's1', usageId: 'usage-1' }, copilotUsage: { totalNanoAiu: 5_000_000_000 }, aiCreditsStatus: 'complete', inputTokens: input, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } } });
  const turn = { interactionId: 'ask', turnId: '0' };
  const asked = [begin(), { ...prompt('ask', at(9)) }, { id: 'turn', type: 'assistant.turn_start', timestamp: at(9), data: turn }, receipt(at(9), 100),
    { id: 'answer', type: 'assistant.message', timestamp: at(9), data: { ...turn, apiCallId: 'api-1', phase: 'final_answer', toolRequests: [] } },
    { id: 'done', type: 'assistant.turn_end', timestamp: at(9), data: { turnId: '0' } }];
  // Home a holds a copy of the same receipt dated later; being first, it supplies the request.
  const h = await homes(t, { a: { s1: [begin(), receipt(at(18), 100)] }, b: { s1: asked } });
  const scanner = createScanner();
  assert.equal(report(await scanner.scan(h.roots)).promptCredits.work.tokens, 120);
  await h.write('a', 's1', [begin(), receipt(at(18), 300)]);
  const again = report(await scanner.scan(h.roots)), fresh = report(await createScanner().scan(h.roots));
  assert.equal(fresh.promptCredits.work.tokens, 320);
  assert.deepEqual(again.promptCredits, fresh.promptCredits);
});

test('a journal last written days ago is read again in full once it changes, and continued after that', async t => {
  const h = await homes(t, { a: { s1: [begin(), usage('u1'), usage('u2')] } });
  const journal = h.file('a', 's1'), old = new Date(Date.now() - 3 * 86_400_000);
  await fs.utimes(journal, old, old);
  const scanner = createScanner(), first = await scanner.scan(h.roots);
  assert.equal(first.records.length, 2);
  // Its earlier content is replaced while it grows: nothing read before may be kept.
  await h.write('a', 's1', [begin(), usage('u1', at(10), { inputTokens: 900 }), usage('u2'), usage('u3')]);
  const second = await scanner.scan(h.roots);
  assert.deepEqual(second.records.map(r => r.inputTotal), [900, 100, 100]);
  assert.deepEqual(history(second), history(await createScanner().scan(h.roots)));
  // Having changed once, it is continued from where it ended.
  await fs.appendFile(journal, lines([usage('u4')]));
  const third = await scanner.scan(h.roots);
  assert.equal(third.records.length, 4);
  assert.ok(second.records.every((r, i) => r === third.records[i]));
  // And a later rewrite is still noticed.
  await h.write('a', 's1', [begin(), usage('u1'), usage('u2'), usage('u3'), usage('u4'), usage('u5')]);
  const fourth = await scanner.scan(h.roots);
  assert.deepEqual(fourth.records.map(r => r.inputTotal), [100, 100, 100, 100, 100]);
  assert.deepEqual(history(fourth), history(await createScanner().scan(h.roots)));
});

test('only a change in what is reported produces a new result', async t => {
  const h = await homes(t, { a: { s1: [begin(), usage('u1'), toolStart('c1')], s2: [begin('s2'), usage('u1')] } });
  const scanner = createScanner(), first = await scanner.scan(h.roots);
  assert.equal(await scanner.scan(h.roots), first);
  // Lines that report nothing leave the result as it is.
  await fs.appendFile(h.file('a', 's1'), lines([{ id: 'h1', type: 'hook.start', timestamp: at(11), data: { hookType: 'x' } }, begin(), { type: 'session.info', timestamp: at(11), data: {} }]));
  assert.equal(await scanner.scan(h.roots), first);
  // A different list of sources is a different result over the same history.
  const wider = await scanner.scan([...h.roots, path.join(h.root, 'absent')]);
  assert.notEqual(wider, first);
  assert.deepEqual(wider.sources.map(source => source.state), ['ok', 'missing']);
  assert.ok(wider.records.every((r, i) => r === first.records[i]));
  const narrower = await scanner.scan(h.roots);
  assert.deepEqual(narrower.sources, first.sources);
  // A malformed line is reported, and what was read before is kept as it was.
  await fs.appendFile(h.file('a', 's1'), '{"type":"session.usage_record","data":{broken}\n');
  const flawed = await scanner.scan(h.roots);
  assert.equal(flawed.coverage.invalid, first.coverage.invalid + 1);
  assert.ok(flawed.records.every((r, i) => r === first.records[i]));
  assert.equal(flawed.tools[0], first.tools[0]);
  // New usage adds to it.
  await fs.appendFile(h.file('a', 's2'), lines([usage('u2')]));
  const grown = await scanner.scan(h.roots);
  assert.equal(grown.records.length, 3);
  assert.ok(first.records.every(r => grown.records.includes(r)));
  assert.deepEqual(history(grown), history(await createScanner().scan(h.roots)));
});

test('skipping event types nothing reads changes only the malformed-line count for those types', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-skip-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { sessions } = await writeSyntheticHome(root, { seed: 5, records: 600, days: 20, now, payload: 'realistic', delegation: .3, linkStyles: true });
  const plain = createScanner(), skipping = createScanner({ skipUnused: true });
  const [a, b] = [await plain.scan([root]), await skipping.scan([root])];
  assert.ok(a.records.length > 400 && a.tools.length && a.skills.length && a.promptEvents.length);
  assert.deepEqual(history(b), history(a));
  assert.deepEqual(report(b), report(a));
  // A damaged line of a type nothing reads is not noticed when it still looks complete;
  // damaged lines of every other kind are.
  await fs.appendFile(sessions[0].file, '{"type":"hook.start","data":{broken}\n{"type":"hook.start","data":{"cut off\n{"type":"session.usage_record","data":{broken}\n{"type":"session.shutdown","data":{}}\n');
  const [c, d] = [await plain.scan([root]), await skipping.scan([root])];
  assert.equal(c.coverage.invalid, a.coverage.invalid + 3);
  assert.equal(d.coverage.invalid, a.coverage.invalid + 2);
  assert.deepEqual({ ...history(d), coverage: null }, { ...history(c), coverage: null });
});
