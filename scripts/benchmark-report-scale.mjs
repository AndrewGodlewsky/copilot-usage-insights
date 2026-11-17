import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = option('repo', process.cwd());
const { buildReport } = await import(pathToFileURL(path.join(root, 'src/core/copilot-report.mjs')));
const { createPromptEventSet } = await import(pathToFileURL(path.join(root, 'src/core/prompt-credits.mjs')));
export const now = new Date('2026-11-17T18:00:00Z');
const start = now.getTime() - 3_600_000;

export function fixture(count, kind = 'normal') {
  const records = [], promptEvents = [];
  const firstMs = Math.min(start, now.getTime() - count * 10 - 60_000);
  for (let i = 0; i < count; i++) {
    const sessionId = ['shared', 'shared-models', 'long', 'delegated'].includes(kind) ? 'long-session' : `session-${i}`;
    const interaction = kind.startsWith('shared') ? 'shared-interaction' : `interaction-${i}`;
    const ms = firstMs + i * 10, api = `call-${i}`, key = `receipt-${i}`, model = `Model ${kind === 'shared-models' ? i : i % 3}`, project = 'Synthetic project';
    const r = { key, sessionId, project, model, modelId: `raw-${i % 3}`, ts: new Date(ms + 2).toISOString(), ms: ms + 2,
      input: 1000, inputTotal: 2000 + i % 100, output: 100, cacheRead: 1000, cacheWrite: i % 100, reasoning: 10,
      nanoAiu: i % 7 === 0 ? 0 : 1_000_000, creditStatus: 'complete', initiator: 'user', cacheDetailsReported: true,
      apiCallId: api, logFile: 'synthetic-not-read', source: 'synthetic', duration: 1 };
    records.push(r);
    const base = { sessionId, agent: '', parentTool: '', interaction, turn: String(i) };
    const receipt = { ...base, kind: 'receipt', id: `receipt-event-${i}`, ms: ms + 2, receiptKey: key, api, model,
      nano: r.nanoAiu, status: 'complete', copilot: true, initiator: 'user', context: [r.modelId, r.inputTotal, r.cacheRead, r.cacheWrite, true] };
    promptEvents.push({ ...base, kind: 'user', id: `user-${i}`, ms, promptId: `prompt-${i}`, project, origin: 'user', delivery: i ? 'steering' : 'idle' },
      { ...base, kind: 'turn-start', id: `start-${i}`, ms: ms + 1 }, receipt,
      { ...base, kind: 'message', id: `message-${i}`, ms: ms + 3, api, originatingPrompt: '', tools: [], invalidTools: false, terminal: true },
      { ...base, interaction: '', kind: 'turn-end', id: `end-${i}`, ms: ms + 4 });
    if (kind === 'coupled') promptEvents.push({ ...receipt, id: `copy-${i}`, sessionId: `copy-session-${i}` });
    if (kind === 'chain' && i > 0) {
      const previous = promptEvents.findLast(e => e.kind === 'receipt' && e.sessionId === `session-${i - 1}`);
      promptEvents.push({ ...previous, id: `copy-${i}`, sessionId });
    }
  }
  if (kind === 'delegated') {
    assert.ok(count >= 3);
    promptEvents[3].tools = ['task']; promptEvents[3].terminal = false;
    for (let i = 1; i < count - 1; i++) {
      const agent = `worker-${i}`, ms = records[i].ms - 2;
      records[i].initiator = 'sub-agent';
      for (const event of promptEvents.slice(i * 5, i * 5 + 5)) { event.agent = agent; event.parentTool = 'task'; }
      promptEvents[i * 5].origin = 'child'; promptEvents[i * 5 + 2].initiator = 'sub-agent';
      promptEvents.push({ kind: 'agent-start', id: `spawn-${i}`, sessionId: 'long-session', agent, parentTool: '', tool: 'task', interaction: '', turn: '', ms: ms - 1 },
        { kind: 'agent-end', id: `done-${i}`, sessionId: 'long-session', agent, parentTool: '', tool: 'task', interaction: '', turn: '', ms: ms + 5 });
    }
    for (const event of promptEvents.slice((count - 1) * 5, count * 5)) if (event.interaction) event.interaction = 'interaction-0';
    records.at(-1).initiator = 'agent'; promptEvents[(count - 1) * 5 + 2].initiator = 'agent';
    promptEvents.splice((count - 1) * 5, 1);
    promptEvents.push({ kind: 'tool-start', id: 'task-start', sessionId: 'long-session', agent: '', parentTool: '', tool: 'task', interaction: '', turn: '', ms: firstMs + 5 },
      { kind: 'tool-end', id: 'task-end', sessionId: 'long-session', agent: '', parentTool: '', tool: 'task', interaction: '', turn: '', ms: records.at(-1).ms - 3 });
  }
  return { records, promptEvents, cache: { uniquePromptEvents: true }, skills: [], tools: [], interactions: [], sources: [] };
}

