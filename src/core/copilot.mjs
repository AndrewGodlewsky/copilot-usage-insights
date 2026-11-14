// Only accounting and activity metadata leaves this parser; payload text is discarded.
export const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const textValue = value => typeof value === 'string' ? value : '';
export const normalizeSessionName = value => textValue(value).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 256);

export function normalizeUsage(usage, { key, timestamp, sessionId, project = '', cwd = '', source = '' }) {
  if (!usage || typeof usage !== 'object') return { reason: 'invalid' };
  const provider = usage.provider?.kind ?? usage.provider?.id;
  if (usage.isByok || usage.byokKind || (provider && provider !== 'copilot')) return { reason: 'excluded' };
  if (provider !== 'copilot' && !usage.copilotUsage) return { reason: 'unclassified' };
  const ms = Date.parse(timestamp);
  if (!key || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) return { reason: 'invalid' };
  const inputTotal = count(usage.inputTokens), output = count(usage.outputTokens);
  const cacheRead = count(usage.cacheReadTokens), cacheWrite = count(usage.cacheWriteTokens);
  const cacheKnown = cacheRead !== null && cacheWrite !== null && inputTotal !== null && cacheRead + cacheWrite <= inputTotal;
  const reported = count(usage.copilotUsage?.totalNanoAiu);
  const nanoAiu = usage.aiCreditsStatus === 'unavailable' ? null : reported;
  const creditStatus = nanoAiu === null ? 'unavailable' : usage.aiCreditsStatus && usage.aiCreditsStatus !== 'complete' ? 'partial' : 'complete';
  return { record: {
    key, ts: new Date(ms).toISOString(), ms, sessionId, project: project || cwd.split(/[\\/]/).filter(Boolean).at(-1) || 'Unknown project', cwd, source,
    model: textValue(usage.modelDisplayName) || textValue(usage.model) || 'Unknown model',
    modelId: textValue(usage.model),
    apiCallId: textValue(usage.apiCallId).slice(0, 256),
    responseModel: textValue(usage.responseModel).slice(0, 256),
    initiator: ['user', 'agent', 'sub-agent'].includes(usage.initiator) ? usage.initiator : '',
    isAuto: typeof usage.isAuto === 'boolean' ? usage.isAuto : null,
    duration: Number.isFinite(usage.duration) && usage.duration >= 0 ? usage.duration : null,
    inputTotal, input: cacheKnown ? inputTotal - cacheRead - cacheWrite : null,
    cacheRead: cacheKnown ? cacheRead : null, cacheWrite: cacheKnown ? cacheWrite : null,
    output, reasoning: count(usage.reasoningTokens),
    total: inputTotal === null || output === null ? null : inputTotal + output,
    nanoAiu, creditStatus,
  } };
}

export function createReceiptParser({ sessionId: initialSession, source, logFile = '' }) {
  let sessionId = initialSession, cwd = '', project = '';
  let invalid = 0, invalidSkills = 0, invalidTools = 0, excluded = 0, unclassified = 0, hasCheckpoint = false;
  const records = new Map(), skills = new Map(), receiptSessions = new Set(), skillExcludedSessions = new Set(), seen = new Set();
  const toolStarts = new Map(), toolOutcomes = new Map();
  return {
    push(line) {
      if (!line.trim()) return;
      let e;
      try { e = JSON.parse(line); } catch { invalid++; return; }
      if (e?.type === 'session.start') {
        sessionId = textValue(e.data?.sessionId) || sessionId;
        cwd = textValue(e.data?.context?.cwd);
        project = textValue(e.data?.context?.repository);
      } else if (e?.type === 'session.context_changed') {
        cwd = textValue(e.data?.cwd) || cwd;
        project = textValue(e.data?.repository) || cwd.split(/[\\/]/).filter(Boolean).at(-1) || project;
      } else if (e?.type === 'tool.execution_start' || e?.type === 'tool.execution_complete') {
        if (e.ephemeral) return;
        const id = textValue(e.id), callId = textValue(e.data?.toolCallId), ms = Date.parse(e.timestamp);
        const starting = e.type === 'tool.execution_start', name = textValue(e.data?.toolName).trim();
        if (!id || !callId || starting && !name || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) { invalidTools++; return; }
        const key = JSON.stringify(['tool', sessionId, callId]);
        if (starting) {
          if (!toolStarts.has(key)) toolStarts.set(key, { key, sessionId, ms, ts: new Date(ms).toISOString(), name,
            project: project || cwd.split(/[\\/]/).filter(Boolean).at(-1) || 'Unknown project',
            model: textValue(e.data?.model), server: textValue(e.data?.mcpConfigServerName) || textValue(e.data?.mcpServerName),
            mcpTool: textValue(e.data?.mcpToolName),
          });
        } else if (!toolOutcomes.has(key) || ms > toolOutcomes.get(key).completedMs) {
          toolOutcomes.set(key, { success: typeof e.data?.success === 'boolean' ? e.data.success : null, completedMs: ms });
        }
      } else if (e?.type === 'skill.invoked' || e?.type === 'skill.invoked_ref') {
        if (e.ephemeral) return;
        const id = textValue(e.id), name = textValue(e.data?.name).trim(), ms = Date.parse(e.timestamp);
        if (!id || !name || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) { invalidSkills++; return; }
        const key = JSON.stringify(['skill', sessionId, id]);
        if (!skills.has(key)) skills.set(key, { key, sessionId, ms, ts: new Date(ms).toISOString(),
          project: project || cwd.split(/[\\/]/).filter(Boolean).at(-1) || 'Unknown project', name,
          plugin: textValue(e.data?.pluginName), version: textValue(e.data?.pluginVersion), path: textValue(e.data?.path),
          trigger: ['user-invoked', 'agent-invoked', 'context-load'].includes(e.data?.trigger) ? e.data.trigger : 'unknown',
        });
      } else if (e?.type === 'session.usage_checkpoint' || e?.type === 'session.shutdown') hasCheckpoint = true;
      else if (e?.type === 'session.usage_record') {
        receiptSessions.add(sessionId);
        receiptSessions.add(initialSession);
        const u = e.data?.usage;
        const sourceSession = textValue(u?.accounting?.sourceSessionId) || sessionId;
        receiptSessions.add(sourceSession);
        const id = textValue(u?.accounting?.usageId) || textValue(e.id);
        const key = id ? JSON.stringify(['receipt', sourceSession, id]) : '';
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        const result = normalizeUsage(u, { key, timestamp: e.timestamp, sessionId: sourceSession, cwd, project, source });
        if (!result.record) for (const id of [sessionId, initialSession, sourceSession]) skillExcludedSessions.add(id);
        if (result.record) records.set(key, { ...result.record, logFile });
        else if (result.reason === 'excluded') excluded++;
        else if (result.reason === 'unclassified') unclassified++;
        else invalid++;
      }
    },
    snapshot: () => ({ records: [...records.values()], skills: [...skills.values()],
      tools: [...toolStarts.values()].map(tool => ({ ...tool, success: null, completedMs: null, ...toolOutcomes.get(tool.key) })),
      skillExcludedSessions: [...skillExcludedSessions], invalidSkills, invalidTools, receiptSessions: [...receiptSessions], invalid, excluded, unclassified, aggregateOnly: hasCheckpoint && receiptSessions.size === 0 }),
  };
}
