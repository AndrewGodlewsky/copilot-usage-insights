import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeSecurityStatus } from '../src/core/security-status.mjs';

test('dated runtime baseline distinguishes older, patched, newer and unreviewed branches', () => {
  for (const version of ['v24.22.1', '24.22.2', '24.21.99', '26.13.0']) assert.equal(runtimeSecurityStatus(version).status, 'below-baseline');
  for (const version of ['v24.22.3', '24.23.0', '24.22.4', '26.13.1']) assert.equal(runtimeSecurityStatus(version).status, 'baseline-met');
  for (const version of ['22.23.5', '27.0.0', '24.22.3-rc.1', 'invalid']) assert.equal(runtimeSecurityStatus(version).status, 'unverified');
  assert.deepEqual(runtimeSecurityStatus('v24.22.1'), { nodeVersion: 'v24.22.1', reviewedAt: '2026-11-17', minimum: '24.22.3', status: 'below-baseline' });
});
