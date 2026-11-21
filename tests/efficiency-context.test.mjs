import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTokenInsight } from '../src/panel/token-insights.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { formatNumber, formatCredits } from '../src/core/format.mjs';
import { demoData, demoContext } from '../scripts/demo-data.mjs';
import { mountPanel } from './fixtures/panel.mjs';

const formats = { number: value => value == null ? 'Unavailable' : String(value), credits: value => value == null ? 'Unavailable' : String(value) };
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (context, report = {}, extra = {}) => renderTokenInsight('context', report, { ...formats, context, ...extra });
// 950 of 1,000 tokens are attributed, against an allowance of 4,000.
const snapshot = (extra = {}) => ({ available: true, checkedAt: '2026-11-14T12:00:00Z', totalTokens: 1000, limit: 4000, modelId: 'model', modelSource: 'selected',
  categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 700 }, entries: [], omitted: 0, ...extra });
const history = { efficiency: { summary: { requests: 10, toolRequests: 8, averageToolTokens: 1200 } }, promptCredits: { prompts: 5, eligiblePrompts: 4, work: { averageRequests: 3 } } };

test('room left is a gauge of used against the allowance, and stays unknown without one', () => {
  const html = render(snapshot()), shown = text(html);
  assert.match(html, /role="img" aria-label="25% of the allowance used, 75% left"><span style="width:25\.0%/);
  assert.match(shown, /Used 1000 · 25% Left 3000 · 75%/);
  assert.match(shown, /allowance of 4000 tokens that Copilot reported/);
  assert.doesNotMatch(shown, /compact(s|ed|ion) (at|when|after)|will be compacted/i);

  const unknown = text(render(snapshot({ limit: null })));
  assert.match(unknown, /did not report an allowance for this conversation, so the room left is unavailable/);
  assert.doesNotMatch(unknown, /Used 1000|Left /);
  assert.match(text(render(snapshot({ limit: 0 }))), /room left is unavailable/);

  const over = text(render(snapshot({ limit: 800 })));
  assert.match(over, /estimate of 1000 tokens is above the reported allowance of 800, so no room left is shown/);
  assert.doesNotMatch(over, /-200|Left /);

  const full = render(snapshot({ limit: 1000 }));
  assert.match(full, /width:100\.0%/);
  assert.match(text(full), /Left 0 · 0%/, 'a measured zero is shown as zero');
});

test('the five categories are one stacked bar with shares, and a remainder is not attributed', () => {
  const html = render(snapshot()), shown = text(html);
  const bar = html.match(/<div class="context-mix">.*?<\/div><\/div><\/div>/)[0];
  assert.equal((bar.match(/<span style="width:/g) || []).length, 6);
  assert.match(bar, /aria-label="System instructions: 10%; Custom instructions: 5%; Built-in tool definitions: 8%; MCP tool definitions: 2%; Conversation and tool results: 70%; Not attributed: 5%"/);
  for (const row of ['System instructions 100 · 10%', 'Custom instructions 50 · 5%', 'Built-in tool definitions 80 · 8%', 'MCP tool definitions 20 · 2%', 'Conversation and tool results 700 · 70%', 'Not attributed 50 · 5%']) assert.ok(shown.includes(row), row);
  assert.match(shown, /Copilot attributed 950 of 1000 tokens to these categories/);

  const exact = render(snapshot({ categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 750 } }));
  assert.equal((exact.match(/<div class="context-mix">.*?<\/div><\/div><\/div>/)[0].match(/<span style="width:/g) || []).length, 5);
  assert.doesNotMatch(exact, /Not attributed/);

  const zero = text(render(snapshot({ categories: { systemPrompt: 300, customInstructions: 0, systemTools: 0, mcpTools: 0, messages: 700 } })));
  assert.match(zero, /Custom instructions 0 · 0%/, 'a category measured as zero stays in the legend');
});

test('a missing or impossible category draws no bar and is named as unavailable', () => {
  const html = render(snapshot({ categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: null, messages: 700 } })), shown = text(html);
  assert.doesNotMatch(html, /context-mix/);
  assert.match(html, /<dt>MCP tool definitions<\/dt><dd>Unavailable<\/dd>/);
  assert.match(html, /<dt>Conversation and tool results<\/dt><dd>700<\/dd>/);
  assert.match(shown, /No bar is drawn because one category is unavailable: MCP tool definitions\. Unavailable is not zero/);
  // Setup needs all four of its categories; conversation is still measured.
  assert.match(html, /Instructions \+ definitions<\/span><strong class="value">Unavailable<\/strong>/);
  assert.match(html, /Setup share of context<\/span><strong class="value">Unavailable<\/strong>/);
  assert.match(html, /Conversation share of context<\/span><strong class="value">70%<\/strong>/);
  assert.match(html, /Tool definitions, this conversation<\/span><strong class="value">Unavailable<\/strong>/);
  assert.doesNotMatch(shown, /MCP tool definitions 0\b/);

  const several = text(render(snapshot({ categories: { customInstructions: 500 } })));
  assert.match(several, /some categories are unavailable: System instructions, Built-in tool definitions, MCP tool definitions, Conversation and tool results/);
  assert.match(several, /Custom instructions 500/);
  assert.match(several, /Some context categories are unavailable\./);

  // A category larger than the whole snapshot is not evidence of anything.
  const impossible = render(snapshot({ categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 5000 } }));
  assert.doesNotMatch(impossible, /context-mix|5000|500%/);
  assert.match(text(impossible), /one category is unavailable: Conversation and tool results/);

  const overlapping = render(snapshot({ categories: { systemPrompt: 600, customInstructions: 600, systemTools: 0, mcpTools: 0, messages: 0 } }));
  assert.doesNotMatch(overlapping, /context-mix|1200|120%/);
  assert.match(text(overlapping), /these categories add up to more than the snapshot total/);

  const nothing = render(snapshot({ totalTokens: 0, categories: { systemPrompt: 0, customInstructions: 0, systemTools: 0, mcpTools: 0, messages: 0 } }));
  assert.match(text(nothing), /This snapshot holds no tokens\./);
  assert.match(text(nothing), /The parts you can change hold no tokens in this snapshot\./);
  assert.doesNotMatch(nothing, /NaN|Infinity|undefined/);
});

test('setup is shown beside conversation as tokens and share', () => {
  const html = render(snapshot());
  assert.match(html, /Instructions \+ definitions<\/span><strong class="value">250<\/strong>/);
  assert.match(html, /Setup share of context<\/span><strong class="value">25%<\/strong>/);
  assert.match(html, /Conversation and tool results<\/span><strong class="value">700<\/strong>/);
  assert.match(html, /Conversation share of context<\/span><strong class="value">70%<\/strong>/);
});

test('sources are grouped by kind in plain words, bounded, and never added together', () => {
  const entries = [
    { kind: 'plugin', id: 'plugin:kit', label: 'kit', tokens: 300 },
    { kind: 'skill', id: 'skill:a', label: 'skill-a', tokens: 120, parentId: 'plugin:kit' },
    { kind: 'skill', id: 'skill:b', label: 'skill-b', tokens: 90, parentId: 'plugin:gone' },
    { kind: 'skill', id: 'skill:c', label: 'skill-c', tokens: 60 },
    { kind: 'skill', id: 'skill:d', label: 'skill-d', tokens: 30 },
    { kind: 'mcpServer', id: 'mcp:one', label: 'server-one', tokens: 200 },
    { kind: 'toolDefinition', id: 'def:edit', label: 'edit-definition', tokens: 40 },
    { kind: 'tool', id: 'tool:view', label: 'view-result', tokens: 400 },
    { kind: 'subagent', id: 'agent:x', label: 'helper', tokens: 25 },
    { kind: 'system', id: 'system:x', label: 'system-source', tokens: 20 },
    { kind: 'constructor', id: 'odd:x', label: 'odd-kind', tokens: 10 },
    { kind: 'skill', id: 'skill:zero', label: 'skill-zero', tokens: 0 },
    { kind: 'tool', id: 'tool:huge', label: 'bigger-than-context', tokens: 1600 },
  ];
  const html = render(snapshot({ entries, omitted: 7 })), shown = text(html);
  const groups = [...html.matchAll(/<div class="context-source-group"><h4>([^<]+)<\/h4>/g)].map(match => match[1]);
  assert.deepEqual(groups, ['Tool results', 'Plugins', 'MCP servers', 'Skills', 'Tool definitions', 'Subagents', 'Other sources'], 'ordered by each group\'s largest source');
  const skills = html.split('<h4>Skills</h4>')[1].split('<div class="context-source-group">')[0];
  assert.equal((skills.match(/class="token-bar-row"/g) || []).length, 3);
  assert.match(skills, /Largest 3 of 4\./);
  assert.match(skills, /skill-a<\/span>.*?width:7\.5%.*?>120<\/span><span class="token-bar-detail">12% of context · included in kit</);
  assert.match(skills, /skill-b.*?9% of context · included in another source/);
  assert.doesNotMatch(skills, /skill-d|skill-zero/);
  const other = html.split('<h4>Other sources</h4>')[1].split('</section>')[0];
  assert.match(other, /system-source/);
  assert.match(other, /odd-kind/);
  // A source larger than the snapshot keeps its tokens but gets no share.
  assert.match(html, /bigger-than-context<\/span>.*?width:100\.0%.*?>1600<\/span><\/div>/);
  assert.match(shown, /From 12 attributed sources in this snapshot; 7 more were omitted\. Bars are scaled to the largest source\. Parent and child sources can overlap, so do not add rows or groups together\./);
  assert.doesNotMatch(shown, /\b(420|300 of|2895|2,895)\b/, 'no group or grand total is shown');

  const none = text(render(snapshot()));
  assert.match(none, /Copilot returned no individual sources in this snapshot\. This does not establish that none were loaded\./);
  assert.doesNotMatch(render(snapshot({ entries: undefined })), /undefined|NaN/);
});

test('source names, kinds and parents are escaped', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = render(snapshot({ modelId: bad, entries: [
    { kind: 'plugin', id: bad, label: bad, tokens: 300 },
    { kind: 'skill', id: 'skill', label: `${bad} skill`, tokens: 100, parentId: bad },
    { kind: bad, id: 'odd', label: '', tokens: 50 },
    { kind: 'tool', id: `${bad} id`, label: '', tokens: 40 }] }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; skill/);
  assert.match(html, /included in &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; id/, 'an unnamed source falls back to its id');
});

test('the snapshot is related to the selected history as two labelled scopes', () => {
  const html = render(snapshot(), history), shown = text(html);
  assert.match(html, /Tool definitions, this conversation<\/span><strong class="value">100<\/strong><span class="sub">Built-in plus MCP definitions in this snapshot</);
  assert.match(html, /Tool definitions per call, selected history<\/span><strong class="value">1200 \*<\/strong><span class="sub">Average over 8 of 10 model calls</);
  assert.match(shown, /These are two different scopes\./);
  assert.match(shown, /A gap between them is expected and is not a finding on its own\./);
  assert.match(render(snapshot(), history, { showCoverage: false }), /selected history<\/span><strong class="value">1200<\/strong>/);

  const complete = render(snapshot(), { ...history, efficiency: { summary: { requests: 10, toolRequests: 10, averageToolTokens: 1200 } } });
  assert.match(complete, /selected history<\/span><strong class="value">1200<\/strong><span class="sub">Average over 10 of 10 model calls</);

  const unmeasured = render(snapshot(), { efficiency: { summary: { requests: 10, toolRequests: 0, averageToolTokens: null } } });
  assert.match(unmeasured, /selected history<\/span><strong class="value">Unavailable<\/strong><span class="sub">Average over 0 of 10 model calls</);
  assert.match(render(snapshot()), /selected history<\/span><strong class="value">Unavailable<\/strong>/);
});

test('the per-prompt figure is labelled an illustration and needs both of its inputs', () => {
  const shown = text(render(snapshot(), history));
  assert.match(shown, /Illustration, not a measurement About 750 input tokens of setup behind one prompt/);
  assert.match(shown, /If this setup of 250 tokens were sent with every model call, one prompt would carry it 3 times\. That is the recorded average of model calls per prompt, measured on 4 of 5 prompts\. A warm cache would normally serve most of it as cache reads\./);
  assert.match(shown, /One snapshot multiplied by a history average\. Treat it as a sense of scale only\./);
  assert.match(shown, /This snapshot does not prove these sources are present on every request\./);

  const filtered = text(render(snapshot(), { ...history, promptCredits: { ...history.promptCredits, modelFiltered: true } }));
  assert.match(filtered, /model calls per prompt on the selected models, measured on 4 of 5 prompts/);
  const rounded = text(render(snapshot(), { promptCredits: { prompts: 3, eligiblePrompts: 3, work: { averageRequests: 2.5 } } }));
  assert.match(rounded, /About 625 input tokens of setup behind one prompt/);

  for (const report of [{}, { promptCredits: { prompts: 5, eligiblePrompts: 0, work: { averageRequests: null } } }]) {
    const missing = text(render(snapshot(), report));
    assert.match(missing, /Illustration, not a measurement Unavailable\. It needs every setup category in the snapshot and the recorded model calls per prompt/);
    assert.doesNotMatch(missing, /About \d|carry it/);
  }
  const partial = text(render(snapshot({ categories: { systemPrompt: null, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 700 } }), history));
  assert.match(partial, /Illustration, not a measurement Unavailable\./);
  assert.doesNotMatch(partial, /About 450/, 'a missing category is not counted as zero');
});

test('the observation names the largest category the user can change and keeps one experiment', () => {
  const insight = categories => render(snapshot({ categories })).match(/<aside class="token-insight">.*<\/aside>/)[0];
  const conversation = insight(snapshot().categories);
  assert.match(conversation, /<strong>Conversation and tool results are the largest part you can change: 700 tokens, 70% of this context\.<\/strong>/);
  assert.match(conversation, /start a new conversation and inspect it after its first request/);
  assert.match(conversation, /A long conversation can need its history\./);

  // System instructions and built-in tools are larger here, but are not the user's to change.
  const mcp = insight({ systemPrompt: 400, customInstructions: 50, systemTools: 300, mcpTools: 150, messages: 100 });
  assert.match(mcp, /<strong>MCP tool definitions are the largest part you can change: 150 tokens, 15% of this context\.<\/strong>/);
  assert.match(mcp, /Disconnect one MCP server that this task does not need, then inspect again\./);

  const instructions = insight({ systemPrompt: 100, customInstructions: 500, systemTools: 80, mcpTools: 20, messages: 300 });
  assert.match(instructions, /<strong>Custom instructions are the largest part you can change: 500 tokens, 50% of this context\.<\/strong>/);
  assert.match(instructions, /Move one task-specific part of your custom instructions into a file/);

  // A category that was not reported could be the largest, so nothing is named.
  const unknown = insight({ systemPrompt: 100, customInstructions: 500, systemTools: 80, mcpTools: 20, messages: null });
  assert.match(unknown, /<strong>Some context categories are unavailable\.<\/strong>/);
  assert.doesNotMatch(unknown, /largest part/);
  // The categories set by Copilot do not have to be known to name the user's largest.
  assert.match(insight({ systemPrompt: null, customInstructions: 50, systemTools: null, mcpTools: 20, messages: 700 }), /Conversation and tool results are the largest part/);

  for (const html of [conversation, mcp, instructions, unknown]) {
    assert.equal((html.match(/Compare afterward:/g) || []).length, 1);
    assert.match(html, /This snapshot does not prove these sources are present on every request\./);
  }
});

test('the two halves of the view are separable and only the history half reads the report', () => {
  const context = snapshot({ entries: [{ kind: 'skill', id: 's', label: 'skill-a', tokens: 100 }] });
  const fixed = render(context, history, { contextPart: 'snapshot' }), related = render(context, history, { contextPart: 'history' });
  assert.equal(fixed + related, render(context, history));
  assert.equal(fixed, render(context, {}, { contextPart: 'snapshot' }));
  assert.notEqual(related, render(context, {}, { contextPart: 'history' }));
  assert.match(fixed, /Room left/);
  assert.match(fixed, /Sources you can change/);
  assert.doesNotMatch(fixed, /selected history|token-insight"/);
  assert.match(related, /Beside your selected history/);
  assert.match(related, /Compare afterward:/);
});

test('an unmeasured snapshot shows no figures, and no variant prints a broken number', () => {
  for (const context of [undefined, null, { available: false, reason: 'timeout' }, { available: false, reason: 'empty' }]) {
    const html = render(context, history);
    assert.match(html, /Current context has not been measured here/);
    assert.doesNotMatch(html, /Room left|Illustration|selected history/);
  }
  const variants = [snapshot(), snapshot({ limit: null }), snapshot({ limit: 800 }), snapshot({ categories: {} }), snapshot({ totalTokens: 0, limit: 0, categories: {} }),
    snapshot({ entries: [{ kind: 'tool', id: 'a', label: 'a', tokens: 0 }] }), { available: true, totalTokens: 100, categories: { systemPrompt: 80, customInstructions: 80, systemTools: 0, mcpTools: 0 } }];
  for (const context of variants) for (const report of [{}, history, { efficiency: {}, promptCredits: {} }]) {
    for (const number of [formats.number, formatNumber]) assert.doesNotMatch(render(context, report, { number }), /NaN|undefined|Infinity|null/);
  }
});

test('the demo snapshot reads as plausible, complete evidence', () => {
  const now = new Date(2026, 10, 20, 12), data = demoData(now), report = buildReport(data.records, { range: '30d' }, now, data);
  const html = renderTokenInsight('context', report, { number: formatNumber, credits: formatCredits, context: demoContext(now) }), shown = text(html);
  assert.match(shown, /Used 61\.8K · 30\.9% Left 138\.2K · 69\.1%/);
  assert.match(shown, /Conversation and tool results 37\.3K · 60\.4%/);
  assert.doesNotMatch(shown, /Not attributed/);
  assert.match(html, /Instructions \+ definitions<\/span><strong class="value">24\.5K<\/strong>/);
  assert.match(html, /Tool definitions, this conversation<\/span><strong class="value">17\.2K<\/strong>/);
  assert.match(shown, /code-review 2\.1K 3\.4% of context · included in engineering/);
  assert.match(shown, /Illustration, not a measurement About [\d.]+K input tokens of setup behind one prompt/);
  assert.match(shown, /Conversation and tool results are the largest part you can change: 37\.3K tokens, 60\.4% of this context\./);
  assert.doesNotMatch(html, /NaN|undefined|Infinity|—/);
});

const jumpTokenTopic = (get, id) => get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: id } }) } });

