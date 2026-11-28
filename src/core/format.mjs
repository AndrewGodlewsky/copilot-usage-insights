// Pure number formatting shared by the dashboard and charts.
// Compact magnitude: 2131 -> '2.1K', 999999 -> '1M', 2131000000000 -> '2.1T'.
const numberFormats = new Map();
export function compact(n) {
  if (!Number.isFinite(n)) return 'Unavailable';
  if (Object.is(n, -0)) n = 0;
  const v = Math.abs(n), sign = n < 0 ? '-' : '';
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (let i = 0; i < units.length; i++) {
    const [size, suffix] = units[i];
    if (v >= size) {
      const rounded = Math.round(v / size * 10) / 10;
      if (rounded >= 1000 && i > 0) return sign + trim(v / units[i - 1][0]) + units[i - 1][1];
      return sign + trim(rounded) + suffix;
    }
  }
  return formatNumber(n, { simplify: false });
}

function trim(x) {
  return x.toFixed(1).replace(/\.0$/, '');
}

export function formatNumber(value, { simplify = true, ...options } = {}) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (Object.is(value, -0)) value = 0;
  if (simplify && Math.abs(value) >= 1000) return compact(value);
  // Small nonzero charges must not round down to a misleading zero.
  const precision = value !== 0 && Math.abs(value) < .001 ? { maximumSignificantDigits: 3 } : { maximumFractionDigits: 3 };
  const resolved = { ...precision, ...options }, key = JSON.stringify(resolved);
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, resolved);
    if (numberFormats.size >= 32) numberFormats.delete(numberFormats.keys().next().value);
    numberFormats.set(key, formatter);
  }
  return formatter.format(value);
}

export function formatCredits(value, { simplify = true } = {}) {
  const precision = value !== 0 && Math.abs(value) < 1
    ? { maximumSignificantDigits: simplify ? 2 : 12 }
    : { maximumFractionDigits: simplify ? 1 : 9 };
  return formatNumber(value, { simplify, ...precision });
}
