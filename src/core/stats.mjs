// Pure statistical and exact-integer helpers shared across src/core/ (zero Node built-ins).
import { dayKey } from './query.mjs';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const nonNegative = value => Number.isFinite(value) && value >= 0;

export const isCompleteCacheSplit = r =>
  r.cacheDetailsReported !== false && nonNegative(r.inputTotal) && nonNegative(r.cacheRead) && nonNegative(r.cacheWrite) && r.cacheRead + r.cacheWrite <= r.inputTotal;

export const isCompleteCharge = r =>
  Number.isSafeInteger(r.nanoAiu) && r.nanoAiu >= 0 && r.creditStatus === 'complete';

export function medianOf(values) {
  if (!values?.length) return null;
  const sorted = Float64Array.from(values).sort();
  const low = (sorted.length - 1) >> 1, high = sorted.length >> 1;
  return (sorted[low] + sorted[high]) / 2;
}

// Exact median from a Map<numericValue, frequency> (or iterable of [value, count] pairs).
export function medianFromCounts(counts, total) {
  if (!total || total <= 0) return null;
  const entries = [...counts].filter(([, c]) => c > 0).sort((a, b) => a[0] - b[0]);
  if (!entries.length) return null;
  const low = Math.floor((total - 1) / 2), high = Math.floor(total / 2);
  let seen = 0, lower;
  for (const [value, freq] of entries) {
    seen += freq;
    if (lower === undefined && seen > low) lower = value;
    if (seen > high) return (lower + value) / 2;
  }
  return lower ?? null;
}

// Exact non-negative integer accumulator (nanoAiu) that avoids BigInt allocation until > 2^53.
export function createNanoTotal() {
  let low = 0, high = 0n;
  return {
    add(n) {
      if (typeof n === 'bigint') { high += n; return; }
      if (!Number.isFinite(n) || n <= 0) return;
      if (Number.isSafeInteger(n) && low <= MAX_SAFE - n) { low += n; return; }
      high += BigInt(low) + BigInt(Math.round(n));
      low = 0;
    },
    addTotal(other) {
      if (!other) return;
      const bi = other.bigint();
      if (bi <= BigInt(MAX_SAFE - low)) low += Number(bi);
      else { high += BigInt(low) + bi; low = 0; }
    },
    bigint: () => high ? high + BigInt(low) : BigInt(low),
    number: () => high ? Number(high + BigInt(low)) : low,
    credits: () => (high ? Number(high + BigInt(low)) : low) / 1e9,
  };
}

// Shared 62-point daily/weekly trend bucketing.
export function bucketTrend(dayEntries, { maxPoints = 62, create, merge, finish } = {}) {
  const ordered = [...dayEntries].sort((a, b) => a[0] - b[0]);
  if (!ordered.length) return { unit: 'day', points: [], earlier: 0 };
  const first = ordered[0][0], weekly = ordered.at(-1)[0] - first >= maxPoints, span = weekly ? 7 : 1, points = [];
  let startBucket = null, cur = null;
  const flush = () => { if (cur) points.push(finish(dayKey(startBucket), cur)); };
  for (const [day, entry] of ordered) {
    const bucket = first + Math.floor((day - first) / span) * span;
    if (bucket !== startBucket) { flush(); startBucket = bucket; cur = create(); }
    merge(cur, entry);
  }
  flush();
  return { unit: weekly ? 'week' : 'day', points: points.slice(-maxPoints), earlier: Math.max(0, points.length - maxPoints) };
}
