import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_TOPICS, PATTERN_TOPICS, renderTokenTopic } from '../src/panel/token-topics.mjs';

const formats = { number: value => value == null ? 'Unavailable' : String(value), credits: value => value == null ? 'Unavailable' : String(value) };
const render = (id, report = {}) => renderTokenTopic(id, report, formats);

test('efficiency catalogs separate consumption from workflow findings without duplicating topics', () => {
  assert.deepEqual(TOKEN_TOPICS.map(t => t.id), ['overview', 'context', 'tools', 'results', 'cache', 'prompts', 'delegation', 'output', 'drivers', 'skills']);
  assert.deepEqual(PATTERN_TOPICS.map(t => t.id), ['findings', 'habits', 'growth', 'compaction', 'recovery', 'transitions', 'repetition', 'models']);
  const all = [...TOKEN_TOPICS, ...PATTERN_TOPICS];
  assert.equal(new Set(all.map(t => t.id)).size, all.length);
  assert.ok(all.every(t => t.question));
});

test('topic introductions handle absent measurements without invented zeros', () => {
  for (const id of ['growth', 'tools', 'prompts', 'output', 'drivers']) {
    const html = render(id);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/);
    assert.match(html, /Unavailable|No .*recorded|No comparable/);
  }
  for (const id of ['delegation', 'compaction', 'transitions', 'repetition']) assert.match(render(id), /Not measured yet/);
});

test('topic measurements retain coverage and keep reasoning inside output', () => {
  const efficiency = { summary: { requests: 4, outputRequests: 4, outputTokens: 120, reasoningRequests: 2, reasoningTokens: 30, toolRequests: 2, averageToolTokens: 1500, toolShare: 20 } };
  assert.match(render('output', { efficiency }), /120/);
  assert.match(render('output', { efficiency }), /30/);
  assert.match(render('output', { efficiency }), /2 of 4/);
  assert.match(render('output', { efficiency }), /part of output/);
  assert.doesNotMatch(render('output', { efficiency }), /150|90|25%/);
  assert.match(render('tools', { efficiency }), /1500/);
  assert.match(render('tools', { efficiency }), /2 of 4/);
});

test('prompt topic preserves zero credits and labels model-filtered contributions', () => {
  const html = render('prompts', { promptCredits: { prompts: 3, eligiblePrompts: 2, credits: 0, averageCredits: 0, modelFiltered: true } });
  assert.match(html, /Selected-model contribution/);
  assert.match(html, /2 of 3/);
  assert.match(html, />0<\/strong>/);
  assert.match(html, /initial calls, agent continuations/);
  assert.doesNotMatch(html, /Unavailable/);
});

test('growth and spend topics escape labels, bound lists, and preserve incomplete charges', () => {
  const growth = render('growth', { efficiency: { insights: [{ kind: 'growth', sessionName: '<Session>', model: '<Model>', early: 100, late: 300, samples: 6, requests: 8 }] } });
  assert.match(growth, /&lt;Session&gt;/);
  assert.doesNotMatch(growth, /<Session>|<Model>/);
  const sessions = Array.from({ length: 8 }, (_, i) => ({ name: '<Session '+i+'>', project: '<Project>', credits: 8 - i, missingCredits: i === 0 ? 1 : 0 }));
  const spend = render('drivers', { sessions });
  assert.equal((spend.match(/<tr>/g) || []).length, 6);
  assert.match(spend, /8 \*/);
  assert.match(spend, /&lt;Project&gt;/);
  assert.match(spend, /incomplete/);
  assert.doesNotMatch(spend, /<Project>|Session 7/);
});

test('current-context topic entry points never claim historical attribution', () => {
  for (const id of ['results', 'skills']) {
    assert.match(render(id), /data-token-context/);
    assert.match(render(id), /current context/i);
    assert.match(render(id), /historical|history/i);
  }
});
