import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './settings.mjs';
import { createDiagnostics, RUNTIME_EVENTS, parseRuntimeDiagnostics } from '../core/diagnostics.mjs';

const MAX_BYTES = 128 * 1024;

// Keep lifecycle and source-health summaries, not usage records. Small writes also work during
// process exit. The two bounded files are best-effort if several extension processes rotate them.
export function createRuntimeDiagnostics({ directory = configDir(), processId = process.pid } = {}) {
  const file = path.join(directory, 'diagnostics.jsonl'), previous = path.join(directory, 'diagnostics.previous.jsonl');
  let writable = true;
  const diagnostics = createDiagnostics({ onRecord(entry) {
    if (!RUNTIME_EVENTS.has(entry.event)) return;
    if (entry.event === 'history.scan' && !['started', 'finished', 'failed'].includes(entry.phase)) return;
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
        entries.push(...parseRuntimeDiagnostics(lines.join('\n')));
      } catch (error) { if (error.code !== 'ENOENT') available = false; }
      finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch { available = false; } } }
    }
    return { available, entries: entries.slice(-300) };
  } };
}
