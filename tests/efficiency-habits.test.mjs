import test from 'node:test';
import assert from 'node:assert/strict';
import { createHabitsAccumulator } from '../src/core/efficiency-habits.mjs';
import { renderHabitsTopic } from '../src/panel/habits-topic.mjs';
import { mountPanel } from './fixtures/panel.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { demoData } from '../scripts/demo-data.mjs';

const now = new Date(2026, 10, 16), MIN = 60_000;
// One confirmed prompt. `credits` set means complete, finished work with that many calls.
let serial = 0;
const prompt = (sessionId, ms, { day = 5, calls = 0, nano = 0, tokens = 10, human = true, project = 'p', promptId, delivery = 'idle' } = {}) => ({
  sessionId, project, day, provider: true, identity: human, humanDelivery: human, delivery,
  sample: { ms, promptId: promptId ?? `m${serial++}` },
  charges: Array.from({ length: calls }, () => ({ nano: nano / Math.max(1, calls), tokens })) });
const run = (prompts, { query = {}, start = 1, end = 10, interactions } = {}) => {
  const a = createHabitsAccumulator(query, start, end, now, interactions);
  for (const p of prompts) a.add(p, p.charges.length > 0);
  return a.finish();
};
const number = (n, o) => n == null ? 'Unavailable' : String(o?.maximumFractionDigits ? Math.round(n * 10) / 10 : Math.round(n));

test('conversations are grouped by prompt count with their share of credits', () => {
  const list = [];
  list.push(prompt('a', 1000, { calls: 2, nano: 2e9 }));
  for (let i = 0; i < 3; i++) list.push(prompt('b', 1000 + i * MIN, { calls: 1, nano: 1e9 }));
  for (let i = 0; i < 6; i++) list.push(prompt('c', 1000 + i * MIN, { calls: 1, nano: 1e9 }));
  const d = run(list);
  assert.equal(d.conversations, 3); assert.equal(d.usable, 3); assert.equal(d.prompts, 10); assert.equal(d.eligible, 10);
  assert.deepEqual(d.length.map(b => b.conversations), [1, 1, 1, 0]);
  assert.deepEqual(d.length.map(b => b.prompts), [1, 3, 6, 0]);
  assert.equal(d.credits, 11);
  assert.equal(d.length[2].credits, 6); assert.ok(Math.abs(d.length[2].share - 6 / 11 * 100) < 1e-9);
  assert.equal(d.length[3].credits, null); assert.equal(d.length[3].share, null);
});

test('position bins count earlier prompts, and work figures use eligible prompts only', () => {
  const list = [];
  for (let i = 0; i < 17; i++) list.push(prompt('s', 1000 + i * MIN, i === 3 ? {} : { calls: i + 1, nano: (i + 1) * 1e9, tokens: 100 }));
  const d = run(list);
  assert.deepEqual(d.position.map(b => b.prompts), [1, 4, 10, 2]);
  assert.deepEqual(d.position.map(b => b.eligible), [1, 3, 10, 2]);
  assert.equal(d.position[0].medianCalls, 1); assert.equal(d.position[0].averageCredits, 1);
  // positions 2, 3, 5 have 2, 3, 5 calls; the 4th prompt has no complete work
  assert.equal(d.position[1].averageCalls, 10 / 3); assert.equal(d.position[1].medianCalls, 3);
  assert.equal(d.position[1].averageTokens, 1000 / 3); assert.equal(d.position[1].tokenPrompts, 3);
  assert.equal(d.position[3].medianCredits, 16.5);
});

test('prompts before the selected dates set the position but are not counted', () => {
  const d = run([prompt('s', 100, { day: 0, calls: 1, nano: 1e9 }), prompt('s', 200, { day: 0, calls: 1, nano: 1e9 }), prompt('s', 300, { day: 5, calls: 3, nano: 3e9 })]);
  assert.equal(d.prompts, 1); assert.equal(d.position[0].prompts, 0); assert.equal(d.position[1].prompts, 1);
  assert.equal(d.position[0].averageCredits, null, 'an empty bin is null, not 0');
  assert.equal(d.firstPrompts, 0);
});

