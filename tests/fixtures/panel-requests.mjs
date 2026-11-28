import { mountPanel } from './panel.mjs';
import { createReceiptParser } from '../../src/core/copilot.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildModelProjectPage, buildSessionModels } from '../../src/core/copilot-report.mjs';

export async function requestPanel() {
  const now = new Date(2026, 10, 14, 12), parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  for (let i = 0; i < 28; i++) parser.push(JSON.stringify({ type: 'session.usage_record', id: `call-${i}`, timestamp: now.toISOString(), data: { usage: {
    provider: { kind: 'copilot' }, model: '<Sonnet>', inputTokens: 100, outputTokens: 20, reasoningTokens: 5,
    cacheReadTokens: 60, cacheWriteTokens: 10, copilotUsage: { totalNanoAiu: 250000000 }, duration: 1000, initiator: 'agent', isAuto: false,
  } } }));
  const records = parser.snapshot().records.map(r => ({ ...r, sessionName: '<Session>' }));
  const report = { ...buildReport(records, {}, now), sources: [], coverage: {} };
  const panel = await mountPanel(report);
  panel.server.modelProjects = input => buildModelProjectPage(records, input, now);
  panel.server.sessionPage = input => buildModelSessionPage(records, input, now);
  panel.server.sessionModels = input => buildSessionModels(records, input, now);
  panel.server.requestPage = input => ({ ...buildRequestPage(records, input, now), rows: buildRequestPage(records, input, now).rows.map(r => ({ ...r,
    ...(input.id ? { prompt: { available: true, text: '<script>unsafe()</script> Full original prompt', truncated: false } } : {}),
  })) });
  const click = dataset => {
    if (panel.get('breakdown-view').hidden) panel.get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
    return panel.get('breakdown').onclick({ target: { closest: () => ({ dataset }) } });
  };
  return { ...panel, click, report, records, now };
}

export function jumpPatternTopic(get, id) {
  get('pattern-topic-stops').onclick({ target: { closest: () => ({ dataset: { patternStop: id } }) } });
}

export function jumpTokenTopic(get, id) {
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: id } }) } });
}
