import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { createCallFingerprint } from '../src/node/call-fingerprint.mjs';
import { createRepeatMemory, REPEAT_LIMITS } from '../src/core/efficiency-repetition.mjs';

const now = new Date(2026, 10, 13, 12);
const timestamp = new Date(2026, 10, 13, 10).toISOString();
const session = { type: 'session.start', data: { sessionId: 's1', context: { repository: 'project-one' } } };
const usage = (extra = {}) => ({ id: 'usage', type: 'session.usage_record', timestamp, data: { usage: {
  provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20, ...extra,
} } });
const start = (id, extra = {}) => ({ id: `start-${id}`, type: 'tool.execution_start', timestamp,
  data: { toolCallId: id, toolName: 'view', model: 'model-a', arguments: 'PRIVATE ARGS', ...extra } });
const end = (id, success = true) => ({ id: `end-${id}`, type: 'tool.execution_complete', timestamp,
  data: { toolCallId: id, success, result: { content: 'PRIVATE RESULT' }, error: { message: 'PRIVATE ERROR' } } });
const parse = events => {
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  [session, ...events].forEach(e => parser.push(JSON.stringify(e)));
  return parser.snapshot();
};
const report = (snapshot, input = {}) => buildReport(snapshot.records, { range: '1d', ...input }, now, snapshot);

test('tool metadata joins outcomes by call ID, deduplicates replay, and discards payloads', () => {
  const snapshot = parse([usage(), end('a', false), start('a'), start('a'), end('a', false),
    start('b'), end('b', true), start('c'), start('d'), end('d', 'false'), end('orphan'),
    { ...start('live'), ephemeral: true }, { ...start('invalid'), timestamp: 'invalid' },
    start('unnamed', { toolName: '' }), end('', true)]);
  assert.equal(snapshot.tools?.length, 4);
  assert.deepEqual(snapshot.tools.map(t => t.success), [false, true, null, null]);
  assert.equal(snapshot.invalidTools, 3);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  const r = report(snapshot).tools;
  assert.equal(r.calls, 4);
  assert.equal(r.rows.length, 1);
  assert.deepEqual([r.rows[0].calls, r.rows[0].successes, r.rows[0].failures, r.rows[0].unknown, r.rows[0].successRate], [4, 1, 1, 2, 50]);
  assert.equal(report(parse([usage(), start('pending')])).tools.rows[0].successRate, null);
});

test('tool reports use call dates and explicit models, distinguish MCP servers, and apply attribution', () => {
  const snapshot = parse([usage(), start('a'), end('a'), start('b', { model: 'model-b' }), end('b', false),
    start('no-model', { model: undefined }),
    start('mcp-one', { mcpServerName: 'one', mcpToolName: 'fetch' }),
    start('mcp-two', { mcpServerName: 'two', mcpToolName: 'fetch' }),
    { ...start('yesterday'), timestamp: new Date(2026, 10, 12, 10).toISOString() },
    { ...start('future'), timestamp: new Date(2026, 10, 13, 13).toISOString() },
    { type: 'session.context_changed', data: { repository: 'project-two' } }, start('other-project'),
    { ...end('other-project', false), timestamp: new Date(2026, 10, 13, 13).toISOString() }]);
  assert.equal(report(snapshot).tools?.calls, 6);
  assert.equal(report(snapshot).tools.rows.length, 3);
  assert.equal(report(snapshot, { range: 'all' }).tools.calls, 7);
  assert.equal(report(snapshot, { models: ['model-b'] }).tools.calls, 1);
  assert.equal(report(snapshot, { models: ['missing-model'] }).tools.calls, 0);
  const project = report(snapshot, { project: 'project-two' }).tools;
  assert.equal(project.calls, 1);
  assert.equal(project.rows[0].unknown, 1, 'future completion must not become a current failure');
  assert.equal(report(snapshot, { session: 'other-session' }).tools.calls, 0);
  assert.equal(report(parse([start('a')])).tools.omitted, 1);
  assert.equal(report(parse([usage({ isByok: true }), start('a')])).tools.calls, 0);
  assert.equal(report(parse([usage(), { ...usage({ provider: { kind: 'custom' } }), id: 'custom' }, start('a')])).tools.calls, 0);
});

