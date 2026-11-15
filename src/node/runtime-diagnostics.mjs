import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './settings.mjs';
import { createDiagnostics } from '../core/diagnostics.mjs';

const MAX_BYTES = 128 * 1024;
const durableEvents = new Set(['extension.started', 'extension.joined', 'extension.signal', 'extension.exit', 'extension.crash',
  'canvas.open', 'canvas.close', 'canvas.dispose', 'runtime.started', 'server.listening', 'server.closing', 'server.closed', 'server.error', 'server.response',
  'wsl.discovery', 'history.scan', 'history.source']);

// Keep lifecycle and source-health summaries, not usage records. Small writes also work during
// process exit. The two bounded files are best-effort if several extension processes rotate them.
export function createRuntimeDiagnostics({ directory = configDir(), processId = process.pid } = {}) {
  const file = path.join(directory, 'diagnostics.jsonl'), previous = path.join(directory, 'diagnostics.previous.jsonl');
  let writable = true;
  const diagnostics = createDiagnostics({ onRecord(entry) {
    if (!durableEvents.has(entry.event)) return;
    if (entry.event === 'history.scan' && !['finished', 'failed'].includes(entry.phase)) return;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      let size = 0;
      try { size = fs.statSync(file).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const line = JSON.stringify({ ...entry, processId }) + '\n';
      if (size + Buffer.byteLength(line) > MAX_BYTES) fs.renameSync(file, previous);
      fs.appendFileSync(file, line, { mode: 0o600 });
      writable = true;
    } catch { writable = false; }
  } });
  return { ...diagnostics, readPersisted() {
    const entries = [];
    let available = writable;
    for (const name of [previous, file]) {
      let fd;
      try {
        fd = fs.openSync(name, 'r');
        const size = fs.fstatSync(fd).size, offset = Math.max(0, size - MAX_BYTES), buffer = Buffer.alloc(Math.min(size, MAX_BYTES));
        const text = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, offset)).toString('utf8');
        const lines = text.split('\n');
        if (offset) lines.shift();
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (!durableEvents.has(entry.event) || typeof entry.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(entry.at) || !Number.isFinite(Date.parse(entry.at))) continue;
            // Reapply the allowlist when reading disk; ignore edited or malformed fields.
            const safe = createDiagnostics({ clock: () => new Date(entry.at) });
            safe.record(entry.level, entry.event, entry);
            entries.push(...safe.snapshot().entries);
          } catch {}
        }
      } catch (error) { if (error.code !== 'ENOENT') available = false; }
      finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { available = false; } } }
    }
    return { available, entries: entries.slice(-300) };
  } };
}
