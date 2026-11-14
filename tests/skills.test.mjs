import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { startServer } from '../src/node/canvas-server.mjs';

const now = new Date(2026, 10, 13, 12);
const timestamp = new Date(2026, 10, 13, 10).toISOString();
const start = { type: 'session.start', data: { sessionId: 's1', context: { repository: 'project-one' } } };
const usage = (extra = {}, id = 'u1') => ({ id, type: 'session.usage_record', timestamp, data: { usage: {
  provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20,
  cacheReadTokens: 50, cacheWriteTokens: 10, accounting: { usageId: id }, ...extra,
} } });
const skill = (id = 'k1', extra = {}) => ({ id, type: 'skill.invoked', timestamp, data: {
  name: 'code-review', pluginName: 'team-tools', pluginVersion: '1.2.3',
  content: 'PRIVATE SKILL BODY', arguments: 'PRIVATE ARGUMENTS', path: path.join(os.tmpdir(), 'skill-fixture', 'SKILL.md'), ...extra,
} });
const skillRef = (id = 'k1', extra = {}) => ({ ...skill(id, extra), type: 'skill.invoked_ref', data: {
  ...skill(id, extra).data, content: undefined, contentId: 'sha256:shared-body', contentLength: 87,
} });
const parse = events => {
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  [start, ...events].forEach(e => parser.push(JSON.stringify(e)));
  return parser.snapshot();
};
const report = (snapshot, input = {}) => buildReport(snapshot.records, { range: '1d', ...input }, now, snapshot);
const loadStart = (id, name = 'code-review', extra = {}) => ({ id: id + '-start', type: 'tool.execution_start', timestamp,
  data: { toolCallId: id, toolName: 'skill', arguments: { skill: name, prompt: 'PRIVATE ARGUMENT' }, ...extra } });
const loadEnd = (id, success = false) => ({ id: id + '-end', type: 'tool.execution_complete', timestamp,
  data: { toolCallId: id, success, result: { content: 'PRIVATE RESULT' }, error: { message: 'PRIVATE ERROR' } } });

test('skill load failures count explicit paired outcomes once without changing uses or retaining payloads', () => {
  const events = [usage(), skill('manual', { trigger: 'user-invoked' }), loadStart('failed'), loadEnd('failed'),
    loadStart('failed'), loadEnd('failed'), loadStart('success'), loadEnd('success', true),
    loadStart('pending'), loadStart('unknown'), loadEnd('unknown', 'false'), loadEnd('orphan'),
    loadStart('other-tool', 'code-review', { toolName: 'read_file' }), loadEnd('other-tool'),
    loadStart('mcp-skill', 'code-review', { mcpServerName: 'external' }), loadEnd('mcp-skill'),
    { ...loadStart('live'), ephemeral: true }, loadEnd('live'), loadStart('live-end'), { ...loadEnd('live-end'), ephemeral: true }];
  for (const ordered of [events, [...events].reverse()]) {
    const snapshot = parse(ordered), result = report(snapshot).skills, row = result.rows[0];
    assert.equal(result.rows.length, 1);
    assert.equal(result.failures, 1);
    assert.equal(row.failures, 1);
    assert.equal(row.invocations, 1);
    assert.deepEqual(row.triggers, { manual: 1, agent: 0, preloaded: 0, unknown: 0 });
    assert.equal(row.path, skill().data.path);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  }
  assert.equal(report(parse([usage(), skill()])).skills.rows[0].failures, 0);
});

test('failed loads without activations remain identifiable with no invented paths, versions, or uses', () => {
  const result = report(parse([usage(), loadStart('missing', 'missing-skill'), loadEnd('missing'),
    loadStart('unnamed', ''), loadEnd('unnamed'), loadStart('successful', 'success-only'), loadEnd('successful', true)])).skills;
  assert.equal(result.failures, 2);
  assert.equal(result.invocations, 0);
  assert.equal(result.sessions, 1);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(r => r.name).sort(), ['Unknown skill', 'missing-skill']);
  for (const row of result.rows) {
    assert.equal(row.failures, 1);
    assert.equal(row.invocations, 0);
    assert.equal(row.sessions, 1);
    assert.equal(row.unresolved, true);
    assert.equal(row.path, ''); assert.equal(row.plugin, ''); assert.equal(row.version, '');
    assert.deepEqual(row.triggers, { manual: 0, agent: 0, preloaded: 0, unknown: 0 });
  }
});