test('tool model filters resolve request display labels to recorded IDs within the same session', () => {
  const snapshot = parse([usage({ model: 'model-id', modelDisplayName: 'Model One' }), start('a', { model: 'model-id' }), end('a'),
    { type: 'session.start', data: { sessionId: 's2', context: { repository: 'project-two' } } },
    { ...usage({ model: 'model-id', modelDisplayName: 'Model Two' }), id: 'second' }, start('b', { model: 'model-id' }), end('b', false)]);
  const one = report(snapshot, { models: ['Model One'] });
  assert.equal(one.totals.requests, 1);
  assert.equal(one.tools.calls, 1);
  assert.equal(one.tools.rows[0].successRate, 100);
  const two = report(snapshot, { models: ['Model Two'] });
  assert.equal(two.tools.calls, 1);
  assert.equal(two.tools.rows[0].successRate, 0);
  assert.equal(report(snapshot, { models: ['Model One', 'Model Two'] }).tools.calls, 2);
});

test('scanner retains new outcomes, deduplicates copies, and rebuilds tool history after deletion', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-tools-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homes = [path.join(root, 'a'), path.join(root, 'b')];
  const files = homes.map(home => path.join(home, 'session-state', 's1', 'events.jsonl'));
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  for (const file of files) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, lines([session, usage(), start('a')]));
  }
  const scanner = createScanner();
  assert.equal(report(await scanner.scan(homes)).tools?.calls, 1);
  await fs.appendFile(files[1], lines([end('a', false)]));
  assert.equal(report(await scanner.scan(homes)).tools.rows[0].failures, 1);
  assert.equal(report(await scanner.scan(homes, { force: true })).tools.calls, 1);
  await fs.unlink(files[1]);
  assert.equal(report(await scanner.scan(homes)).tools.rows[0].unknown, 1);
  await fs.writeFile(files[0], lines([session, usage(), start('b'), end('b')]));
  assert.equal(report(await scanner.scan(homes)).tools.rows[0].successRate, 100);
});

// Repeated calls: whether an identical call (same name and arguments) came earlier in the same
// conversation. The parser compares calls and keeps two numbers; these tests also check that
// nothing else about the arguments survives.
const at = minute => new Date(2026, 10, 13, 10, minute).toISOString();
const minuteOf = ms => ms === null ? null : (ms - Date.parse(at(0))) / 60_000;
const asks = (id, minute, args, extra = {}, envelope = {}) => ({ id: `start-${id}`, type: 'tool.execution_start', timestamp: at(minute),
  data: { toolCallId: id, toolName: 'view', model: 'model-a', arguments: args, ...extra }, ...envelope });
const SECRET_PATH = 'C:/Users/PRIVATE_OWNER/secret-plans/PRIVATE_FILE.md', SECRET_QUERY = 'PRIVATE_QUERY password=hunter2';
const SECRETS = /PRIVATE|hunter2|secret-plans/;
// Parses with a real keyed fingerprint and notes every fingerprint that was made.
function compare(events, options = {}) {
  const prints = [];
  const createFingerprint = () => { const print = createCallFingerprint(); return text => { const value = print(text); prints.push(value); return value; }; };
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture', ...options, createFingerprint });
  const lines = [session, ...events].map(e => JSON.stringify(e));
  for (const line of lines) parser.push(line);
  return { parser, lines, prints, snapshot: parser.snapshot() };
}
// [call, earlier identical calls, minute the latest of those started] for each tool event.
const repeats = snapshot => snapshot.tools.map(t => [JSON.parse(t.key)[2], t.repeat, minuteOf(t.repeatOfMs)]);
function strings(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { found.push(key); strings(item, found); }
  return found;
}
// Fails when argument text, a fingerprint, or anything shaped like a digest is present: a run
// of 16 or more hex characters, or of 20 or more base64 characters with a digit among them.
function assertNothingLeaked(value, prints, what, { paths = false } = {}) {
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, SECRETS, `${what} holds argument text`);
  for (const print of prints) assert.ok(!json.includes(print), `${what} holds a fingerprint`);
  // A temporary folder name looks like a digest, so a value that carries paths skips this part.
  if (!paths) for (const text of strings(value)) for (const [run] of text.matchAll(/[A-Za-z0-9+/_-]{16,}/g)) {
    assert.ok(!/^[0-9a-f]+$/i.test(run) && !(run.length >= 20 && /\d/.test(run)), `${what} holds a digest-like run: ${run}`);
  }
}
const lookup = { toolName: 'docs-lookup', mcpServerName: 'docs', mcpToolName: 'lookup' };
const history = [usage(),
  asks('a', 0, { path: SECRET_PATH }), asks('b', 3, { path: SECRET_PATH }), asks('c', 9, { path: SECRET_PATH }),
  // The same file with a line range, the same arguments to another tool, and another server are different calls.
  asks('d', 10, { path: SECRET_PATH, view_range: [1, 20] }), asks('e', 11, { path: SECRET_PATH }, { toolName: 'grep' }),
  asks('f', 12, { query: SECRET_QUERY }, lookup), asks('g', 13, { query: SECRET_QUERY }, { ...lookup, mcpServerName: 'other' }), asks('h', 14, { query: SECRET_QUERY }, lookup),
  // Arguments are compared as recorded, whatever their shape. Recorded empty arguments are comparable.
  asks('i', 15, SECRET_QUERY, { toolName: 'bash' }), asks('j', 16, SECRET_QUERY, { toolName: 'bash' }), asks('k', 17, {}), asks('l', 18, {})];
