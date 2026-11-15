// Shared by the pure report builder, worker boundary and panel. Dates are local calendar
// dates represented as whole days, never parsed as UTC instants or added as 24-hour durations.
export const RANGE_DAYS = new Map([['1d', 1], ['7d', 7], ['30d', 30], ['90d', 90]]);
// Match the transcript parser's supported history and bound daily chart allocation.
export const MIN_USAGE_DATE = '2020-01-01';
const DAY_MS = 86_400_000;
export function dayNumber(year, monthIndex, date) {
  const d = new Date(0);
  d.setUTCFullYear(year, monthIndex, date);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() / DAY_MS;
}
export function dayKey(day) { return new Date(day * DAY_MS).toISOString().slice(0, 10); }
export function localDay(now = new Date()) { return dayNumber(now.getFullYear(), now.getMonth(), now.getDate()); }
// localDay(new Date(ms)) for many timestamps. Each local day is one contiguous span of time, so
// its bounds are looked up once and reused; this holds for any offset or daylight-saving rule.
const daySpans = new Map();
export function dayOfMs(ms) {
  const bucket = Math.floor(ms / DAY_MS);
  let spans = daySpans.get(bucket);
  if (spans) for (const span of spans) if (ms >= span.start && ms < span.end) return span.day;
  const date = new Date(ms), day = localDay(date);
  if (!Number.isFinite(day)) return day;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  // Only trust a span that demonstrably contains this instant.
  if (!(ms >= start && ms < end)) return day;
  if (!spans) { if (daySpans.size > 4096) daySpans.clear(); daySpans.set(bucket, spans = []); }
  spans.push({ start, end, day });
  return day;
}
export function parseDateDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('date must use YYYY-MM-DD');
  const [year, month, date] = value.split('-').map(Number);
  const day = dayNumber(year, month - 1, date);
  if (dayKey(day) !== value) throw new RangeError('date must be a real calendar date');
  return day;
}
export function normalizeQuery({ range = 'mtd', startDate, endDate, models, environment, includeCache = true } = {}, now = new Date()) {
  if (range !== 'mtd' && range !== 'all' && range !== 'custom' && !RANGE_DAYS.has(range)) throw new RangeError(`Unknown range: ${range}`);
  if (typeof includeCache !== 'boolean') throw new TypeError('includeCache must be a boolean');
  if (models !== undefined && (!Array.isArray(models) || !models.every((m) => typeof m === 'string' && m.trim() !== ''))) throw new TypeError('models must be an array of non-empty strings');
  const out = { range, includeCache };
  if (environment !== undefined && (typeof environment !== 'string' || environment.length > 512 || /[\x00-\x1f\x7f]/.test(environment))) throw new TypeError('Invalid environment');
  if (environment) out.environment = environment;
  if (models !== undefined) out.models = [...new Set(models)].sort();
  if (range === 'custom') {
    const start = parseDateDay(startDate);
    const end = parseDateDay(endDate);
    if (start < parseDateDay(MIN_USAGE_DATE)) throw new RangeError(`startDate must be on or after ${MIN_USAGE_DATE}`);
    if (start > end) throw new RangeError('startDate must not follow endDate');
    if (end > localDay(now)) throw new RangeError('endDate must not be in the future');
    out.startDate = startDate;
    out.endDate = endDate;
  } else if (startDate !== undefined || endDate !== undefined) throw new RangeError('startDate and endDate require custom range');
  return out;
}
