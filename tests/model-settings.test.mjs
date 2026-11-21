import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { createScanner } from '../src/node/copilot-source.mjs';
import { renderTokenTopic } from '../src/panel/token-topics.mjs';

const now = new Date(2026, 10, 15, 12), timestamp = new Date(2026, 10, 15, 10).toISOString();
const start = { type: 'session.start', data: { sessionId: 's', context: { repository: 'project' } } };
const usage = (id, extra = {}) => ({ type: 'session.usage_record', id, timestamp, data: { usage: {
  provider: { kind: 'copilot' }, model: 'model-id', modelDisplayName: 'Model', reasoningEffort: 'medium',
  inputTokens: 100, outputTokens: 20, reasoningTokens: 5, duration: 1000, copilotUsage: { totalNanoAiu: 1e9 }, ...extra } } });
const change = (id, extra = {}) => ({ type: 'session.model_change', id, timestamp,
  data: { previousModel: 'model-id', newModel: 'model-id', previousReasoningEffort: 'medium', reasoningEffort: 'high', source: 'model_picker', ...extra } });
const parse = events => { const parser = createReceiptParser({ sessionId: 's', source: 'fixture', skipUnused: true }); [start, ...events].forEach(e => parser.push(JSON.stringify(e))); return parser.snapshot(); };
const report = (snapshot, query = {}) => buildReport(snapshot.records, { range: '7d', ...query }, now, snapshot);

test('effort costs stay within each model and keep missing effort and partial charges unknown', () => {
  const snapshot = parse([usage('a'), usage('b', { reasoningEffort: 'high', copilotUsage: { totalNanoAiu: 2e9 } }),
    usage('c', { reasoningEffort: null, copilotUsage: { totalNanoAiu: 0 }, duration: 0 }),
    usage('d', { reasoningEffort: 'max', model: 'other', modelDisplayName: 'Other', aiCreditsStatus: 'partial' }),
    usage('e', { reasoningEffort: { secret: 'PRIVATE' } })]);
  const result = report(snapshot), rows = result.efficiency.efforts;
  assert.equal(rows.length, 4);
  assert.equal(rows.find(r => r.effort === 'medium').credits, 1);
  assert.equal(rows.find(r => r.effort === 'high').averageCredits, 2);
  assert.equal(rows.find(r => r.effort === 'high').reasoningShare, 25);
  assert.equal(rows.find(r => r.effort === 'unknown').requests, 2);
  assert.equal(rows.find(r => r.effort === 'max').credits, null);
  assert.equal(report(snapshot, { models: ['Other'] }).efficiency.efforts.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  const html = renderTokenTopic('transitions', result, { number: n => n == null ? 'Unavailable' : String(n), credits: n => n == null ? 'Unavailable' : String(n) });
  assert.match(html, /Effort levels within one model/); assert.match(html, /not counted as a level/); assert.match(html, /at least 10 calls/);
});

test('only real explicit model and effort changes count; copied, child and no-op events do not', () => {
  const snapshot = parse([usage('a'), change('effort'), change('effort'), change('model', { newModel: 'other', reasoningEffort: 'medium', source: 'sdk' }),
    change('both', { newModel: 'other', source: 'agent' }), change('noop', { reasoningEffort: 'medium' }),
    change('unknown', { previousReasoningEffort: null }), change('unset', { reasoningEffort: undefined }),
    { ...change('ephemeral'), ephemeral: true }, { ...change('child'), agentId: 'child' },
    { ...change('old'), timestamp: new Date(2026, 9, 1).toISOString() },
    { ...change('future'), timestamp: new Date(2026, 10, 16).toISOString() }]);
  const result = report(snapshot).efficiency.switches;
  assert.equal(result.events, 3); assert.equal(result.modelChanges, 2); assert.equal(result.effortChanges, 2);
  assert.equal(result.manual, 1); assert.equal(result.automatic, 2); assert.equal(result.sessions, 1);
  assert.equal(report(snapshot, { range: '90d' }).efficiency.switches.events, 4);
  assert.equal(report(snapshot, { project: 'elsewhere' }).efficiency.switches.events, 0);
  assert.equal(report(snapshot, { models: ['Other model'] }).efficiency.switches.events, 0);
  assert.equal(report(snapshot, { models: ['Model'] }).efficiency.switches.events, 3);
  assert.equal(report({ ...snapshot, skillExcludedSessions: ['s'] }).efficiency.switches.events, 0);
});

test('scanner retains and deduplicates switch metadata across copies and refreshes with environment filtering', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-switches-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); return fs.rm(root, { recursive: true, force: true }); });
  const homes = ['a', 'b'].map(n => path.join(root, n));
  for (const home of homes) {
    const dir = path.join(home, 'session-state', 's'); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'events.jsonl'), [start, usage('a'), change('switch')].map(e => JSON.stringify(e) + '\n').join(''));
  }
  const scanner = createScanner({ skipUnused: true });
  for (const force of [false, true]) {
    const snapshot = await scanner.scan(homes, { force });
    assert.equal(snapshot.modelChanges.length, 1);
    assert.equal(report(snapshot).efficiency.switches.events, 1);
    assert.equal(report(snapshot, { environment: 'wsl:missing' }).efficiency.switches.events, 0);
  }
});
