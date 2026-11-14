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
  content: 'PRIVATE SKILL BODY', arguments: 'PRIVATE ARGUMENTS', path: 'PRIVATE PATH', ...extra,
} });
const parse = events => {
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  [start, ...events].forEach(e => parser.push(JSON.stringify(e)));
  return parser.snapshot();
};
const report = (snapshot, input = {}) => buildReport(snapshot.records, { range: '1d', ...input }, now, snapshot);

test('skill parser deduplicates persisted activations and retains only metadata', () => {
  const snapshot = parse([usage(), skill(), skill(), { ...skill('live'), ephemeral: true },
    skill('', {}), skill('empty', { name: '  ' }), { ...skill('bad-time'), timestamp: 'bad' }]);
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.skills[0].name, 'code-review');
  assert.equal(snapshot.skills[0].project, 'project-one');
  assert.equal(snapshot.invalidSkills, 3);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
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
  await fs.appendFile(files[0], JSON.stringify(skill('k2')));
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
