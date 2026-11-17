// Only these existing public report fields can be reconstructed as object keys.
// Unknown future fields keep the plain format until both sides understand them.
const reportWireSessionFields = ['requests', 'total', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'completeTokenRequests', 'unclassifiedInput', 'inputTotal',
  'missing', 'missingTokens', 'knownTokenRequests', 'missingCache', 'missingCredits', 'partialCredits', 'chargedRequests', 'completeCreditRequests', 'creditTokenRequests',
  'sessions', 'averageTokens', 'credits', 'averageCredits', 'creditsPerMillionTokens', 'name', 'project', 'id', 'userPrompts', 'uncertainPrompts'];
const reportWireOptionFields = ['id', 'name'];
const reportWireMissingFields = new Set(['input', 'inputTotal', 'output', 'cacheRead', 'cacheWrite', 'reasoning']);
const reportWireSessionKeys = new Set(reportWireSessionFields), reportWireOptionKeys = new Set(reportWireOptionFields);
const reportWireTableKeys = new Set(['columns', 'defaults', 'rows', 'absent']);
const reportWireTextEncoder = new TextEncoder();
const reportWireObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const reportWireScalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number';
function reportWireValidValue(key, value) {
  if (reportWireScalar(value)) return true;
  return key === 'missing' && reportWireObject(value) && Object.keys(value).every(field => reportWireMissingFields.has(field) &&
    (value[field] === undefined || reportWireScalar(value[field])));
}
function reportWireValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value || 0 : null;
  if (reportWireObject(value)) return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, reportWireValue(item)]));
  return value;
}
function reportWireEqual(first, value) {
  if (!reportWireObject(first)) return Object.is(first, reportWireValue(value));
  if (!reportWireObject(value)) return false;
  const keys = Object.keys(value).filter(key => value[key] !== undefined);
  return keys.length === Object.keys(first).length && keys.every(key => Object.hasOwn(first, key) && Object.is(first[key], reportWireValue(value[key])));
}
function reportWireEncodeTable(rows, fields, allowed) {
  if (!Array.isArray(rows)) return null;
  const counts = new Map();
  for (const row of rows) {
    if (!reportWireObject(row)) return null;
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) return null;
      const value = row[key];
      if (value === undefined) continue;
      if (!reportWireValidValue(key, value)) return null;
      let entry = counts.get(key);
      if (!entry) { entry = { value: reportWireValue(value), count: 0, same: true }; counts.set(key, entry); }
      entry.count++;
      if (entry.same && !reportWireEqual(entry.value, value)) entry.same = false;
    }
  }
  const columns = [], defaults = {}, absent = [];
  for (const key of fields) {
    const entry = counts.get(key);
    if (!entry) continue;
    if (entry.same && entry.count === rows.length) defaults[key] = entry.value;
    else columns.push(key);
  }
  const values = rows.map((row, rowIndex) => {
    let omitted;
    const cells = columns.map((key, columnIndex) => {
      if (!Object.hasOwn(row, key) || row[key] === undefined) { (omitted ??= [rowIndex]).push(columnIndex); return null; }
      return reportWireValue(row[key]);
    });
    if (omitted) absent.push(omitted);
    return cells;
  });
  return { columns, defaults, rows: values, ...(absent.length ? { absent } : {}) };
}

export function encodeReportWire(report) {
  if (!reportWireObject(report) || Object.hasOwn(report, 'reportWireVersion') || !reportWireObject(report.options)) return report;
  const sessions = reportWireEncodeTable(report.sessions, reportWireSessionFields, reportWireSessionKeys);
  if (!sessions) return report;
  const choices = reportWireEncodeTable(report.options.sessions, reportWireOptionFields, reportWireOptionKeys);
  if (!choices) return report;
  return { ...report, reportWireVersion: 1, sessions, options: { ...report.options, sessions: choices } };
}

function reportWireInvalid() { throw new TypeError('Invalid compact report'); }
function reportWireDecodeValue(key, value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value || 0 : null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (key !== 'missing' || !reportWireObject(value)) return reportWireInvalid();
  const result = {};
  for (const field of Object.keys(value)) {
    const item = value[field];
    if (!reportWireMissingFields.has(field) || item !== undefined && !reportWireScalar(item)) return reportWireInvalid();
    if (item !== undefined) result[field] = reportWireValue(item);
  }
  return result;
}
function reportWireDecodeTable(table, allowed) {
  if (!reportWireObject(table) || Object.keys(table).some(key => !reportWireTableKeys.has(key)) || !Array.isArray(table.columns) ||
      !Array.isArray(table.rows) || !reportWireObject(table.defaults)) return reportWireInvalid();
  const keys = new Set(), defaults = {}, objectDefaults = [];
  for (const key of table.columns) {
    if (!allowed.has(key) || keys.has(key)) return reportWireInvalid();
    keys.add(key);
  }
  for (const key of Object.keys(table.defaults)) {
    if (!allowed.has(key) || keys.has(key)) return reportWireInvalid();
    keys.add(key);
    const value = reportWireDecodeValue(key, table.defaults[key]);
    if (reportWireObject(value)) objectDefaults.push([key, value]);
    else defaults[key] = value;
  }
  const omitted = new Map();
  if (Object.hasOwn(table, 'absent')) {
    if (!Array.isArray(table.absent)) return reportWireInvalid();
    for (const row of table.absent) {
      if (!Array.isArray(row) || row.length < 2 || !Number.isInteger(row[0]) || row[0] < 0 || row[0] >= table.rows.length || omitted.has(row[0])) return reportWireInvalid();
      const columns = new Set();
      for (let i = 1; i < row.length; i++) {
        const column = row[i];
        if (!Number.isInteger(column) || column < 0 || column >= table.columns.length || columns.has(column)) return reportWireInvalid();
        columns.add(column);
      }
      omitted.set(row[0], columns);
    }
  }
  return Array.from(table.rows, (values, rowIndex) => {
    if (!Array.isArray(values) || values.length !== table.columns.length) return reportWireInvalid();
    const row = { ...defaults }, omittedColumns = omitted.get(rowIndex);
    for (const [key, value] of objectDefaults) row[key] = { ...value };
    for (let column = 0; column < table.columns.length; column++) {
      const key = table.columns[column], value = values[column];
      if (omittedColumns?.has(column)) { if (value !== null) return reportWireInvalid(); }
      else row[key] = reportWireDecodeValue(key, value);
    }
    return row;
  });
}

export function decodeReportWire(report) {
  if (!reportWireObject(report) || !Object.hasOwn(report, 'reportWireVersion')) return report;
  if (report.reportWireVersion !== 1 || !reportWireObject(report.options)) return reportWireInvalid();
  const sessions = reportWireDecodeTable(report.sessions, reportWireSessionKeys);
  const choices = reportWireDecodeTable(report.options.sessions, reportWireOptionKeys);
  const { reportWireVersion, ...rest } = report;
  return { ...rest, sessions, options: { ...report.options, sessions: choices } };
}

// Conservatively budget the decoded report without serializing it a second time.
// Encoded bytes already contain every varying value; add repeated keys and defaults.
export function reportWireRetainedBytes(report, serializedBytes) {
  if (report?.reportWireVersion !== 1) return serializedBytes;
  let bytes = serializedBytes;
  for (const table of [report.sessions, report.options.sessions]) {
    const defaults = reportWireTextEncoder.encode(JSON.stringify(table.defaults)).byteLength;
    const keys = table.columns.reduce((sum, key) => sum + JSON.stringify(key).length + 2, 2);
    bytes += table.rows.length * (defaults + keys);
  }
  return bytes;
}
