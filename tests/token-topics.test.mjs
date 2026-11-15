import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_TOPICS, PATTERN_TOPICS, renderTokenTopic, tokenTopicIcon } from '../src/panel/token-topics.mjs';
import { createEfficiencyAccumulator } from '../src/core/efficiency.mjs';

const formats = { number: value => value == null ? 'Unavailable' : String(value), credits: value => value == null ? 'Unavailable' : String(value) };
const render = (id, report = {}) => renderTokenTopic(id, report, formats);

test('efficiency catalogs separate consumption from workflow findings without duplicating topics', () => {
  assert.deepEqual(TOKEN_TOPICS.map(t => t.id), ['overview', 'context', 'tools', 'results', 'cache', 'skills', 'prompts', 'delegation', 'output', 'drivers']);
  assert.deepEqual(TOKEN_TOPICS.map(t => t.group), ['', 'Context', 'Context', 'Context', 'Context', 'Context', 'Agent work', 'Agent work', 'Agent work', 'Spending']);
  assert.ok(TOKEN_TOPICS.every(t => t.label && t.iconPath));
  assert.deepEqual(PATTERN_TOPICS.map(t => t.id), ['findings', 'habits', 'growth', 'compaction', 'recovery', 'transitions', 'repetition', 'models']);
  const all = [...TOKEN_TOPICS, ...PATTERN_TOPICS];
  assert.equal(new Set(all.map(t => t.id)).size, all.length);
  assert.ok(all.every(t => t.question));
});

