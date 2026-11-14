import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReceiptParser } from '../core/copilot.mjs';
import { readUsageDatabase } from './copilot-db.mjs';

const MAX_LINE = 8 * 1024 * 1024;
const absent = e => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';
async function hashPrefix(handle, length) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024);
  for (let position = 0; position < length;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - position), position);
    if (!bytesRead) throw new Error('Session log changed while reading; refresh to retry');
    hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
  }
  return hash;
}
export function createScanner() {
  const files = new Map();
  let queue = Promise.resolve();
  async function scan(roots, { force = false, disabled = [] } = {}) {
    const seenRoots = new Set(), seenFiles = new Set(), sources = [], snapshots = [], databases = [];
    for (const root of roots) {
      let real;
      try { real = await fs.realpath(root); }
      catch (e) { sources.push({ path: root, state: absent(e) ? 'missing' : 'error', message: absent(e) ? 'Copilot home not found' : e.message }); continue; }
      const identity = process.platform === 'win32' ? real.toLowerCase() : real;
      if (seenRoots.has(identity)) continue;
      seenRoots.add(identity);
      const off = disabled.some(p => (process.platform === 'win32' ? p.toLowerCase() : p) === identity);
      const source = { path: real, state: off ? 'off' : 'ok', files: 0, records: 0, message: '' };
      sources.push(source);
      if (off) continue;
      const stateDir = path.join(real, 'session-state');
      let dirs = [];
      try { dirs = await fs.readdir(stateDir, { withFileTypes: true }); }
      catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; } }
      for (const dir of dirs) {
        if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
        const file = path.join(stateDir, dir.name, 'events.jsonl');
        try {
          const stat = await fs.stat(file);
          if (!stat.isFile()) continue;
          seenFiles.add(file); source.files++;
          let entry = files.get(file);
          if (!force && entry && entry.size === stat.size && entry.mtime === stat.mtimeMs && entry.ctime === stat.ctimeMs) { snapshots.push({ ...entry.parser.snapshot(), source }); continue; }
          const handle = await fs.open(file, 'r');
          try {
            let prefixMatches = false, hash;
            if (!force && entry && stat.size > entry.size && entry.ino === stat.ino) {
              hash = await hashPrefix(handle, entry.offset);
              prefixMatches = hash.copy().digest('hex') === entry.digest;
            }
            if (!prefixMatches) {
              hash = createHash('sha256');
              entry = { parser: createReceiptParser({ sessionId: dir.name, source: real }), offset: 0, digest: hash.copy().digest('hex') };
            }
            let position = entry.offset, pending = Buffer.alloc(0), dropping = false;
            const chunk = Buffer.alloc(256 * 1024);
            while (position < stat.size) {
              const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, stat.size - position), position);
              if (!bytesRead) break;
              const block = chunk.subarray(0, bytesRead);
              // Verify the entire consumed prefix, retaining only its digest between scans.
              const lastNewline = block.lastIndexOf(10);
              if (lastNewline >= 0) entry.digest = hash.copy().update(block.subarray(0, lastNewline + 1)).digest('hex');
              hash.update(block);
              let begin = 0;
              for (let i = 0; i < block.length; i++) if (block[i] === 10) {
                if (!dropping && pending.length + i - begin <= MAX_LINE) entry.parser.push(Buffer.concat([pending, block.subarray(begin, i)]).toString('utf8'));
                else entry.parser.push('{oversized line');
                pending = Buffer.alloc(0); dropping = false; begin = i + 1; entry.offset = position + begin;
              }
              if (!dropping) {
                if (pending.length + block.length - begin > MAX_LINE) { pending = Buffer.alloc(0); dropping = true; }
                else pending = Buffer.concat([pending, block.subarray(begin)]);
              }
              position += bytesRead;
            }
            Object.assign(entry, { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino });
            files.set(file, entry);
            snapshots.push({ ...entry.parser.snapshot(), source });
          } finally { await handle.close(); }
        } catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; } }
      }
      const db = path.join(real, 'session-store.db');
      try { await fs.access(db); databases.push({ db, source }); }
      catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; } }
    }
    for (const file of files.keys()) if (!seenFiles.has(file)) files.delete(file);
    const receiptSessions = new Set(snapshots.flatMap(s => s.receiptSessions));
    const records = new Map();
    const coverage = { excluded: 0, unclassified: 0, invalid: 0, aggregateOnly: 0, fallbackRequests: 0 };
    for (const s of snapshots) {
      for (const r of s.records) if (!records.has(r.key)) { records.set(r.key, r); s.source.records++; }
      for (const k of ['excluded', 'unclassified', 'invalid']) coverage[k] += s[k];
      if (s.aggregateOnly) coverage.aggregateOnly++;
    }
    for (const { db, source } of databases) {
      try {
        const result = readUsageDatabase(db, receiptSessions, source.path);
        coverage.unclassified += result.unclassified; coverage.invalid += result.invalid;
        for (const r of result.records) if (!records.has(r.key)) { records.set(r.key, r); source.records++; coverage.fallbackRequests++; }
      } catch (e) { source.state = 'warning'; source.message = e.message; }
    }
    for (const s of sources) if (s.state === 'ok' && !s.records) s.state = 'empty';
    return { records: [...records.values()], sources, coverage };
  }
  return { scan(roots, options) { const next = queue.then(() => scan(roots, options)); queue = next.catch(() => {}); return next; } };
}
