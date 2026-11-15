import { createReceiptParser } from '../../src/core/copilot.mjs';

export const reviewNow = new Date(2026, 10, 15, 12);
export function reviewFixture({ sessionId = 'session-a', source = 'fixture', project = 'PRIVATE PROJECT' } = {}) {
  const events = []; let ms = new Date(2026, 10, 15, 10).getTime(), id = 0;
  const push = (type, data, extra = {}) => { const e = { type, data, id: `${sessionId}-${id++}`, timestamp: new Date(ms++).toISOString(), ...extra }; events.push(e); return e; };
  push('session.start', { sessionId, context: { repository: project } });
  const user = (interaction, data = {}, extra = {}) => push('user.message', { interactionId: interaction, messageId: interaction, source: 'user', content: 'PRIVATE PROMPT', ...data }, extra);
  const call = (interaction, api, extra = {}) => {
    push('assistant.turn_start', { turnId: api, interactionId: interaction });
    push('session.usage_record', { usage: { apiCallId: api, provider: { kind: 'copilot' }, model: 'PRIVATE MODEL', initiator: 'user', inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10, reasoningTokens: 5, toolTokenCount: 25, copilotUsage: { totalNanoAiu: 0 }, ...extra } });
    push('assistant.message', { interactionId: interaction, turnId: api, apiCallId: api, phase: 'final_answer', toolRequests: [] });
    push('assistant.turn_end', { turnId: api });
  };
  return { events, push, user, call, time(date) { ms = date.getTime(); }, scan() {
    const parser = createReceiptParser({ sessionId, source, logFile: `${source}/session-state/${sessionId}/events.jsonl` });
    for (const e of events) parser.push(JSON.stringify(e));
    return { ...parser.snapshot(), sources: [] };
  } };
}