test('the panel keeps its unavailable states and draws nothing until context is inspected', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests, server } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(requests.some(r => r.method === 'efficiency.context'), false);
  assert.equal(get('efficiency-context-history').innerHTML, '');
  const states = [[undefined, 'Context attribution is not available in this host session. Try /context in Copilot to inspect it there.'],
    [{ available: false, reason: 'empty' }, 'This conversation has no context snapshot yet. Make a request in Copilot, then inspect again.'],
    [{ available: false, reason: 'timeout' }, 'Copilot did not return a context snapshot in time. Try again later, or use /context in Copilot.']];
  for (const [state, message] of states) {
    server.contextSnapshot = state;
    await get('efficiency-context-read').onclick();
    assert.equal(get('efficiency-context-result').innerHTML, `<p class="footnote integration-note">${message} Historical sections are still available.</p>`);
    assert.equal(get('efficiency-context-history').innerHTML, '');
    assert.equal(get('efficiency-context-read').textContent, 'Inspect again');
    assert.equal(get('efficiency-context-read').disabled, false);
  }
  server.contextSnapshot = snapshot();
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-history').innerHTML, /Beside your selected history/);
  // A failed read leaves no figures from the earlier snapshot behind.
  server.transportError = true;
  await get('efficiency-context-read').onclick();
  server.transportError = false;
  assert.equal(get('efficiency-context-result').innerHTML, '<p class="footnote integration-note">Context inspection is unavailable. Try again, or use /context in Copilot. Historical sections are still available.</p>');
  assert.equal(get('efficiency-context-history').innerHTML, '');
  await get('refresh').onclick();
  assert.equal(get('efficiency-context-history').innerHTML, '');
});

