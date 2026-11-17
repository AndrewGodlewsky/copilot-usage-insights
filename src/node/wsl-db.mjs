import path from 'node:path';
import { execFile } from 'node:child_process';
import { normalizeDatabaseRows, USAGE_DB_FIELDS } from './copilot-db.mjs';
import { readUsageDatabaseInProcess } from './copilot-db-process-reader.mjs';
import { parseWslDistributions } from './wsl-sources.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const runProcess = (file, args, options, input = '') => new Promise((resolve, reject) => {
  const child = execFile(file, args, options, (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin.on('error', reject);
  child.stdin.end(input);
});

// Read a SQLite transaction in its owning environment. Never copy live DB/WAL/SHM files.
export const WSL_USAGE_EXPORT = `
import json, pathlib, re, signal, sqlite3, sys, time
# Killing wsl.exe alone need not terminate its Linux child. SIGALRM also bounds
# blocked filesystem/SQLite work; keep its default action, not a Python handler.
if hasattr(signal, 'alarm'):
    signal.signal(signal.SIGALRM, signal.SIG_DFL)
    signal.alarm(4)
deadline = time.monotonic() + 4
db = None
try:
    excluded = set(json.loads(sys.stdin.read(2 * 1024 * 1024 + 1)))
    file = pathlib.Path(sys.argv[1])
    if not file.is_file():
        raise ValueError('unavailable')
    db = sqlite3.connect(file.as_uri() + '?mode=ro', uri=True, timeout=1)
    db.row_factory = sqlite3.Row
    db.set_progress_handler(lambda: time.monotonic() >= deadline, 10000)
    db.execute('PRAGMA query_only = ON')
    db.execute('PRAGMA trusted_schema = OFF')
    db.execute('BEGIN')
    fields = ${JSON.stringify(USAGE_DB_FIELDS)}
    tables = {r['name'] for r in db.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('assistant_usage_events', 'sessions')") if isinstance(r['sql'], str) and not re.match(r'^\\s*CREATE\\s+VIRTUAL\\b', re.sub(r'/\\*.*?\\*/|--[^\\r\\n]*', ' ', r['sql'], flags=re.S), re.I)}
    columns = {r['name'] for r in db.execute('PRAGMA table_info(assistant_usage_events)')} if 'assistant_usage_events' in tables else set()
    supported = all(f in columns for f in ['id', 'session_id', 'model', 'created_at'])
    rows, sessions = [], []
    size = 0
    def append(target, row):
        global size
        item = dict(row)
        size += len(json.dumps(item, ensure_ascii=True).encode('utf-8')) + 2
        if size > ${MAX_BYTES - 1024}:
            raise ValueError('limit')
        target.append(item)
    sc = {r['name'] for r in db.execute('PRAGMA table_info(sessions)')} if 'sessions' in tables else set()
    if 'id' in sc:
        projection = ','.join('"' + f + '"' if f in sc else "'' AS " + f for f in ['id', 'cwd', 'repository', 'summary'])
        for row in db.execute('SELECT ' + projection + ' FROM sessions'):
            append(sessions, row)
    needed = supported and any(r['session_id'] not in excluded for r in db.execute('SELECT DISTINCT session_id COLLATE BINARY AS session_id FROM assistant_usage_events'))
    if needed:
        projection = ','.join('"' + f + '"' if f in columns else 'NULL AS "' + f + '"' for f in fields)
        for row in db.execute('SELECT ' + projection + ' FROM assistant_usage_events ORDER BY id'):
            if row['session_id'] not in excluded:
                append(rows, row)
    result = {'supported': supported, 'sessions': sessions, 'rows': rows}
except Exception as error:
    result = {'error': True, 'sqliteCode': getattr(error, 'sqlite_errorcode', None), 'timeout': time.monotonic() >= deadline}
finally:
    if db is not None:
        db.close()
sys.stdout.write(json.dumps(result, ensure_ascii=True, allow_nan=False))
`;