const counted = [['a', 0, null], ['b', 1, 0], ['c', 2, 3], ['d', 0, null], ['e', 0, null], ['f', 0, null], ['g', 0, null], ['h', 1, 12], ['i', 0, null], ['j', 1, 15], ['k', 0, null], ['l', 1, 17]];

test('the parser counts identical earlier calls in a conversation and when the latest one started', () => {
  for (const skipUnused of [false, true]) assert.deepEqual(repeats(compare(history, { skipUnused }).snapshot), counted);
  // A completion changes the outcome of a call and nothing about its count.
  const done = compare([...history, end('b', false)]).snapshot.tools[1];
  assert.deepEqual([done.success, done.repeat, minuteOf(done.repeatOfMs)], [false, 1, 0]);
  // Another conversation in the same journal starts its own count, and the first one keeps its own.
  const other = { type: 'session.start', data: { sessionId: 's2', context: { repository: 'project-one' } } };
  const next = compare([...history, other, asks('m', 20, { path: SECRET_PATH }), asks('n', 21, { path: SECRET_PATH }), session, asks('o', 22, { path: SECRET_PATH })]).snapshot;
  assert.deepEqual(repeats(next).slice(-3), [['m', 0, null], ['n', 1, 20], ['o', 3, 9]]);
  assert.deepEqual(next.tools.slice(-3).map(t => t.sessionId), ['s2', 's2', 's1']);
  // Without a fingerprint function nothing is compared, and nothing is reported as a first call.
  assert.ok(parse(history).tools.every(t => t.repeat === null && t.repeatOfMs === null));
  assert.equal(report(parse(history)).efficiency.repetition.measured, 0);
});

test('a replayed or reread journal never makes a call a repeat of itself', () => {
  const replayed = compare([history[0], history[1], history[2], history[2], history[1], history[3], history[1], history[3]]);
  assert.deepEqual(repeats(replayed.snapshot), counted.slice(0, 3));
  assert.equal(replayed.prints.length, 3, 'a replayed line is not fingerprinted again');
  // The same lines pushed again change nothing, and an earlier snapshot stays current.
  const first = compare(history), revision = first.parser.revision();
  for (const line of first.lines) first.parser.push(line);
  assert.equal(first.parser.revision(), revision);
  assert.deepEqual(first.parser.snapshot(), first.snapshot);
  // Another parser gives the same counts from different fingerprints.
  const second = compare(history);
  assert.deepEqual(repeats(second.snapshot), repeats(first.snapshot));
  assert.ok(first.prints.length === 12 && first.prints.every(print => !second.prints.includes(print)));
  // "Earlier" is the order the journal records calls in, even when a timestamp runs backwards.
  assert.deepEqual(repeats(compare([asks('late', 30, {}), asks('early', 20, {})]).snapshot), [['late', 0, null], ['early', 1, 30]]);
});

