import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings, FINDINGS_SHOWN } from '../src/core/efficiency-findings.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { buildEfficiencyReview } from '../src/panel/efficiency.mjs';
import { demoData } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const kinds = f => f.shown.map(x => x.kind);
const status = (f, kind) => f.shown.some(x => x.kind === kind) ? 'found' : f.clear.some(x => x.kind === kind) ? 'clear' : f.missing.some(x => x.kind === kind) ? 'missing' : 'none';
const timing = (quick, long, calls = 10) => ({ cacheTiming: { modelFiltered: false, situations: [{ id: 'under5', calls, share: quick }, { id: 'over60', calls, share: long }] } });
const prompts = (share, eligible = 20, extra = {}) => ({ eligiblePrompts: eligible, pending: false, spread: { heavyPrompts: Math.floor(eligible / 10), heavyShare: share, heavyCredits: 12.5 }, ...extra });
const recovery = (longest, known = 10, name = 'bash') => ({ recovery: { known, runs: { longest, repeated: 2, top: longest >= 2 ? [{ name, server: '', mcpTool: '', session: 'Chat', length: longest, day: '2026-06-01', then: 'succeeded' }] : [] } } });
const compaction = (repeat, sessions = 4) => ({ compaction: { sessions, repeatSessions: repeat, repeatCompactions: repeat * 2, modelFiltered: false } });
const growth = (input, total = 1000, calls = 20, conversations = 3) => ({ growthSummary: { measuredCalls: calls, measuredConversations: conversations, later: { input, totalInput: total, calls: 5, conversations: 2 } } });
const change = (before, after, pairs = 5, modelFiltered = false) => ({ changeDetail: { modelFiltered, next: { cachePairs: pairs, cacheBefore: before, cacheAfter: after, lower: 4 } } });
const repetition = (repeated, measured = 40, afterReading = 0) => ({ repetition: { reading: { measured, repeated, share: measured ? repeated / measured * 100 : null, top: repeated ? [{ name: 'view', server: '', mcpTool: '', repeated }] : [] }, compaction: { afterReading } } });
const habits = (laterHigher, conversations = 10, reason) => ({ habits: reason ? { reason } : { paired: { conversations, laterHigher } } });

test('each finding kind appears at its threshold and not just below it', () => {
  const cases = [
    ['pause', (a, b) => [timing(a, b), null], [80, 60], [80, 60.1], [90, 10]],
    ['prompts', v => [{}, prompts(v)], [50], [49.9], [90]],
    ['failures', v => [recovery(v), null], [3], [2], [8]],
    ['compaction', v => [compaction(v, 8), null], [2], [1], [6]],
    ['late', v => [growth(v), null], [500], [499], [900]],
    ['switch', (a, b) => [change(a, b), null], [70, 50], [70, 50.1], [90, 10]],
    ['repetition', v => [repetition(v, 40), null], [6], [5], [16]],
    ['habits', v => [habits(v, 10), null], [7], [6], [10]],
  ];
  for (const [kind, make, at, below, above] of cases) {
    const [e, p] = make(...at);
    assert.equal(status(buildFindings(e, p), kind), 'found', `${kind} at threshold`);
    const [e2, p2] = make(...below);
    assert.equal(status(buildFindings(e2, p2), kind), 'clear', `${kind} below threshold`);
    const [e3, p3] = make(...above);
    assert.equal(status(buildFindings(e3, p3), kind), 'found', `${kind} above threshold`);
  }
  // Compaction also needs a quarter of the compacted conversations.
  assert.equal(status(buildFindings(compaction(2, 9)), 'compaction'), 'clear');
});

