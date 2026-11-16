import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createScanner } from './copilot-source.mjs';
import { createSettings, copilotHome, enhancePromptUsageHome, reviewUsageHome } from './settings.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildModelProjectPage, buildSessionModels } from '../core/copilot-report.mjs';
import { readRequestPrompts } from './request-prompts.mjs';
import { addInstalledSkillVersions } from './skill-version.mjs';
import { createIntegrationReader } from './integrations.mjs';
import { createDiagnostics, diagnosticError } from '../core/diagnostics.mjs';
import { localDay } from '../core/query.mjs';
import { createContextReader } from './context.mjs';
import { createReviewService, safeReviewError, ReviewError } from './ai-review.mjs';
import { prepareInsightReview } from './review-evidence.mjs';
import { loadReviewGuidance } from './review-insights.mjs';
import { createWslDiscovery } from './wsl-sources.mjs';
import { createVSCodeSources } from './vscode-sources.mjs';
import { validEndpoint } from './canvas-endpoint.mjs';

const MAX_BODY = 64 * 1024, MAX_REPORTS = 12;
// The latest time carried by anything in a scan: until then, the clock can still change a report.
function latestTime(scan) {
  let latest = -Infinity;
  for (const list of [scan.records, scan.skills, scan.interactions, scan.promptEvents, scan.tools]) for (const item of list || []) {
    if (item.ms > latest) latest = item.ms;
    if (item.completedMs > latest) latest = item.completedMs;
  }
  return latest;
}
export async function startServer({ settings = createSettings(), scanner, defaultHome = copilotHome(), html, now = () => new Date(), readIntegrations = createIntegrationReader(() => undefined), readContext = createContextReader(() => undefined), diagnostics = createDiagnostics(), session, reviewService = createReviewService(session, { diagnostics }), endpoint } = {}) {
  if (endpoint !== undefined && !validEndpoint(endpoint)) throw new TypeError('Invalid dashboard endpoint');
  scanner ??= createScanner({ optionalHomes: [enhancePromptUsageHome(), reviewUsageHome()], discoverWsl: createWslDiscovery({ diagnostics }), discoverVSCode: createVSCodeSources() });
  html ??= await readFile(new URL('../../panel/index.html', import.meta.url), 'utf8');
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  diagnostics.record('info', 'runtime.started');
  const diagnosticSnapshot = () => ({ version, capturedAt: now().toISOString(), runtime: { node: process.version, platform: process.platform, arch: process.arch, processId: process.pid }, ...diagnostics.snapshot() });
  const savedDiagnosticSnapshot = () => ({ ...diagnosticSnapshot(), ...(diagnostics.readPersisted ? { persisted: diagnostics.readPersisted() } : {}) });
  const token = endpoint?.token ?? randomBytes(32).toString('hex'), prefix = `/${token}/`;
  let origin;
  const pending = new Set();
  let history, reviewRequest, preparedReview, contextSnapshot;
  // Reports already built from the current scan, by filter. A scan is never altered once it is
  // returned, so a report stays right until the scan is replaced, the local day changes, or
  // something dated later than the report's own moment comes due.
  let reports = { scan: null, latest: -Infinity, built: new Map() };
  function reportFor(scan, input, at) {
    if (reports.scan !== scan) reports = { scan, latest: latestTime(scan), built: new Map() };
    const key = JSON.stringify(input), day = localDay(at), ms = at.getTime();
    let entry = reports.built.get(key);
    const cached = !!entry && entry.day === day && ms >= entry.ms && reports.latest <= entry.ms;
    if (!cached) {
      entry = { day, ms, report: buildReport(scan.records, input, at, scan), sent: null };
      reports.built.delete(key);
      if (reports.built.size >= MAX_REPORTS) reports.built.delete(reports.built.keys().next().value);
      reports.built.set(key, entry);
    }
    return { entry, cached };
  }
  function readHistory(config, { refresh = false, force = false } = {}) {
    const roots = [defaultHome, ...config.extraHomes], key = JSON.stringify([roots, config.disabledHomes, config.includeWsl !== false, config.readWslDatabases !== false, config.includeVSCode !== false, config.extraVSCodeHomes]);
    if (!history || history.key !== key || refresh || force) {
      const fields = { force };
      const entry = { key, promise: diagnostics.measure('history.scan', fields, async () => {
        const scan = await scanner.scan(roots, { disabled: config.disabledHomes, force, includeWsl: config.includeWsl !== false, readWslDatabases: config.readWslDatabases !== false, includeVSCode: config.includeVSCode !== false, extraVSCodeHomes: config.extraVSCodeHomes || [] });
        Object.assign(fields, { records: scan.records.length, sources: scan.sources?.length ?? 0,
          compactions: scan.records.filter(r => r.origin === 'compaction').length,
          environments: new Set((scan.sources || []).map(s => s.environment).filter(Boolean)).size,
          files: scan.sources?.reduce((sum, source) => sum + (source.files || 0), 0) ?? 0, ...scan.coverage });
        for (const [index, source] of (scan.sources || []).entries()) if (['error', 'warning', 'missing'].includes(source.state)) {
          diagnostics.record('warn', 'history.source', { sourceIndex: index + 1, sourceState: source.state, sourceKind: source.kind === 'vscode' ? 'vscode' : 'copilot', ...source.diagnostic });
        }
        return { scan, scannedAt: now().toISOString() };
      }) };
      history = entry;
      entry.promise.catch(() => { if (history === entry) history = undefined; });
    } else diagnostics.record('info', 'history.cache', { cacheHit: true });
    return history.promise;
  }
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const task = handle(req, res).catch(e => {
      diagnostics.record('error', 'server.response', diagnosticError(e));
      if (!res.headersSent) json(res, 500, { error: e.message });
      else res.end();
    }).finally(() => pending.delete(task));
    pending.add(task);
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
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Origin not allowed' });
    if (req.method === 'GET' && req.url === prefix) {
      const page = html.replace('<script type="application/json" id="initial-diagnostics">null</script>',
        () => `<script type="application/json" id="initial-diagnostics">${JSON.stringify(savedDiagnosticSnapshot()).replaceAll('<', '\\u003c')}</script>`);
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
    try {
      message = JSON.parse(body);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Expected an object');
      const input = message.input ?? {};
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be an object');
      if (message.refresh !== undefined && typeof message.refresh !== 'boolean') throw new TypeError('refresh must be a boolean');
      if (message.known !== undefined && typeof message.known !== 'string') throw new TypeError('known must be a string');
      Object.assign(fields, { method: message.method, range: input.range, refresh: message.refresh === true, detail: message.method === 'usage.requests' && input.id !== undefined });
      if (message.method !== 'diagnostics.get') diagnostics.record('info', 'api.request', { ...fields, phase: 'started' });
      let result;
      if (message.method === 'diagnostics.get') {
        if (Object.keys(input).length) throw new TypeError('Diagnostics does not accept options.');
        result = savedDiagnosticSnapshot();
      } else if (['review.catalog', 'review.reconnect', 'review.run', 'review.prepare', 'review.analyze', 'review.cancel'].includes(message.method)) {
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
            const config = await Promise.race([settings.get(), aborted]);
            clearTimeout(timer);
            if (res.destroyed || controller.signal.aborted) throw new ReviewError('cancelled');
            if (message.method === 'review.run' && (!input.expectedModel || input.expectedModel !== config.reviewModel)) throw new ReviewError('model');
            if (message.method === 'review.prepare') {
              if (!history) throw new ReviewError('snapshot');
              const { scan } = await Promise.race([history.promise, aborted]);
              const snapshot = await prepareInsightReview(scan, input.filters, now(), contextSnapshot);
              snapshot.guide = await loadReviewGuidance([...new Set(snapshot.payload.evidence.map(e => e.topic))]);
              const catalog = config.reviewModel ? await reviewService.catalog(controller.signal) : { models: [] };
              const supported = catalog.models.find(m => m.id === config.reviewModel)?.reasoningEfforts || [];
              snapshot.model = config.reviewModel || '';
              snapshot.savedReasoning = config.reviewReasoning;
              snapshot.allowSamples = config.reviewAllowSamples !== false;
              snapshot.reasoningEffort = config.reviewReasoning || (supported.includes('medium') ? 'medium' : 'default');
              controller.signal.throwIfAborted();
              preparedReview = snapshot;
              result = { id: snapshot.id, preview: snapshot.preview, scope: snapshot.scope, filterLabels: snapshot.filterLabels, capturedAt: snapshot.payload.capturedAt,
                model: snapshot.model, reasoningEffort: snapshot.reasoningEffort, allowSamples: snapshot.allowSamples, guidanceVersion: snapshot.guide.version, hasEvidence: snapshot.payload.evidence.length > 0 };
            } else if (message.method === 'review.analyze') {
              const snapshot = preparedReview;
              if (!snapshot || snapshot.id !== input.snapshotId) throw new ReviewError('snapshot');
              if (!input.expectedModel || input.expectedModel !== snapshot.model || config.reviewModel !== snapshot.model) throw new ReviewError('model');
              if (input.expectedReasoning !== snapshot.reasoningEffort || config.reviewReasoning !== snapshot.savedReasoning) throw new ReviewError('effort');
              preparedReview = undefined;
              const allowSamples = input.allowSamples && snapshot.allowSamples && config.reviewAllowSamples !== false;
              result = { ...await reviewService.review({ model: snapshot.model, reasoningEffort: snapshot.reasoningEffort, analysis: snapshot, allowSamples }, controller.signal),
                scope: snapshot.scope, filterLabels: snapshot.filterLabels, capturedAt: snapshot.payload.capturedAt, filterKey: snapshot.filters };
            } else result = message.method === 'review.catalog' ? await reviewService.catalog(controller.signal)
              : message.method === 'review.reconnect' ? await reviewService.reconnect(config.reviewModel, controller.signal)
                : await reviewService.review({ model: config.reviewModel, prompt: input.prompt }, controller.signal);
          } catch (error) { throw safeReviewError(error); }
          finally {
            // Cancelled or failed reviews can also leave billed usage behind.
            if (['review.run', 'review.analyze'].includes(message.method)) history = undefined;
            clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAborted); res.removeListener('close', disconnected);
            if (reviewRequest === controller) reviewRequest = undefined;
          }
        }
      } else if (message.method === 'efficiency.context') {
        if (Object.keys(input).length) throw new TypeError('Context inspection does not accept options.');
        result = await diagnostics.measure('context.read', {}, readContext);
        contextSnapshot = result;
      } else if (message.method === 'usage.inventory') {
        if (Object.keys(input).length) throw new TypeError('Inventory does not accept filters.');
        result = await diagnostics.measure('inventory.read', {}, readIntegrations);
        for (const kind of ['mcp', 'plugins']) if (!result[kind].available) diagnostics.record('warn', 'inventory.unavailable', { kind, ...result[kind].diagnostic });
        // Reuse an existing response, so the panel retains server evidence even if it later
        // loses its connection. No heartbeat, extra scan, or extra request is necessary.
        result = { ...result, diagnostics: savedDiagnosticSnapshot() };
      } else if (message.method === 'settings.get') result = { ...await settings.get(), defaultHome };
      else if (message.method === 'settings.set') result = await settings.set(input);
      else if (['usage.report', 'usage.refresh'].includes(message.method)) {
        // Validate before opening any files.
        buildReport([], input, now());
        const config = await settings.get();
        const { scan, scannedAt } = await readHistory(config, { refresh: message.refresh === true, force: message.method === 'usage.refresh' });
        const at = now(), buildFields = { records: scan.records.length, range: input.range };
        const { entry } = diagnostics.measure('report.build', buildFields, () => { const found = reportFor(scan, input, at); buildFields.cached = found.cached; return found; });
        // Installed versions are read from disk each time, onto copies, so the kept report stays as built.
        const rows = entry.report.skills.rows.map(row => ({ ...row }));
        await diagnostics.measure('skills.versions', { rows: rows.length }, () => addInstalledSkillVersions(rows));
        const preferences = { textSize: config.textSize ?? 'small', simplifyNumbers: config.simplifyNumbers ?? true };
        const { generatedAt, ...report } = entry.report;
        const extras = JSON.stringify([rows.map(row => row.installedVersion), preferences]);
        let content;
        // Everything the dashboard shows except the two timestamps. Its fingerprint lets a
        // dashboard that already holds this exact content skip the download and the redraw.
        if (entry.sent?.extras !== extras) {
          content = JSON.stringify({ ...report, skills: { ...report.skills, rows }, sources: scan.sources, coverage: scan.coverage, preferences });
          entry.sent = { extras, revision: createHash('sha256').update(content).digest('base64url') };
        }
        const head = `{"generatedAt":${JSON.stringify(at.toISOString())},"scannedAt":${JSON.stringify(scannedAt)},"revision":${JSON.stringify(entry.sent.revision)}`;
        fields.unchanged = message.known === entry.sent.revision;
        if (fields.unchanged) send(res, 200, head + ',"unchanged":true}');
        else {
          content ??= JSON.stringify({ ...report, skills: { ...report.skills, rows }, sources: scan.sources, coverage: scan.coverage, preferences });
          send(res, 200, head + ',' + content.slice(1));
        }
        diagnostics.record('info', 'api.request', { ...fields, phase: 'finished', httpStatus: 200, durationMs: performance.now() - started });
        return;
      } else if (['usage.requests', 'usage.sessions', 'usage.modelProjects', 'usage.sessionModels'].includes(message.method)) {
        const buildPage = message.method === 'usage.sessionModels' ? buildSessionModels : message.method === 'usage.modelProjects' ? buildModelProjectPage : message.method === 'usage.sessions' ? buildModelSessionPage : buildRequestPage;
        buildPage([], input, now());
        const config = await settings.get();
        const { scan } = await readHistory(config);
        result = buildPage(scan.records, input, now(), scan);
        if (input.id !== undefined) {
          const ids = new Set(result.rows.map(row => row.id));
          const promptFields = { rows: ids.size };
          const prompts = await diagnostics.measure('prompt.read', promptFields, async () => {
            const prompts = await readRequestPrompts(scan.records.filter(r => ids.has(r.key)), { maxChars: 12000 });
            promptFields.unavailable = [...prompts.values()].filter(p => !p.available).length;
            return prompts;
          });
          result.rows = result.rows.map(row => ({ ...row, prompt: prompts.get(row.id) }));
        }
      } else throw new TypeError('Unknown dashboard method');
      json(res, 200, result);
      if (message.method !== 'diagnostics.get') diagnostics.record('info', 'api.request', { ...fields, phase: 'finished', httpStatus: 200, durationMs: performance.now() - started });
    } catch (e) {
      const status = e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError ? 400 : 500;
      diagnostics.record('error', 'api.request', { ...fields, ...diagnosticError(e), phase: 'failed', httpStatus: status, durationMs: performance.now() - started });
      json(res, status, { error: e.message });
    }
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint?.port ?? 0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  diagnostics.record('info', 'server.listening');
  let closing;
  return {
    url: origin + prefix,
    close() {
      return closing ??= (async () => {
        diagnostics.record('info', 'server.closing');
        const closed = new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
        reviewRequest?.abort(new ReviewError('cancelled'));
        preparedReview = contextSnapshot = undefined;
        await reviewService.close();
        server.closeIdleConnections();
        await Promise.allSettled([...pending]);
        server.closeAllConnections();
        await closed;
      })();
    },
  };
}