test('a unique skill identity outside the date range can identify a failure without adding a use', () => {
  const snapshot = parse([usage(), { ...skill(), timestamp: new Date(2026, 10, 12, 10).toISOString() }, loadStart('today'), loadEnd('today')]);
  const row = report(snapshot).skills.rows[0];
  assert.equal(row.path, skill().data.path);
  assert.equal(row.unresolved, false);
  assert.equal(row.failures, 1);
  assert.equal(row.invocations, 0);
  assert.equal(row.lastUsed, timestamp);
  assert.equal(row.triggers.manual + row.triggers.agent + row.triggers.preloaded + row.triggers.unknown, 0);
});

test('name-only failure attribution preserves path, plugin and version identities across date filters', () => {
  for (const variant of [{ path: '/other/SKILL.md' }, { pluginName: 'other-plugin' }, { pluginVersion: '2.0.0' }]) {
    const snapshot = parse([usage(), { ...skill('earlier'), timestamp: new Date(2026, 10, 12, 10).toISOString() },
      skill('current', variant), loadStart('ambiguous'), loadEnd('ambiguous')]);
    for (const range of ['1d', 'all']) {
      const result = report(snapshot, { range }).skills;
      assert.equal(result.failures, 1);
      assert.equal(result.rows.filter(r => r.unresolved).length, 1);
      assert.equal(result.rows.find(r => r.unresolved).failures, 1);
      assert.ok(result.rows.filter(r => !r.unresolved).every(r => r.failures === 0));
    }
  }
});

test('failure name matching is exact and limited to the same session and project', () => {
  const snapshot = parse([usage(), skill('first'), loadStart('same-call'), loadEnd('same-call'),
    loadStart('case', 'Code-Review'), loadEnd('case'),
    { type: 'session.context_changed', data: { repository: 'project-two' } }, loadStart('new-project'), loadEnd('new-project'),
    { type: 'session.start', data: { sessionId: 's2', context: { repository: 'project-one' } } },
    usage({}, 'second-session'), skill('second', { path: '/second/SKILL.md' }), loadStart('same-call'), loadEnd('same-call')]);
  const result = report(snapshot).skills;
  assert.equal(result.failures, 4);
  assert.equal(result.rows.find(r => r.path === skill().data.path).failures, 1);
  assert.equal(result.rows.find(r => r.path === '/second/SKILL.md').failures, 1);
  assert.equal(result.rows.find(r => r.name === 'Code-Review').unresolved, true);
  assert.equal(report(snapshot, { project: 'project-two' }).skills.rows[0].unresolved, true);
  assert.equal(report(snapshot, { session: 's2' }).skills.failures, 1);
});

test('skill failures follow attempt dates, project/session and provider rules, but ignore model filters', () => {
  const yesterday = new Date(2026, 10, 12, 10).toISOString(), future = new Date(2026, 10, 13, 13).toISOString();
  const events = [usage(), skill(), loadStart('today'), loadEnd('today'),
    { ...loadStart('yesterday'), timestamp: yesterday }, loadEnd('yesterday'),
    { ...loadStart('future'), timestamp: future }, { ...loadEnd('future'), timestamp: future },
    loadStart('future-end'), { ...loadEnd('future-end'), timestamp: future },
    loadStart('invalid-order'), { ...loadEnd('invalid-order'), timestamp: yesterday },
    { type: 'session.context_changed', data: { repository: 'project-two' } }, loadStart('other-project'), loadEnd('other-project')];
  const snapshot = parse(events);
  assert.equal(report(snapshot).skills.failures, 2);
  assert.equal(report(snapshot, { range: 'all' }).skills.failures, 3);
  assert.equal(report(snapshot, { range: 'custom', startDate: '2026-11-12', endDate: '2026-11-12' }).skills.failures, 1);
  assert.equal(report(snapshot, { project: 'project-two' }).skills.failures, 1);
  assert.equal(report(snapshot, { session: 'missing' }).skills.failures, 0);
  assert.equal(report(snapshot, { models: ['missing'], includeCache: false }).skills.failures, 2);
  for (const accounting of [[], [usage({ isByok: true })], [usage(), usage({ provider: { kind: 'custom' } }, 'mixed')],
    [usage(), usage({ provider: undefined }, 'unknown')], [{ ...usage(), timestamp: future }]]) {
    const result = report(parse([...accounting, loadStart('failure'), loadEnd('failure')])).skills;
    assert.equal(result.failures, 0);
    assert.equal(result.omittedFailures, 1);
    assert.equal(result.rows.length, 0);
  }
});