test('a call that was not compared is unknown, never a first call', () => {
  const blank = JSON.stringify(asks('edge', 30, { pad: '' })).length, pad = extra => ({ pad: 'p'.repeat(REPEAT_LIMITS.eventChars - blank + extra) });
  const big = { path: SECRET_PATH, file_text: 'PRIVATE_BODY '.repeat(400) };
  const events = [
    // A subagent has a context of its own. Its calls are not compared, and not remembered either.
    asks('sub-a', 0, { path: SECRET_PATH }, {}, { agentId: 'agent-1' }), asks('sub-b', 1, { path: SECRET_PATH }, { parentToolCallId: 'task-1' }),
    asks('main', 2, { path: SECRET_PATH }),
    asks('missing', 3, undefined), asks('null', 4, null),
    asks('big-a', 5, big), asks('big-b', 6, big),
    asks('edge', 30, pad(0)), asks('over', 31, pad(1)), asks('same', 32, pad(0))];
  const { snapshot, lines, prints } = compare(events);
  assert.deepEqual([lines.at(-3).length, lines.at(-2).length], [REPEAT_LIMITS.eventChars, REPEAT_LIMITS.eventChars + 1]);
  assert.deepEqual(repeats(snapshot), [['sub-a', null, null], ['sub-b', null, null], ['main', 0, null], ['missing', null, null], ['null', null, null],
    ['big-a', null, null], ['big-b', null, null], ['edge', 0, null], ['over', null, null], ['same', 1, 30]]);
  assert.equal(prints.length, 3, 'only compared calls are fingerprinted');
  assert.equal(snapshot.tools.length, 10, 'a call that is not compared is still a recorded call');
  assertNothingLeaked(snapshot, prints, 'the snapshot');
});

test('one parser compares a bounded number of calls and leaves the rest unknown', () => {
  assert.deepEqual({ ...REPEAT_LIMITS }, { eventChars: 4096, sessionCalls: 20000, journalCalls: 50000 });
  let made = 0;
  const parser = createReceiptParser({ sessionId: 'a', source: 'fixture', createFingerprint: () => { const print = createCallFingerprint(); return text => { made++; return print(text); }; } });
  const run = (sessionId, calls) => {
    parser.push(JSON.stringify({ type: 'session.start', data: { sessionId, context: { repository: 'project-one' } } }));
    for (let i = 0; i < calls; i++) parser.push(JSON.stringify(asks(`${sessionId}-${i}`, 0, { path: 'same' })));
  };
  const rest = REPEAT_LIMITS.journalCalls - 2 * REPEAT_LIMITS.sessionCalls;
  run('a', REPEAT_LIMITS.sessionCalls + 1); run('b', REPEAT_LIMITS.sessionCalls); run('c', rest + 1);
  const tools = parser.snapshot().tools, of = id => tools.filter(t => t.sessionId === id).map(t => t.repeat);
  assert.deepEqual(of('a').slice(-2), [REPEAT_LIMITS.sessionCalls - 1, null], 'past the limit for one conversation');
  assert.ok(of('b').every((repeat, index) => repeat === index));
  assert.deepEqual(of('c').slice(-2), [rest - 1, null], 'past the limit for one journal');
  assert.equal(made, REPEAT_LIMITS.journalCalls, 'no fingerprint is made past the limit');
  // The same rule on small numbers: three calls a conversation, five a journal.
  const memory = createRepeatMemory(value => value, { sessionCalls: 3, journalCalls: 5 }), seen = [];
  for (const id of ['x', 'x', 'x', 'x', 'y', 'y', 'y', 'z']) seen.push(memory.open(id) ? memory.note('same', 7).repeat : null);
  assert.deepEqual(seen, [0, 1, 2, null, 0, 1, null, null]);
});

test('no argument text and no fingerprint leaves the parser', () => {
  const { parser, snapshot, prints } = compare(history);
  assert.equal(prints.length, 12);
  assert.ok(prints.every(print => /^[A-Za-z0-9_-]{12}$/.test(print)));
  assert.deepEqual(Object.keys(parser), ['push', 'revision', 'snapshot'], 'what the parser remembers has no accessor');
  assert.deepEqual(Object.keys(snapshot.tools[1]), ['key', 'sessionId', 'ms', 'ts', 'name', 'project', 'model', 'server', 'mcpTool', 'skillName', 'success', 'completedMs', 'repeat', 'repeatOfMs']);
  assert.ok(snapshot.tools.every(t => (t.repeat === null || Number.isSafeInteger(t.repeat)) && (t.repeatOfMs === null || Number.isSafeInteger(t.repeatOfMs))));
  assertNothingLeaked(snapshot, prints, 'the snapshot');
  const built = report(snapshot);
  assert.deepEqual([built.efficiency.repetition.measured, built.efficiency.repetition.repeated], [12, 5]);
  assertNothingLeaked(built, prints, 'the report');
  // The key is random for each function, so a fingerprint cannot be matched against a guess.
  const one = createCallFingerprint(), two = createCallFingerprint(), guess = JSON.stringify(['view', '', '', { path: SECRET_PATH }]);
  assert.equal(one(guess), one(guess));
  assert.notEqual(one(guess), two(guess));
  for (const plain of [createHash('sha256').update(guess).digest('base64url'), createHmac('sha256', '').update(guess).digest('base64url')]) assert.ok(!plain.startsWith(one(guess)) && !prints.includes(plain.slice(0, 12)));
});

