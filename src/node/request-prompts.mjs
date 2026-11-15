import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

const unavailable = () => ({ available: false, text: '', truncated: false });
const MAX_LOG = 64 * 1024 * 1024, MAX_LINE = 8 * 1024 * 1024;

// Visits the events of the named types. Most of a journal is other events, often very large,
// so a line is parsed only if it mentions one of those names at all.
async function readEvents(file, types, visit, signal) {
  signal?.throwIfAborted();
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_LOG) throw new Error('Log unavailable');
    if (!stat.size) return;
    const stream = handle.createReadStream({ start: 0, end: stat.size - 1, autoClose: false, signal });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        signal?.throwIfAborted();
        if (!types.some(type => line.includes(type))) continue;
        // A character is at most three bytes, so shorter lines cannot exceed the limit.
        if (line.length * 3 > MAX_LINE && Buffer.byteLength(line) > MAX_LINE) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event && typeof event === 'object' && !Array.isArray(event) && !event.ephemeral && types.includes(event.type)) visit(event);
      }
    } finally { lines.close(); stream.destroy(); }
  } finally { await handle.close(); }
}

// Called only for visible requests. Nothing is cached in the usage index.
export async function readRequestPrompts(records, { maxChars = 160, signal, humanOnly = false } = {}) {
  signal?.throwIfAborted();
  const result = new Map(records.map(r => [r.key, unavailable()])), files = new Map();
  for (const r of records) if (r.logFile && r.apiCallId) {
    if (!files.has(r.logFile)) files.set(r.logFile, []);
    files.get(r.logFile).push(r);
  }
  for (const [file, group] of files) {
    signal?.throwIfAborted();
    try {
      const root = await fs.realpath(path.join(group[0].source, 'session-state'));
      const real = await fs.realpath(file), relative = path.relative(root, real);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(real) !== 'events.jsonl') continue;
      // One pass: which interaction each wanted call belongs to, and every interaction's prompts.
      const calls = new Map(group.map(r => [r.apiCallId, new Set()])), interactions = new Map();
      await readEvents(real, ['assistant.message', 'user.message'], e => {
        if (e.type === 'assistant.message') {
          if (calls.has(e.data?.apiCallId)) calls.get(e.data.apiCallId).add(typeof e.data.interactionId === 'string' ? e.data.interactionId : '');
          return;
        }
        const interaction = e.data?.interactionId;
        if (typeof interaction !== 'string' || !interaction || typeof e.id !== 'string' || typeof e.data.content !== 'string') return;
        let prompts = interactions.get(interaction);
        if (!prompts) interactions.set(interaction, prompts = new Map());
        const text = e.data.content.slice(0, maxChars), promptId = e.data.messageId || e.id;
        const invalid = humanOnly && (e.checkpoint || e.agentId || e.data.agentId || e.data.parentToolCallId || e.data.isAutopilotContinuation || e.data.source && e.data.source !== 'user' || e.data.causalDependencies?.length);
        const digest = createHash('sha256').update(e.data.content).digest('hex');
        // Replayed events are fine; conflicting copies are not a reliable link.
        if (invalid || prompts.has(e.id) && prompts.get(e.id).digest !== digest) prompts.set(e.id, unavailable());
        else if (!prompts.has(e.id)) prompts.set(e.id, { available: true, text, truncated: e.data.content.length > maxChars, digest, promptId });
      }, signal);
      for (const r of group) {
        const ids = calls.get(r.apiCallId);
        const prompts = ids.size === 1 && !ids.has('') ? interactions.get([...ids][0]) : null;
        if (prompts?.size === 1) {
          const p = [...prompts.values()][0];
          if (humanOnly && (p.promptId !== r.expectedPrompt || !ids.has(r.expectedInteraction))) continue;
          result.set(r.key, { available: p.available, text: p.text, truncated: p.truncated });
        }
      }
    } catch { signal?.throwIfAborted(); /* Deleted, oversized, or unreadable logs leave accounting visible. */ }
  }
  return result;
}