test('minimum samples decide between clear and missing, and missing says why', () => {
  assert.equal(status(buildFindings(timing(90, 10, 9)), 'pause'), 'missing');
  assert.equal(status(buildFindings({}, prompts(80, 19)), 'prompts'), 'missing');
  assert.equal(status(buildFindings({}, prompts(80, 40, { pending: true })), 'prompts'), 'missing');
  assert.equal(status(buildFindings({}, prompts(null, 40)), 'prompts'), 'missing');
  assert.equal(status(buildFindings(recovery(5, 9)), 'failures'), 'missing');
  assert.equal(status(buildFindings(compaction(3, 2)), 'compaction'), 'missing');
  assert.equal(status(buildFindings(growth(900, 1000, 19)), 'late'), 'missing');
  assert.equal(status(buildFindings(growth(900, 1000, 20, 2)), 'late'), 'missing');
  assert.equal(status(buildFindings(change(90, 10, 4)), 'switch'), 'missing');
  assert.equal(status(buildFindings(repetition(10, 19)), 'repetition'), 'missing');
  assert.equal(status(buildFindings(repetition(4, 20)), 'repetition'), 'clear');
  assert.equal(status(buildFindings(habits(4, 4)), 'habits'), 'missing');
  assert.match(buildFindings(habits(0, 0, 'model-filter')).missing.find(m => m.kind === 'habits').reason, /model filter/);
  const filtered = buildFindings(change(90, 10, 9, true));
  assert.match(filtered.missing.find(m => m.kind === 'switch').reason, /model filter/);
  // An empty report is all missing, never all clear and never an error.
  const none = buildFindings({}, null);
  assert.equal(none.qualified, 0); assert.equal(none.clear.length, 0); assert.equal(none.missing.length, 8);
  assert.ok(none.missing.every(m => m.reason && m.label));
  // A null measure is not zero: a missing share must not read as a gap.
  assert.equal(status(buildFindings({ cacheTiming: { situations: [{ id: 'under5', calls: 20, share: 80 }, { id: 'over60', calls: 20, share: null }] } }), 'pause'), 'missing');
});

test('findings are ordered by how far past the threshold they are and capped', () => {
  const e = { ...timing(90, 10), ...recovery(9), ...compaction(4, 4), ...growth(1000), ...change(90, 10) };
  const f = buildFindings(e, prompts(60));
  assert.equal(f.qualified, 6);
  assert.equal(f.shown.length, FINDINGS_SHOWN);
  assert.equal(f.more, 1);
  for (let i = 1; i < f.shown.length; i++) assert.ok(f.shown[i - 1].strength >= f.shown[i].strength);
  // Strengths: pause 4x, compaction 4x, switch 4x, failures 3x, late 2x, prompts 1.2x. Ties keep the fixed kind order.
  assert.deepEqual(kinds(f), ['pause', 'compaction', 'switch', 'failures', 'late']);
  assert.equal(new Set(kinds(f)).size, kinds(f).length, 'at most one finding of each kind');
});

test('every finding names the view that holds its detail', () => {
  const where = f => Object.fromEntries(f.shown.map(x => [x.kind, `${x.view.section}:${x.view.topic}`]));
  assert.deepEqual(where(buildFindings({ ...timing(90, 10), ...recovery(9), ...compaction(4), ...growth(900) }, prompts(70))),
    { pause: 'tokens:cache', prompts: 'tokens:prompts', failures: 'patterns:recovery', compaction: 'patterns:compaction', late: 'patterns:growth' });
  assert.deepEqual(where(buildFindings(change(90, 10))), { switch: 'patterns:transitions' });
});

test('the report adds findings without changing insights or the AI review payload', () => {
  const data = demoData(), report = buildReport(data.records, { range: '30d' }, new Date(), data);
  assert.ok(report.efficiency.findings && Array.isArray(report.efficiency.findings.shown));
  assert.ok(JSON.stringify(report.efficiency.findings).length < 6000, 'bounded');
  const withFindings = buildEfficiencyReview(report, null);
  const { findings, ...rest } = report.efficiency;
  const without = buildEfficiencyReview({ ...report, efficiency: rest }, null);
  assert.equal(withFindings, without);
  // Whatever the findings say, the review payload must not change.
  const loud = buildEfficiencyReview({ ...report, efficiency: { ...rest, findings: buildFindings({ ...timing(90, 10), ...recovery(9) }, prompts(90)) } }, null);
  assert.equal(loud, without);
  assert.doesNotMatch(withFindings, /"findings"|FROM THE OTHER VIEWS/);
});

async function open(report) {
  const mounted = await mountPanel(report);
  mounted.get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await mounted.get('refresh').onclick();
  return mounted;
}
const fullReport = () => {
  const data = demoData();
  return { ...buildReport(data.records, { range: '30d' }, new Date(), data), sources: [], coverage: {} };
};

