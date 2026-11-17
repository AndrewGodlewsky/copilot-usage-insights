import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReportWire, decodeReportWire, reportWireRetainedBytes } from '../src/core/report-wire.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { fixture, now } from '../scripts/benchmark-report-scale.mjs';

const json = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function report() {
  const input = fixture(4, 'normal');
  return buildReport(input.records, { range: 'all' }, now, input);
}

test('compact report restores the exact JSON report without mutating either input', () => {
  const original = report(), saved = structuredClone(original), encoded = encodeReportWire(original);
  assert.equal(encoded.reportWireVersion, 1);
  assert.ok(Array.isArray(encoded.sessions.rows));
  assert.ok(Array.isArray(encoded.options.sessions.rows));
  assert.deepEqual(original, saved);
  const received = json(encoded), savedWire = structuredClone(received), decoded = decodeReportWire(received);
  assert.deepEqual(decoded, json(original));
  assert.deepEqual(received, savedWire);
  assert.equal(decodeReportWire(decoded), decoded);
  assert.equal(decodeReportWire(original), original);
  assert.ok(reportWireRetainedBytes(encoded, bytes(encoded)) >= bytes(original));
});

test('compact report preserves absent fields, nulls, zeroes, strings, and nested missing counters', () => {
  const original = { sessions: [
    { id: 'one', name: '', credits: null, userPrompts: 0, missing: { input: 0, output: null } },
    { id: 'two', name: null, credits: 0, userPrompts: undefined, missing: { output: 0 } },
    { id: 'three', credits: -0, averageCredits: Infinity, missing: null },
  ], options: { sessions: [{ id: 'one', name: '' }, { id: 'two', name: null }, { id: 'three' }] } };
  const encoded = encodeReportWire(original);
  assert.equal(encoded.reportWireVersion, 1);
  assert.deepEqual(decodeReportWire(json(encoded)), json(original));
  assert.ok(reportWireRetainedBytes(encoded, bytes(encoded)) >= bytes(original));
  assert.deepEqual(decodeReportWire(json(encodeReportWire({ sessions: [], options: { sessions: [] } }))), { sessions: [], options: { sessions: [] } });
});

test('shared missing counters decode into independent objects', () => {
  const original = report(), decoded = decodeReportWire(json(encodeReportWire(original)));
  decoded.sessions[0].missing.input = 99;
  assert.equal(decoded.sessions[1].missing.input, original.sessions[1].missing.input);
});

test('unknown future session fields retain the complete plain report', () => {
  const original = report(); original.sessions[0].futureField = { useful: 'retained' };
  assert.equal(encodeReportWire(original), original);
  assert.equal(reportWireRetainedBytes(original, bytes(original)), bytes(original));
});

test('decoder rejects unsupported versions, invalid dimensions, and unsafe keys', () => {
  const valid = json(encodeReportWire(report()));
  const invalid = alter => { const input = structuredClone(valid); alter(input); assert.throws(() => decodeReportWire(input), TypeError); };
  invalid(input => { input.reportWireVersion = 2; });
  invalid(input => { input.sessions.rows[0].push(1); });
  invalid(input => { delete input.sessions.rows[0]; });
  invalid(input => { delete input.sessions.rows[0][0]; });
  invalid(input => { input.sessions.columns[0] = '__proto__'; });
  invalid(input => { input.sessions.columns[0] = 'constructor'; });
  invalid(input => { input.sessions.columns[0] = 'prototype'; });
  invalid(input => { input.sessions.columns[0] = 'unrecognized'; });
  invalid(input => { input.sessions.columns[1] = input.sessions.columns[0]; });
  invalid(input => { input.sessions.defaults = JSON.parse('{"__proto__":{"polluted":true}}'); });
  invalid(input => { input.sessions.defaults.missing = JSON.parse('{"__proto__":{"polluted":true}}'); });
  invalid(input => { input.sessions.defaults.missing = { input: { arbitrary: 1 } }; });
  invalid(input => { input.sessions.absent = [[input.sessions.rows.length, 0]]; });
  invalid(input => { input.sessions.absent = [[0, input.sessions.columns.length]]; });
  invalid(input => { input.sessions.absent = [[0, 0, 0]]; });
  invalid(input => { input.sessions.absent = [[0, 0], [0, 0]]; });
  invalid(input => { input.options.sessions = []; });
  invalid(input => { input.options.sessions.columns = ['__proto__']; });
  assert.equal({}.polluted, undefined);
});

test('deterministic tables preserve mixed optional fields and conservative UTF-8 accounting', () => {
  for (let seed = 0; seed < 20; seed++) {
    const sessions = Array.from({ length: 33 }, (_, index) => {
      const row = { id: `s-${index}`, name: '共同の会話 🐟', credits: seed % 2 ? null : index, missing: { input: index % 3, output: null } };
      if ((index + seed) % 3) row.project = '';
      if ((index + seed) % 5) row.userPrompts = 0;
      if ((index + seed) % 7) row.uncertainPrompts = undefined;
      return row;
    });
    const original = { sessions, options: { sessions: sessions.map(({ id, name }) => ({ name, id })) } };
    const encoded = encodeReportWire(original), reordered = { ...original, sessions: sessions.map(row => Object.fromEntries(Object.entries(row).reverse())) };
    assert.deepEqual(encodeReportWire(reordered), encoded);
    assert.deepEqual(decodeReportWire(json(encoded)), json(original));
    assert.ok(reportWireRetainedBytes(encoded, bytes(encoded)) >= bytes(original));
  }
});

test('100,000 sessions round trip with less than half the original JSON bytes', () => {
  const template = report(), session = template.sessions[0], option = template.options.sessions[0];
  const original = { ...template, sessions: Array.from({ length: 100000 }, (_, index) => ({ ...session, id: `s-${index}`, name: `Synthetic session ${index}`, credits: index / 1000000 })),
    options: { ...template.options, sessions: Array.from({ length: 100000 }, (_, index) => ({ ...option, id: `s-${index}`, name: `Synthetic session ${index}` })) } };
  const originalBytes = bytes(original), encoded = encodeReportWire(original), compactBytes = bytes(encoded);
  assert.ok(compactBytes < originalBytes / 2, `${compactBytes} compact bytes versus ${originalBytes} plain bytes`);
  const decoded = decodeReportWire(json(encoded));
  assert.deepEqual(decoded, json(original));
  assert.ok(reportWireRetainedBytes(encoded, compactBytes) >= originalBytes);
});
