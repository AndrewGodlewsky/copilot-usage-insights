import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConversations, CONVERSATION_TOPICS } from '../src/panel/conversations.mjs';
import { conversationComparison } from '../src/core/conversation-summary.mjs';

const measured = () => ({ windowed: true, sessions: 10, countedSessions: 8, uncertainSessions: 1, withoutPrompts: 1, prompts: 25,
  medianPrompts: 2.5, averagePrompts: 3.125, multiDaySessions: 3, priorSessions: 2,
  distribution: [{ label: '1 prompt', count: 2 }, { label: '2–5 prompts', count: 4 }, { label: '6–15 prompts', count: 2 }, { label: '16+ prompts', count: 0 }],
  dayDistribution: [{ label: '1 day', count: 5 }, { label: '2–3 days', count: 2 }, { label: '4+ days', count: 1 }],
  workSessions: 5, workPrompts: 12, modelCalls: 36, averageCallsPerPrompt: 3, workMatrix: [[1, 0, 0], [0, 2, 1], [1, 0, 0]],
  promptWork: { prompts: 15, totalPrompts: 25, medianCalls: 3, averageCalls: 4, distribution: [{ label: '1 call', count: 3 }, { label: '2–5 calls', count: 8 }, { label: '6–15 calls', count: 3 }, { label: '16+ calls', count: 1 }] },
  steering: { topMessages: 4, topSessions: 2, sessions: 2 },
  delivery: { idle: 10, steering: 5, queued: 5, unknown: 5, known: 20, prompts: 25, sessions: 9, unconfirmedPrompts: 2, classifiedSessions: 4, steeredSessions: 2, averageSteering: .75, userStops: 3, stopSessions: 2 },
  examples: [{ index: 0, prompts: 3, days: 2, uncertain: false, workBins: [0, 1, 0, 0], delivery: { idle: 1, steering: 1, queued: 0, unknown: 0 },
    events: [{ kind: 'prompt', ms: Date.UTC(2026, 10, 15, 10), delivery: 'steering', calls: null }, { kind: 'stop', ms: Date.UTC(2026, 10, 15, 11) }], eventsOmitted: 2 }], examplesOmitted: 1 });

test('focused habits show one question with real counts, coverage and expandable explanations', () => {
  const html = renderConversations(measured());
  assert.match(html, /How much do you interact/); assert.match(html, /8 of 10 conversations/);
  assert.match(html, /2\.5/); assert.match(html, /50%/); assert.match(html, /data-conversation-bucket="1"/);
  assert.match(html, /selected dates, not lifetime session length/);
  assert.doesNotMatch(html, /When your messages arrive|Days with user messages|Model calls after a user prompt/);
  assert.doesNotMatch(html, /NaN|Infinity|conversation-events/);
  assert.equal(CONVERSATION_TOPICS.length, 4);
});

test('agent work keeps independent prompt and joint-session coverage', () => {
  const html = renderConversations(measured(), { topic: 'work' });
  assert.match(html, /15 of 25 confirmed prompts/); assert.match(html, /5 of 8 counted conversations/);
  assert.match(html, /Human messages/); assert.match(html, /not task duration/);
  assert.match(html, /initial call, continuations/);
  assert.doesNotMatch(html, /How much do you interact/);
});

test('guidance preserves unknown delivery, unconfirmed submissions and independent stops', () => {
  const html = renderConversations(measured(), { topic: 'guidance' });
  assert.match(html, /20 of 25 prompts/); assert.match(html, /2 additional submissions/);
  assert.match(html, /4 of 9 sessions/); assert.match(html, /Recorded user stops/);
  assert.match(html, /Unknown delivery/); assert.match(html, /not failed prompts or wasted tokens/);
  const c = measured(); c.countedSessions = 0;
  assert.match(renderConversations(c, { topic: 'guidance' }), /20 of 25 prompts/);
  c.delivery = { userStops: 1, stopSessions: 1 };
  const partial = renderConversations(c, { topic: 'guidance' });
  assert.match(partial, /No confirmed prompt delivery sample/); assert.match(partial, /Recorded user stops/);
  assert.doesNotMatch(partial, /NaN|Infinity/);
});

test('returning uses local active dates and does not claim continuous work', () => {
  const html = renderConversations(measured(), { topic: 'returning' });
  assert.match(html, /37\.5%/); assert.match(html, /2–3 days/); assert.match(html, /4\+ days/);
  assert.match(html, /2 conversations also have recorded prompts before/);
  assert.match(html, /does not establish continuous work/);
});

test('examples are opt-in metadata, filtered without fetching and never invent missing work', () => {
  const html = renderConversations(measured(), { examplesOpen: true, bucket: 1 });
  assert.match(html, /Conversation 1/); assert.match(html, /You stopped the agent/);
  assert.match(html, /Work is shared, incomplete/); assert.match(html, /2 additional events/);
  assert.match(html, /No prompt text is loaded/); assert.match(html, /not a representative sample/);
  assert.match(renderConversations(measured(), { examplesOpen: true, bucket: 3 }), /None of the bounded examples match/);
});

test('formatter and escaped data work across every focused view and missing measurements', () => {
  const c = measured(); c.distribution[0].label = '<script>bad</script>';
  const html = renderConversations(c, { number: n => `formatted(${n})` });
  assert.match(html, /formatted\(2\.5\)/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  for (const topic of CONVERSATION_TOPICS) {
    const empty = renderConversations({}, { topic });
    assert.doesNotMatch(empty, /NaN|Infinity|undefined/);
    assert.match(empty, /Unavailable/);
    assert.match(renderConversations({ reason: 'model-filter' }, { topic }), /Clear the model filter/);
  }
});

test('period comparisons withhold weak samples, coverage shifts, all-time and loading history', () => {
  const c = measured(); c.comparison = { startDate: '2026-10-25', endDate: '2026-10-31', previous: measured() };
  c.comparison.previous.medianPrompts = 2;
  assert.deepEqual(conversationComparison(c, 'interaction'), { current: 2.5, previous: 2, unit: 'prompts / conversation', samples: 8, total: 10, previousSamples: 8, previousTotal: 10, startDate: '2026-10-25', endDate: '2026-10-31' });
  assert.match(renderConversations(c), /2 → 2\.5/);
  assert.match(renderConversations(c, { loading: true }), /History is still loading/);
  assert.doesNotMatch(renderConversations(c, { loading: true }), /2 → 2\.5/);
  c.comparison.previous.countedSessions = 7;
  assert.equal(conversationComparison(c, 'interaction').reason, undefined, 'exactly ten percentage points remains eligible');
  c.comparison.previous.sessions = 20;
  assert.match(conversationComparison(c, 'interaction').reason, /coverage differs/);
  c.comparison.previous.countedSessions = 2;
  assert.match(conversationComparison(c, 'interaction').reason, /Not enough/);
  assert.match(conversationComparison(measured(), 'work').reason, /bounded date range/);
});