test('pauses use the previous confirmed prompt in the same conversation, whatever the arrival order', () => {
  const list = [prompt('s', 101 * MIN, { calls: 4, nano: 4e9 }), prompt('s', 0, { calls: 1, nano: 1e9 }), prompt('s', 3 * MIN, { calls: 2, nano: 2e9 }),
    prompt('s', 40 * MIN, { calls: 3, nano: 3e9 }), prompt('t', 0, { calls: 1, nano: 1e9 })];
  const d = run(list);
  assert.equal(d.firstPrompts, 2);
  assert.deepEqual(d.pause.map(b => b.prompts), [1, 1, 1]);
  assert.deepEqual(d.pause.map(b => b.averageCalls), [2, 3, 4]);
  assert.equal(d.pause[2].credits, 4);
});

test('a session with a submission that cannot be confirmed is left out and reported', () => {
  const d = run([prompt('s', 0, { calls: 1, nano: 1e9 }), prompt('s', MIN, { human: false }), prompt('s', 2 * MIN, { calls: 1, nano: 1e9 }), prompt('t', 0, { calls: 1, nano: 1e9 })]);
  assert.equal(d.conversations, 2); assert.equal(d.usable, 1); assert.equal(d.uncertain, 1); assert.equal(d.prompts, 1);
});

test('the first prompt is compared with later prompts in the same conversation', () => {
  const list = [];
  for (const [id, first, later] of [['a', 1, 2], ['b', 3, 1], ['c', 2, 2]]) { list.push(prompt(id, 0, { calls: 1, nano: first * 1e9 })); list.push(prompt(id, MIN, { calls: 1, nano: later * 1e9 })); }
  list.push(prompt('d', 0, { calls: 1, nano: 1e9 })); list.push(prompt('d', MIN, {}));
  const d = run(list);
  assert.deepEqual(d.paired, { conversations: 3, laterHigher: 1 });
});

test('prompt length uses the recorded character count and keeps unknown separate', () => {
  const sizes = [50, 150, 700, 2500];
  const interactions = sizes.map((chars, i) => ({ key: JSON.stringify(['interaction', 'prompt', 's', `m${i}`]), kind: 'prompt', chars }));
  interactions.push({ key: JSON.stringify(['interaction', 'prompt', 's', 'm4']), kind: 'prompt', chars: null });
  const list = [...sizes, 0].map((_, i) => prompt('s', i * MIN, { calls: i + 1, nano: (i + 1) * 1e9, promptId: `m${i}` }));
  const d = run(list, { interactions });
  assert.equal(d.measuredChars, 4); assert.equal(d.prompts, 5);
  assert.deepEqual(d.chars.map(b => b.prompts), [1, 1, 1, 1]);
  assert.deepEqual(d.chars.map(b => b.averageCalls), [1, 2, 3, 4]);
  assert.equal(run(list).measuredChars, 0, 'without recorded lengths the measure is unavailable');
});

test('project and session filters apply, and a model filter hides the measures', () => {
  const list = [prompt('s', 0, { calls: 1, nano: 1e9, project: 'x' }), prompt('s', MIN, { calls: 1, nano: 1e9, project: 'y' }), prompt('t', 0, { calls: 1, nano: 1e9, project: 'x' })];
  assert.equal(run(list, { query: { project: 'x' } }).prompts, 2);
  assert.equal(run(list, { query: { session: 't' } }).prompts, 1);
  assert.deepEqual(run(list, { query: { models: ['m'] } }), { reason: 'model-filter' });
});

