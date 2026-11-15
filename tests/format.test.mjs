import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { compact, formatNumber, formatCredits } from '../src/core/format.mjs';
import { compact as chartsCompact, usageValue, stackedBars } from '../src/panel/charts.mjs';

test('repeated dashboard values reuse locale formatters without changing precision', async () => {
  let constructed = 0;
  const source = (await fs.readFile(new URL('../src/core/format.mjs', import.meta.url), 'utf8')).replaceAll('export ', '');
  const format = runInNewContext(source + '\nformatNumber', { Intl: { NumberFormat: class extends Intl.NumberFormat { constructor(...args) { super(...args); constructed++; } } } });
  for (let i = 0; i < 1000; i++) assert.equal(format(i + .25, { simplify: false }), (i + .25).toLocaleString(undefined, { maximumFractionDigits: 3 }));
  assert.equal(constructed, 1, 'one formatter per precision instead of per displayed number');
  assert.equal(format(.000000001), '0.000000001');
  assert.equal(constructed, 2);
});

test('compact formats magnitudes', () => {
  assert.equal(compact(950), '950');
  assert.equal(compact(114500), '114.5K');
  assert.equal(compact(46_200_000), '46.2M');
  assert.equal(compact(15_900_000_000), '15.9B');
  assert.equal(compact(4_000_000), '4M');
  assert.equal(compact(999_999), '1M');
  assert.equal(compact(999_950_000), '1B');
  assert.equal(compact(999), '999');
});

test('number display supports K/M/B/T, full values, fractions, missing data and rounding boundaries', () => {
  for (const [value, expected] of [[2131, '2.1K'], [42_244_916, '42.2M'], [2_131_000_000, '2.1B'], [2_131_000_000_000, '2.1T'],
    [999_950, '1M'], [999_950_000, '1B'], [999_950_000_000, '1T'], [1000, '1K'], [-2131, '-2.1K'], [0, '0'], [999, '999'], [2.25, '2.25']]) {
    assert.equal(formatNumber(value), expected);
    assert.equal(formatNumber(value, { simplify: false }), value.toLocaleString(undefined, { maximumFractionDigits: 3 }));
  }
  assert.equal(formatNumber(.000000001), '0.000000001');
  assert.equal(formatNumber(.000000001, { simplify: false }), '0.000000001');
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(formatNumber(value), 'Unavailable');
});

test('the charts use the core compact formatter', () => {
  assert.equal(chartsCompact, compact);
});

test('credits simplify fractions and magnitudes while preserving small charges and coverage', () => {
  for (const [value, expected] of [[0, '0'], [12.345678901, '12.3'], [2131.123456789, '2.1K'], [42_244_916, '42.2M'],
    [2_131_000_000, '2.1B'], [2_131_000_000_000, '2.1T'], [.123456789, '0.12'], [.001234567, '0.0012'], [.000000001, '0.000000001']]) {
    assert.equal(formatCredits(value), expected);
    assert.equal(formatCredits(value, { simplify: false }), value.toLocaleString(undefined, { maximumFractionDigits: 9 }));
  }
  assert.equal(formatCredits(.0000000001), '0.0000000001');
  assert.equal(formatCredits(.0000000001, { simplify: false }), '0.0000000001');
  for (const value of [null, undefined, NaN, Infinity]) assert.equal(formatCredits(value), 'Unavailable');
  assert.equal(usageValue({ credits: 12.345678901, partialCredits: 1 }, 'credits', formatCredits), '12.3 *');
  assert.equal(usageValue({ credits: null }, 'credits', formatCredits), 'Unavailable');
  const daily = [{ day: '2026-11-14', credits: 12.345678901 }];
  const simplified = stackedBars(daily, { keys: ['credits'], fmt: formatCredits });
  const full = stackedBars(daily, { keys: ['credits'], fmt: value => formatCredits(value, { simplify: false }) });
  assert.ok(simplified.includes('12.3') && !simplified.includes('12.345678901'));
  assert.ok(full.includes('12.345678901'));
});