export function invariants(report, input, kind) {
  assert.equal(report.totals.requests, input.records.length);
  const credits = input.records.reduce((sum, r) => sum + BigInt(r.nanoAiu), 0n);
  assert.equal(report.totals.credits, Number(credits) / 1e9);
  assert.equal(report.efficiency.summary.credits, Number(credits) / 1e9);
  assert.equal(report.projects.reduce((sum, p) => sum + p.userPrompts, 0), kind === 'delegated' ? 1 : input.records.length);
  if (['normal', 'long', 'coupled'].includes(kind)) {
    assert.equal(report.promptCredits.eligiblePrompts, input.records.length);
    assert.equal(report.promptCredits.credits, Number(credits) / 1e9);
  }
  if (kind.startsWith('shared')) {
    assert.equal(report.promptCredits.eligiblePrompts, 0);
    assert.equal(report.promptCredits.excluded.attribution, input.records.length);
    assert.equal(report.efficiency.conversations.delivery.prompts, input.records.length);
  }
  if (kind === 'delegated') {
    assert.equal(report.promptCredits.eligiblePrompts, 1);
    assert.equal(report.promptCredits.work.requests, input.records.length);
    assert.equal(report.promptCredits.credits, Number(credits) / 1e9);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (option('compare')) {
    const baseline = await import(pathToFileURL(path.join(option('compare'), 'src/core/copilot-report.mjs')));
    let comparisons = 0;
    for (const kind of ['normal', 'long', 'shared', 'shared-models', 'coupled', 'chain', 'delegated']) for (const variant of ['original', 'reordered-ties', 'conflicts']) {
      const input = fixture(64, kind);
      if (variant === 'reordered-ties') {
        for (const e of input.promptEvents) e.ms = start;
        input.promptEvents.reverse();
      } else if (variant === 'conflicts') {
        input.promptEvents.push(...input.promptEvents.slice(0, 32).map(e => ({ ...e, environment: 'windows' })),
          ...input.promptEvents.slice(0, 32).map(e => ({ ...e, ms: e.ms + 1, delivery: 'queued' })));
        input.cache.uniquePromptEvents = false;
      }
      for (const query of [{ range: 'all' }, { range: '1d' }, { range: 'all', models: ['Model 0'] }, { range: 'all', session: input.records[0].sessionId },
        { range: 'all', project: 'missing' }, { range: 'all', includeCache: false }, { range: 'custom', startDate: '2026-11-01', endDate: '2026-11-16' }]) {
        const oldInput = structuredClone(input), newInput = structuredClone(input);
        const expected = baseline.buildReport(oldInput.records, query, now, oldInput);
        const actual = buildReport(newInput.records, query, now, newInput);
        assert.deepEqual(actual, expected, `${kind}/${variant}/${JSON.stringify(query)}`);
        comparisons++;
      }
    }
    console.log(JSON.stringify({ mode: 'baseline-equivalence', comparisons }));
    process.exit(0);
  }
  const count = Number(option('n', 10000)), kind = option('case', 'normal'), repeats = Number(option('repeat', 3));
  const samples = [];
  if (kind === 'conflicts') {
    for (let run = 0; run < repeats; run++) {
      globalThis.gc?.(); const begin = performance.now(), set = createPromptEventSet();
      for (let i = 0; i < count; i++) set.add({ kind: 'user', id: 'same-envelope-id', sessionId: 'one-session', ms: start + i, promptId: `p-${i}`, origin: 'user', project: 'Synthetic' });
      assert.equal(set.events.length, count); samples.push(performance.now() - begin);
    }
    console.log(JSON.stringify({ kind, count, samples }));
  } else {
    const input = fixture(count, kind); let result;
    const query = { range: 'all', ...(option('models') ? { models: ['Model 0', ...Array.from({ length: Number(option('models')) }, (_, i) => `Absent model ${i}`)] } : {}) };
    globalThis.gc?.(); const before = process.memoryUsage().heapUsed;
    for (let run = 0; run < repeats; run++) {
      input.cache = { uniquePromptEvents: true }; globalThis.gc?.();
      const begin = performance.now(); result = buildReport(input.records, query, now, input);
      samples.push(performance.now() - begin); if (!query.models) invariants(result, input, kind);
    }
    const warm = performance.now(); result = buildReport(input.records, query, now, input);
    const warmMs = performance.now() - warm; if (!query.models) invariants(result, input, kind);
    globalThis.gc?.();
    console.log(JSON.stringify({ kind, count, filterModels: query.models?.length, samples, warmMs, retainedHeapMiB: (process.memoryUsage().heapUsed - before) / 1048576,
      requests: result.totals.requests, prompts: result.promptCredits.prompts, eligible: result.promptCredits.eligiblePrompts, jsonBytes: Buffer.byteLength(JSON.stringify(result)) }));
    if (process.argv.includes('--wire')) {
      const { encodeReportWire, decodeReportWire, reportWireRetainedBytes } = await import('../src/core/report-wire.mjs');
      const plainStart = performance.now(), plainJson = JSON.stringify(result), plainStringifyMs = performance.now() - plainStart;
      const encodeStart = performance.now(), encoded = encodeReportWire(result), encodeMs = performance.now() - encodeStart;
      const stringifyStart = performance.now(), compactJson = JSON.stringify(encoded), compactStringifyMs = performance.now() - stringifyStart;
      const parseStart = performance.now(), received = JSON.parse(compactJson), compactParseMs = performance.now() - parseStart;
      const decodeStart = performance.now(), decoded = decodeReportWire(received), decodeMs = performance.now() - decodeStart;
      const plainParseStart = performance.now(), expected = JSON.parse(plainJson), plainParseMs = performance.now() - plainParseStart;
      assert.deepEqual(decoded, expected, 'Compact wire must restore the complete JSON-equivalent report');
      const plainBytes = Buffer.byteLength(plainJson), compactBytes = Buffer.byteLength(compactJson);
      console.log(JSON.stringify({ mode: 'compact-wire', sessionRows: result.sessions.length, plainBytes, compactBytes,
        reductionPercent: (1 - compactBytes / plainBytes) * 100, retainedBytesEstimate: reportWireRetainedBytes(encoded, compactBytes),
        plainStringifyMs, encodeMs, compactStringifyMs, plainParseMs, compactParseMs, decodeMs }));
    }
    if (process.argv.includes('--sizes')) {
      const bytes = value => Buffer.byteLength(JSON.stringify(value));
      const fields = Object.entries(result).map(([name, value]) => ({ name, bytes: bytes(value) })).sort((a, b) => b.bytes - a.bytes);
      const columns = Object.keys(result.sessions[0] || {}).filter(k => k !== 'missing'), missingColumns = Object.keys(result.sessions[0]?.missing || {});
      const columnar = { columns, missingColumns, rows: result.sessions.map(row => [...columns.map(key => row[key]), missingColumns.map(key => row.missing[key])]) };
      const restored = columnar.rows.map(values => ({ ...Object.fromEntries(columns.map((key, i) => [key, values[i]])),
        missing: Object.fromEntries(missingColumns.map((key, i) => [key, values[columns.length][i]])) }));
      assert.deepEqual(restored, result.sessions, 'Experimental columnar encoding must restore every session field');
      const defaults = {}, varying = [];
      for (const key of columns) {
        const first = result.sessions[0][key];
        if (result.sessions.every(row => Object.is(row[key], first))) defaults[key] = first;
        else varying.push(key);
      }
      const commonMissing = result.sessions.every(row => bytes(row.missing) === bytes(result.sessions[0].missing) && missingColumns.every(key => row.missing[key] === result.sessions[0].missing[key]));
      const shared = { defaults, columns: varying, ...(commonMissing ? { missing: result.sessions[0].missing } : { missingColumns }),
        rows: result.sessions.map(row => [...varying.map(key => row[key]), ...(commonMissing ? [] : [missingColumns.map(key => row.missing[key])])]) };
      const restoredShared = shared.rows.map(values => ({ ...defaults, ...Object.fromEntries(varying.map((key, i) => [key, values[i]])),
        missing: commonMissing ? { ...shared.missing } : Object.fromEntries(missingColumns.map((key, i) => [key, values[varying.length][i]])) }));
      assert.deepEqual(restoredShared, result.sessions, 'Experimental common-value encoding must restore every session field');
      console.log(JSON.stringify({ mode: 'wire-size-experiment-only', fields, options: Object.entries(result.options).map(([name, value]) => ({ name, bytes: bytes(value) })),
        sessionRows: result.sessions.length, originalSessionsBytes: bytes(result.sessions), columnarSessionsBytes: bytes(columnar), sharedValueSessionsBytes: bytes(shared),
        note: 'No runtime protocol change; these synthetic-only encodings were decoded and deep-compared with every original session field.' }));
    }
  }
}
