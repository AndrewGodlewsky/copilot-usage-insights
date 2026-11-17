// A dated maintenance baseline, not a vulnerability scan or a safety guarantee.
const NODE_BASELINES = { 24: '24.22.3', 26: '26.13.1' };
export function runtimeSecurityStatus(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  const minimum = match ? NODE_BASELINES[Number(match[1])] || null : null;
  const current = match?.slice(1).map(Number);
  const required = minimum?.split('.').map(Number);
  const meets = required && current.some((n, i) => n > required[i] && current.slice(0, i).every((p, j) => p === required[j]))
    || required && current.every((n, i) => n === required[i]);
  return { nodeVersion: String(version).slice(0, 64), reviewedAt: '2026-11-17', minimum,
    status: !minimum ? 'unverified' : meets ? 'baseline-met' : 'below-baseline' };
}
