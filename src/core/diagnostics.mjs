const errorTypes = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'AbortError', 'TimeoutError']);
export const RUNTIME_EVENTS = new Set(['extension.started', 'extension.joined', 'extension.signal', 'extension.exit', 'extension.crash',
  'extension.sdk', 'extension.join', 'canvas.queue', 'server.start', 'server.import', 'server.assets', 'server.bind', 'server.page', 'server.endpointRead', 'server.usageModules', 'server.reviewModules',
  'canvas.open', 'canvas.close', 'canvas.dispose', 'runtime.started', 'server.listening', 'server.closing', 'server.closed', 'server.error', 'server.response', 'server.endpoint', 'server.endpointReset',
  'wsl.discovery', 'history.scan', 'history.source', 'history.discovery', 'history.copilot', 'history.journals', 'history.vscode', 'history.merge', 'history.database', 'history.names', 'history.finalize', 'report.build', 'report.serialize', 'skills.versions']);
const errorCodes = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ENOSPC', 'EBUSY', 'EISDIR', 'EINVAL', 'EADDRINUSE', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ABORT_ERR', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_SQLITE_ERROR', 'SQLITE_BUSY', 'SQLITE_CORRUPT']);
for (const code of ['RUNTIME', 'SDK', 'ACCOUNT', 'CATALOG', 'MODEL', 'EFFORT', 'SNAPSHOT', 'ISOLATION', 'TIMEOUT', 'CANCELLED', 'USAGE', 'CLEANUP', 'RESPONSE', 'FAILED', 'BUSY']) errorCodes.add(`REVIEW_${code}`);
const sourceFiles = 'canvas-server|canvas-endpoint|copilot-source|copilot-db|copilot-report|copilot|query|settings|request-prompts|skill-version|skill-folder|integrations|efficiency|diagnostics|canvas|context|wsl-db|wsl-sources|wsl-discovery-process|source-paths|vscode|vscode-sources';
const numericFields = new Set(['durationMs', 'httpStatus', 'records', 'files', 'rows', 'sources', 'sourceIndex', 'invalid', 'invalidSkills', 'invalidTools', 'unclassified', 'unavailable', 'line', 'column', 'lastResponseAgeMs', 'processId', 'exitCode', 'activeCanvases']);
const booleanFields = new Set(['force', 'cacheHit', 'detail', 'refresh', 'mcpAvailable', 'pluginsAvailable', 'online', 'hidden', 'secureContext', 'reused']);
for (const field of ['filesRead', 'filesReused', 'filesAppended', 'bytesRead', 'bytesHashed', 'folders', 'responseBytes', 'promptEvents', 'tools', 'skills', 'filesDeferred', 'databasesDeferred', 'scanId']) numericFields.add(field);
for (const event of ['history.recent', 'history.background']) RUNTIME_EVENTS.add(event);
RUNTIME_EVENTS.add('skills.report');
for (const field of ['skillUses', 'skillFailures', 'omittedSkillUses', 'omittedSkillFailures', 'unattributedUses', 'unattributedFailures']) numericFields.add(field);
booleanFields.add('unchanged');
for (const field of ['executableAllowed', 'bootstrapPresent', 'sdkPathPresent', 'parentMatches']) booleanFields.add(field);
for (const field of ['received', 'eligible', 'distributions', 'running', 'homes', 'vscodeHomes', 'environments', 'compactions', 'wslDatabases', 'fallbackRequests', 'sqliteCode', 'pass', 'inputChars', 'cards', 'samples']) numericFields.add(field);
const enumFields = {
  method: new Set(['settings.get', 'settings.set', 'usage.report', 'usage.inventory', 'usage.refresh', 'usage.requests', 'usage.sessions', 'usage.modelProjects', 'usage.sessionModels', 'efficiency.context']),
  range: new Set(['1d', '7d', 'mtd', '30d', '90d', 'all', 'custom']),
  sourceState: new Set(['error', 'warning', 'missing', 'empty', 'ok', 'off']),
  sourceKind: new Set(['copilot', 'vscode']),
  environmentType: new Set(['local', 'wsl', 'remote']),
  databaseReader: new Set(['local', 'wsl']),
  loadKind: new Set(['initial', 'manual', 'automatic', 'filter', 'background']),
  historyPhase: new Set(['recent', 'history', 'complete']),
  action: new Set(['copy', 'open']),
  kind: new Set(['mcp', 'plugins']),
  reason: new Set(['unsupported', 'invalid-response', 'failed']),
  phase: new Set(['started', 'finished', 'failed']),
  stage: new Set(['runtime', 'catalog', 'start', 'usage', 'session', 'access', 'workspace', 'tools', 'account', 'generate', 'cleanup']),
  requestStage: new Set(['fetch', 'decode', 'http', 'complete']),
  signal: new Set(['SIGINT', 'SIGTERM']),
  platform: new Set(['win32', 'darwin', 'linux']),
  arch: new Set(['x64', 'arm64', 'ia32', 'arm']),
  directive: new Set(['connect-src', 'default-src']),
};
for (const method of ['review.catalog', 'review.reconnect', 'review.run', 'review.prepare', 'review.analyze', 'review.cancel', 'diagnostics.get']) enumFields.method.add(method);

