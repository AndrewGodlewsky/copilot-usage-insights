import { dayOfMs } from './query.mjs';

const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export const recordedEffort = value => efforts.has(value) ? value : 'unknown';
const modelSettingName = value => typeof value === 'string' && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '';

export function modelChange(e, sessionId, project) {
  if (e.ephemeral || e.agentId || e.data?.parentToolCallId || e.data?.parentAgentTaskId) return null;
  const d = e.data || {}, ms = Date.parse(e.timestamp), id = modelSettingName(e.id);
  if (!id || !Number.isFinite(ms) || ms < Date.UTC(2020, 0, 1) || ms >= Date.UTC(2100, 0, 1)) return null;
  const fromModel = modelSettingName(d.previousModel), toModel = modelSettingName(d.newModel);
  const fromEffort = recordedEffort(d.previousReasoningEffort), toEffort = recordedEffort(d.reasoningEffort);
  const modelChanged = !!fromModel && !!toModel && fromModel !== toModel;
  const effortChanged = fromEffort !== 'unknown' && toEffort !== 'unknown' && fromEffort !== toEffort;
  if (!modelChanged && !effortChanged) return null;
  return { key: JSON.stringify(['model-change', sessionId, id]), sessionId, project, ms,
    fromModel, toModel, fromEffort, toEffort, modelChanged, effortChanged,
    source: ['model_picker', 'sdk', 'agent', 'startup'].includes(d.source) ? d.source : 'unknown' };
}

export function summarizeModelChanges(records, activity, query, start, end, now, copilotSessions) {
  const excluded = new Set(activity.skillExcludedSessions || []), selectedIds = new Set();
  const models = query.models && new Set(query.models);
  let eligible = copilotSessions;
  if (!eligible || models) {
    eligible ??= new Set();
    for (const r of records) if (r.ms <= now.getTime()) {
      if (!copilotSessions) eligible.add(r.sessionId);
      if (models?.has(r.model)) selectedIds.add(r.modelId);
    }
  }
  const wanted = model => models?.has(model) || selectedIds.has(model);
  const result = { events: 0, sessions: 0, modelChanges: 0, effortChanges: 0, manual: 0, automatic: 0, unknownSource: 0, omitted: 0, transitions: [] };
  const sessions = new Set(), seen = new Set(), transitions = new Map();
  for (const e of activity.modelChanges || []) {
    if (seen.has(e.key) || e.ms > now.getTime()) continue;
    seen.add(e.key);
    const day = dayOfMs(e.ms);
    if (day < start || day > end || query.project && query.project !== e.project || query.session && query.session !== e.sessionId ||
      query.models && !wanted(e.fromModel) && !wanted(e.toModel)) continue;
    if (!eligible.has(e.sessionId) || excluded.has(e.sessionId)) { result.omitted++; continue; }
    result.events++; sessions.add(e.sessionId);
    result.modelChanges += Number(e.modelChanged); result.effortChanges += Number(e.effortChanged);
    result[e.source === 'model_picker' ? 'manual' : e.source === 'unknown' ? 'unknownSource' : 'automatic']++;
    const key = JSON.stringify([e.fromModel, e.toModel, e.fromEffort, e.toEffort, e.source]);
    if (!transitions.has(key)) transitions.set(key, { fromModel: e.fromModel, toModel: e.toModel, fromEffort: e.fromEffort, toEffort: e.toEffort, source: e.source, count: 0 });
    transitions.get(key).count++;
  }
  return { ...result, sessions: sessions.size, transitions: [...transitions.values()].sort((a, b) => b.count - a.count || a.fromModel.localeCompare(b.fromModel) || a.toModel.localeCompare(b.toModel) || a.fromEffort.localeCompare(b.fromEffort) || a.toEffort.localeCompare(b.toEffort) || a.source.localeCompare(b.source)) };
}