test('the panel shows qualifying findings with evidence, a caveat, an experiment and a button', async () => {
  const report = fullReport();
  report.efficiency.findings = buildFindings({ ...timing(90, 10), ...recovery(9, 10, '<img src=x>'), ...compaction(4, 4), ...growth(900), ...change(90, 10) }, prompts(70));
  const { get } = await open(report);
  const html = get('efficiency-findings').innerHTML;
  assert.match(html, /Less input is reused from cache after long pauses/);
  assert.match(html, /data-finding-section="tokens" data-finding-topic="cache"/);
  assert.match(html, /data-finding-section="patterns" data-finding-topic="recovery"/);
  assert.match(html, /TRY THIS/);
  assert.match(html, /What to compare afterward/);
  assert.match(html, /Showing 5 of 6 that qualified; 1 more qualified/);
  assert.match(html, /not targets/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|—/);
  assert.match(get('efficiency-insight-count').textContent, /patterns to review/);
});

test('a finding button opens the token or pattern view that holds the detail', async () => {
  const report = fullReport();
  report.efficiency.findings = buildFindings({ ...timing(90, 10), ...recovery(9) });
  const { get } = await open(report);
  const press = (section, topic) => get('efficiency-findings').onclick({ target: { closest: () => ({ dataset: { findingSection: section, findingTopic: topic } }) } });
  press('patterns', 'recovery');
  assert.equal(get('pattern-recovery-panel').hidden, false);
  assert.equal(get('pattern-findings-panel').hidden, true);
  assert.equal(get('efficiency-patterns-panel').hidden, false);
  press('tokens', 'cache');
  assert.equal(get('efficiency-tokens-panel').hidden, false);
  assert.equal(get('token-cache-panel').hidden, false);
});

test('when nothing qualifies the panel says what was checked, separately from missing data', async () => {
  const report = fullReport();
  report.efficiency.findings = buildFindings({ ...timing(60, 59), ...compaction(0, 5) }, null);
  const { get } = await open(report);
  const html = get('efficiency-findings').innerHTML;
  assert.doesNotMatch(html, /FROM THE OTHER VIEWS/);
  assert.match(html, /Nothing from the other views crossed its threshold/);
  assert.match(html, /Checked, and below the threshold: Cache reuse after pauses, Conversations compacted more than once\./);
  assert.match(html, /Not enough data to check: Credits held by the heaviest prompts \(needs 20 prompts/);
  assert.match(html, /Missing data is not the same as nothing found/);
  const empty = fullReport();
  empty.efficiency.findings = buildFindings({}, null);
  const blank = (await open(empty)).get('efficiency-findings').innerHTML;
  assert.doesNotMatch(blank, /Nothing from the other views crossed/);
  assert.match(blank, /Not enough data to check/);
  const old = fullReport();
  delete old.efficiency.findings;
  assert.equal((await open(old)).get('efficiency-findings').innerHTML, '');
});

test('overlapping legacy growth and MCP failure cards are deduplicated against cross-view findings and new kinds render', async () => {
  const report = fullReport();
  report.efficiency.insights = [
    { kind: 'growth', model: 'Alpha', sessionName: 'Chat', initiator: 'user', early: 1000, late: 15000, multiple: 15, samples: 6, requests: 6 },
    { kind: 'cache', model: 'Alpha', rate: 20, input: 100000, cached: 20000, samples: 10, requests: 10 },
  ];
  report.mcp = { available: false, rows: [{ name: 'github', calls: 10, successes: 5, failures: 5, unknown: 0 }] };
  report.efficiency.findings = buildFindings({
    ...growth(900),
    ...recovery(5, 10, 'search'),
    ...repetition(12, 40, 3),
    ...habits(8, 10),
  }, null);
  // Make the failure finding specifically target github / search so MCP RELIABILITY deduplicates.
  report.efficiency.findings.shown.find(f => f.kind === 'failures').operation = 'github / search';
  const { get } = await open(report);
  const insightsHtml = get('efficiency-insights').innerHTML;
  const findingsHtml = get('efficiency-findings').innerHTML;
  assert.doesNotMatch(insightsHtml, /Inspect larger input later in a session/);
  assert.doesNotMatch(insightsHtml, /MCP RELIABILITY/);
  assert.match(insightsHtml, /Check opportunities to reuse context/);
  assert.match(insightsHtml, /Open Cache reuse/);
  assert.match(findingsHtml, /Reading and searching calls repeated identical earlier calls/);
  assert.match(findingsHtml, /3 happened after a compaction/);
  assert.match(findingsHtml, /Later prompts cost more credits than the first prompt in most conversations/);
  assert.match(findingsHtml, /data-finding-section="patterns" data-finding-topic="repetition"/);
  assert.match(findingsHtml, /data-finding-section="patterns" data-finding-topic="habits"/);
});
