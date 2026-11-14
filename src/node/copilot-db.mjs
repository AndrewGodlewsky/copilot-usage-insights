import { DatabaseSync } from 'node:sqlite';
import { normalizeUsage, normalizeSessionName } from '../core/copilot.mjs';

export function readUsageDatabase(file, receiptSessions, source) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
    const columns = new Set(db.prepare('PRAGMA table_info(assistant_usage_events)').all().map(c => c.name));
    const supported = ['id', 'session_id', 'model', 'created_at'].every(c => columns.has(c));
    const fields = ['id', 'session_id', 'model', 'created_at', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens', 'total_nano_aiu'];
    const sql = `SELECT ${fields.map(f => columns.has(f) ? `"${f}"` : `NULL AS "${f}"`).join(',')} FROM assistant_usage_events ORDER BY id`;
    let projects = new Map();
    const sc = new Set(db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name));
    if (sc.has('id')) projects = new Map(db.prepare(`SELECT id, ${sc.has('cwd') ? 'cwd' : "'' AS cwd"}, ${sc.has('repository') ? 'repository' : "'' AS repository"}, ${sc.has('summary') ? 'summary' : "'' AS summary"} FROM sessions`).all().map(s => [s.id, s]));
    const records = [], occurrences = new Map(), skillExcludedSessions = new Set();
    let unclassified = 0, invalid = 0;
    for (const row of supported ? db.prepare(sql).iterate() : []) {
      if (receiptSessions.has(row.session_id)) continue;
      const fingerprint = JSON.stringify(['sqlite', row.session_id, row.created_at, row.model, row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_write_tokens, row.total_nano_aiu]);
      const n = occurrences.get(fingerprint) ?? 0; occurrences.set(fingerprint, n + 1);
      const context = projects.get(row.session_id);
      const result = normalizeUsage({ model: row.model, inputTokens: row.input_tokens, outputTokens: row.output_tokens, cacheReadTokens: row.cache_read_tokens, cacheWriteTokens: row.cache_write_tokens, reasoningTokens: row.reasoning_tokens, copilotUsage: row.total_nano_aiu === null ? undefined : { totalNanoAiu: row.total_nano_aiu } }, {
        key: `${fingerprint}:${n}`, timestamp: /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.created_at) ? row.created_at.replace(' ', 'T') + 'Z' : row.created_at,
        sessionId: row.session_id, project: context?.repository ?? '', cwd: context?.cwd ?? '', source,
      });
      if (result.record) records.push(result.record);
      else if (result.reason === 'unclassified') unclassified++;
      else invalid++;
      if (!result.record) skillExcludedSessions.add(row.session_id);
    }
    return { records, unclassified, invalid, skillExcludedSessions: [...skillExcludedSessions], sessionNames: [...projects].map(([id, s]) => [id, normalizeSessionName(s.summary)]), warning: supported ? '' : 'Unsupported Copilot usage database schema' };
  } finally { db?.close(); }
}
