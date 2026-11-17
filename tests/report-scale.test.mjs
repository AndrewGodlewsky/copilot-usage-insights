import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, invariants, now } from '../scripts/benchmark-report-scale.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { createPromptEventSet, intern, summarizePromptCredits } from '../src/core/prompt-credits.mjs';
import { localDay } from '../src/core/query.mjs';
import { prepareInsightReview } from '../src/node/review-evidence.mjs';

const summarize = input => summarizePromptCredits(input.promptEvents, input.records, {}, -Infinity, localDay(now), now,
  { memo: input.cache, unique: true });

test('metadata interning bounds retained characters while preserving every value', () => {
  const set = Map.prototype.set, clear = Map.prototype.clear;
  let retained = 0, peak = 0, largest = 0;
  Map.prototype.set = function (key, value) {
    if (typeof key === 'string' && key === value && !this.has(key)) { retained += key.length * 2; peak = Math.max(peak, retained); largest = Math.max(largest, key.length); }
    return set.call(this, key, value);
  };
  Map.prototype.clear = function () { retained = 0; return clear.call(this); };
  try {
    for (let index = 0; index < 512; index++) {
      const value = `${index}:` + 'x'.repeat(8180);
      assert.equal(intern(value), value);
    }
    const oversized = 'metadata:' + 'y'.repeat(2 * 1024 * 1024);
    assert.equal(intern(oversized), oversized);
  } finally { Map.prototype.set = set; Map.prototype.clear = clear; }
  assert.ok(peak <= 4 * 1024 * 1024, `Interning retained ${peak} character bytes`);
  assert.ok(largest <= 8192, `Interning retained a ${largest}-character value`);
});

test('independent pairs of copied receipt journals do not rescan all other pairs', () => {
  const input = fixture(128, 'coupled'); let reads = 0;
  for (const event of input.promptEvents) {
    const ms = event.ms;
    Object.defineProperty(event, 'ms', { enumerable: true, get() { reads++; return ms; } });
  }
  const result = summarize(input);
  assert.equal(result.eligiblePrompts, 128);
  assert.ok(reads < input.promptEvents.length * 30, `Copied session grouping read ${reads} timestamps for ${input.promptEvents.length} events`);
});

test('shared steering submissions reuse their group model projection', () => {
  const input = fixture(256, 'shared'), map = Array.prototype.map;
  let projected = 0, result;
  // Count actual charge projections, independent of machine speed or concurrent test load.
  Array.prototype.map = function (callback, thisArg) {
    return map.call(this, function (value, index, array) {
      if (value && Object.hasOwn(value, 'nano') && Object.hasOwn(value, 'tokens')) projected++;
      return callback.call(this, value, index, array);
    }, thisArg);
  };
  try { result = summarize(input); } finally { Array.prototype.map = map; }
  assert.equal(result.prompts, 256);
  assert.equal(result.eligiblePrompts, 0);
  assert.equal(result.conversations.delivery.prompts, 256);
  assert.ok(projected < 256 * 4, `Projected ${projected} charge models for 256 shared submissions`);
});

test('shared submissions batch their per-model counts when every call has a distinct model label', () => {
  const input = fixture(256, 'shared-models'), get = Map.prototype.get; let lookups = 0, result;
  Map.prototype.get = function (key) { if (typeof key === 'string' && key.startsWith('Model ')) lookups++; return get.call(this, key); };
  try { result = summarize(input); } finally { Map.prototype.get = get; }
  assert.equal(result.modelPrompts.length, 256);
  assert.ok(result.modelPrompts.every(m => m.count === 0 && m.uncertain === 256));
  assert.ok(lookups < 256 * 10, `Looked up ${lookups} model counters for 256 shared submissions`);
});

test('conflicting copies under one envelope ID retain every variant without pairwise comparisons', () => {
  const set = createPromptEventSet(); let reads = 0;
  for (let i = 0; i < 256; i++) {
    const event = { kind: 'user', id: 'collision', sessionId: 'same-session', get ms() { reads++; return i; }, promptId: `prompt-${i}`, origin: 'user' };
    set.add(event);
    assert.equal(set.add({ ...event, environment: 'windows' }), event, 'environment provenance does not split an equal copy');
  }
  assert.equal(set.events.length, 256);
  assert.ok(reads < 256 * 30, `Conflict lookup read ${reads} timestamps for 256 variants`);
});

test('long, shared and cross-session histories preserve accounting and exclusions', () => {
  for (const kind of ['normal', 'long', 'shared', 'shared-models', 'coupled', 'chain', 'delegated']) {
    const input = fixture(128, kind);
    const report = buildReport(input.records, { range: 'all' }, now, input);
    invariants(report, input, kind);
    const again = buildReport(input.records, { range: 'all' }, now, input);
    assert.deepEqual(again, report, `${kind}: cached accounting must match the first report`);
  }
});

test('many children of one tool validate each agent without rescanning all siblings', () => {
  const input = fixture(258, 'delegated'), has = Set.prototype.has; let checks = 0, result;
  Set.prototype.has = function (value) { if (typeof value === 'string' && value.startsWith('worker-')) checks++; return has.call(this, value); };
  try { result = summarize(input); } finally { Set.prototype.has = has; }
  assert.equal(result.eligiblePrompts, 1);
  assert.equal(result.work.requests, 258);
  assert.ok(checks < 258 * 20, `Checked ${checks} child-agent memberships for 258 calls`);
});

test('large model selections are indexed once instead of scanned for every prompt', () => {
  const input = fixture(128, 'long'); let reads = 0;
  const names = Array.from({ length: 512 }, (_, i) => `Absent ${i}`);
  names.push('Model 0');
  const models = new Proxy(names, { get(target, key, receiver) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, receiver); } });
  const result = summarizePromptCredits(input.promptEvents, input.records, { models }, -Infinity, localDay(now), now,
    { memo: input.cache, unique: true });
  assert.equal(result.eligiblePrompts, 43);
  assert.ok(reads < names.length * 10, `Read ${reads} model choices for ${input.records.length} prompts`);
});

test('review snapshots copy only the selected prompt records and keep them private', async () => {
  const input = fixture(128, 'long'); let copies = 0;
  for (const record of input.records) Object.defineProperty(record, 'privateCopyProbe', { enumerable: true, get() { copies++; return 'private-record-sentinel'; } });
  const prepared = await prepareInsightReview(input, { range: 'all' }, now);
  assert.equal(prepared.candidates.length, 24);
  assert.equal(copies, 24, 'Unselected records should not be copied into a temporary review snapshot');
  assert.doesNotMatch(prepared.preview, /private-record-sentinel|synthetic-not-read/);
  const before = prepared.candidates[0].record.inputTotal;
  input.records[0].inputTotal = 999999;
  assert.equal(prepared.candidates[0].record.inputTotal, before, 'Selected review samples retain the captured record values');
});