test('each topic has a distinct decorative icon shared by its stop and framed lens', () => {
  assert.equal(new Set(TOKEN_TOPICS.map(t => t.iconPath)).size, 10);
  for (const topic of TOKEN_TOPICS) {
    const icon = tokenTopicIcon(topic), lens = tokenTopicIcon(topic, true);
    assert.ok(icon.includes(`<path d="${topic.iconPath}"/>`));
    assert.ok(lens.includes(`<path d="${topic.iconPath}"/>`));
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.match(lens, /viewBox="0 0 36 36"/);
    assert.match(lens, /stroke="#123953"/);
    assert.match(icon, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(icon + lens, /undefined|NaN|<text/);
  }
});

test('topic introductions handle absent measurements without invented zeros', () => {
  for (const id of ['growth', 'tools', 'prompts', 'delegation', 'output', 'drivers']) {
    const html = render(id);
    assert.doesNotMatch(html, /NaN|undefined|Infinity/);
    assert.match(html, /Unavailable|No .*recorded|No comparable/);
  }
  for (const id of ['compaction', 'transitions', 'repetition']) assert.match(render(id), /Not measured yet/);
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
  const html = render('prompts', { promptCredits: { prompts: 3, eligiblePrompts: 2, credits: 0, averageCredits: 0, modelFiltered: true, work: { averageRequests: 2, maxRequests: 3, tokenPrompts: 2, averageTokens: 100, requests: 4 } } });
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

test('all ten token sections render measured insights and keep context kinds distinct', () => {
  const accumulator = createEfficiencyAccumulator();
  accumulator.add({ project: 'P', sessionId: 's', model: '<Model>', initiator: 'sub-agent', ms: 1,
    inputTotal: 1000, output: 100, reasoning: 40, cacheRead: 600, cacheWrite: 100,
    toolTokenCount: 200, availableToolCount: 3, nanoAiu: 0, creditStatus: 'complete' });
  const report = { efficiency: accumulator.finish(),
    promptCredits: { prompts: 1, eligiblePrompts: 1, credits: 0, averageCredits: 0, work: { requests: 1, averageRequests: 1, maxRequests: 1, tokenPrompts: 1, averageTokens: 1100 } },
    skills: { invocations: 2, failures: 1, rows: [{ name: '<Skill>', plugin: '<Plugin>', invocations: 2, failures: 1 }] },
    tools: { calls: 3, rows: [{ name: '<Tool>', server: '<Server>', mcpTool: 'search', calls: 3, failures: 1, unknown: 1 }] },
    sessions: [{ name: '<Session>', project: '<Project>', requests: 1, credits: 0 }] };
  const context = { available: true, totalTokens: 1000, checkedAt: '2026-11-14T12:00:00Z', modelId: '<Model>',
    categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 750 },
    entries: [{ id: 'parent', kind: 'plugin', label: 'PARENT', tokens: 500 },
      { id: 'skill', parentId: 'parent', kind: 'skill', label: 'ACTUAL_SKILL', tokens: 50 },
      { id: 'other', kind: 'newKind', label: 'skill tool MCP', tokens: 99 },
      { id: 'tool', kind: 'tool', label: 'ACTUAL_RESULT', tokens: 300 },
      { id: 'mcp', kind: 'mcpServer', label: 'ACTUAL_MCP', tokens: 80 },
      { id: 'definition', kind: 'toolDefinition', label: 'ACTUAL_DEFINITION', tokens: 20 }], omitted: 3 };
  for (const topic of TOKEN_TOPICS) {
    const html = renderTokenTopic(topic.id, report, { ...formats, context });
    assert.match(html, /Compare afterward:/, topic.id);
    assert.doesNotMatch(html, /undefined|NaN|Infinity|Not measured yet|<Model>|<Skill>|<Plugin>|<Server>|<Session>|<Project>/, topic.id);
  }
  const contextView = renderTokenTopic('context', report, { ...formats, context });
  assert.match(contextView, />250<\/strong>/);
  assert.match(contextView, />25%<\/strong>/);
  const skillView = renderTokenTopic('skills', report, { ...formats, context });
  assert.match(skillView, /ACTUAL_SKILL/);
  assert.match(skillView, /&lt;Plugin&gt;/);
  assert.match(skillView, /ignores the model filter/);
  assert.match(skillView, /3 entries were omitted/);
  assert.doesNotMatch(skillView, /PARENT|skill tool MCP|ACTUAL_RESULT|ACTUAL_MCP/);
  const resultView = renderTokenTopic('results', report, { ...formats, context });
  assert.match(resultView, /ACTUAL_RESULT/);
  assert.doesNotMatch(resultView, /ACTUAL_SKILL|ACTUAL_DEFINITION/);
  const toolView = renderTokenTopic('tools', report, { ...formats, context });
  assert.match(toolView, /ACTUAL_MCP/);
  assert.match(toolView, /ACTUAL_DEFINITION/);
  assert.doesNotMatch(toolView, /ACTUAL_RESULT|ACTUAL_SKILL/);
  assert.match(render('cache', report), />300<\/strong>/);
  assert.match(render('output', report), />40%<\/strong>/);
  assert.match(render('output', report), />60<\/strong>/);
  assert.match(render('delegation', report), /Subagent/);
  assert.match(render('delegation', report), /0 \(1 of 1 model calls\)/, 'recorded zero credits are available');
});

test('empty and zero measurements never produce a false ratio or inferred context category', () => {
  for (const topic of TOKEN_TOPICS) {
    const html = render(topic.id);
    assert.ok(html.length);
    assert.doesNotMatch(html, /NaN|Infinity|undefined|Not measured yet/);
  }
  const html = renderTokenTopic('context', {}, { ...formats, context: { available: true, totalTokens: 100, categories: { systemPrompt: 80, customInstructions: 80, systemTools: 0, mcpTools: 0 } } });
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, />160|160%/);
  const zero = render('output', { efficiency: { summary: { requests: 1, outputRequests: 1, outputTokens: 0, reasoningRequests: 1, reasoningTokens: 0, otherOutput: 0, reasoningShare: null } } });
  assert.match(zero, />0<\/strong>/);
  assert.match(zero, /Unavailable/);
  assert.doesNotMatch(zero, /role="img"/);
});

test('delegated model averages retain independent measurement coverage', () => {
  const accumulator = createEfficiencyAccumulator();
  for (let i = 0; i < 100; i++) accumulator.add({ model: 'Sparse model', initiator: 'sub-agent', inputTotal: i === 0 ? 1000 : null, output: 20 });
  const html = render('delegation', { efficiency: accumulator.finish() });
  assert.match(html, /1000 \(1 of 100 model calls\)/);
  assert.match(html, /20 \(100 of 100 model calls\)/);
});