test('the panel draws the snapshot once, keeps the source table, and lets history follow the filters', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests, server } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const bad = '<img src=x>';
  server.contextSnapshot = snapshot({ modelId: bad, entries: [{ kind: 'plugin', id: 'plugin:kit', label: bad, tokens: 300 },
    { kind: 'skill', id: 'skill:a', label: 'snapshot-skill', tokens: 120, parentId: 'plugin:kit' }, { kind: 'tool', id: 'tool:view', label: 'snapshot-result', tokens: 400 }], omitted: 2 });
  await get('efficiency-context-read').onclick();
  const result = get('efficiency-context-result').innerHTML, related = get('efficiency-context-history').innerHTML;
  assert.equal(get('efficiency-context-read').textContent, 'Inspect again');
  assert.match(result, /<strong>1K<\/strong> tokens in current context · 25% of the 4K allowance/);
  assert.match(result, /aria-label="25% of the allowance used, 75% left"/);
  assert.match(result, /class="context-mix"/);
  assert.match(result, /Not attributed <b>50<\/b> · 5%/);
  assert.match(result, /Instructions \+ definitions<\/span><strong class="value">250<\/strong>/);
  assert.match(result, /<h4>Skills<\/h4>/);
  assert.match(result, /12% of context · included in &lt;img src=x&gt;/);
  // The full table and its overlap warning stay in the disclosure, after the grouped view.
  assert.ok(result.indexOf('Sources you can change') < result.indexOf('<details>'));
  assert.match(result, /<details><summary>Largest attributed sources · showing 3 of 5<\/summary><p class="footnote integration-note">Parent and child sources can overlap\. These rows are not added together\./);
  assert.match(result, /<table class="context-sources">/);
  assert.doesNotMatch(result + related, /<img|NaN|undefined|Infinity/);
  assert.doesNotMatch(result, /selected history|Compare afterward/);
  assert.match(related, /Tool definitions, this conversation<\/span><strong class="value">100<\/strong>/);
  assert.match(related, /selected history<\/span><strong class="value">Unavailable<\/strong>/);
  assert.match(related, /Illustration, not a measurement<\/span><p>Unavailable\./);
  assert.match(related, /Conversation and tool results are the largest part you can change: 700 tokens, 70% of this context\./);

  // New history arrives: only the comparison is redrawn, from the snapshot already held.
  Object.assign(report.efficiency.summary, { requests: 10, toolRequests: 8, averageToolTokens: 1200 });
  Object.assign(report.promptCredits, { prompts: 5, eligiblePrompts: 4 });
  Object.assign(report.promptCredits.work, { averageRequests: 3 });
  await get('refresh').onclick();
  assert.doesNotMatch(get('status').textContent, /Could not update/);
  assert.equal(get('efficiency-context-result').innerHTML, result);
  assert.match(get('efficiency-context-history').innerHTML, /selected history<\/span><strong class="value">1\.2K \*<\/strong><span class="sub">Average over 8 of 10 model calls</);
  assert.match(get('efficiency-context-history').innerHTML, /About 750 input tokens of setup behind one prompt/);
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 1);

  // The other current-context topics still read the same snapshot.
  jumpTokenTopic(get, 'skills');
  assert.match(get('token-topic-body').innerHTML, /snapshot-skill/);
  jumpTokenTopic(get, 'results');
  assert.match(get('token-topic-body').innerHTML, /snapshot-result/);
  jumpTokenTopic(get, 'tools');
  assert.match(get('token-topic-body').innerHTML, /Current tool and MCP sources/);
  assert.doesNotMatch(get('token-topic-body').innerHTML, /not been measured/);
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 1);

  server.contextSnapshot = { available: false, reason: 'empty' };
  await get('efficiency-context-read').onclick();
  assert.equal(get('efficiency-context-history').innerHTML, '');
  assert.match(get('token-topic-body').innerHTML, /not been measured/);
});
