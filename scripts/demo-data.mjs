import { normalizeUsage } from '../src/core/copilot.mjs';

// Synthetic usage only. No user transcripts or account data belong in previews.
export function demoData(now = new Date()) {
  const records = [];
  for (let day = 0; day < 70; day++) {
    if (day % 9 === 5) continue;
    for (let request = 0; request < 6 + day % 8; request++) {
      const date = new Date(now); date.setDate(date.getDate() - day); date.setHours(8 + request, 15, 0, 0);
      const input = 7000 + ((day + request) % 7) * 2700;
      const sessionId = `demo-session-${day}-${request % 2}`;
      records.push(normalizeUsage({ provider: { kind: 'copilot' }, model: ['GPT-5.1', 'GPT-5 mini', 'Sonnet'][request % 3], inputTokens: input, outputTokens: 600 + request * 100, cacheReadTokens: Math.floor(input * .55), cacheWriteTokens: Math.floor(input * .2), copilotUsage: { totalNanoAiu: (request + 1) * 77000000 }, aiCreditsStatus: 'complete' }, { key: `${day}-${request}`, timestamp: date.toISOString(), sessionId, project: ['website', 'api', 'documentation'][request % 3], source: 'Synthetic demo' }).record);
    }
  }
  return { records, sources: [{ path: 'Synthetic demo — no account data', state: 'ok', files: 70, records: records.length }], coverage: { excluded: 0, unclassified: 0, invalid: 0, aggregateOnly: 0, fallbackRequests: 0 } };
}