test('scanner joins and deduplicates failed skill calls across copies, refreshes, tails and deletions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-skill-failures-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homes = ['a', 'b'].map(name => path.join(root, name));
  const files = homes.map(home => path.join(home, 'session-state', 's1', 'events.jsonl'));
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  for (const file of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, lines([start, usage(), skill(), loadStart('load')])); }
  const scanner = createScanner(), scan = async force => report(await scanner.scan(homes, { force })).skills;
  assert.equal((await scan()).failures, 0);
  await fs.appendFile(files[1], JSON.stringify(loadEnd('load')));
  assert.equal((await scan()).failures, 0, 'partial lines are not counted');
  await fs.appendFile(files[1], '\n');
  assert.equal((await scan()).failures, 1);
  await fs.appendFile(files[0], lines([loadEnd('load'), loadStart('load'), loadEnd('load')]));
  assert.equal((await scan()).failures, 1);
  assert.equal((await scan(true)).failures, 1);
  // The two copies can hold different portions of the same session journal.
  await fs.writeFile(files[0], lines([start, usage(), skill(), loadStart('load')]));
  await fs.writeFile(files[1], lines([start, loadEnd('load')]));
  assert.equal((await scan(true)).failures, 1);
  await fs.unlink(files[1]);
  assert.equal((await scan()).failures, 0);
  await fs.writeFile(files[0], lines([start, usage(), loadStart('new', 'missing'), loadEnd('new')]));
  const result = await scan();
  assert.equal(result.failures, 1); assert.equal(result.rows[0].name, 'missing');
});

for (const event of [skill, skillRef]) test(`${event().type} parser deduplicates persisted activations and retains only metadata`, () => {
  const snapshot = parse([usage(), event(), event(), { ...event('live'), ephemeral: true },
    event('', {}), event('empty', { name: '  ' }), { ...event('bad-time'), timestamp: 'bad' }]);
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.skills[0].name, 'code-review');
  assert.equal(snapshot.skills[0].project, 'project-one');
  assert.equal(snapshot.skills[0].path, skill().data.path);
  assert.equal(snapshot.invalidSkills, 3);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
});

test('reference activations count separately even with the same content, while full/ref replays count once', () => {
  const events = [usage(), skill('full', { trigger: 'user-invoked' }), skillRef('full', { trigger: 'user-invoked' }),
    skillRef('repeat-one', { trigger: 'user-invoked' }), skillRef('repeat-two', { trigger: 'agent-invoked' }),
    skillRef('repeat-one', { trigger: 'user-invoked' })];
  for (const ordered of [events, [...events].reverse()]) {
    const snapshot = parse(ordered);
    const row = report(snapshot).skills.rows[0];
    assert.equal(row.invocations, 3);
    assert.deepEqual(row.triggers, { manual: 2, agent: 1, preloaded: 0, unknown: 0 });
    assert.equal(row.plugin, 'team-tools');
    assert.equal(row.version, '1.2.3');
    assert.equal(row.path, skill().data.path);
    assert.ok(!JSON.stringify(snapshot).includes('shared-body'));
  }
});

test('skills from different paths stay separate and row IDs survive date filters', () => {
  const other = path.join(os.tmpdir(), 'other-skill-fixture', 'SKILL.md');
  const snapshot = parse([usage(), skill(), skill('k2', { path: other }), skill('k3', { path: undefined }),
    { ...skill('yesterday'), timestamp: new Date(2026, 10, 12, 10).toISOString() }]);
  const r = report(snapshot);
  assert.equal(r.skills.rows.length, 3);
  assert.equal(new Set(r.skills.rows.map(s => s.id)).size, 3);
  assert.ok(r.skills.rows.some(s => s.path === other));
  assert.ok(r.skills.rows.some(s => s.path === ''));
  assert.deepEqual(r.skills.rows.map(s => s.id).sort(), report(snapshot, { range: 'all' }).skills.rows.map(s => s.id).sort());
});