export function wslDatabaseLocation(file) {
  if (typeof file !== 'string' || file.length > 4096 || /[\x00-\x1f\x7f]/.test(file)) return null;
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\/]+)\\(.+)$/i.exec(file);
  if (!match || !parseWslDistributions(match[1]).includes(match[1])) return null;
  const parts = match[2].split(/[\\/]/);
  if (parts.some(p => !p || p === '.' || p === '..') || parts.at(-1) !== 'session-store.db') return null;
  return { distribution: match[1], file: '/' + parts.join('/') };
}

const isLocked = error => ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code)
  || error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) && [5, 6].includes(error.errcode & 255);
const unavailable = () => new Error('Could not read the locked WSL usage database. Check that the distribution is running, /usr/bin/python3 includes sqlite3, and its default user can read this Copilot home. Journals remain included.');

export function createUsageDatabaseReader({ platform = process.platform, readLocal = readUsageDatabaseInProcess, run = runProcess, timeoutMs = 5000, localTimeoutMs = 30000 } = {}) {
  let queue = Promise.resolve();
  return async (file, receiptSessions, source, { readWslDatabases = true, signal } = {}) => {
    signal?.throwIfAborted();
    const location = platform === 'win32' && wslDatabaseLocation(file);
    // A Windows lock wait cannot resolve WSL's WAL locking incompatibility; use the native fallback immediately.
    try {
      const next = queue.then(() => { signal?.throwIfAborted(); return readLocal(file, receiptSessions, source, { waitForLock: !location, signal, timeoutMs: location ? timeoutMs : localTimeoutMs }); });
      queue = next.catch(() => {});
      return await next;
    }
    catch (error) {
      signal?.throwIfAborted();
      if (!location || !isLocked(error)) throw error;
      if (!readWslDatabases) throw new Error('WSL usage database is locked and the native WSL database reader is disabled in Settings. Journals remain included.');
      const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', process.arch === 'ia32' ? 'Sysnative' : 'System32', 'wsl.exe');
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)));
      const options = { shell: false, windowsHide: true, env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_BYTES, encoding: 'utf8', ...(signal ? { signal } : {}) };
      try {
        const running = parseWslDistributions(await run(executable, ['--list', '--running', '--quiet'], { ...options, encoding: 'buffer', maxBuffer: 64 * 1024 }));
        if (!running.some(name => name.toLowerCase() === location.distribution.toLowerCase())) throw unavailable();
        const input = JSON.stringify([...receiptSessions]);
        if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw unavailable();
        const output = await run(executable, ['--distribution', location.distribution, '--cd', '/', '--exec', '/usr/bin/python3', '-I', '-S', '-B', '-c', WSL_USAGE_EXPORT, location.file], options, input);
        const payload = JSON.parse(output);
        if (payload?.error) {
          const failure = unavailable();
          if (Number.isInteger(payload.sqliteCode) && payload.sqliteCode >= 0 && payload.sqliteCode <= 65535) Object.assign(failure, { code: 'ERR_SQLITE_ERROR', errcode: payload.sqliteCode });
          if (payload.timeout === true) failure.code = 'ETIMEDOUT';
          throw failure;
        }
        if (!payload || typeof payload.supported !== 'boolean' || !Array.isArray(payload.rows) || !Array.isArray(payload.sessions)
          || [...payload.rows, ...payload.sessions].some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw unavailable();
        return { ...normalizeDatabaseRows(payload.rows, new Map(payload.sessions.map(s => [s.id, s])), receiptSessions, source, payload.supported), databaseRead: 'wsl' };
      } catch (error) {
        signal?.throwIfAborted();
        const failure = unavailable();
        if (error?.code === 'ERR_SQLITE_ERROR') Object.assign(failure, { code: error.code, errcode: error.errcode });
        if (error?.killed || error?.code === 'ETIMEDOUT') failure.code = 'ETIMEDOUT';
        throw failure;
      }
    }
  };
}
