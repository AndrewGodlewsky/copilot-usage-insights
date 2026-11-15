import { count, normalizeUsage } from './copilot.mjs';

const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) ? value : '';

// VS Code debug spans can contain prompts and results; retain only accounting fields.
export function createVSCodeParser({ source, logFile, project = 'VS Code', cwd = '' }) {
  const records = new Map(), rejected = new Set(), sessions = new Set(), signatures = new Map();
  let revision = 0, invalid = 0, unclassified = 0, excluded = 0;
  return {
    push(line) {
      if (!line.trim()) return;
      let e;
      try { e = JSON.parse(line); } catch { invalid++; revision++; return; }
      if (e?.type !== 'llm_request') return;
      const sid = identifier(e.sid), span = identifier(e.spanId), a = e.attrs;
      if (e.v !== undefined && e.v !== 1 || !sid || !span || !a || typeof a !== 'object' || !Number.isFinite(e.ts) || e.ts < Date.UTC(2020, 0, 1) || e.ts >= Date.UTC(2100, 0, 1)) { invalid++; revision++; return; }
      const sessionId = `vscode:${sid}`, response = identifier(a.responseId), key = JSON.stringify(['vscode', sid, response || span]);
      sessions.add(sessionId);
      if (rejected.has(key)) return;
      const reason = a.isByok === true || a.providerKind && a.providerKind !== 'copilot' ? 'excluded'
        : count(a.copilotUsageNanoAiu) === null ? 'unclassified' : '';
      if (reason) {
        if (reason === 'excluded') excluded++; else unclassified++;
        records.delete(key);
        rejected.add(key); revision++; return;
      }
      const { record } = normalizeUsage({ provider: { kind: 'copilot' }, model: identifier(a.model), inputTokens: a.inputTokens, outputTokens: a.outputTokens,
        copilotUsage: { totalNanoAiu: a.copilotUsageNanoAiu }, duration: e.dur,
        // The serialized logger omits cache writes and reasoning. Do not invent zeros.
        cacheDetailsReported: false,
      }, { key, timestamp: new Date(e.ts).toISOString(), sessionId, project, cwd, source });
      const signature = JSON.stringify([record.model, record.inputTotal, record.output, record.nanoAiu]);
      if (signatures.has(key)) {
        if (signatures.get(key) !== signature) { records.delete(key); rejected.add(key); invalid++; revision++; }
        return;
      }
      signatures.set(key, signature);
      records.set(key, { ...record, format: 'vscode', logFile });
      revision++;
    },
    revision: () => revision,
    snapshot: () => ({ records: [...records.values()], sessions, receiptSessions: new Set([...sessions, ...[...sessions].map(id => id.slice(7))]), skillExcludedSessions: new Set(),
      skills: [], interactions: [], promptEvents: [], tools: [], toolOutcomes: [], invalid, unclassified, excluded, invalidSkills: 0, invalidTools: 0, aggregateOnly: false }),
  };
}
