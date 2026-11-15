import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Synthetic by default. --local reads local usage but prints only counts and timings.
const target = process.argv.find(a => a.startsWith('--repo='))?.slice(7) || process.cwd();
const load = file => import(pathToFileURL(path.join(target, file)).href);
const { buildReport } = await load('src/core/copilot-report.mjs');
const { createReceiptParser } = await load('src/core/copilot.mjs');
const elapsed = async fn => { const start = performance.now(); const value = await fn(); return { ms: Math.round((performance.now() - start) * 10) / 10, value }; };
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const now = new Date();

async function reportTimes(snapshot) {
  const timings = {};
  for (const query of [{ range: 'all' }, { range: '1d' }, { range: '7d' }, { range: 'all', models: [snapshot.records[0]?.model || 'missing'] }]) {
    const samples = [];
    let report;
    for (let i = 0; i < 3; i++) {
      const run = await elapsed(() => buildReport(snapshot.records, query, now, snapshot));
      report = run.value; samples.push(run.ms);
    }
    timings[query.models ? 'modelFilter' : query.range] = { medianMs: median(samples), records: report.totals.requests };
  }
  return timings;
}

if (process.argv.includes('--startup')) {
  const { startServer } = await load('src/node/canvas-server.mjs');
  const server = await startServer({ html: '', defaultHome: 'synthetic', settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
    scanner: { scan: async () => ({ records: [], sources: [], coverage: {} }) },
    readIntegrations: async () => { await new Promise(resolve => setTimeout(resolve, 1000)); return { mcp: { available: true, rows: [] }, plugins: { available: true, rows: [] } }; },
  });
  try {
    const run = await elapsed(async () => {
      const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.report' }) });
      if (!response.ok) throw new Error(`Startup failed: ${response.status}`);
      await response.json();
    });
    console.log(JSON.stringify({ mode: 'synthetic startup', hostInventoryDelayMs: 1000, usageReadyMs: run.ms }));
  } finally { await server.close(); }
} else if (process.argv.includes('--format')) {
  const { formatNumber, formatCredits } = await load('src/core/format.mjs');
  const run = await elapsed(() => { for (let i = 0; i < 10000; i++) { formatNumber(i % 1000); formatCredits(i / 1000); } });
  console.log(JSON.stringify({ mode: 'number formatting', values: 20000, durationMs: run.ms }));
} else if (process.argv.includes('--local')) {
  const { createScanner } = await load('src/node/copilot-source.mjs');
  const { copilotHome, enhancePromptUsageHome, reviewUsageHome, createSettings } = await load('src/node/settings.mjs');
  const { addInstalledSkillVersions } = await load('src/node/skill-version.mjs');
  const config = await createSettings().get(), roots = [copilotHome(), ...config.extraHomes], options = { disabled: config.disabledHomes };
  const scanner = createScanner({ optionalHomes: [enhancePromptUsageHome(), reviewUsageHome()] });
  const first = await elapsed(() => scanner.scan(roots, options));
  const warm = await elapsed(() => scanner.scan(roots, options));
  const report = buildReport(warm.value.records, { range: '7d' }, now, warm.value);
  const versions = await elapsed(() => addInstalledSkillVersions(report.skills.rows));
  console.log(JSON.stringify({ mode: 'local', coldScanMs: first.ms, unchangedScanMs: warm.ms, skillVersionMs: versions.ms, files: first.value.sources.reduce((n, s) => n + (s.files || 0), 0), records: first.value.records.length, reports: await reportTimes(warm.value) }));
} else {
  for (const count of [1000, 5000, 10000]) {
    const records = [], promptEvents = [], interactions = [], tools = [];
    const start = performance.now();
    for (let offset = 0; offset < count; offset += 100) {
      const sessionId = `bench-${offset}`, parser = createReceiptParser({ sessionId, source: 'synthetic' });
      let serial = 0;
      const push = (type, data) => parser.push(JSON.stringify({ type, data, id: `event-${serial++}`, timestamp: new Date(now.getTime() - (offset % 60) * 86400000).toISOString() }));
      push('session.start', { sessionId, context: { repository: `Project ${offset % 7}` } });
      for (let i = 0; i < 100; i++) {
        const interactionId = `prompt-${i}`, apiCallId = `call-${i}`;
        push('user.message', { interactionId, messageId: interactionId, source: 'user', content: 'Synthetic prompt' });
        push('assistant.turn_start', { interactionId, turnId: interactionId });
        push('session.usage_record', { usage: { apiCallId, provider: { kind: 'copilot' }, model: `Model ${i % 3}`, initiator: 'user',
          accounting: { sourceSessionId: sessionId, usageId: apiCallId }, copilotUsage: { totalNanoAiu: 1000000 }, aiCreditsStatus: 'complete', inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 200, toolTokenCount: 50 } });
        push('assistant.message', { interactionId, turnId: interactionId, apiCallId, phase: 'final_answer', toolRequests: [] });
        push('assistant.turn_end', { turnId: interactionId });
      }
      const s = parser.snapshot(); records.push(...s.records); promptEvents.push(...s.promptEvents); interactions.push(...s.interactions); tools.push(...s.tools);
    }
    console.log(JSON.stringify({ mode: 'synthetic', records: records.length, parseMs: Math.round(performance.now() - start), reports: await reportTimes({ records, promptEvents, interactions, tools }) }));
  }
}
