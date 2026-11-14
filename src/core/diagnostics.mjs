const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError']);
const errorCodes = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ENOSPC', 'EBUSY', 'EISDIR', 'EINVAL', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ABORT_ERR', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_SQLITE_ERROR', 'SQLITE_BUSY', 'SQLITE_CORRUPT']);
const sourceFiles = 'canvas-server|copilot-source|copilot-db|copilot-report|copilot|query|settings|request-prompts|skill-version|skill-folder|integrations|efficiency|diagnostics|canvas|context';
const numericFields = new Set(['durationMs', 'httpStatus', 'records', 'files', 'rows', 'sources', 'sourceIndex', 'invalid', 'invalidSkills', 'invalidTools', 'unclassified', 'unavailable', 'line', 'column']);
const booleanFields = new Set(['force', 'cacheHit', 'detail', 'refresh', 'mcpAvailable', 'pluginsAvailable']);
const enumFields = {
  method: new Set(['settings.get', 'settings.set', 'usage.report', 'usage.refresh', 'usage.requests', 'usage.sessions', 'skills.openFolder', 'efficiency.context']),
  range: new Set(['1d', '7d', '30d', '90d', 'all', 'custom']),
  sourceState: new Set(['error', 'warning', 'missing', 'empty', 'ok', 'off']),
  action: new Set(['copy', 'open']),
  kind: new Set(['mcp', 'plugins']),
  reason: new Set(['unsupported', 'invalid-response', 'failed']),
  phase: new Set(['started', 'finished', 'failed']),
};

// Error messages and arbitrary stack text can contain prompts, paths, or credentials.
export function diagnosticError(error) {
  const result = { errorType: errorTypes.has(error?.name) ? error.name : 'Error' };
  if (errorCodes.has(error?.code)) result.errorCode = error.code;
  const stack = typeof error?.stack === 'string' ? error.stack.slice(0, 16000) : '';
  const locations = [...stack.matchAll(new RegExp(`[/\\\\](${sourceFiles})\\.mjs:(\\d+):(\\d+)`, 'g'))]
    .map(([, file, line, column]) => `${file}.mjs:${line}:${column}`);
  for (const [, line, column] of stack.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/[a-f0-9]{64}\/?:(\d+):(\d+)/g)) locations.push(`panel/index.html:${line}:${column}`);
  if (locations.length) result.locations = [...new Set(locations)].slice(0, 5);
  return result;
}

export function createDiagnostics({ limit = 300, clock = () => new Date(), tick = () => globalThis.performance?.now() ?? Date.now() } = {}) {
  const entries = [], startedAt = clock().toISOString();
  let dropped = 0;
  function record(level, event, fields = {}) {
    if (!['info', 'warn', 'error'].includes(level) || !/^[a-z]+(?:\.[a-zA-Z]+)+$/.test(event)) return;
    const entry = { at: clock().toISOString(), level, event };
    for (const [key, value] of Object.entries(fields)) {
      if (numericFields.has(key) && Number.isFinite(value) && value >= 0) entry[key] = Math.round(value * 10) / 10;
      else if (booleanFields.has(key) && typeof value === 'boolean') entry[key] = value;
      else if (Object.hasOwn(enumFields, key) && enumFields[key].has(value)) entry[key] = value;
      else if (key === 'errorType' && errorTypes.has(value) || key === 'errorCode' && errorCodes.has(value)) entry[key] = value;
      else if (key === 'locations' && Array.isArray(value)) entry.locations = value.filter(v => typeof v === 'string' && new RegExp(`^(?:(?:${sourceFiles})\\.mjs|panel/index\\.html):\\d+:\\d+$`).test(v)).slice(0, 5);
    }
    entries.push(entry);
    if (entries.length > limit) { entries.shift(); dropped++; }
  }
  function measure(event, fields, work) {
    const start = tick();
    record('info', event, { ...fields, phase: 'started' });
    const success = value => { record('info', event, { ...fields, phase: 'finished', durationMs: tick() - start }); return value; };
    const failure = error => { record('error', event, { ...fields, ...diagnosticError(error), phase: 'failed', durationMs: tick() - start }); throw error; };
    try {
      const result = work();
      return result?.then ? result.then(success, failure) : success(result);
    } catch (error) { return failure(error); }
  }
  return { record, measure, snapshot: () => ({ startedAt, limit, dropped, entries: entries.map(e => ({ ...e, ...(e.locations ? { locations: [...e.locations] } : {}) })) }) };
}
