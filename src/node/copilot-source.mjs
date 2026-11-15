import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReceiptParser, normalizeSessionName } from '../core/copilot.mjs';
import { readUsageDatabase, readDesktopSessionNames } from './copilot-db.mjs';
import { diagnosticError } from '../core/diagnostics.mjs';
import { load, CORE_SCHEMA } from '../vendor/js-yaml/js-yaml.mjs';

const MAX_LINE = 8 * 1024 * 1024;
const absent = e => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';
async function workspaceName(file, sessionId) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    if (!(await handle.stat()).isFile()) return '';
    const buffer = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === buffer.length) return '';
    const data = load(buffer.toString('utf8', 0, bytesRead), { schema: CORE_SCHEMA, maxDepth: 20, maxAliases: 50 });
    return data?.id && data.id !== sessionId ? '' : normalizeSessionName(data?.name);
  } catch { return ''; }
  finally { await handle?.close(); }
}
async function hashPrefix(handle, length) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024);
  for (let position = 0; position < length;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - position), position);
    if (!bytesRead) throw new Error('Session log changed while reading; refresh to retry');
    hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
  }
  return hash;
}
export function createScanner({ optionalHomes = [] } = {}) {
  const files = new Map();
  let queue = Promise.resolve();
  async function scan(roots, { force = false, disabled = [] } = {}) {
    const seenRoots = new Set(), seenFiles = new Set(), sources = [], snapshots = [], databases = [], sessionNames = new Map();
    for (const root of new Set([...roots, ...optionalHomes])) {
      let real;
      try { real = await fs.realpath(root); }
      catch (e) {
        if (absent(e) && optionalHomes.includes(root) && !roots.includes(root)) continue;
        sources.push({ path: root, state: absent(e) ? 'missing' : 'error', message: absent(e) ? 'Copilot home not found' : e.message, diagnostic: diagnosticError(e) }); continue;
      }
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
      catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; source.diagnostic = diagnosticError(e); } }
      for (const dir of dirs) {
        if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
        const file = path.join(stateDir, dir.name, 'events.jsonl');
        try {
          const name = await workspaceName(path.join(stateDir, dir.name, 'workspace.yaml'), dir.name);
          if (name) sessionNames.set(JSON.stringify([real, dir.name]), name);
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
              entry = { parser: createReceiptParser({ sessionId: dir.name, source: real, logFile: file }), offset: 0, digest: hash.copy().digest('hex') };
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
        } catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; source.diagnostic = diagnosticError(e); } }
      }
      const db = path.join(real, 'session-store.db');
      try { await fs.access(db); databases.push({ db, source }); }
      catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; source.diagnostic = diagnosticError(e); } }
    }
    for (const file of files.keys()) if (!seenFiles.has(file)) files.delete(file);
    const receiptSessions = new Set(snapshots.flatMap(s => s.receiptSessions));
    const records = new Map(), skills = new Map(), tools = new Map(), toolOutcomes = new Map(), interactions = new Map(), promptEvents = new Map(), skillExcludedSessions = new Set(snapshots.flatMap(s => s.skillExcludedSessions));
    const coverage = { excluded: 0, unclassified: 0, invalid: 0, invalidSkills: 0, invalidTools: 0, aggregateOnly: 0, fallbackRequests: 0 };
    for (const s of snapshots) {
      for (const r of s.records) if (!records.has(r.key)) { records.set(r.key, r); s.source.records++; }
      for (const event of s.interactions) if (!interactions.has(event.key)) interactions.set(event.key, event);
      for (const event of s.promptEvents) promptEvents.set(JSON.stringify(event), event);
      for (const skill of s.skills) if (!skills.has(skill.key)) skills.set(skill.key, skill);
      for (const tool of s.tools) {
        const previous = tools.get(tool.key);
        if (!previous || (tool.completedMs ?? -Infinity) > (previous.completedMs ?? -Infinity)) tools.set(tool.key, tool);
      }
      for (const outcome of s.toolOutcomes) {
        const previous = toolOutcomes.get(outcome.key);
        if (!previous || outcome.completedMs > previous.completedMs) toolOutcomes.set(outcome.key, outcome);
      }
      for (const k of ['excluded', 'unclassified', 'invalid', 'invalidSkills', 'invalidTools']) coverage[k] += s[k];
      if (s.aggregateOnly) coverage.aggregateOnly++;
    }
    // Copied journals can contain separate portions of a call's start and completion.
    for (const [key, tool] of tools) if (toolOutcomes.has(key)) tools.set(key, { ...tool, ...toolOutcomes.get(key) });
    for (const { db, source } of databases) {
      try {
        const result = readUsageDatabase(db, receiptSessions, source.path);
        if (result.warning) { source.state = 'warning'; source.message = result.warning; }
        for (const [id, name] of result.sessionNames) {
          const key = JSON.stringify([source.path, id]);
          if (name && !sessionNames.has(key)) sessionNames.set(key, name);
        }
        for (const session of result.skillExcludedSessions) skillExcludedSessions.add(session);
        coverage.unclassified += result.unclassified; coverage.invalid += result.invalid;
        for (const r of result.records) if (!records.has(r.key)) { records.set(r.key, r); source.records++; coverage.fallbackRequests++; }
      } catch (e) { source.state = 'warning'; source.message = e.message; source.diagnostic = diagnosticError(e); }
    }
    const sessionIdsByHome = new Map();
    for (const record of records.values()) {
      if (!sessionIdsByHome.has(record.source)) sessionIdsByHome.set(record.source, new Set());
      sessionIdsByHome.get(record.source).add(record.sessionId);
    }
    for (const [home, ids] of sessionIdsByHome) {
      for (const [id, name] of readDesktopSessionNames(path.join(home, 'data.db'), ids)) {
        sessionNames.set(JSON.stringify([home, id]), name);
      }
    }
    for (const s of sources) if (s.state === 'ok' && !s.records) s.state = 'empty';
    return { records: [...records.values()].map(r => ({ ...r, sessionName: sessionNames.get(JSON.stringify([r.source, r.sessionId])) || '' })), skills: [...skills.values()], interactions: [...interactions.values()], promptEvents: [...promptEvents.values()], tools: [...tools.values()], skillExcludedSessions: [...skillExcludedSessions], sources, coverage };
  }
  return { scan(roots, options) { const next = queue.then(() => scan(roots, options)); queue = next.catch(() => {}); return next; } };
}