// Error messages and arbitrary stack text can contain prompts, paths, or credentials.
export function diagnosticError(error) {
  const result = { errorType: errorTypes.has(error?.name) ? error.name : 'Error' };
  if (errorCodes.has(error?.code)) result.errorCode = error.code;
  if (error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) && error.errcode >= 0 && error.errcode <= 65535) result.sqliteCode = error.errcode;
  const stack = typeof error?.stack === 'string' ? error.stack.slice(0, 16000) : '';
  const locations = [...stack.matchAll(new RegExp(`[/\\\\](${sourceFiles})\\.mjs:(\\d+):(\\d+)`, 'g'))]
    .map(([, file, line, column]) => `${file}.mjs:${line}:${column}`);
  for (const [, line, column] of stack.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/[a-f0-9]{64}\/?:(\d+):(\d+)/g)) locations.push(`panel/index.html:${line}:${column}`);
  if (locations.length) result.locations = [...new Set(locations)].slice(0, 5);
  return result;
}

export function createDiagnostics({ limit = 300, clock = () => new Date(), tick = () => globalThis.performance?.now() ?? Date.now(), onRecord } = {}) {
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
      else if (['pluginVersion', 'nodeVersion', 'guidanceVersion'].includes(key) && typeof value === 'string' && /^v?\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value)) entry[key] = value;
      else if (key === 'locations' && Array.isArray(value)) entry.locations = value.filter(v => typeof v === 'string' && new RegExp(`^(?:(?:${sourceFiles})\\.mjs|panel/index\\.html):\\d+:\\d+$`).test(v)).slice(0, 5);
    }
    entries.push(entry);
    if (entries.length > limit) { entries.shift(); dropped++; }
    // Diagnostics must never turn a successful operation into a failure.
    try { onRecord?.({ ...entry, ...(entry.locations ? { locations: [...entry.locations] } : {}) }); } catch {}
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

// Apply the same privacy rules to files read by the server and files chosen in Show logs.
export function parseRuntimeDiagnostics(text) {
  let at;
  const safe = createDiagnostics({ clock: () => at || new Date() });
  for (const line of text.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (!entry || !RUNTIME_EVENTS.has(entry.event) || typeof entry.at !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(entry.at) || !Number.isFinite(Date.parse(entry.at))) continue;
      at = new Date(entry.at);
      safe.record(entry.level, entry.event, entry);
    } catch {}
  }
  return safe.snapshot().entries;
}

// A readable index into the structured logs. Each line is the latest retained operation,
// not an additive breakdown: stages can nest and can belong to different loads.
export function loadTimingSummary(entries) {
  const labels = {
    'extension.sdk': 'Copilot SDK loading', 'extension.join': 'Copilot extension registration', 'canvas.open': 'Canvas open callback', 'canvas.queue': 'Canvas lifecycle wait',
    'server.start': 'Local server startup', 'server.import': 'Server module loading', 'server.endpointRead': 'Saved endpoint read',
    'server.assets': 'Dashboard file read', 'server.bind': 'Loopback listener start', 'server.page': 'Dashboard HTML response',
    'server.usageModules': 'Usage modules (after canvas startup)', 'server.reviewModules': 'AI review modules (explicit action)',
    'ui.ready': 'Dashboard document loaded',
    'ui.load': 'Usage load', 'history.scan': 'All history', 'history.discovery': 'WSL source discovery',
    'history.recent': 'Recent journals ready', 'history.background': 'Remaining history verification', 'ui.history': 'History displayed',
    'history.copilot': 'Copilot source probing and journals', 'history.journals': 'Copilot journals',
    'history.vscode': 'VS Code discovery and journals', 'history.merge': 'Journal deduplication',
    'history.database': 'Usage database', 'history.names': 'Session names', 'history.finalize': 'History reconciliation',
    'report.build': 'Report calculations', 'skills.versions': 'Installed skill versions',
    'report.serialize': 'Response preparation', 'api.decode': 'Response download and decoding',
    'ui.render': 'Dashboard DOM update', 'inventory.read': 'Plugin/MCP inventory (separate from usage)',
  };
  const latest = new Map();
  for (const entry of entries) if (Object.hasOwn(labels, entry.event) && ['started', 'finished', 'failed'].includes(entry.phase)) {
    const key = JSON.stringify([entry.source, entry.processId, entry.event, entry.sourceIndex, entry.loadKind, entry.historyPhase]);
    const previous = latest.get(key);
    if (!previous || entry.at >= previous.at) latest.set(key, entry);
  }
  const lines = ['Load timing summary', 'Latest retained operations, each with its own timestamp. Nested stages overlap; do not add them together.'];
  if (!latest.size) lines.push('No load timings retained yet.');
  for (const entry of latest.values()) {
    const name = entry.event === 'ui.load' && entry.loadKind === 'initial' ? 'Initial usage load' : labels[entry.event];
    const context = [entry.source, entry.processId ? `process ${entry.processId}` : '', entry.loadKind, entry.sourceIndex ? `source ${entry.sourceIndex}` : '', entry.environmentType, entry.historyPhase].filter(Boolean).join(', ');
    const timing = Number.isFinite(entry.durationMs) ? `${entry.durationMs} ms` : 'no completion retained';
    const counts = ['scanId', 'records', 'folders', 'files', 'filesRead', 'filesAppended', 'filesReused', 'filesDeferred', 'databasesDeferred', 'bytesRead', 'bytesHashed', 'responseBytes', 'cacheHit', 'unchanged']
      .filter(key => typeof entry[key] === 'boolean' || Number.isFinite(entry[key])).map(key => `${key}=${entry[key]}`).join(', ');
    lines.push(`${entry.at} ${name}${context ? ` (${context})` : ''}: ${entry.phase}, ${timing}${counts ? '; ' + counts : ''}`);
  }
  lines.push('bytesRead = journal bytes parsed; bytesHashed = additional prefix-validation reads. Source numbers are anonymous and local to each scan.',
    'Canvas startup timings are separate from usage scanning. Document loaded measures navigation through the page load event, not final browser paint. Host work before extension registration is not measured. Inventory loads separately.');
  return lines.join('\n');
}
