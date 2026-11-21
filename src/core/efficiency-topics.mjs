// Efficiency topics that need their own pass over the selected history register here, one line
// each: { key, create }. A request topic sees every in-range model call as add(record, day).
// A tool topic sees every in-range, provider-attributed tool call as add(tool, outcome), where
// outcome is true, false, or null when no completion is recorded. create(context) receives
// { query, start, end, now, sessionLabels, activity, records } and returns { add, finish };
// finish() is reported as report.efficiency[key].
import { createDelegationTopic } from './efficiency-delegation.mjs';
import { createOutputMix } from './efficiency-output.mjs';
import { createCacheTiming } from './efficiency-cache.mjs';
import { createTokenMix } from './efficiency-overview.mjs';
import { createCompactionTopic } from './efficiency-compaction.mjs';
import { createRecoveryTopic } from './efficiency-recovery.mjs';
import { createToolFootprint } from './efficiency-tools.mjs';
import { createModelMix } from './efficiency-models.mjs';
const requestTopics = [
  { key: 'delegation', create: createDelegationTopic },
  { key: 'outputMix', create: createOutputMix },
  { key: 'cacheTiming', create: createCacheTiming },
  { key: 'tokenMix', create: createTokenMix },
  { key: 'compaction', create: createCompactionTopic },
  { key: 'toolFootprint', create: createToolFootprint },
  { key: 'modelMix', create: createModelMix },
];
const toolTopics = [
  { key: 'recovery', create: createRecoveryTopic },
];

const begin = (topics, context) => topics.map(topic => ({ key: topic.key, accumulator: topic.create(context) }));
export function createEfficiencyTopics(context = {}) {
  const requests = begin(requestTopics, context), tools = begin(toolTopics, context);
  return {
    addRequest(record, day) { for (let i = 0; i < requests.length; i++) requests[i].accumulator.add(record, day); },
    addTool(tool, outcome) { for (let i = 0; i < tools.length; i++) tools[i].accumulator.add(tool, outcome); },
    finish() {
      const result = {};
      for (const { key, accumulator } of [...requests, ...tools]) result[key] = accumulator.finish();
      return result;
    },
  };
}
