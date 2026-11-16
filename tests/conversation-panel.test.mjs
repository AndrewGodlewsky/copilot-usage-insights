import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConversations } from '../src/panel/conversations.mjs';

const measured = () => ({ windowed: true, sessions: 10, countedSessions: 8, uncertainSessions: 1, withoutPrompts: 1, prompts: 25,
  medianPrompts: 2.5, averagePrompts: 3.125, multiDaySessions: 3, priorSessions: 2,
  distribution: [{ label: '1 prompt', count: 2 }, { label: '2–5 prompts', count: 4 }, { label: '6–15 prompts', count: 2 }, { label: '16+ prompts', count: 0 }],
  workSessions: 5, workPrompts: 12, modelCalls: 36, averageCallsPerPrompt: 3, workMatrix: [[1, 0, 0], [0, 2, 1], [1, 0, 0]] });

test('conversation graphics expose counts, percentages, axes and both coverage denominators without color alone', () => {
  const html = renderConversations(measured());
  assert.match(html, /User prompts per session/); assert.match(html, /50%/); assert.match(html, /width:0%/);
  assert.match(html, /8 of 10 sessions/); assert.match(html, /5 of 8 counted sessions/);
  assert.match(html, /<caption>.*Model calls per prompt/); assert.match(html, /scope="row"/); assert.match(html, /scope="col"/);
  assert.match(html, /Median prompts/); assert.match(html, /2\.5/);
  assert.match(html, /Earlier recorded activity/); assert.match(html, /not task duration/);
  assert.doesNotMatch(html, /NaN|Infinity|<button|data-tip/);
});

test('conversation graphics use configured formatting, escape labels, and explain missing measurements', () => {
  const c = measured(); c.distribution[0].label = '<script>'; c.windowed = false;
  const html = renderConversations(c, { number: n => `formatted(${n})` });
  assert.match(html, /formatted\(25\)/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /Earlier recorded activity|<script>/);
  assert.match(renderConversations({ sessions: 3, countedSessions: 0, uncertainSessions: 1, withoutPrompts: 2 }), /No sessions with reliable user-prompt counts/);
  assert.doesNotMatch(renderConversations({ countedSessions: 0 }), /<table|NaN|Infinity/);
  assert.match(renderConversations({ reason: 'model-filter' }), /Clear the model filter/);
  c.workSessions = 0;
  assert.match(renderConversations(c), /Complete prompt accounting is not available/);
});

test('delivery graphics show unknowns, independent stops and the restricted session denominator', () => {
  const c = measured();
  c.delivery = { idle: 10, steering: 5, queued: 5, unknown: 5, known: 20, prompts: 25, sessions: 9, unconfirmedPrompts: 2, classifiedSessions: 4, steeredSessions: 2, averageSteering: .75, userStops: 3, stopSessions: 2 };
  const html = renderConversations(c);
  assert.match(html, /How you guide the agent/);
  assert.match(html, /Prompt delivery distribution/);
  assert.match(html, /Started while idle/); assert.match(html, /Steering/); assert.match(html, /Queued/); assert.match(html, /Unknown/);
  assert.match(html, /20 of 25 prompts/); assert.match(html, /4 of 9 sessions/);
  assert.match(html, /2 additional submissions/);
  assert.match(html, /User stops/); assert.match(html, /3/); assert.match(html, /not.*wasted/i);
  assert.doesNotMatch(html, /NaN|Infinity/);
  c.delivery.classifiedSessions = 0; c.delivery.averageSteering = null;
  assert.match(renderConversations(c), /Unavailable/);
  assert.doesNotMatch(renderConversations(c), /NaN|Infinity/);
  assert.match(renderConversations(c, { number: n => `formatted(${n})` }), /formatted\(20\)/);
});

test('stops remain visible without a usable conversation-depth sample', () => {
  const c = { sessions: 1, countedSessions: 0, prompts: 0, delivery: { userStops: 1, stopSessions: 1, known: 0, classifiedSessions: 0 } };
  const html = renderConversations(c);
  assert.match(html, /User stops/); assert.match(html, /No confirmed prompt delivery sample/);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('delivery has independent prompt and session denominators even without a depth sample', () => {
  const c = { sessions: 2, countedSessions: 0, uncertainSessions: 2, prompts: 0,
    delivery: { prompts: 4, sessions: 2, idle: 1, steering: 1, queued: 1, unknown: 1, known: 3,
      classifiedSessions: 1, steeredSessions: 1, averageSteering: 1, userStops: 0, stopSessions: 0 } };
  const html = renderConversations(c);
  assert.match(html, /3 of 4 prompts/); assert.match(html, /1 of 2 sessions/);
  assert.match(html, /width:25%/); assert.match(html, /separate.*depth/i);
  assert.doesNotMatch(html, /No confirmed prompt delivery|NaN|Infinity/);
});