test('skill triggers count manual, agent, preloaded, and unknown activations without splitting rows', () => {
  const snapshot = parse([usage(), skill('manual', { trigger: 'user-invoked' }),
    skill('manual', { trigger: 'user-invoked' }), skill('agent', { trigger: 'agent-invoked' }),
    skill('preloaded', { trigger: 'context-load' }), skill('legacy'),
    skill('future-kind', { trigger: 'future-trigger' }), skill('invalid-kind', { trigger: {} }),
    { ...skill('yesterday', { trigger: 'agent-invoked' }), timestamp: new Date(2026, 10, 12, 10).toISOString() },
    { type: 'session.context_changed', data: { repository: 'project-two' } }, skill('other', { trigger: 'user-invoked' })]);
  assert.equal(snapshot.skills.find(s => s.key.includes('manual')).trigger, 'user-invoked');
  assert.equal(snapshot.skills.find(s => s.key.includes('future-kind')).trigger, 'unknown');
  const rows = report(snapshot).skills.rows;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].triggers, { manual: 2, agent: 1, preloaded: 1, unknown: 3 });
  assert.equal(Object.values(rows[0].triggers).reduce((a, b) => a + b, 0), rows[0].invocations);
  assert.equal(report(snapshot, { range: 'all' }).skills.rows[0].triggers.agent, 2);
  assert.deepEqual(report(snapshot, { project: 'project-two' }).skills.rows[0].triggers, { manual: 1, agent: 0, preloaded: 0, unknown: 0 });
  assert.equal(report(snapshot, { models: ['another-model'] }).skills.rows[0].triggers.manual, 2);
});

test('folder API opens only an attributed recorded row from enabled sources', async t => {
  let snapshot = parse([usage(), skill()]);
  const opened = [];
  const server = await startServer({ html: '', now: () => now, defaultHome: 'fixture',
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => ({ ...snapshot, sources: [], coverage: {} }) },
    openFolder: async file => opened.push(file),
  });
  t.after(() => server.close());
  const request = (input, origin) => fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ method: 'skills.openFolder', input }) });
  const id = report(snapshot).skills.rows[0].id;
  assert.equal((await request({ id })).status, 200);
  assert.deepEqual(opened, [skill().data.path]);
  assert.equal((await request({ id: 'invented' })).status, 400);
  assert.equal((await request({ id, path: '/arbitrary/path' })).status, 400);
  assert.equal((await request({ id }, 'https://example.com')).status, 403);
  snapshot = parse([usage({ isByok: true }), skill()]);
  assert.equal((await request({ id })).status, 400);
  snapshot = parse([]);
  assert.equal((await request({ id })).status, 400);
  snapshot = parse([usage(), loadStart('missing', 'missing-skill'), loadEnd('missing')]);
  const failureId = report(snapshot).skills.rows[0].id;
  assert.equal((await request({ id: failureId })).status, 400, 'failure-only rows without paths cannot launch a folder');
  assert.equal(opened.length, 1);
});

test('skill reports group by name/plugin/version and respect event dates, project and session', () => {
  const snapshot = parse([usage(), skill(), skill('k2'), skill('k3', { pluginName: 'other-tools' }),
    { ...skill('yesterday'), timestamp: new Date(2026, 10, 12, 10).toISOString() },
    { ...skill('future'), timestamp: new Date(2026, 10, 13, 13).toISOString() },
    { type: 'session.context_changed', data: { repository: 'project-two' } }, skill('k4', { pluginVersion: '2.0' })]);
  const r = report(snapshot);
  assert.equal(r.skills.invocations, 4);
  assert.equal(r.skills.rows.length, 3);
  assert.equal(r.skills.rows[0].invocations, 2);
  assert.equal(r.skills.rows[0].lastUsed, timestamp);
  assert.ok(r.options.projects.includes('project-two'), 'skill-only projects can be selected in the dashboard');
  assert.equal(report(snapshot, { project: 'project-two' }).skills.invocations, 1);
  assert.equal(report(snapshot, { session: 'different' }).skills.invocations, 0);
  assert.equal(report(snapshot, { range: 'all' }).skills.invocations, 5);
  assert.equal(report(snapshot, { models: ['another-model'] }).skills.invocations, 4, 'model filtering does not infer skill attribution');
});

test('unattributed and mixed-provider skill sessions are omitted with coverage counts', () => {
  assert.equal(report(parse([skill()])).skills.omitted, 1);
  const mixed = report(parse([usage(), usage({ isByok: true }, 'byok'), skill()]));
  assert.equal(mixed.skills.invocations, 0);
  assert.equal(mixed.skills.omitted, 1);
  const unknown = report(parse([usage(), usage({ provider: undefined }, 'unknown'), skill()]));
  assert.equal(unknown.skills.invocations, 0);
  assert.equal(unknown.skills.omitted, 1);
  assert.equal(report(parse([usage(), skill()]), { includeCache: false }).skills.invocations, 1);
});

