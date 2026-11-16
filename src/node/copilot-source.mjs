import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReceiptParser, normalizeSessionName } from '../core/copilot.mjs';
import { createPromptEventSet } from '../core/prompt-credits.mjs';
import { readDesktopSessionNames } from './copilot-db.mjs';
import { createUsageDatabaseReader } from './wsl-db.mjs';
import { diagnosticError } from '../core/diagnostics.mjs';
import { load, CORE_SCHEMA } from '../vendor/js-yaml/js-yaml.mjs';
import { sourceIdentity, sourceEnvironment } from './source-paths.mjs';
import { createVSCodeParser } from '../core/vscode.mjs';
import { mergeCoverage } from '../core/coverage.mjs';
import { enhancePromptUsageHome, reviewUsageHome } from './settings.mjs';
import { inOrder } from './read-queue.mjs';

const MAX_LINE = 8 * 1024 * 1024, CHUNK = 256 * 1024, MAX_NAME_FILE = 64 * 1024;
// A digest of what was read lets a journal that has grown be continued instead of read again.
// Journals untouched for a day rarely grow, so they are read without one; if one does change,
// it is read again from the start, and from then on with a digest.
const RECENT = 24 * 60 * 60 * 1000;
const absent = e => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';
const sameFile = (known, stat) => known.size === stat.size && known.mtime === stat.mtimeMs && known.ctime === stat.ctimeMs;
const sameList = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const sameFields = (a, b) => { for (const k in a) if (a[k] !== b[k]) return false; return true; };
const chunks = [];
async function hashPrefix(handle, length, metrics) {
  const hash = createHash('sha256'), buffer = chunks.pop() || Buffer.allocUnsafe(CHUNK);
  try {
    for (let position = 0; position < length;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, length - position), position);
      if (!bytesRead) throw new Error('Session log changed while reading; refresh to retry');
      if (metrics) metrics.bytesHashed += bytesRead;
      hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
  } finally { chunks.push(buffer); }
  return hash;
}
// Combines every journal's contribution, in folder order. Every entry is filed under a session
// ID, so journals can repeat one another only when they share one: a copied or moved session.
// Those few are reconciled entry by entry, the first copy winning; all others are simply joined
// end to end. Pure: the result is kept for as long as the same snapshots are current.
function mergeJournals(snapshots) {
  const records = [], compactions = new Map(), skills = [], interactions = [], promptEvents = [], tools = [];
  const receiptSessions = new Set(), skillExcludedSessions = new Set(), sessionsByHome = new Map(), added = new Array(snapshots.length).fill(0);
  const coverage = { excluded: 0, unclassified: 0, invalid: 0, invalidSkills: 0, invalidTools: 0, aggregateOnly: 0, fallbackRequests: 0 };
  const owner = new Map(), overlapping = new Set();
  for (let i = 0; i < snapshots.length; i++) for (const id of snapshots[i].sessions) {
    const first = owner.get(id);
    if (first === undefined) owner.set(id, i);
    else if (first !== i) { overlapping.add(first); overlapping.add(i); }
  }
  const seenRecords = new Map(), seenInteractions = new Set(), seenSkills = new Set(), seenEvents = createPromptEventSet(), toolAt = new Map(), outcomes = new Map();
  let home, homeSessions, session;
  const keep = r => {
    records.push(r);
    if (r.source !== home) { home = r.source; homeSessions = sessionsByHome.get(home); if (!homeSessions) sessionsByHome.set(home, homeSessions = new Set()); session = undefined; }
    if (r.sessionId !== session) homeSessions.add(session = r.sessionId);
  };
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    for (const record of s.compactions || []) if (!compactions.has(record.key)) compactions.set(record.key, { record, owner: i });
    for (const id of s.receiptSessions) receiptSessions.add(id);
    for (const id of s.skillExcludedSessions) skillExcludedSessions.add(id);
    for (const k of ['excluded', 'unclassified', 'invalid', 'invalidSkills', 'invalidTools']) coverage[k] += s[k];
    if (s.aggregateOnly) coverage.aggregateOnly++;
    if (!overlapping.has(i)) {
      for (const r of s.records) keep(r);
      added[i] = s.records.length;
      for (const event of s.interactions) interactions.push(event);
      for (const event of s.promptEvents) promptEvents.push(event);
      for (const skill of s.skills) skills.push(skill);
      for (const tool of s.tools) tools.push(tool);
      continue;
    }
    for (const r of s.records) {
      const at = seenRecords.get(r.key);
      if (at === undefined) { seenRecords.set(r.key, records.length); keep(r); added[i]++; }
      else if (r.backgroundActivity && !records[at].backgroundActivity) records[at] = { ...records[at], backgroundActivity: true };
    }
    for (const event of s.interactions) if (!seenInteractions.has(event.key)) { seenInteractions.add(event.key); interactions.push(event); }
    for (const event of s.promptEvents) if (seenEvents.add(event) === event) promptEvents.push(event);
    for (const skill of s.skills) if (!seenSkills.has(skill.key)) { seenSkills.add(skill.key); skills.push(skill); }
    for (const tool of s.tools) {
      const at = toolAt.get(tool.key);
      if (at === undefined) { toolAt.set(tool.key, tools.length); tools.push(tool); }
      else if ((tool.completedMs ?? -Infinity) > (tools[at].completedMs ?? -Infinity)) tools[at] = tool;
    }
    for (const outcome of s.toolOutcomes) {
      const previous = outcomes.get(outcome.key);
      if (!previous || outcome.completedMs > previous.completedMs) outcomes.set(outcome.key, outcome);
    }
  }
  // Copied journals can contain separate portions of a call's start and completion.
  for (const [key, at] of toolAt) {
    const outcome = outcomes.get(key), tool = tools[at];
    if (outcome && (outcome.success !== tool.success || outcome.completedMs !== tool.completedMs)) tools[at] = { ...tool, ...outcome };
  }
  return { recordList: records, compactions: [...compactions.values()], skills, interactions, promptEvents, tools, receiptSessions, skillExcludedSessions, sessionsByHome, coverage, added };
}

