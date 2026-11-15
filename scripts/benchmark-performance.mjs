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

// Heavy-user simulation: writes a synthetic Copilot home, then times every stage a dashboard
// open, a filter change and the 60-second refresh go through, as the panel drives them.
//   node --expose-gc scripts/benchmark-performance.mjs --scale --records=50000
// Options: --days=180 --empty=2000 --payload=compact|realistic --seed=1 --skip-unused --keep
// --repo=<checkout> measures another checkout on the same generated history.
async function scale() {
  const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const fs = await import('node:fs/promises'), os = await import('node:os');
  const { writeSyntheticHome } = await import('./synthetic-history.mjs');
  const { createScanner } = await load('src/node/copilot-source.mjs');
  const { startServer } = await load('src/node/canvas-server.mjs');
  const { buildRequestPage, buildModelSessionPage, buildSessionModels } = await load('src/core/copilot-report.mjs');
  const { readRequestPrompts } = await load('src/node/request-prompts.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-scale-'));
  const round = ms => Math.round(ms * 10) / 10, mb = bytes => Math.round(bytes / 104857.6) / 10;
  const heap = () => { globalThis.gc?.(); return mb(process.memoryUsage().heapUsed); };
  const timed = async (fn, runs = 3) => { const samples = []; let value; for (let i = 0; i < runs; i++) { const run = await elapsed(fn); value = run.value; samples.push(run.ms); } return { ms: median(samples), value }; };
  const scannerOptions = process.argv.includes('--skip-unused') ? { skipUnused: true } : {};
  try {
    const written = await elapsed(() => writeSyntheticHome(root, { seed: Number(option('seed', 1)), records: Number(option('records', 50000)), days: Number(option('days', 180)), payload: option('payload', 'compact'), now, emptyDirs: Number(option('empty', 2000)) }));
    const { truth, sessions, bytes } = written.value;
    // Hold back the tail of the largest journal so appends can be replayed as live activity.
    const active = sessions.reduce((a, b) => b.lines > a.lines ? b : a);
    const lines = (await fs.readFile(active.file, 'utf8')).split('\n').filter(Boolean), held = lines.splice(-80);
    await fs.writeFile(active.file, lines.join('\n') + '\n');
    const append = count => fs.appendFile(active.file, held.splice(0, count).join('\n') + '\n');
    const out = { mode: 'scale', payload: option('payload', 'compact'), skipUnused: !!scannerOptions.skipUnused, records: truth.records, sessionFiles: sessions.length, emptyDirs: Number(option('empty', 2000)), journalMB: mb(bytes), generateMs: round(written.ms) };
    {
      const baseHeap = heap(), scanner = createScanner(scannerOptions);
      const cold = await elapsed(() => scanner.scan([root]));
      Object.assign(out, { coldScanMs: round(cold.ms), coldMBperSec: round(bytes / 1048576 / (cold.ms / 1000)), retainedHeapMB: round(heap() - baseHeap) });
      out.heapBytesPerRequest = Math.round(out.retainedHeapMB * 1048576 / truth.records);
      let snapshot = cold.value;
      out.unchangedScanMs = (await timed(async () => { snapshot = await scanner.scan([root]); })).ms;
      // The first report of a session also links every model call to its prompt.
      out.firstReportAllMs = round((await elapsed(() => buildReport(snapshot.records, { range: 'all' }, new Date(), snapshot))).ms);
      const appends = [], afterAppend = [];
      for (let i = 0; i < 4; i++) {
        await append(10);
        appends.push((await elapsed(async () => { snapshot = await scanner.scan([root]); })).ms);
        afterAppend.push((await elapsed(() => buildReport(snapshot.records, { range: 'all' }, new Date(), snapshot))).ms);
      }
      Object.assign(out, { appendScanMs: median(appends), reportAllAfterAppendMs: median(afterAppend), activeJournalMB: mb((await fs.stat(active.file)).size) });
      const model = snapshot.records[0]?.model, project = snapshot.records[0]?.project;
      out.reports = {};
      for (const [name, query] of Object.entries({ '1d': { range: '1d' }, '7d': { range: '7d' }, '30d': { range: '30d' }, '90d': { range: '90d' }, all: { range: 'all' }, allOneModel: { range: 'all', models: [model] }, allOneProject: { range: 'all', project } })) {
        const run = await timed(() => buildReport(snapshot.records, query, new Date(), snapshot));
        const json = await timed(() => JSON.stringify(run.value));
        out.reports[name] = { buildMs: run.ms, requests: run.value.totals.requests, jsonKB: Math.round(json.value.length / 1024), stringifyMs: json.ms, sessionRows: run.value.sessions.length, dailyRows: run.value.daily.length };
      }
      const busiest = [...snapshot.records.reduce((m, r) => m.set(r.sessionId, (m.get(r.sessionId) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0];
      const sample = snapshot.records.find(r => r.sessionId === busiest);
      out.pages = {
        modelSessionsMs: (await timed(() => buildModelSessionPage(snapshot.records, { range: 'all', model: sample.model }, new Date(), snapshot))).ms,
        sessionRequestsMs: (await timed(() => buildRequestPage(snapshot.records, { range: 'all', model: sample.model, session: busiest }, new Date()))).ms,
        sessionModelsMs: (await timed(() => buildSessionModels(snapshot.records, { range: 'all', project: sample.project, session: busiest }, new Date()))).ms,
        promptReadMs: (await timed(() => readRequestPrompts([sample], { maxChars: 12000 }), 1)).ms,
      };
    }
    // The real HTTP path, exactly as the panel calls it. The panel offers the fingerprint of
    // what it already shows; a checkout that does not understand it simply sends everything.
    const idle = heap();
    const server = await startServer({ html: '', defaultHome: root, scanner: createScanner(scannerOptions), settings: { get: async () => ({ extraHomes: [], disabledHomes: [] }) },
      readIntegrations: async () => ({ mcp: { available: false, rows: [] }, plugins: { available: false, rows: [] } }) });
    try {
      const shown = new Map();
      const call = async (input, refresh = false) => {
        const key = JSON.stringify(input), known = refresh ? shown.get(key) : undefined;
        const run = await elapsed(async () => {
          const response = await fetch(server.url + 'api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'usage.report', input, ...(refresh ? { refresh: true } : {}), ...(known ? { known } : {}) }) });
          const text = await response.text();
          if (!response.ok) throw new Error(text.slice(0, 200));
          return text;
        });
        const revision = /"revision":"([^"]+)"/.exec(run.value.slice(0, 400))?.[1];
        if (revision) shown.set(key, revision);
        return { ms: round(run.ms), kb: Math.round(run.value.length / 1024) };
      };
      const all = { range: 'all' }, week = { range: '7d' };
      out.server = { firstOpen7d: await call(week), filterToAll: await call(all), filterBackTo7d: await call(week) };
      const quiet = [];
      for (let i = 0; i < 3; i++) quiet.push(await call(week, true));
      out.server.refreshNothingNew7d = quiet.sort((a, b) => a.ms - b.ms)[1];
      const quietAll = [];
      await call(all);
      for (let i = 0; i < 3; i++) quietAll.push(await call(all, true));
      out.server.refreshNothingNewAll = quietAll.sort((a, b) => a.ms - b.ms)[1];
      const busy = [];
      for (let i = 0; i < 3; i++) { await append(10); busy.push(await call(all, true)); }
      out.server.refreshAfterActivityAll = busy.sort((a, b) => a.ms - b.ms)[1];
      await call(week);
      const busyWeek = [];
      for (let i = 0; i < 1; i++) { await append(10); busyWeek.push(await call(week, true)); }
      out.server.refreshAfterActivity7d = busyWeek[0];
    } finally { await server.close(); }
    out.serverHeapMB = round(heap() - idle);
    console.log(JSON.stringify(out));
  } finally { if (!process.argv.includes('--keep')) await fs.rm(root, { recursive: true, force: true }); else console.error(`Kept ${root}`); }
}

if (process.argv.includes('--scale')) await scale();
else if (process.argv.includes('--startup')) {
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
