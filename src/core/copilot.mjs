// Only accounting and activity metadata leaves this parser; payload text is discarded.
import { linkId, intern, promptEvent, promptEventTypes, createPromptEventSet } from './prompt-credits.mjs';
import { createCoverageCollector, coverageTime } from './coverage.mjs';
import { recordedEffort, modelChange } from './model-settings.mjs';
import { compactionEvent } from './efficiency-compaction.mjs';
import { createRepeatMemory, REPEAT_LIMITS } from './efficiency-repetition.mjs';
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
  const cacheKnown = usage.cacheDetailsReported !== false && cacheRead !== null && cacheWrite !== null && inputTotal !== null && cacheRead + cacheWrite <= inputTotal;
  const reported = count(usage.copilotUsage?.totalNanoAiu);
  const nanoAiu = usage.aiCreditsStatus === 'unavailable' ? null : reported;
  const creditStatus = nanoAiu === null ? 'unavailable' : usage.aiCreditsStatus && usage.aiCreditsStatus !== 'complete' ? 'partial' : 'complete';
  return { record: {
    key, ts: new Date(ms).toISOString(), ms, sessionId, project: project || cwd.split(/[\\/]/).filter(Boolean).at(-1) || 'Unknown project', cwd, source,
    model: intern(textValue(usage.modelDisplayName) || textValue(usage.model) || 'Unknown model'),
    modelId: intern(textValue(usage.model)),
    effort: recordedEffort(usage.reasoningEffort),
    apiCallId: intern(linkId(usage.apiCallId)),
    responseModel: intern(textValue(usage.responseModel).slice(0, 256)),
    initiator: ['user', 'agent', 'sub-agent'].includes(usage.initiator) ? intern(usage.initiator) : '',
    isAuto: typeof usage.isAuto === 'boolean' ? usage.isAuto : null,
    duration: Number.isFinite(usage.duration) && usage.duration >= 0 ? usage.duration : null,
    toolTokenCount: count(usage.toolTokenCount), availableToolCount: count(usage.availableToolCount),
    cacheDetailsReported: typeof usage.cacheDetailsReported === 'boolean' ? usage.cacheDetailsReported : null,
    inputTotal, input: cacheKnown ? inputTotal - cacheRead - cacheWrite : null,
    cacheRead: cacheKnown ? cacheRead : null, cacheWrite: cacheKnown ? cacheWrite : null,
    output, reasoning: count(usage.reasoningTokens),
    total: inputTotal === null || output === null ? null : inputTotal + output,
    nanoAiu, creditStatus,
  } };
}

// Every event type this parser reads. Lines of any other type hold nothing the dashboard uses.
const activityTypes = new Set(['session.error', 'session.compaction_start', 'session.compaction_complete', 'skill.invoked', 'skill.invoked_ref', ...[...promptEventTypes].filter(type => type !== 'abort' && type !== 'session.resume')]);
const usedTypes = new Set(['session.start', 'session.context_changed', 'session.model_change', ...activityTypes, ...promptEventTypes]);
const checkpointTypes = new Set(['session.usage_checkpoint', 'session.shutdown']);
function emptyCheckpoint(data) {
  if (data?.totalNanoAiu !== 0) return false;
  if (!['totalPremiumRequests', 'totalApiDurationMs', 'conversationTokens'].every(key => !Object.hasOwn(data, key) || data[key] === 0)) return false;
  for (const key of ['modelMetrics', 'agentMetrics', 'tokenDetails', 'usageAccountingWatermarks']) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) return false;
  }
  return !Object.hasOwn(data, 'providerModelMetrics') || Array.isArray(data.providerModelMetrics) && data.providerModelMetrics.length === 0;
}
// Copilot writes each line as {"type":"<name>",...}. Returns the name, or '' for any other shape.
function leadingType(line) {
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!text.startsWith('{"type":"')) return '';
  const end = text.indexOf('"', 9);
  if (end < 10 || end > 80 || text.charCodeAt(end + 1) !== 44 || text.charCodeAt(text.length - 1) !== 125) return '';
  const name = text.slice(9, end);
  return /^[a-z0-9_.]+$/.test(name) ? name : '';
}

