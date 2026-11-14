import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createScanner } from './copilot-source.mjs';
import { createSettings, copilotHome } from './settings.mjs';
import { buildReport } from '../core/copilot-report.mjs';

const MAX_BODY = 64 * 1024;
export async function startServer({ settings = createSettings(), scanner = createScanner(), defaultHome = copilotHome(), html, now = () => new Date() } = {}) {
  html ??= await readFile(new URL('../../panel/index.html', import.meta.url), 'utf8');
  const token = randomBytes(32).toString('hex'), prefix = `/${token}/`;
  let origin;
  const pending = new Set();
  const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    const task = handle(req, res).catch(e => {
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
    try {
      message = JSON.parse(body);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Expected an object');
      const input = message.input ?? {};
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be an object');
      let result;
      if (message.method === 'settings.get') result = { ...await settings.get(), defaultHome };
      else if (message.method === 'settings.set') result = await settings.set(input);
      else if (['usage.report', 'usage.refresh'].includes(message.method)) {
        // Validate before opening any files.
        buildReport([], input, now());
        const config = await settings.get();
        const scan = await scanner.scan([defaultHome, ...config.extraHomes], { disabled: config.disabledHomes, force: message.method === 'usage.refresh' });
        result = { ...buildReport(scan.records, input, now()), sources: scan.sources, coverage: scan.coverage };
      } else throw new TypeError('Unknown dashboard method');
      json(res, 200, result);
    } catch (e) { json(res, e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError ? 400 : 500, { error: e.message }); }
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  let closing;
  return {
    url: origin + prefix,
    close() {
      return closing ??= (async () => {
        const closed = new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
        server.closeIdleConnections();
        await Promise.allSettled([...pending]);
        server.closeAllConnections();
        await closed;
      })();
    },
  };
}
