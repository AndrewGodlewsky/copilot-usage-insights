import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createSettings, copilotHome } from './settings.mjs';
import { createIntegrationReader } from './integrations.mjs';
import { createDiagnostics, diagnosticError } from '../core/diagnostics.mjs';
import { localDay, dayKey, parseDateDay, RANGE_DAYS } from '../core/query.mjs';
import { createContextReader } from './context.mjs';
import { validEndpoint } from './canvas-endpoint.mjs';
import { runtimeSecurityStatus } from '../core/security-status.mjs';
import { encodeReportWire, reportWireRetainedBytes } from '../core/report-wire.mjs';

const MAX_BODY = 64 * 1024, MAX_REPORTS = 12, MAX_REPORT_BYTES = 16 * 1024 * 1024;
// Serialized size bounds retention without a second traversal of each report. It
// is a proxy for object size, not an exact JavaScript heap limit.
export function createReportCache({ maxEntries = MAX_REPORTS, maxBytes = MAX_REPORT_BYTES } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid report cache limits');
  const entries = new Map();
  let bytes = 0;
  const remove = key => {
    const found = entries.get(key);
    if (!found) return;
    bytes -= found.bytes;
    entries.delete(key);
  };
  return {
    get size() { return entries.size; },
    get bytes() { return bytes; },
    get(key) {
      const found = entries.get(key);
      if (!found) return;
      entries.delete(key); entries.set(key, found);
      return found.value;
    },
    delete: remove,
    set(key, value, size) {
      if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid report cache size');
      remove(key);
      if (size > maxBytes) return;
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
      entries.set(key, { value, bytes: size });
      bytes += size;
    },
  };
}
const pausedError = () => Object.assign(new Error('Usage Insights is paused. Resume it in Settings.'), { code: 'paused' });
async function whileActive(work, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    const result = await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }), new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    })]);
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener('abort', abort); }
}
// The latest time carried by anything in a scan: until then, the clock can still change a report.
function latestTime(scan) {
  let latest = -Infinity;
  for (const list of [scan.records, scan.skills, scan.interactions, scan.promptEvents, scan.tools, scan.modelChanges, scan.compactionEvents]) for (const item of list || []) {
    if (item.ms > latest) latest = item.ms;
    if (item.completedMs > latest) latest = item.completedMs;
  }
  return latest;
}
export async function startServer({ settings = createSettings(), scanner, defaultHome = copilotHome(), html, now = () => new Date(), readIntegrations = createIntegrationReader(() => undefined), readContext = createContextReader(() => undefined), diagnostics = createDiagnostics(), session, reviewService, endpoint } = {}) {
  if (endpoint !== undefined && !validEndpoint(endpoint)) throw new TypeError('Invalid dashboard endpoint');
  const lifetime = new AbortController();
  const suppliedScanner = scanner;
  let activity = new AbortController(), paused = false;
  let usageModules, reviewModules, reviewAbortReason;
  const loadUsage = () => usageModules ??= diagnostics.measure('server.usageModules', {}, () => import('./canvas-usage.mjs'));
  const loadReview = () => reviewModules ??= diagnostics.measure('server.reviewModules', {}, () => import('./canvas-review.mjs'));
  html ??= await diagnostics.measure('server.assets', {}, () => readFile(new URL('../../panel/index.html', import.meta.url), 'utf8'));
  // HTML parsing normalizes newlines. Hash the exact executable inline script we serve.
  html = html.replace(/\r\n?/g, '\n');
  const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`);
  const contentPolicy = `default-src 'none'; script-src ${scriptHashes.join(' ') || "'none'"}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'`;
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  diagnostics.record('info', 'runtime.started');
  const diagnosticSnapshot = () => ({ version, capturedAt: now().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch, processId: process.pid }, ...diagnostics.snapshot() });
  const savedDiagnosticSnapshot = () => ({ ...diagnosticSnapshot(), ...(diagnostics.readPersisted ? { persisted: diagnostics.readPersisted() } : {}) });
  const token = endpoint?.token ?? randomBytes(32).toString('hex'), prefix = `/${token}/`;
  let origin;
  const settingsWrites = new Set();
  let history, reviewRequest, preparedReview, contextSnapshot;
  let scanId = 0;
  // Reports already built from the current scan, by filter. A scan is never altered once it is
  // returned, so a report stays right until the scan is replaced, the local day changes, or
  // something dated later than the report's own moment comes due.
  let reports = { scan: null, latest: -Infinity, built: createReportCache(), pending: new Map() };
  function setPaused(value) {
    if (paused === value) return;
    paused = value;
    if (paused) {
      activity.abort(pausedError());
      reviewRequest?.abort(reviewAbortReason);
      reviewService?.cancel();
      scanner = suppliedScanner;
      history = preparedReview = contextSnapshot = undefined;
      reports = { scan: null, latest: -Infinity, built: createReportCache(), pending: new Map() };
    } else activity = new AbortController();
  }
  function reportFor(scan, input, at, buildReport) {
    if (reports.scan !== scan) reports = { scan, latest: latestTime(scan), built: createReportCache(), pending: new Map() };
    const current = reports;
    const key = JSON.stringify(input), day = localDay(at), ms = at.getTime();
    let entry = reports.built.get(key) || reports.pending.get(key);
    const cached = !!entry && entry.day === day && ms >= entry.ms && reports.latest <= entry.ms;
    if (!cached) {
      entry = { day, ms, report: buildReport(scan.records, input, at, scan), sent: null };
      reports.built.delete(key);
    }
    // Share a calculation while requests independently check installed versions.
    // These references live only as long as the requests, including failed ones.
    entry.readers = (entry.readers || 0) + 1;
    reports.pending.set(key, entry);
    return { entry, cached, key, release() {
      if (--entry.readers === 0 && current.pending.get(key) === entry) current.pending.delete(key);
    } };
  }
  async function readHistory(config, { refresh = false, force = false, recent = false } = {}) {
    const signal = activity.signal;
    const { createCanvasScanner } = await loadUsage();
    signal.throwIfAborted();
    scanner ??= createCanvasScanner({ diagnostics, signal });
    const roots = [defaultHome, ...config.extraHomes], key = JSON.stringify([roots, config.disabledHomes, config.includeWsl !== false, config.readWslDatabases !== false, config.includeVSCode !== false, config.extraVSCodeHomes]);
    if (!history || history.key !== key || (refresh || force) && (history.complete || history.error)) {
      const progressive = !history || history.key !== key || !!history.error;
      const at = now(), since = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 29);
      const fields = { force, scanId: ++scanId };
      let ready;
      const entry = { key, complete: false, ready: new Promise(resolve => { ready = resolve; }) };
      entry.promise = diagnostics.measure('history.scan', fields, async () => {
        const scan = await scanner.scan(roots, { signal, disabled: config.disabledHomes, force, includeWsl: config.includeWsl !== false, readWslDatabases: config.readWslDatabases !== false, includeVSCode: config.includeVSCode !== false, extraVSCodeHomes: config.extraVSCodeHomes || [],
          ...(progressive ? { recentSince: since.getTime(), scanId: fields.scanId,
          onRecent: (scan, progress) => {
            signal.throwIfAborted();
            ready({ scan, scanId: fields.scanId, loading: { phase: 'recent', scanId: fields.scanId, since: dayKey(localDay(since)), ...progress } });
          } } : {}),
        });
        signal.throwIfAborted();
        Object.assign(fields, { records: scan.records.length, sources: scan.sources?.length ?? 0,
          compactions: scan.records.filter(r => r.origin === 'compaction').length,
          environments: new Set((scan.sources || []).map(s => s.environment).filter(Boolean)).size,
          files: scan.sources?.reduce((sum, source) => sum + (source.files || 0), 0) ?? 0, ...scan.coverage });
        for (const [index, source] of (scan.sources || []).entries()) if (['error', 'warning', 'missing'].includes(source.state)) {
          diagnostics.record('warn', 'history.source', { sourceIndex: index + 1, sourceState: source.state, sourceKind: source.kind === 'vscode' ? 'vscode' : 'copilot', ...source.diagnostic });
        }
        return { scan, scannedAt: now().toISOString(), scanId: fields.scanId };
      });
      history = entry;
      entry.promise.then(result => { entry.complete = true; ready(result); entry.ready = null; }, error => { entry.error = error; ready(null); entry.ready = null; });
    } else diagnostics.record('info', 'history.cache', { cacheHit: true });
    const entry = history;
    if (recent && !entry.complete && !entry.error) {
      const result = await entry.ready;
      if (!entry.error && !entry.complete && result) return result;
    }
    return entry.promise;
  }
  function withinRecentRange(input, loading) {
    const at = now(), range = input.range || 'mtd';
    const start = range === 'custom' ? parseDateDay(input.startDate) : range === 'mtd' ? localDay(new Date(at.getFullYear(), at.getMonth(), 1))
      : RANGE_DAYS.has(range) ? localDay(at) - RANGE_DAYS.get(range) + 1 : -Infinity;
    return start >= parseDateDay(loading.since);
  }
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    void handle(req, res).catch(e => {
      if (lifetime.signal.aborted) return;
      diagnostics.record('error', 'server.response', diagnosticError(e));
      if (!res.headersSent) json(res, 500, { error: e.message });
      else res.end();
    });
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.on('error', error => diagnostics.record('error', 'server.error', diagnosticError(error)));
  server.on('close', () => diagnostics.record('info', 'server.closed'));
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(body); };
  const json = (res, status, data) => send(res, status, JSON.stringify(data));
  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', contentPolicy);
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Origin not allowed' });
    if (req.method === 'GET' && req.url === prefix) {
      const started = performance.now();
      diagnostics.record('info', 'server.page', { phase: 'started' });
      const page = html.replace('<script type="application/json" id="initial-diagnostics">null</script>',
        () => `<script type="application/json" id="initial-diagnostics">${JSON.stringify(savedDiagnosticSnapshot()).replaceAll('<', '\\u003c')}</script>`);
      res.once('finish', () => diagnostics.record('info', 'server.page', { phase: 'finished', durationMs: performance.now() - started, responseBytes: Buffer.byteLength(page) }));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return;
    }
    if (req.method !== 'POST' || req.url !== prefix + 'api') return json(res, 404, { error: 'Not found' });
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Expected JSON' });
    let size = 0, body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY) { json(res, 413, { error: 'Request too large' }); return; }
      body += chunk;
    }
    let message;
    const started = performance.now(), fields = {};
    let requestActivity = activity;
    const startedPaused = paused;
    const checkActivity = () => requestActivity.signal.throwIfAborted();
    function allowActivity(config) {
      if (requestActivity !== activity || !startedPaused && requestActivity.signal.aborted) throw pausedError();
      setPaused(config.paused === true);
      requestActivity = activity;
      checkActivity();
      return config;
    }
    const activitySettings = async () => allowActivity(await settings.get());
    const active = work => whileActive(work, requestActivity.signal);
    try {
      message = JSON.parse(body);
      lifetime.signal.throwIfAborted();
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Expected an object');
      const input = message.input ?? {};
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be an object');
      if (message.refresh !== undefined && typeof message.refresh !== 'boolean') throw new TypeError('refresh must be a boolean');
      if (message.compact !== undefined && (typeof message.compact !== 'boolean' || !['usage.report', 'usage.refresh'].includes(message.method))) throw new TypeError('compact must be a boolean for usage reports');
      if (message.known !== undefined && typeof message.known !== 'string') throw new TypeError('known must be a string');
      Object.assign(fields, { method: message.method, range: input.range, refresh: message.refresh === true, detail: message.method === 'usage.requests' && input.id !== undefined });
      if (message.method !== 'diagnostics.get') diagnostics.record('info', 'api.request', { ...fields, phase: 'started' });
      if (paused && !['settings.get', 'settings.set', 'diagnostics.get', 'review.cancel'].includes(message.method)) await activitySettings();
      let result;
      if (message.method === 'diagnostics.get') {
        if (Object.keys(input).length) throw new TypeError('Diagnostics does not accept options.');
        result = savedDiagnosticSnapshot();
      } else if (['review.catalog', 'review.reconnect', 'review.run', 'review.prepare', 'review.analyze', 'review.cancel'].includes(message.method)) {
        const { buildReport, createReviewService, safeReviewError, ReviewError, prepareInsightReview, finalizeInsightReview, describeModelReference } = await loadReview();
        lifetime.signal.throwIfAborted();
        reviewService ??= createReviewService(session, { diagnostics });
        reviewAbortReason = new ReviewError('cancelled');
        const allowed = message.method === 'review.run' ? ['prompt', 'expectedModel'] : message.method === 'review.prepare' ? ['filters'] : message.method === 'review.analyze' ? ['snapshotId', 'expectedModel', 'expectedReasoning', 'allowSamples'] : [];
        if (Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError('Unexpected review options.');
        if (message.method === 'review.prepare') {
          const f = input.filters;
          if (!f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).some(k => !['range', 'startDate', 'endDate', 'models', 'project', 'session', 'environment', 'includeCache'].includes(k))) throw new TypeError('Invalid review filters.');
          for (const key of ['project', 'session']) if (f[key] !== undefined && (typeof f[key] !== 'string' || f[key].length > 8192)) throw new TypeError('Invalid review filters.');
          buildReport([], f, now());
        }
        if (message.method === 'review.analyze' && (typeof input.snapshotId !== 'string' || typeof input.allowSamples !== 'boolean' || !['default', 'medium', 'high'].includes(input.expectedReasoning))) throw new TypeError('Invalid analysis options.');
        if (message.method === 'review.cancel') { reviewRequest?.abort(new ReviewError('cancelled')); reviewService.cancel(); result = { ok: true }; }
        else {
          if (message.method === 'review.run' && (typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 48 * 1024)) throw new TypeError('Review snapshot must be nonempty and no larger than 48 KiB.');
          if (reviewRequest) throw new ReviewError('busy');
          const controller = new AbortController();
          reviewRequest = controller;
          const disconnected = () => { if (!res.writableEnded) controller.abort(new ReviewError('cancelled')); };
          res.once('close', disconnected);
          let rejectAborted;
          const aborted = new Promise((_, reject) => { rejectAborted = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', rejectAborted, { once: true }); });
          const timer = setTimeout(() => controller.abort(new ReviewError('timeout')), 15_000);
          try {
            const config = { ...await Promise.race([settings.get(), aborted]) };
            allowActivity(config);
            clearTimeout(timer);
            if (res.destroyed || controller.signal.aborted) throw new ReviewError('cancelled');
            if (message.method === 'review.run' && (!input.expectedModel || input.expectedModel !== config.reviewModel)) throw new ReviewError('model');
            if (message.method === 'review.prepare') {
              if (!history) throw new ReviewError('snapshot');
              if (!history.complete || history.error) throw new ReviewError('snapshot');
              const { scan } = await Promise.race([history.promise, aborted]);
              // Freeze the same history/context before awaiting optional reference metadata.
              preparedReview = undefined;
              const frozenContext = structuredClone(contextSnapshot);
              const preparedAt = now();
              let catalog = { models: [], reference: null };
              try { catalog = await Promise.race([reviewService.catalog(controller.signal, { refresh: false }), aborted]); }
              catch { controller.signal.throwIfAborted(); /* A statistics-only review remains usable. */ }
              const snapshot = await prepareInsightReview(scan, input.filters, preparedAt, frozenContext, { catalog: catalog.reference });
              snapshot.catalogToken = catalog.token;
              const supported = catalog.models.find(m => m.id === config.reviewModel)?.reasoningEfforts || [];
              snapshot.model = config.reviewModel || '';
              snapshot.savedReasoning = config.reviewReasoning;
              snapshot.allowSamples = config.reviewAllowSamples !== false;
              snapshot.reasoningEffort = config.reviewReasoning || (supported.includes('medium') ? 'medium' : 'default');
              await finalizeInsightReview(snapshot, snapshot.allowSamples, controller.signal);
              const latest = await Promise.race([settings.get(), aborted]);
              if (latest.reviewModel !== config.reviewModel || latest.reviewReasoning !== config.reviewReasoning || (latest.reviewAllowSamples !== false) !== snapshot.allowSamples) throw new ReviewError('snapshot');
              controller.signal.throwIfAborted();
              preparedReview = snapshot;
              result = { id: snapshot.id, preview: snapshot.preview, scope: snapshot.scope, filterLabels: snapshot.filterLabels, capturedAt: snapshot.payload.capturedAt,
                model: snapshot.model, reasoningEffort: snapshot.reasoningEffort, allowSamples: snapshot.allowSamples, guidanceVersion: snapshot.guide.version, hasEvidence: snapshot.payload.evidence.length > 0,
                referenceStatus: describeModelReference(snapshot.payload.modelReference) };
            } else if (message.method === 'review.analyze') {
              const snapshot = preparedReview;
              if (!snapshot || snapshot.id !== input.snapshotId) throw new ReviewError('snapshot');
              if (!input.expectedModel || input.expectedModel !== snapshot.model || config.reviewModel !== snapshot.model) throw new ReviewError('model');
              if (input.expectedReasoning !== snapshot.reasoningEffort || config.reviewReasoning !== snapshot.savedReasoning) throw new ReviewError('effort');
              if (input.allowSamples !== snapshot.allowSamples || (config.reviewAllowSamples !== false) !== snapshot.allowSamples) throw new ReviewError('snapshot');
              preparedReview = undefined;
              const allowSamples = input.allowSamples && snapshot.allowSamples && config.reviewAllowSamples !== false;
              result = { ...await active(() => reviewService.review({ model: snapshot.model, reasoningEffort: snapshot.reasoningEffort, analysis: snapshot, allowSamples }, controller.signal)),
                scope: snapshot.scope, filterLabels: snapshot.filterLabels, capturedAt: snapshot.payload.capturedAt, filterKey: snapshot.filters };
            } else result = await active(() => message.method === 'review.catalog' ? reviewService.catalog(controller.signal)
              : message.method === 'review.reconnect' ? reviewService.reconnect(config.reviewModel, controller.signal)
                : reviewService.review({ model: config.reviewModel, prompt: input.prompt }, controller.signal));
            checkActivity();
          } catch (error) { throw requestActivity.signal.aborted ? requestActivity.signal.reason : error?.code === 'paused' ? error : safeReviewError(error); }
          finally {
            // Cancelled or failed reviews can also leave billed usage behind.
            if (requestActivity === activity && ['review.run', 'review.analyze'].includes(message.method)) history = undefined;
            clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAborted); res.removeListener('close', disconnected);
            if (reviewRequest === controller) reviewRequest = undefined;
          }
        }
      } else if (message.method === 'efficiency.context') {
        if (Object.keys(input).length) throw new TypeError('Context inspection does not accept options.');
        await activitySettings();
        checkActivity();
        result = await active(() => diagnostics.measure('context.read', {}, readContext));
        checkActivity();
        contextSnapshot = result;
      } else if (message.method === 'usage.inventory') {
        if (Object.keys(input).length) throw new TypeError('Inventory does not accept filters.');
        await activitySettings();
        checkActivity();
        result = await active(() => diagnostics.measure('inventory.read', {}, readIntegrations));
        checkActivity();
        for (const kind of ['mcp', 'plugins']) if (!result[kind].available) diagnostics.record('warn', 'inventory.unavailable', { kind, ...result[kind].diagnostic });
        // Reuse an existing response, so the panel retains server evidence even if it later
        // loses its connection. No heartbeat, extra scan, or extra request is necessary.
        result = { ...result, diagnostics: savedDiagnosticSnapshot() };
      } else if (message.method === 'settings.get') {
        result = { ...await settings.get(), defaultHome, runtimeSecurity: runtimeSecurityStatus(process.version) };
        if (result.paused === true) setPaused(true);
      }
      else if (message.method === 'settings.set') {
        const write = settings.set(input); settingsWrites.add(write);
        try { result = await write; setPaused(result.paused === true); } finally { settingsWrites.delete(write); }
      }
      else if (['usage.report', 'usage.refresh'].includes(message.method)) {
        const { buildReport, addInstalledSkillVersions } = await loadUsage();
        lifetime.signal.throwIfAborted();
        // Validate before opening any files.
        buildReport([], input, now());
        const config = await activitySettings();
        const { scan, scannedAt, loading, scanId: currentScan } = await active(() => readHistory(config, { refresh: message.refresh === true, force: message.method === 'usage.refresh', recent: true }));
        checkActivity();
        Object.assign(fields, { historyPhase: loading ? 'recent' : 'complete', scanId: currentScan });
        if (loading && !withinRecentRange(input, loading)) {
          json(res, 200, { loading: { ...loading, phase: 'history' } });
          diagnostics.record('info', 'api.request', { ...fields, historyPhase: 'history', phase: 'finished', httpStatus: 200, durationMs: performance.now() - started });
          return;
        }
        const at = now(), buildFields = { records: scan.records.length, range: input.range, promptEvents: scan.promptEvents?.length ?? 0, tools: scan.tools?.length ?? 0, skills: scan.skills?.length ?? 0 };
        const { entry, key, release } = diagnostics.measure('report.build', buildFields, () => { const found = reportFor(scan, input, at, buildReport); buildFields.cacheHit = found.cached; return found; });
        try {
          const skills = entry.report.skills;
          diagnostics.record('info', 'skills.report', { range: entry.report.query.range, historyPhase: loading ? 'recent' : 'complete', scanId: currentScan,
            skills: scan.skills?.length ?? 0, rows: skills.rows.length, skillUses: skills.invocations, skillFailures: skills.failures,
            omittedSkillUses: skills.omitted, omittedSkillFailures: skills.omittedFailures, unattributedUses: skills.unattributedUses, unattributedFailures: skills.unattributedFailures });
          // Installed versions are read from disk each time, onto copies, so the kept report stays as built.
          const rows = entry.report.skills.rows.map(row => ({ ...row }));
          if (!loading) await active(() => diagnostics.measure('skills.versions', { rows: rows.length }, () => addInstalledSkillVersions(rows)));
          checkActivity();
          const serializationFields = { range: input.range };
          const payload = diagnostics.measure('report.serialize', serializationFields, () => {
            const preferences = { textSize: config.textSize ?? 'small', simplifyNumbers: config.simplifyNumbers ?? true, paused: false };
            const { generatedAt, ...report } = entry.report;
            if (loading) report.promptCredits = { ...report.promptCredits, pending: true, averageCredits: null, credits: null };
            const extras = JSON.stringify([rows.map(row => row.installedVersion), preferences, loading, message.compact === true]);
            let content, retainedBytes;
            const serializeReport = () => {
              const full = { ...report, skills: { ...report.skills, rows }, sources: scan.sources, coverage: scan.coverage, preferences, loading };
              const wire = message.compact === true ? encodeReportWire(full) : full;
              const serialized = JSON.stringify(wire), bytes = Buffer.byteLength(serialized);
              retainedBytes = message.compact === true ? reportWireRetainedBytes(wire, bytes) : bytes;
              return serialized;
            };
            // Everything the dashboard shows except the two timestamps. Its fingerprint lets a
            // dashboard that already holds this exact content skip the download and the redraw.
            if (entry.sent?.extras !== extras) {
              content = serializeReport();
              entry.sent = { extras, revision: createHash('sha256').update(content).digest('base64url') };
            }
            // Publish only a sized, completed report. An oversized response is still
            // returned normally, and its revision still supports unchanged replies.
            if (content && reports.scan === scan) reports.built.set(key, entry, retainedBytes);
            const head = `{"generatedAt":${JSON.stringify(at.toISOString())},"scannedAt":${JSON.stringify(scannedAt || null)},"scanId":${currentScan},"revision":${JSON.stringify(entry.sent.revision)}`;
            fields.unchanged = message.known === entry.sent.revision;
            if (fields.unchanged) return finishPayload(head + (loading ? ',"loading":' + JSON.stringify(loading) : '') + ',"unchanged":true}');
            else {
              content ??= serializeReport();
              return finishPayload(head + ',' + content.slice(1));
            }
            function finishPayload(value) {
              Object.assign(serializationFields, { responseBytes: Buffer.byteLength(value), unchanged: fields.unchanged });
              return value;
            }
          });
          send(res, 200, payload);
          diagnostics.record('info', 'api.request', { ...fields, phase: 'finished', httpStatus: 200, durationMs: performance.now() - started });
          return;
        } finally { release(); }
      } else if (['usage.requests', 'usage.sessions', 'usage.modelProjects', 'usage.sessionModels'].includes(message.method)) {
        const { buildRequestPage, buildModelSessionPage, buildModelProjectPage, buildSessionModels, readRequestPrompts } = await loadUsage();
        lifetime.signal.throwIfAborted();
        const buildPage = message.method === 'usage.sessionModels' ? buildSessionModels : message.method === 'usage.modelProjects' ? buildModelProjectPage : message.method === 'usage.sessions' ? buildModelSessionPage : buildRequestPage;
        buildPage([], input, now());
        const config = await activitySettings();
        const { scan, loading } = await active(() => readHistory(config, { recent: true }));
        checkActivity();
        if (loading && !withinRecentRange(input, loading)) throw new Error('History for this date range is still loading.');
        result = buildPage(scan.records, input, now(), scan);
        if (input.id !== undefined) {
          const ids = new Set(result.rows.map(row => row.id));
          const promptFields = { rows: ids.size };
          const prompts = await active(() => diagnostics.measure('prompt.read', promptFields, async () => {
            const prompts = await readRequestPrompts(scan.records.filter(r => ids.has(r.key)), { maxChars: 12000, signal: requestActivity.signal });
            promptFields.unavailable = [...prompts.values()].filter(p => !p.available).length;
            return prompts;
          }));
          checkActivity();
          result.rows = result.rows.map(row => ({ ...row, prompt: prompts.get(row.id) }));
        }
      } else throw new TypeError('Unknown dashboard method');
      json(res, 200, result);
      if (message.method !== 'diagnostics.get') diagnostics.record('info', 'api.request', { ...fields, phase: 'finished', httpStatus: 200, durationMs: performance.now() - started });
    } catch (e) {
      if (lifetime.signal.aborted) return;
      if (e?.code === 'paused') { json(res, 423, { code: 'paused', paused: true, error: pausedError().message }); return; }
      const status = e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError ? 400 : 500;
      diagnostics.record('error', 'api.request', { ...fields, ...diagnosticError(e), phase: 'failed', httpStatus: status, durationMs: performance.now() - started });
      json(res, status, { error: e.message });
    }
  }
  await diagnostics.measure('server.bind', {}, () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint?.port ?? 0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  }));
  origin = `http://127.0.0.1:${server.address().port}`;
  diagnostics.record('info', 'server.listening');
  let closing;
  return {
    url: origin + prefix,
    close() {
      return closing ??= (async () => {
        diagnostics.record('info', 'server.closing');
        lifetime.abort();
        activity.abort();
        const closed = new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
        // Stop HTTP immediately. An abandoned, potentially very large scan must not hold
        // the canvas lifecycle queue (or its loopback port) until it finishes.
        server.closeAllConnections();
        reviewRequest?.abort(reviewAbortReason);
        preparedReview = contextSnapshot = undefined;
        await reviewService?.close();
        await Promise.allSettled([...settingsWrites]);
        await closed;
      })();
    },
  };
}
