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