export function createScanner({ optionalHomes = [], skipUnused = false, discoverWsl, discoverVSCode, diagnostics, readDatabase = createUsageDatabaseReader() } = {}) {
  const measure = (event, fields, work) => diagnostics ? diagnostics.measure(event, fields, work) : work();
  const readMetrics = () => ({ filesRead: 0, filesReused: 0, filesAppended: 0, bytesRead: 0, bytesHashed: 0 });
  const environmentType = source => source.environment?.startsWith('wsl:') ? 'wsl' : source.environment?.startsWith('remote:') ? 'remote' : 'local';
  // Journals and session names are reread only when their size or timestamps change.
  const files = new Map(), names = new Map();
  // Shared by every result of this scanner, so later stages can keep work between scans.
  const cache = { uniquePromptEvents: true };
  let queue = Promise.resolve(), merge = null, fallback = new Map(), previous = null;

  async function workspaceName(file, sessionId, force) {
    let handle;
    try {
      const known = force ? undefined : names.get(file);
      if (known && sameFile(known, await fs.stat(file))) return known.name;
      handle = await fs.open(file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) { names.delete(file); return ''; }
      const buffer = Buffer.allocUnsafe(MAX_NAME_FILE + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      let name = '';
      if (bytesRead < buffer.length) {
        try {
          const data = load(buffer.toString('utf8', 0, bytesRead), { schema: CORE_SCHEMA, maxDepth: 20, maxAliases: 50 });
          name = data?.id && data.id !== sessionId ? '' : normalizeSessionName(data?.name);
        } catch { name = ''; }
      }
      names.set(file, { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, name });
      return name;
    } catch { names.delete(file); return ''; }
    finally { await handle?.close(); }
  }

  // Lines the dashboard does not use leave the earlier snapshot, and everything built on it, valid.
  function current(entry) {
    if (!entry.parser) return entry.snapshot;
    const revision = entry.parser.revision();
    if (entry.revision !== revision) {
      entry.snapshot = entry.parser.snapshot(); entry.revision = revision;
      for (const key of ['records', 'compactions', 'skills', 'interactions', 'promptEvents', 'tools']) for (const item of entry.snapshot[key] || []) item.environment = entry.environment;
    }
    return entry.snapshot;
  }

  async function readJournal(file, stat, real, sessionId, force, context = {}, metrics, phase) {
    if (phase) {
      phase.files++;
      if (Number.isFinite(stat.mtimeMs) && stat.mtimeMs < phase.sinceMs) {
        phase.filesDeferred++;
        if (force) files.delete(file);
        return null;
      }
    }
    let entry = files.get(file);
    const contextKey = JSON.stringify(context);
    if (entry && entry.contextKey !== contextKey) entry = undefined;
    if (!force && entry && sameFile(entry, stat)) { if (metrics) metrics.filesReused++; return current(entry); }
    const handle = await fs.open(file, 'r');
    const chunk = chunks.pop() || Buffer.allocUnsafe(CHUNK);
    try {
      let prefixMatches = false, hash;
      if (!force && entry && entry.digest !== null && stat.size > entry.size && entry.ino === stat.ino) {
        hash = await hashPrefix(handle, entry.offset, metrics);
        prefixMatches = hash.copy().digest('hex') === entry.digest;
      }
      if (!prefixMatches) {
        const growing = Date.now() - stat.mtimeMs < RECENT || !!entry && (!force || entry.digest !== null);
        hash = growing ? createHash('sha256') : null;
        const parser = context.format === 'vscode' ? createVSCodeParser({ source: real, logFile: file, ...context }) : createReceiptParser({ sessionId, source: real, logFile: file, skipUnused, backgroundActivity: context.backgroundActivity });
        entry = { parser, contextKey, environment: context.environment || sourceEnvironment(real).environment, offset: 0, digest: hash ? hash.copy().digest('hex') : null, snapshot: null, revision: -1 };
      }
      if (metrics) metrics[prefixMatches ? 'filesAppended' : 'filesRead']++;
      const parser = entry.parser;
      let position = entry.offset, pending = [], pendingLength = 0, dropping = false, consumed = null;
      try {
        while (position < stat.size) {
          const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, stat.size - position), position);
          if (!bytesRead) break;
          if (metrics) metrics.bytesRead += bytesRead;
          const block = chunk.subarray(0, bytesRead);
          // Verify the entire consumed prefix, retaining only its digest between scans.
          if (hash) {
            const lastNewline = block.lastIndexOf(10);
            if (lastNewline >= 0) { hash.update(block.subarray(0, lastNewline + 1)); consumed = hash.copy(); hash.update(block.subarray(lastNewline + 1)); }
            else hash.update(block);
          }
          let begin = 0;
          for (let end = block.indexOf(10); end !== -1; end = block.indexOf(10, begin)) {
            if (dropping || pendingLength + end - begin > MAX_LINE) parser.push('{oversized line');
            else if (pendingLength) { pending.push(block.subarray(begin, end)); parser.push(Buffer.concat(pending).toString('utf8')); }
            else parser.push(block.toString('utf8', begin, end));
            pending = []; pendingLength = 0; dropping = false; begin = end + 1; entry.offset = position + begin;
          }
          if (!dropping && begin < block.length) {
            if (pendingLength + block.length - begin > MAX_LINE) { pending = []; pendingLength = 0; dropping = true; }
            // The chunk is reused for the next read, so an unfinished line is copied out of it.
            else { pending.push(Buffer.from(block.subarray(begin))); pendingLength += block.length - begin; }
          }
          position += bytesRead;
        }
      } finally { if (consumed) entry.digest = consumed.digest('hex'); }
      Object.assign(entry, { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino });
      files.set(file, entry);
      // A journal read without a digest is never continued, only read again, so what its parser
      // remembers for recognising repeated lines can be let go.
      if (entry.digest === null) { current(entry); entry.parser = null; }
      return current(entry);
    } finally { chunks.push(chunk); await handle.close(); }
  }

  async function readSession(stateDir, real, sessionId, force, context, metrics, phase) {
    // A folder name has nothing to normalise, so its paths are put together directly.
    const dir = stateDir + path.sep + sessionId;
    const found = { id: sessionId, name: '', nameFile: dir + path.sep + 'workspace.yaml', file: '', snapshot: null, error: null };
    try {
      found.name = await workspaceName(found.nameFile, sessionId, force);
      const file = dir + path.sep + 'events.jsonl', stat = await fs.stat(file);
      if (!stat.isFile()) return found;
      found.file = file;
      found.snapshot = await readJournal(file, stat, real, sessionId, force, context, metrics, phase);
    } catch (e) { found.error = e; }
    return found;
  }

  async function scan(roots, { force = false, disabled = [], includeWsl = true, readWslDatabases = true, includeVSCode = true, extraVSCodeHomes = [], phase, discovery } = {}) {
    const seenRoots = new Set(), seenFiles = new Set(), seenNames = new Set(), sources = [], snapshots = [], owners = [], databases = [], sessionNames = new Map();
    const discovered = discovery || (includeWsl && discoverWsl ? await measure('history.discovery', { environmentType: 'wsl' }, () => discoverWsl({ disabled })) : { homes: [], sources: [] });
    if (phase) phase.discovery = discovered;
    const disabledIds = new Set(disabled.map(p => sourceIdentity(p)));
    const helperHomes = new Set([enhancePromptUsageHome(), reviewUsageHome()].map(p => sourceIdentity(p)));
    const nameIn = (home, id) => sessionNames.get(home)?.get(id);
    const setName = (home, id, name) => { let map = sessionNames.get(home); if (!map) sessionNames.set(home, map = new Map()); map.set(id, name); };
    await measure('history.copilot', { sourceKind: 'copilot', force }, async () => {
      for (const root of new Set([...roots, ...optionalHomes, ...discovered.homes])) {
        const rootIdentity = sourceIdentity(root);
        if (seenRoots.has(rootIdentity)) continue;
        // Disabled UNC sources must not be contacted just to resolve their real path.
        if (disabledIds.has(rootIdentity)) {
          seenRoots.add(rootIdentity); sources.push({ path: root, ...sourceEnvironment(root), state: 'off', files: 0, records: 0, message: '' }); continue;
        }
        let real;
        try { real = await fs.realpath(root); }
        catch (e) {
          if (absent(e) && optionalHomes.includes(root) && !roots.includes(root)) continue;
          sources.push({ path: root, ...sourceEnvironment(root), state: absent(e) ? 'missing' : 'error', message: absent(e) ? 'Copilot home not found' : e.message, diagnostic: diagnosticError(e) }); continue;
        }
        const identity = sourceIdentity(real);
        if (seenRoots.has(identity)) continue;
        seenRoots.add(identity);
        const off = disabledIds.has(identity);
        const source = { path: real, ...sourceEnvironment(real), state: off ? 'off' : 'ok', files: 0, records: 0, message: '' };
        sources.push(source);
        if (off) continue;
        const metrics = { sourceIndex: sources.length, sourceKind: 'copilot', environmentType: environmentType(source), force, ...readMetrics() };
        await measure('history.journals', metrics, async () => {
          const stateDir = path.join(real, 'session-state');
          let dirs = [];
          try { dirs = await fs.readdir(stateDir, { withFileTypes: true }); }
          catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; source.diagnostic = diagnosticError(e); } }
          const sessions = dirs.filter(dir => dir.isDirectory() && !dir.name.startsWith('.'));
          metrics.folders = sessions.length;
          // Outcomes are applied in folder order, so the result does not depend on which read finished first.
          const context = { backgroundActivity: helperHomes.has(rootIdentity) || helperHomes.has(identity) };
          for (const found of await inOrder(sessions, dir => readSession(stateDir, real, dir.name, force, context, metrics, phase))) {
            seenNames.add(found.nameFile);
            if (found.name) setName(real, found.id, found.name);
            if (found.file) { seenFiles.add(found.file); source.files++; }
            if (found.snapshot) { snapshots.push(found.snapshot); owners.push(source); }
            if (found.error && !absent(found.error)) { source.state = 'error'; source.message = found.error.message; source.diagnostic = diagnosticError(found.error); }
          }
        });
        const db = path.join(real, 'session-store.db');
        try { await fs.access(db); databases.push({ db, source }); }
        catch (e) { if (!absent(e)) { source.state = 'error'; source.message = e.message; source.diagnostic = diagnosticError(e); } }
      }
    });
    for (const source of discovered.sources) if (!sources.some(s => sourceIdentity(s.path) === sourceIdentity(source.path))) sources.push({ ...source, ...(source.path.startsWith('\\\\') ? sourceEnvironment(source.path) : {}) });
    if (discoverVSCode) {
      const cliSessions = new Set(snapshots.flatMap(s => [...s.sessions]));
      const metrics = { sourceKind: 'vscode', force, ...readMetrics() };
      const vscode = await measure('history.vscode', metrics, async () => {
        const result = await discoverVSCode({ homes: discovered.vscodeHomes || [], extraHomes: extraVSCodeHomes, include: includeVSCode, disabled, cliSessions, force,
          readJournal: (file, stat, source, session, force, context = {}) => readJournal(file, stat, source, session, force, context, metrics, phase) });
        metrics.sources = result.sources.length;
        return result;
      });
      sources.push(...vscode.sources); snapshots.push(...vscode.snapshots); owners.push(...vscode.owners);
      for (const file of vscode.files) seenFiles.add(file);
    }
    for (const file of files.keys()) if (!seenFiles.has(file)) files.delete(file);
    for (const file of names.keys()) if (!seenNames.has(file)) names.delete(file);
    const mergeFields = { files: snapshots.length, cacheHit: !!merge && sameList(merge.snapshots, snapshots) };
    measure('history.merge', mergeFields, () => {
      if (!mergeFields.cacheHit) merge = { snapshots, journals: mergeJournals(snapshots) };
    });
    const journals = merge.journals, coverage = { ...journals.coverage }, extra = new Map(), kept = new Map();
    const summaryActivity = new Set(snapshots.map(s => s.summaryActivitySession).filter(Boolean));
    const coverageEntries = snapshots.flatMap(s => [...(s.coverageEntries || []), ...(s.emptySummary && summaryActivity.has(s.emptySummary.sessionId) ? [s.emptySummary] : [])]);
    for (let i = 0; i < owners.length; i++) owners[i].records += journals.added[i];
    let skillExcluded = journals.skillExcludedSessions, sessionsByHome = journals.sessionsByHome;
    if (phase) { phase.databasesDeferred = databases.length; databases.length = 0; }
    // WSL readers wait on child processes. Overlap at most two, then reconcile in source order.
    const databaseResults = await inOrder(databases, async ({ db, source }) => {
      try {
        const fields = { sourceIndex: sources.indexOf(source) + 1, sourceKind: 'copilot', environmentType: environmentType(source) };
        const result = await measure('history.database', fields, async () => {
          const result = await readDatabase(db, journals.receiptSessions, source.path, { readWslDatabases });
          Object.assign(fields, { records: result.records.length, databaseReader: result.databaseRead === 'wsl' ? 'wsl' : 'local' });
          return result;
        });
        return { result };
      } catch (error) { return { error }; }
    }, 2);
    for (let i = 0; i < databases.length; i++) {
      const { db, source } = databases[i], { result, error } = databaseResults[i];
      try {
        if (error) throw error;
        if (result.databaseRead === 'wsl') {
          if (!source.message) source.message = 'Usage database read inside WSL; no database copy was created.';
          coverage.wslDatabases = (coverage.wslDatabases || 0) + 1;
        }
        if (result.warning) { source.state = 'warning'; source.message = result.warning; }
        for (const [id, name] of result.sessionNames) if (name && !nameIn(source.path, id)) setName(source.path, id, name);
        if (result.skillExcludedSessions.length) {
          if (skillExcluded === journals.skillExcludedSessions) skillExcluded = new Set(skillExcluded);
          for (const session of result.skillExcludedSessions) skillExcluded.add(session);
        }
        coverage.unclassified += result.unclassified; coverage.invalid += result.invalid;
        for (const issue of result.coverageEntries || []) coverageEntries.push(issue);
        // The database is read afresh every scan; rows that have not changed keep their earlier objects.
        const before = fallback.get(db), rows = new Map();
        for (let r of result.records) {
          r.environment = sourceEnvironment(r.source).environment;
          const known = before?.get(r.key);
          if (known && sameFields(r, known)) r = known;
          rows.set(r.key, r);
          // Database rows are keyed apart from journal receipts; only another database can repeat one.
          if (extra.has(r.key)) continue;
          extra.set(r.key, r); source.records++; coverage.fallbackRequests++;
          if (sessionsByHome === journals.sessionsByHome) sessionsByHome = new Map([...sessionsByHome].map(([home, ids]) => [home, new Set(ids)]));
          if (!sessionsByHome.has(r.source)) sessionsByHome.set(r.source, new Set());
          sessionsByHome.get(r.source).add(r.sessionId);
        }
        kept.set(db, rows);
      } catch (e) { source.state = 'warning'; source.message = e.message; source.diagnostic = diagnosticError(e); }
    }
    fallback = kept;
    return measure('history.finalize', { records: journals.recordList.length + extra.size }, () => {
      const databaseSessions = new Set([...extra.values()].map(r => r.sessionId)), compactions = [];
      const issues = mergeCoverage(coverageEntries, new Set([...journals.receiptSessions, ...databaseSessions]));
      for (const kind of ['excluded', 'unclassified', 'invalid', 'invalidSkills', 'invalidTools', 'aggregateOnly']) {
        coverage[kind] = issues.reduce((total, issue) => total + (issue.kind === kind ? issue.count : 0), 0);
      }
      for (const { record, owner } of journals.compactions) {
        // Whole-session DB fallback already includes compactions; never guess a cross-format row match.
        if (databaseSessions.has(record.sessionId)) continue;
        compactions.push(record); owners[owner].records++;
        if (sessionsByHome === journals.sessionsByHome) sessionsByHome = new Map([...sessionsByHome].map(([home, ids]) => [home, new Set(ids)]));
        if (!sessionsByHome.has(record.source)) sessionsByHome.set(record.source, new Set());
        sessionsByHome.get(record.source).add(record.sessionId);
      }
      measure('history.names', { sources: sessionsByHome.size }, () => {
        if (!phase) for (const [home, ids] of sessionsByHome) if (!sources.some(s => s.path === home && s.kind === 'vscode')) for (const [id, name] of readDesktopSessionNames(path.join(home, 'data.db'), ids)) setName(home, id, name);
      });
      for (const s of sources) if (s.state === 'ok' && !s.records) s.state = 'empty';
      // A record carries its session's current name. The name is written onto the record itself
      // rather than onto a copy, so a rename is noted here to stop an earlier result being reused.
      let home, homeNames, renamed = false;
      const named = r => {
        if (r.source !== home) { home = r.source; homeNames = sessionNames.get(home); }
        const sessionName = homeNames?.get(r.sessionId) || '';
        if (r.sessionName !== sessionName) { r.sessionName = sessionName; renamed = true; }
        return r;
      };
      const records = new Array(journals.recordList.length + extra.size + compactions.length);
      let n = 0;
      for (const r of journals.recordList) records[n++] = named(r);
      for (const r of extra.values()) records[n++] = named(r);
      for (const r of compactions) records[n++] = named(r);
      const result = { records, skills: journals.skills, interactions: journals.interactions, promptEvents: journals.promptEvents, tools: journals.tools, skillExcludedSessions: [...skillExcluded], sources, coverage, coverageEntries: issues };
      // Nothing changed: hand back the very same result, so everything derived from it stays valid.
      if (previous && previous.skills === result.skills && previous.interactions === result.interactions && previous.promptEvents === result.promptEvents && previous.tools === result.tools
        && !renamed && sameList(previous.records, records) && sameList(previous.skillExcludedSessions, result.skillExcludedSessions)
        && sameFields(previous.coverage, coverage) && JSON.stringify(previous.coverageEntries) === JSON.stringify(issues) && JSON.stringify(previous.sources) === JSON.stringify(sources)) return previous;
      if (previous && !renamed && sameList(previous.records, records)) result.records = previous.records;
      Object.defineProperty(result, 'cache', { value: cache });
      return previous = result;
    });
  }
  return { scan(roots, options = {}) {
    const next = queue.then(async () => {
      if (!options.onRecent || !Number.isFinite(options.recentSince)) return scan(roots, options);
      const phase = { scanId: options.scanId, sinceMs: options.recentSince, files: 0, filesDeferred: 0, databasesDeferred: 0 };
      const recent = await measure('history.recent', phase, () => scan(roots, { ...options, phase }));
      // Records can be renamed during final reconciliation. Keep the provisional view immutable.
      const snapshot = structuredClone(recent);
      Object.defineProperty(snapshot, 'cache', { value: { uniquePromptEvents: true } });
      await options.onRecent(snapshot, { files: phase.files, filesDeferred: phase.filesDeferred, databasesDeferred: phase.databasesDeferred });
      await new Promise(resolve => setImmediate(resolve));
      // Recheck metadata; freshly read unchanged journals reuse their parser results.
      return measure('history.background', { scanId: options.scanId, filesDeferred: phase.filesDeferred, databasesDeferred: phase.databasesDeferred }, () => scan(roots, { ...options, force: false, discovery: phase.discovery }));
    });
    queue = next.catch(() => {});
    return next;
  } };
}
