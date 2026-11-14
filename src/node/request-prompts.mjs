import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

const unavailable = () => ({ available: false, text: '', truncated: false });
const MAX_LOG = 64 * 1024 * 1024;

async function readEvents(file, visit) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_LOG) throw new Error('Log unavailable');
    if (!stat.size) return;
    const stream = handle.createReadStream({ start: 0, end: stat.size - 1, autoClose: false });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (Buffer.byteLength(line) > 8 * 1024 * 1024) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event && typeof event === 'object' && !Array.isArray(event) && !event.ephemeral) visit(event);
      }
    } finally { lines.close(); stream.destroy(); }
  } finally { await handle.close(); }
}

// Called only for visible requests. Nothing is cached in the usage index.
export async function readRequestPrompts(records, { maxChars = 160 } = {}) {
  const result = new Map(records.map(r => [r.key, unavailable()])), files = new Map();
  for (const r of records) if (r.logFile && r.apiCallId) {
    if (!files.has(r.logFile)) files.set(r.logFile, []);
    files.get(r.logFile).push(r);
  }
  for (const [file, group] of files) {
    try {
      const root = await fs.realpath(path.join(group[0].source, 'session-state'));
      const real = await fs.realpath(file), relative = path.relative(root, real);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(real) !== 'events.jsonl') continue;
      const calls = new Map(group.map(r => [r.apiCallId, new Set()]));
      await readEvents(real, e => {
        if (e.type !== 'assistant.message' || !calls.has(e.data?.apiCallId)) return;
        calls.get(e.data.apiCallId).add(typeof e.data.interactionId === 'string' ? e.data.interactionId : '');
      });
      const interactions = new Map();
      for (const ids of calls.values()) if (ids.size === 1 && !ids.has('')) interactions.set([...ids][0], new Map());
      await readEvents(real, e => {
        if (e.type !== 'user.message' || !interactions.has(e.data?.interactionId) || typeof e.id !== 'string' || typeof e.data.content !== 'string') return;
        const prompts = interactions.get(e.data.interactionId);
        const text = e.data.content.slice(0, maxChars);
        // Replayed events are fine; conflicting copies are not a reliable link.
        if (prompts.has(e.id) && prompts.get(e.id).text !== text) prompts.set(e.id, unavailable());
        else if (!prompts.has(e.id)) prompts.set(e.id, { available: true, text, truncated: e.data.content.length > maxChars });
      });
      for (const r of group) {
        const ids = calls.get(r.apiCallId);
        const prompts = ids.size === 1 ? interactions.get([...ids][0]) : null;
        if (prompts?.size === 1) result.set(r.key, [...prompts.values()][0]);
      }
    } catch { /* Deleted, oversized, or unreadable logs leave accounting visible. */ }
  }
  return result;
}
