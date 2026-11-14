import test from 'node:test';
import assert from 'node:assert/strict';
import { compact, formatNumber } from '../src/core/format.mjs';
import { compact as chartsCompact } from '../src/panel/charts.mjs';

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
