import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_INPUT = 32 * 1024 * 1024, MAX_OUTPUT = 512 * 1024 * 1024, MAX_LINE = 8 * 1024 * 1024;
const fields = new Set(['records', 'coverageEntries', 'skillExcludedSessions', 'sessionNames']);
const failure = (message = 'Could not read the usage database. Journals remain included.', code) => Object.assign(new Error(message), code ? { code } : {});

// SQLite native queries cannot be interrupted by Worker.terminate(). A disposable process can.
export function readUsageDatabaseInProcess(file, receiptSessions, source, { waitForLock = true, signal, timeoutMs = 30000 } = {}) {
  return readDatabaseInProcess(file, receiptSessions, source, { waitForLock, signal, timeoutMs });
}

export async function readDesktopSessionNamesInProcess(file, sessionIds, { signal, timeoutMs = 30000 } = {}) {
  signal?.throwIfAborted();
  try { if (!(await fs.stat(file)).isFile()) return new Map(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return new Map(); throw error; }
  const result = await readDatabaseInProcess(file, sessionIds, path.dirname(file), { signal, timeoutMs, operation: 'names' });
  return new Map(result.sessionNames);
}

function readDatabaseInProcess(file, receiptSessions, source, { waitForLock = true, signal, timeoutMs = 30000, operation = 'usage' }) {
  signal?.throwIfAborted();
  const sessions = [];
  let inputBytes = Buffer.byteLength(file) + Buffer.byteLength(source) + 128;
  for (const session of receiptSessions) {
    inputBytes += Buffer.byteLength(JSON.stringify(session)) + 1;
    if (inputBytes > MAX_INPUT) throw failure('Usage database input exceeded the reader limit. Journals remain included.', 'EFBIG');
    sessions.push(session);
  }
  const input = JSON.stringify({ file, receiptSessions: sessions, source, waitForLock, operation });
  if (Buffer.byteLength(input) > MAX_INPUT) throw failure('Usage database input exceeded the reader limit. Journals remain included.', 'EFBIG');
  return new Promise((resolve, reject) => {
    const entry = fileURLToPath(new URL('./copilot-db-process.mjs', import.meta.url));
    const embedded = /^(copilot|copilot-runtime)(\.exe)?$/i.test(path.basename(process.execPath));
    const bootstrap = process.argv.find(arg => path.isAbsolute(arg) && path.basename(arg) === 'extension_bootstrap.mjs');
    if (embedded && !bootstrap) { reject(failure()); return; }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|COPILOT_SDK_PATH)$/i.test(key)));
    Object.assign(env, { EXTENSION_PATH: entry, COPILOT_EXTENSION_PARENT_PID: String(process.pid), COPILOT_EXTENSION_SANDBOXED: '0' });
    const child = spawn(process.execPath, embedded ? [bootstrap] : ['--max-old-space-size=1024', entry], { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const result = { records: [], coverageEntries: [], skillExcludedSessions: [], sessionNames: [] };
    let pending = '', bytes = 0, error, complete = false, summary = false, settled = false;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (err) reject(err); else resolve(val);
    };
    const stop = reason => { error ||= reason; try { child.kill('SIGKILL'); } catch {} };
    const abort = () => stop(signal.reason);
    const timer = setTimeout(() => stop(failure('Usage database read timed out. Journals remain included; refresh to retry.', 'ETIMEDOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', reason => { error ||= reason; if (!child.pid) finish(error); });
    child.stdin.on('error', reason => { if (reason?.code !== 'EPIPE') stop(reason); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (error) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_OUTPUT) { stop(failure('Usage database output exceeded the reader limit. Journals remain included.', 'EFBIG')); return; }
      pending += chunk;
      for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (Buffer.byteLength(line) > MAX_LINE) { stop(failure('A usage database result exceeded the reader limit. Journals remain included.', 'EFBIG')); return; }
        try {
          const message = JSON.parse(line);
          if (message.error) {
            const failed = failure();
            if (typeof message.error.code === 'string') failed.code = message.error.code;
            if (Number.isInteger(message.error.errcode)) failed.errcode = message.error.errcode;
            stop(failed); return;
          }
          if (complete) throw failure();
          if (message.summary && typeof message.summary === 'object' && !Array.isArray(message.summary) && !summary) {
            for (const key of ['unclassified', 'invalid', 'warning']) if (Object.hasOwn(message.summary, key)) result[key] = message.summary[key];
            summary = true;
          }
          else if (summary && fields.has(message.field) && Array.isArray(message.items) && message.items.length <= 1000) result[message.field].push(...message.items);
          else if (summary && message.done === true) complete = true;
          else throw failure();
        } catch (reason) { stop(reason); return; }
      }
      if (Buffer.byteLength(pending) > MAX_LINE) stop(failure('A usage database result exceeded the reader limit. Journals remain included.', 'EFBIG'));
    });
    child.once('close', code => {
      if (error) finish(error);
      else if (code !== 0 || !complete || pending.length) finish(failure());
      else finish(null, result);
    });
    child.stdin.end(input);
  });
}