test('delivery bins aggregate work by prompt timing and keep ineligible steering honest', () => {
  const list = [
    prompt('s', 0, { calls: 2, nano: 2e9, tokens: 100, delivery: 'idle' }),
    prompt('s', MIN, { delivery: 'steering' }), // shared billing group: eligible === 0
    prompt('s', 2 * MIN, { calls: 4, nano: 4e9, tokens: 200, delivery: 'queued' }),
    prompt('s', 3 * MIN, { calls: 1, nano: 1e9, tokens: 50, delivery: 'unknown' }),
  ];
  const d = run(list);
  assert.deepEqual(d.delivery.map(b => [b.label, b.prompts, b.eligible]), [
    ['Started while idle', 1, 1],
    ['Steering', 1, 0],
    ['Queued', 1, 1],
    ['Unknown delivery', 1, 1],
  ]);
  assert.equal(d.delivery[0].medianCredits, 2);
  assert.equal(d.delivery[1].medianCredits, null);
  assert.equal(d.delivery[1].averageCredits, null);
  assert.equal(d.delivery[2].medianCalls, 4);
  const html = renderHabitsTopic(d, { number });
  assert.match(html, /How prompt timing relates to work/);
  assert.match(html, /Started while idle/);
  assert.match(html, /Steering/);
  assert.match(html, /0 of 1/);
  assert.match(html, /Unknown delivery/);
  assert.match(html, /not prompt quality/);
  // When there are no unknown-delivery prompts, Unknown delivery row is omitted
  const knownOnly = run(list.slice(0, 3));
  assert.doesNotMatch(renderHabitsTopic(knownOnly, { number }), /Unknown delivery/);
});

test('empty input yields an empty, finite result', () => {
  const d = run([]);
  assert.equal(d.usable, 0); assert.equal(d.credits, null);
  assert.doesNotMatch(JSON.stringify(d), /NaN|Infinity|undefined/);
});

const sample = () => {
  const list = [];
  for (let s = 0; s < 6; s++) for (let i = 0; i < 8; i++) list.push(prompt(`<img src=x>${s}`, i * (i % 2 ? 90 : 2) * MIN, { calls: 1 + (i % 3), nano: (i + 1) * 1e9, tokens: 1000 * (i + 1), project: '<script>p</script>' }));
  return run(list);
};

test('the view shows every table with its coverage and one experiment', () => {
  const html = renderHabitsTopic(sample(), { number });
  for (const text of ['How long conversations run', 'Does a later prompt carry more work', 'Pauses before a prompt', 'Prompt length', 'Compare afterward', 'Cache reuse', '48 of 48', 'position is not a cause'])
    assert.ok(html.includes(text), text);
  assert.match(html, /Share of credits/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|—/);
});

test('missing, model-filtered and sparse data stay honest', () => {
  assert.equal(renderHabitsTopic(undefined, { number }), '');
  assert.equal(renderHabitsTopic({ reason: 'model-filter' }, { number }), '');
  assert.match(renderHabitsTopic(run([]), { number }), /unavailable/);
  const html = renderHabitsTopic(run([prompt('s', 0, { calls: 1, nano: 1e9 }), prompt('s', MIN, {})]), { number });
  assert.match(html, /too few prompts/); assert.match(html, /No prompt in these dates records a length/); assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('the panel renders the habits detail below the conversation views and escapes names', async () => {
  const data = demoData(), report = { ...buildReport(data.records, { range: '30d' }, new Date(), data), sources: [], coverage: {} };
  assert.ok(report.efficiency.habits.usable > 0, 'the report carries the measures');
  report.efficiency.habits = sample();
  const { get } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await get('refresh').onclick();
  const html = get('efficiency-habits-detail').innerHTML;
  assert.match(html, /How long conversations run/);
  assert.doesNotMatch(html, /<script>|<img src=x>/);
  report.efficiency.habits = { reason: 'model-filter' }; report.efficiency.conversations = { reason: 'model-filter' };
  const filtered = await mountPanel(report);
  filtered.get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await filtered.get('refresh').onclick();
  assert.equal(filtered.get('efficiency-habits-detail').innerHTML, '');
  assert.match(filtered.get('efficiency-conversations').innerHTML, /Clear the model filter/);
});
