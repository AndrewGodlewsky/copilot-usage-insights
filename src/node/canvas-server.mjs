import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createScanner } from './copilot-source.mjs';
import { createSettings, copilotHome, enhancePromptUsageHome, reviewUsageHome } from './settings.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildSessionModels } from '../core/copilot-report.mjs';
import { readRequestPrompts } from './request-prompts.mjs';
import { openSkillFolder } from './skill-folder.mjs';
import { addInstalledSkillVersions } from './skill-version.mjs';
import { createIntegrationReader } from './integrations.mjs';
import { mergeMcpInventory } from '../core/integrations.mjs';
import { createDiagnostics, diagnosticError } from '../core/diagnostics.mjs';
import { createContextReader } from './context.mjs';
import { createReviewService, safeReviewError, ReviewError } from './ai-review.mjs';

const MAX_BODY = 64 * 1024;
export async function startServer({ settings = createSettings(), scanner = createScanner({ optionalHomes: [enhancePromptUsageHome(), reviewUsageHome()] }), defaultHome = copilotHome(), html, now = () => new Date(), openFolder = openSkillFolder, readIntegrations = createIntegrationReader(() => undefined), readContext = createContextReader(() => undefined), diagnostics = createDiagnostics(), session, reviewService = createReviewService(session, { diagnostics }) } = {}) {
  html ??= await readFile(new URL('../../panel/index.html', import.meta.url), 'utf8');
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  diagnostics.record('info', 'runtime.started');
  const token = randomBytes(32).toString('hex'), prefix = `/${token}/`;
  let origin;
  const pending = new Set();
  let history, reviewRequest;
  function readHistory(config, { refresh = false, force = false } = {}) {
    const roots = [defaultHome, ...config.extraHomes], key = JSON.stringify([roots, config.disabledHomes]);
    if (!history || history.key !== key || refresh || force) {
      const fields = { force };
      const entry = { key, promise: diagnostics.measure('history.scan', fields, async () => {
        const scan = await scanner.scan(roots, { disabled: config.disabledHomes, force });
        Object.assign(fields, { records: scan.records.length, sources: scan.sources?.length ?? 0,
          files: scan.sources?.reduce((sum, source) => sum + (source.files || 0), 0) ?? 0, ...scan.coverage });
        for (const [index, source] of (scan.sources || []).entries()) if (['error', 'warning', 'missing'].includes(source.state)) {
          diagnostics.record('warn', 'history.source', { sourceIndex: index + 1, sourceState: source.state, ...source.diagnostic });
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
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Origin not allowed' });
    if (req.method === 'GET' && req.url === prefix) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
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
      Object.assign(fields, { method: message.method, range: input.range, refresh: message.refresh === true, detail: message.method === 'usage.requests' && input.id !== undefined });
      if (message.method !== 'diagnostics.get') diagnostics.record('info', 'api.request', { ...fields, phase: 'started' });
      let result;
      if (message.method === 'diagnostics.get') {
        if (Object.keys(input).length) throw new TypeError('Diagnostics does not accept options.');
        result = { version, runtime: { node: process.version, platform: process.platform, arch: process.arch }, ...diagnostics.snapshot() };
      } else if (['review.catalog', 'review.reconnect', 'review.run', 'review.cancel'].includes(message.method)) {
        if (Object.keys(input).some(key => message.method !== 'review.run' || !['prompt', 'expectedModel'].includes(key))) throw new TypeError('Unexpected review options.');
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
            result = message.method === 'review.catalog' ? await reviewService.catalog(controller.signal)
              : message.method === 'review.reconnect' ? await reviewService.reconnect(config.reviewModel, controller.signal)
                : await reviewService.review({ model: config.reviewModel, prompt: input.prompt }, controller.signal);
          } catch (error) { throw safeReviewError(error); }
          finally {
            clearTimeout(timer); controller.signal.removeEventListener('abort', rejectAborted); res.removeListener('close', disconnected);
            if (reviewRequest === controller) reviewRequest = undefined;
          }
        }
      } else if (message.method === 'efficiency.context') {
        if (Object.keys(input).length) throw new TypeError('Context inspection does not accept options.');
        result = await diagnostics.measure('context.read', {}, readContext);
      } else if (message.method === 'settings.get') result = { ...await settings.get(), defaultHome };
      else if (message.method === 'settings.set') result = await settings.set(input);
      else if (['usage.report', 'usage.refresh'].includes(message.method)) {
        // Validate before opening any files.
        buildReport([], input, now());
        const config = await settings.get();
        const { scan, scannedAt } = await readHistory(config, { refresh: message.refresh === true, force: message.method === 'usage.refresh' });
        result = { ...diagnostics.measure('report.build', { records: scan.records.length, range: input.range }, () => buildReport(scan.records, input, now(), scan)), scannedAt, sources: scan.sources, coverage: scan.coverage, preferences: { textSize: config.textSize ?? 'small', simplifyNumbers: config.simplifyNumbers ?? true } };
        await diagnostics.measure('skills.versions', { rows: result.skills.rows.length }, () => addInstalledSkillVersions(result.skills.rows));
        const inventory = await diagnostics.measure('inventory.read', {}, readIntegrations);
        for (const kind of ['mcp', 'plugins']) if (!inventory[kind].available) diagnostics.record('warn', 'inventory.unavailable', { kind, ...inventory[kind].diagnostic });
        result.mcp = mergeMcpInventory(result.mcp, inventory.mcp);
        result.plugins = inventory.plugins;
      } else if (['usage.requests', 'usage.sessions', 'usage.sessionModels'].includes(message.method)) {
        const buildPage = message.method === 'usage.sessionModels' ? buildSessionModels : message.method === 'usage.sessions' ? buildModelSessionPage : buildRequestPage;
        buildPage([], input, now());
        const config = await settings.get();
        const { scan } = await readHistory(config);
        result = buildPage(scan.records, input, now());
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
      } else if (message.method === 'skills.openFolder') {
        if (typeof input.id !== 'string' || !input.id || Object.keys(input).some(key => key !== 'id')) throw new TypeError('Expected a recorded skill ID.');
        const config = await settings.get();
        const scan = await scanner.scan([defaultHome, ...config.extraHomes], { disabled: config.disabledHomes });
        const row = buildReport(scan.records, { range: 'all' }, now(), scan).skills.rows.find(skill => skill.id === input.id);
        if (!row?.path) throw new TypeError('This skill location is not available in the current sources. Refresh the dashboard and try again.');
        await openFolder(row.path);
        result = { ok: true };
      } else throw new TypeError('Unknown dashboard method');
      json(res, 200, result);
      if (message.method !== 'diagnostics.get') diagnostics.record('info', 'api.request', { ...fields, phase: 'finished', httpStatus: 200, durationMs: performance.now() - started });
    } catch (e) {
      const status = e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError ? 400 : 500;
      diagnostics.record('error', 'api.request', { ...fields, ...diagnosticError(e), phase: 'failed', httpStatus: status, durationMs: performance.now() - started });
      json(res, status, { error: e.message });
    }
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  let closing;
  return {
    url: origin + prefix,
    close() {
      return closing ??= (async () => {
        const closed = new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
        reviewRequest?.abort(new ReviewError('cancelled'));
        await reviewService.close();
        server.closeIdleConnections();
        await Promise.allSettled([...pending]);
        server.closeAllConnections();
        await closed;
      })();
    },
  };
}
