import { DatabaseSync } from 'node:sqlite';
import { normalizeUsage, normalizeSessionName } from '../core/copilot.mjs';
import { createCoverageCollector } from '../core/coverage.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function readDesktopSessionNames(file, sessionIds) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 1000;');
    const columns = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name));
    if (!columns.has('id') || !columns.has('title')) return new Map();
    const names = new Map();
    // Many sessions are read in one pass over the table instead of one query each. That is the
    // same answer only while IDs are plain, unique text compared exactly; otherwise ask per ID.
    let titles = null;
    if (sessionIds.size > 32 && !/collate/i.test(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()?.sql ?? 'collate')) {
      titles = new Map();
      for (const row of db.prepare('SELECT id, title FROM sessions').iterate()) {
        if (typeof row.id !== 'string' || titles.has(row.id)) { titles = null; break; }
        titles.set(row.id, row.title);
      }
    }
    const query = titles ? null : db.prepare('SELECT title FROM sessions WHERE id = ?');
    for (const id of sessionIds) {
      const name = normalizeSessionName(titles ? titles.get(id) : query.get(id)?.title);
      if (name) names.set(id, name);
    }
    return names;
  } catch {
    // Desktop metadata is optional; older names and usage remain available if it cannot be read.
    return new Map();
  } finally { db?.close(); }
}

export const USAGE_DB_FIELDS = ['id', 'session_id', 'model', 'created_at', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'total_nano_aiu'];

export function readUsageDatabase(file, receiptSessions, source) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 1000;');
    const columns = new Set(db.prepare('PRAGMA table_info(assistant_usage_events)').all().map(c => c.name));
    const supported = ['id', 'session_id', 'model', 'created_at'].every(c => columns.has(c));
    const fields = USAGE_DB_FIELDS;
    const sql = `SELECT ${fields.map(f => columns.has(f) ? `"${f}"` : `NULL AS "${f}"`).join(',')} FROM assistant_usage_events ORDER BY id`;
    let projects = new Map();
    const sc = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name));
    if (sc.has('id')) projects = new Map(db.prepare(`SELECT id, ${sc.has('cwd') ? 'cwd' : "'' AS cwd"}, ${sc.has('repository') ? 'repository' : "'' AS repository"}, ${sc.has('summary') ? 'summary' : "'' AS summary"} FROM sessions`).all().map(s => [s.id, s]));
    // Rows of sessions that have journal receipts are skipped, which for most histories is every
    // row. One pass over the distinct session IDs avoids fetching rows only to discard them.
    const needed = supported && db.prepare('SELECT DISTINCT session_id COLLATE BINARY AS session_id FROM assistant_usage_events').all().some(row => !receiptSessions.has(row.session_id));
    return normalizeDatabaseRows(needed ? db.prepare(sql).iterate() : [], projects, receiptSessions, source, supported);
  } finally { db?.close(); }
}

export function normalizeDatabaseRows(rows, projects, receiptSessions, source, supported) {
  const records = [], occurrences = new Map(), skillExcludedSessions = new Set();
  const coverage = createCoverageCollector(source, path.join(source, 'session-store.db'));
  let unclassified = 0, invalid = 0;
  for (const row of rows) {
    if (receiptSessions.has(row.session_id)) continue;
    const fingerprint = JSON.stringify(['sqlite', row.session_id, row.created_at, row.model, row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens, row.total_nano_aiu]);
    const n = occurrences.get(fingerprint) ?? 0; occurrences.set(fingerprint, n + 1);
    const context = projects.get(row.session_id);
    const timestamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.created_at) ? row.created_at.replace(' ', 'T') + 'Z' : row.created_at;
    const result = normalizeUsage({ model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens, cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens, reasoningTokens: row.reasoning_tokens, copilotUsage: row.total_nano_aiu === null ? undefined : { totalNanoAiu: row.total_nano_aiu } }, {
      key: `${fingerprint}:${n}`, timestamp,
      sessionId: row.session_id, project: context?.repository ?? '', cwd: context?.cwd ?? '', source,
    });
    if (result.record) records.push(result.record);
    else if (result.reason === 'unclassified') unclassified++;
    else invalid++;
    if (!result.record) {
      skillExcludedSessions.add(row.session_id);
      // Match usage deduplication without retaining its token-field fingerprint in coverage metadata.
      const key = createHash('sha256').update(`${fingerprint}:${n}`).digest('hex');
      coverage.add(result.reason || 'invalid', { key: `db:${key}`, timestamp,
        sessionId: row.session_id, project: context?.repository || context?.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || '', model: row.model || '' });
    }
  }
  return { records, unclassified, invalid, coverageEntries: coverage.snapshot(), skillExcludedSessions: [...skillExcludedSessions], sessionNames: [...projects].map(([id, s]) => [id, normalizeSessionName(s.summary)]), warning: supported ? '' : 'Unsupported Copilot usage database schema' };
}