test('the modules that compare calls keep the key in memory and the parser free of Node built-ins', async () => {
  const read = file => fs.readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const fingerprint = await read('node/call-fingerprint.mjs');
  assert.deepEqual([...fingerprint.matchAll(/^import .*$/gm)].map(([line]) => line), ["import { createHmac, randomBytes } from 'node:crypto';"]);
  assert.match(fingerprint, /const key = randomBytes\(32\);/);
  assert.doesNotMatch(fingerprint.replace(/^\/\/.*$/gm, ''), /\bfs\b|writeFile|console|process\.|globalThis|export (?!function createCallFingerprint)|return key|\[key\]|\{ key/);
  for (const file of ['core/copilot.mjs', 'core/efficiency-repetition.mjs']) assert.doesNotMatch(await read(file), /from 'node:|require\(/, file);
  // The parser reads tool arguments in two places only: the skill name, and the comparison.
  assert.equal((await read('core/copilot.mjs')).match(/\.arguments/g).length, 3);
});

test('the scanner keeps repeat counts through appends, rereads and copies', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-repeats-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const text = events => events.map(e => JSON.stringify(e) + '\n').join('');
  const write = async (name, events) => {
    const file = path.join(root, name, 'session-state', 's1', 'events.jsonl');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text([session, usage(), ...events]));
    return file;
  };
  const [a, b, c] = [asks('a', 0, { path: SECRET_PATH }), asks('b', 3, { path: SECRET_PATH }), asks('c', 9, { path: SECRET_PATH })];
  const home = name => path.join(root, name), expected = [['a', 0, null], ['b', 1, 0], ['c', 2, 3]];
  // A journal that grows is continued by the parser that read its start, so the count carries on.
  const growing = await write('growing', [a, b]), scanner = createScanner();
  assert.deepEqual(repeats(await scanner.scan([home('growing')])), expected.slice(0, 2));
  await fs.appendFile(growing, text([c]));
  const grown = await scanner.scan([home('growing')]);
  assert.deepEqual(repeats(grown), expected);
  assert.deepEqual(repeats(await scanner.scan([home('growing')], { force: true })), expected);
  assert.equal(report(grown).efficiency.repetition.repeated, 2);
  assertNothingLeaked(grown, [], 'the scan', { paths: true });
  // An old journal is read without keeping its parser. When it changes it is read again from the start.
  const old = await write('old', [a, b]), before = new Date(Date.now() - 3 * 86_400_000), aged = createScanner();
  await fs.utimes(old, before, before);
  assert.deepEqual(repeats(await aged.scan([home('old')])), expected.slice(0, 2));
  await fs.appendFile(old, text([c]));
  assert.deepEqual(repeats(await aged.scan([home('old')])), expected);
  // A copy of a journal repeats its calls. They are the same calls, not repeats of one another.
  await write('copy', [a, b, c]);
  assert.deepEqual(repeats(await createScanner().scan([home('growing'), home('copy')])), expected);
  // A shorter copy read first: the counts stand from the copy that holds every call.
  await write('short', [a]);
  assert.deepEqual(repeats(await createScanner().scan([home('short'), home('copy')])), expected);
  // Two copies that each hold part of the conversation: neither saw every earlier call, so the
  // counts are unknown. A lone call in one of them must not read as a first call.
  await write('head', [a, b]);
  await write('tail', [c]);
  const split = await createScanner().scan([home('head'), home('tail')]);
  assert.deepEqual(repeats(split), [['a', null, null], ['b', null, null], ['c', null, null]]);
  assert.deepEqual([report(split).efficiency.repetition.calls, report(split).efficiency.repetition.measured], [3, 0]);
});