test('scanner deduplicates copied skill logs, tails complete lines, and drops deleted events', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-skills-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homes = [path.join(root, 'a'), path.join(root, 'b')];
  const files = homes.map(home => path.join(home, 'session-state', 's1', 'events.jsonl'));
  const lines = events => events.map(e => JSON.stringify(e) + '\n').join('');
  for (const file of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, lines([start, usage(), skill()])); }
  const scanner = createScanner();
  assert.equal((await scanner.scan(homes)).skills.length, 1);
  await fs.appendFile(files[0], JSON.stringify(skillRef('k2')));
  assert.equal((await scanner.scan(homes)).skills.length, 1);
  await fs.appendFile(files[0], '\n');
  assert.equal((await scanner.scan(homes)).skills.length, 2);
  await fs.unlink(files[0]);
  assert.equal((await scanner.scan(homes)).skills.length, 1);
  await fs.writeFile(files[1], lines([start, usage()]));
  assert.equal((await scanner.scan(homes)).skills.length, 0);
});

test('dashboard API includes skill summaries without exposing skill payloads', async t => {
  const snapshot = parse([usage(), skill()]);
  const server = await startServer({ html: '', now: () => now, defaultHome: 'fixture',
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => ({ ...snapshot, sources: [], coverage: {} }) },
  });
  t.after(() => server.close());
  const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.report' }) });
  const result = await response.json();
  assert.equal(result.skills.invocations, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('dashboard reads current installed skill versions without rewriting recorded plugin history', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-skill-version-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'SKILL.md');
  const write = version => fs.writeFile(file, `---\nname: code-review\nmetadata:\n  version: "${version}"\n---\nPRIVATE INSTALLED SKILL BODY\n`);
  await write('2.3.4');
  const snapshot = parse([usage(), skill('k1', { path: file }), skill('k2', { path: file, pluginVersion: '0.9.0' })]);
  const server = await startServer({ html: '', now: () => now, defaultHome: 'fixture',
    settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => ({ ...snapshot, sources: [], coverage: {} }) },
  });
  t.after(() => server.close());
  const request = async method => {
    const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }) });
    assert.equal(response.status, 200);
    return response.json();
  };
  let result = await request('usage.report');
  assert.deepEqual(result.skills.rows.map(row => row.installedVersion), [{ value: '2.3.4', status: 'available' }, { value: '2.3.4', status: 'available' }]);
  const recorded = result.skills.rows.map(({ id, version, invocations }) => ({ id, version, invocations }));
  assert.deepEqual(recorded.map(row => row.version).sort(), ['0.9.0', '1.2.3']);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  await write('2.4.0');
  result = await request('usage.refresh');
  assert.ok(result.skills.rows.every(row => row.installedVersion.value === '2.4.0'));
  assert.deepEqual(result.skills.rows.map(({ id, version, invocations }) => ({ id, version, invocations })), recorded);
  await fs.unlink(file);
  result = await request('usage.report');
  assert.ok(result.skills.rows.every(row => row.installedVersion.status === 'unavailable'));
  assert.deepEqual(result.skills.rows.map(({ id, version, invocations }) => ({ id, version, invocations })), recorded);
});

test('SQLite fallback does not attribute skills from a mixed or unclassified session', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-skill-db-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, 'session-state', 's1');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'events.jsonl'), [start, skill()].map(e => JSON.stringify(e) + '\n').join(''));
  const db = new DatabaseSync(path.join(home, 'session-store.db'));
  db.exec('CREATE TABLE assistant_usage_events (id INTEGER, session_id TEXT, model TEXT, created_at TEXT, total_nano_aiu INTEGER)');
  db.prepare('INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?)').run(1, 's1', 'model-a', timestamp, 1000);
  const scanner = createScanner();
  assert.equal(report(await scanner.scan([home])).skills.invocations, 1);
  db.prepare('INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?)').run(2, 's1', 'custom', timestamp, null);
  db.close();
  const r = report(await scanner.scan([home]));
  assert.equal(r.skills.invocations, 0);
  assert.equal(r.skills.omitted, 1);
});