// `createFingerprint` is called once and must return a one-way function of a string, keyed with
// a secret of its own. With it, each tool call is told whether an identical call came earlier
// in its conversation. Without it, no call is compared.
export function createReceiptParser({ sessionId: initialSession, source, logFile = '', skipUnused = false, backgroundActivity = false, createFingerprint }) {
  const repeats = typeof createFingerprint === 'function' ? createRepeatMemory(createFingerprint()) : null;
  let sessionId = initialSession, cwd = '', project = '', label = 'Unknown project', revision = 0;
  let invalid = 0, invalidSkills = 0, invalidTools = 0, excluded = 0, unclassified = 0, hasCheckpoint = false;
  let summaryNeedsCoverage = false, reviewOrigin = false;
  const noteActivity = () => { if (!summaryNeedsCoverage) { summaryNeedsCoverage = true; revision++; } };
  const coverage = createCoverageCollector(source, logFile);
  let sessionStart = null, summaryEnd = null;
  const checkpoint = (timestamp, data) => {
    if (!summaryNeedsCoverage && !emptyCheckpoint(data)) noteActivity();
    const ms = coverageTime(timestamp);
    if (!hasCheckpoint || ms !== null && (summaryEnd === null || ms > summaryEnd)) {
      hasCheckpoint = true; summaryEnd = ms; revision++;
    }
  };
  const summaryEntry = () => ({ kind: 'aggregateOnly', key: JSON.stringify(['summary', sessionId]), sessionId,
    ms: sessionStart, endMs: summaryEnd !== null && sessionStart !== null && summaryEnd >= sessionStart ? summaryEnd : null,
    source, file: logFile, project: '', model: '', count: 1 });
  const rejectedEvent = (kind, e, key = '', usage = {}, owner = sessionId) => coverage.add(kind, { key, timestamp: e?.timestamp,
    sessionId: owner, project: label === 'Unknown project' ? '' : label, model: textValue(usage?.modelDisplayName) || textValue(usage?.model) });
  // `rejected` remembers receipts that produced no record, so a replayed line is still counted once.
  const records = new Map(), compactions = new Map(), skills = new Map(), receiptSessions = new Set(), skillExcludedSessions = new Set(), rejected = new Set();
  // Every session ID this journal files anything under. Two journals can repeat each other's
  // entries only if these overlap, which is how a copied or moved session is recognised.
  const sessions = new Set([initialSession]);
  // `tools` holds each call as it will be reported: its start plus the latest outcome seen so far.
  const tools = new Map(), toolOutcomes = new Map(), interactions = new Map();
  const modelChanges = new Map(), compactionEvents = new Map();
  const promptEvents = createPromptEventSet();
  const relabel = () => { label = project || cwd.split(/[\\/]/).filter(Boolean).at(-1) || 'Unknown project'; };
  const note = (set, value) => { if (!set.has(value)) { set.add(value); revision++; } };
  const collectPrompt = (e, accounting = {}) => {
    const metadata = promptEvent(e, { sessionId, project: label, ...accounting });
    if (metadata && promptEvents.add(metadata) === metadata) revision++;
  };
  return {
    push(line) {
      if (!line.trim()) return;
      if (skipUnused) {
        const type = leadingType(line);
        if (checkpointTypes.has(type) && summaryNeedsCoverage) {
          // Once activity or an uncertain total is seen, later summaries cannot prove the session empty.
          // Keep skipping their potentially large payloads; empty candidates need the complete data object.
          const at = line.indexOf(',"data":');
          if (at > 0 && at < 1024) {
            try {
              const envelope = JSON.parse(line.slice(0, at) + '}');
              if (Object.hasOwn(envelope, 'timestamp')) { checkpoint(envelope.timestamp); return; }
            } catch { /* Use the normal parser for unusual envelopes. */ }
          }
        }
        if (type && !usedTypes.has(type) && !checkpointTypes.has(type)) return;
      }
      let e;
      try { e = JSON.parse(line); } catch { invalid++; coverage.add('invalid'); revision++; return; }
      if (activityTypes.has(e?.type)) noteActivity();
      if (e?.type !== 'session.usage_record') collectPrompt(e);
      if (e?.type === 'session.start') {
        reviewOrigin = e.data?.usageInsightsReview === 1;
        sessionId = textValue(e.data?.sessionId) || sessionId;
        sessionStart = coverageTime(e.timestamp);
        note(sessions, sessionId);
        cwd = textValue(e.data?.context?.cwd);
        project = textValue(e.data?.context?.repository);
        // Older review exports had this label and no working directory. Keep them in the same project.
        if (!cwd && project === 'Usage Insights AI Review') project = 'Usage Insights';
        relabel();
      } else if (e?.type === 'session.context_changed') {
        cwd = textValue(e.data?.cwd) || cwd;
        project = textValue(e.data?.repository) || cwd.split(/[\\/]/).filter(Boolean).at(-1) || project;
        relabel();
      } else if (e?.type === 'session.model_change') {
        const change = modelChange(e, sessionId, label);
        if (change && !modelChanges.has(change.key)) { modelChanges.set(change.key, change); revision++; }
      } else if (['user.message', 'assistant.turn_start', 'session.error'].includes(e?.type)) {
        if (e.ephemeral || e.checkpoint || e.agentId || e.data?.parentToolCallId) return;
        const kind = e.type === 'user.message' ? 'prompt' : e.type === 'assistant.turn_start' ? 'turn' : 'error';
        if (kind === 'prompt' && (e.data?.isAutopilotContinuation || e.data?.source && e.data.source !== 'user')) return;
        const id = textValue(kind === 'turn' ? e.data?.turnId : kind === 'prompt' ? e.data?.messageId || e.id : e.id), ms = Date.parse(e.timestamp);
        if (!id || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) return;
        const key = JSON.stringify(['interaction', kind, sessionId, id]);
        if (!interactions.has(key)) {
          revision++;
          interactions.set(key, { key, kind, sessionId, ms, project: label,
            chars: kind === 'prompt' && typeof e.data?.content === 'string' ? e.data.content.length : null });
        }
      } else if (e?.type === 'tool.execution_start' || e?.type === 'tool.execution_complete') {
        if (e.ephemeral) return;
        const id = textValue(e.id), callId = textValue(e.data?.toolCallId), ms = Date.parse(e.timestamp);
        const starting = e.type === 'tool.execution_start', name = textValue(e.data?.toolName).trim();
        if (!id || !callId || starting && !name || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) { invalidTools++; rejectedEvent('invalidTools', e, id ? JSON.stringify([sessionId, id]) : ''); revision++; return; }
        const key = JSON.stringify(['tool', sessionId, callId]);
        if (starting) {
          if (!tools.has(key)) {
            revision++;
            const outcome = toolOutcomes.get(key), server = intern(textValue(e.data?.mcpConfigServerName) || textValue(e.data?.mcpServerName)), mcpTool = intern(textValue(e.data?.mcpToolName));
            // Was an identical call (same name and arguments) recorded earlier in this conversation?
            // The arguments are read for that here and only two numbers are kept: how many earlier
            // identical calls there were, and when the latest of them started. The text built from
            // the arguments lasts for this one statement. A replayed line never reaches this point,
            // so a call is not a repeat of itself. Not compared, and left as null: a call inside a
            // subagent, which has a context of its own; a call with no recorded arguments; a line
            // over the size limit; and calls past the limits on what one parser remembers.
            let repeat = null, repeatOfMs = null;
            if (repeats && line.length <= REPEAT_LIMITS.eventChars && !e.agentId && !e.data.parentToolCallId && e.data.arguments != null && repeats.open(sessionId)) {
              ({ repeat, repeatOfMs } = repeats.note(JSON.stringify([name, server, mcpTool, e.data.arguments]), ms));
            }
            tools.set(key, { key, sessionId, ms, ts: new Date(ms).toISOString(), name: intern(name), project: label,
              model: intern(textValue(e.data?.model)), server, mcpTool,
              skillName: name === 'skill' ? textValue(e.data?.arguments?.skill).trim() : '',
              success: outcome ? outcome.success : null, completedMs: outcome ? outcome.completedMs : null,
              repeat, repeatOfMs,
            });
          }
        } else if (!toolOutcomes.has(key) || ms > toolOutcomes.get(key).completedMs) {
          revision++;
          const outcome = { key, success: typeof e.data?.success === 'boolean' ? e.data.success : null, completedMs: ms };
          toolOutcomes.set(key, outcome);
          // Reported objects are never altered once handed out; a changed call gets a new one.
          const tool = tools.get(key);
          if (tool) tools.set(key, { ...tool, success: outcome.success, completedMs: ms });
        }
      } else if (e?.type === 'skill.invoked' || e?.type === 'skill.invoked_ref') {
        if (e.ephemeral) return;
        const id = textValue(e.id), name = textValue(e.data?.name).trim(), ms = Date.parse(e.timestamp);
        if (!id || !name || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) { invalidSkills++; rejectedEvent('invalidSkills', e, id ? JSON.stringify([sessionId, id]) : ''); revision++; return; }
        const key = JSON.stringify(['skill', sessionId, id]);
        if (!skills.has(key)) {
          revision++;
          skills.set(key, { key, sessionId, ms, ts: new Date(ms).toISOString(), project: label, name,
            plugin: textValue(e.data?.pluginName), version: textValue(e.data?.pluginVersion), path: textValue(e.data?.path),
            trigger: ['user-invoked', 'agent-invoked', 'context-load'].includes(e.data?.trigger) ? e.data.trigger : 'unknown',
          });
        }
      } else if (e?.type === 'session.compaction_complete') {
        if (e.ephemeral) return;
        const id = linkId(e.data?.compactionAttemptId) || linkId(e.id);
        // The outcome and counts are activity, kept apart from any usage the same event carries.
        const completed = compactionEvent(e, id, sessionId, label);
        if (completed && !compactionEvents.has(completed.key)) { compactionEvents.set(completed.key, completed); revision++; }
        const u = e.data?.compactionTokensUsed;
        if (!u || typeof u !== 'object') return;
        const key = id ? JSON.stringify(['compaction', sessionId, id]) : '';
        if (key && compactions.has(key)) return;
        const result = normalizeUsage(u, { key, timestamp: e.timestamp, sessionId, cwd, project: label, source });
        // Separate these from ordinary receipts so older sessions still use database fallback.
        if (key) compactions.set(key, result.record ? { ...result.record, logFile, origin: 'compaction' } : null);
        revision++;
        if (result.reason) rejectedEvent(result.reason, e, key, u);
        if (result.reason === 'excluded') excluded++;
        else if (result.reason === 'unclassified') unclassified++;
        else if (result.reason === 'invalid') invalid++;
      } else if (e?.type === 'session.usage_checkpoint' || e?.type === 'session.shutdown') { checkpoint(e.timestamp, e.data); }
      else if (e?.type === 'session.usage_record') {
        note(receiptSessions, sessionId);
        note(receiptSessions, initialSession);
        const u = e.data?.usage;
        const sourceSession = intern(textValue(u?.accounting?.sourceSessionId)) || sessionId;
        note(receiptSessions, sourceSession);
        note(sessions, sourceSession);
        const id = textValue(u?.accounting?.usageId) || textValue(e.id);
        const key = id ? JSON.stringify(['receipt', sourceSession, id]) : '';
        const result = normalizeUsage(u, { key, timestamp: e.timestamp, sessionId: sourceSession, cwd, project: label, source });
        collectPrompt(e, { receipt: result.record, receiptKey: key });
        if (key && (records.has(key) || rejected.has(key))) return;
        revision++;
        if (!result.record) for (const id of [sessionId, initialSession, sourceSession]) skillExcludedSessions.add(id);
        if (result.record) {
          result.record.logFile = logFile;
          if (reviewOrigin) result.record.reviewOrigin = true;
          if (backgroundActivity || reviewOrigin) result.record.backgroundActivity = true;
          records.set(key, result.record);
        }
        else if (key) rejected.add(key);
        if (result.record) return;
        rejectedEvent(result.reason || 'invalid', e, key, u, sourceSession);
        if (result.reason === 'excluded') excluded++;
        else if (result.reason === 'unclassified') unclassified++;
        else invalid++;
      }
    },
    // Changes only when something a snapshot reports has changed, so a caller can keep an earlier snapshot.
    revision: () => revision,
    snapshot: () => ({ records: [...records.values()], compactions: [...compactions.values()].filter(Boolean), skills: [...skills.values()], interactions: [...interactions.values()], promptEvents: promptEvents.events.slice(),
      coverageEntries: [...coverage.snapshot(), ...(hasCheckpoint && summaryNeedsCoverage && !receiptSessions.size ? [summaryEntry()] : [])],
      // Another partial copy can contain the activity missing from an otherwise empty summary.
      emptySummary: hasCheckpoint && !summaryNeedsCoverage ? summaryEntry() : null, summaryActivitySession: summaryNeedsCoverage ? sessionId : '',
      tools: [...tools.values()], modelChanges: [...modelChanges.values()], compactionEvents: [...compactionEvents.values()], toolOutcomes: [...toolOutcomes.values()], sessions: [...sessions],
      skillExcludedSessions: [...skillExcludedSessions], invalidSkills, invalidTools, receiptSessions: [...receiptSessions], invalid, excluded, unclassified, aggregateOnly: hasCheckpoint && summaryNeedsCoverage && receiptSessions.size === 0 }),
  };
}
