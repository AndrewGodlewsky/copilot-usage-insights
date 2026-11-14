import test from 'node:test';
import assert from 'node:assert/strict';
import { compact } from '../src/core/format.mjs';
import { compact as chartsCompact } from '../src/panel/charts.mjs';

test('compact formats magnitudes', () => {
  assert.equal(compact(950), '950');
  assert.equal(compact(114500), '114.5k');
  assert.equal(compact(46_200_000), '46.2M');
  assert.equal(compact(15_900_000_000), '15.9B');
  assert.equal(compact(4_000_000), '4M');
  assert.equal(compact(999_999), '1M');
  assert.equal(compact(999_950_000), '1B');
  assert.equal(compact(999), '999');
});

test('the charts use the core compact formatter', () => {
  assert.equal(chartsCompact, compact);
});
