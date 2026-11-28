import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mountPanel } from './fixtures/panel.mjs';
import { requestPanel } from './fixtures/panel-requests.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { TOKEN_TOPICS, PATTERN_TOPICS, tokenTopicIcon } from '../src/panel/token-topics.mjs';
import { createContextGrowthAccumulator } from '../src/core/context-growth.mjs';

test('Efficiency shows evidence safely, persists across refresh, and drills into the correct filtered breakdown', async () => {
  const { get, report, records, now, requests } = await requestPanel();
  const model = '<Model "A">';
  const history = Array.from({ length: 12 }, (_, i) => ({ ...records[0], key: `eff-${i}`, model: i < 7 ? model : 'Model B',
    ms: now.getTime() - (100 - i) * 1000, initiator: 'user', project: '<Project>', sessionId: 's1', sessionName: '<Session>',
    inputTotal: i < 3 ? 10000 : 40000, cacheRead: 1000, cacheWrite: 1000, nanoAiu: i < 7 ? 3000000000 : 1000000000 }));
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick();
  const before = requests.length;
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('usage-view').hidden, true);
  assert.equal(get('breakdown-view').hidden, true);
  assert.equal(get('efficiency-view').hidden, false);
  assert.match(get('efficiency-summary').innerHTML, /12 of 12 requests/);
  assert.match(get('efficiency-insights').innerHTML, /&lt;Session&gt;|&lt;Model &quot;A&quot;&gt;/);
  assert.match(get('efficiency-insights').innerHTML, /larger input|reuse context|credits concentrate/);
  assert.doesNotMatch(get('efficiency-insights').innerHTML, /<Session>|<Model/);
  assert.match(get('efficiency-models').innerHTML, /Cache reuse|Credits \/ request/);
  assert.equal(requests.length, before, 'switching tabs reads no additional files or API data');
  await get('refresh').onclick();
  assert.equal(get('efficiency-view').hidden, false);
  await get('efficiency-insights').onclick({ target: { closest: () => ({ dataset: { efficiencyInsight: '0' } }) } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(get('efficiency-view').hidden, true);
  assert.equal(get('group').value, 'models');
  assert.deepEqual(requests.at(-1).input.models, [model]);
  assert.equal(requests.at(-1).input.project, '<Project>');
  assert.equal(requests.at(-1).input.session, 's1');
  assert.equal(requests.filter(r => r.method === 'usage.requests').length, 0, 'inspection does not read prompts');
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await get('efficiency-models').onclick({ target: { closest: () => ({ dataset: { efficiencyModel: 'Model B' } }) } });
  assert.deepEqual(requests.at(-1).input.models, ['Model B']);
  assert.equal(requests.at(-1).input.project, '<Project>', 'model inspection preserves existing scope');
  assert.equal(requests.at(-1).input.session, 's1');
});

test('Efficiency distinguishes empty data and tiny credit values and preserves focused actions on refresh', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, document } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.match(get('efficiency-models').innerHTML, /No matching model requests/);
  assert.match(get('efficiency-insights').innerHTML, /More recorded requests/);
  const row = { name: 'Tiny model', requests: 1, inputRequests: 0, outputRequests: 0, cacheRequests: 0, creditRequests: 1,
    averageInput: null, averageOutput: null, cacheHitRate: null, averageCredits: .000000001 };
  report.efficiency = { summary: row, models: [row], insights: [] };
  const dataset = { efficiencyModel: 'Tiny model' };
  const restored = { dataset, focus() { document.activeElement = this; } };
  get('efficiency-view').querySelectorAll = () => [restored];
  document.activeElement = { dataset };
  await get('refresh').onclick();
  assert.equal(document.activeElement, restored);
  assert.match(get('efficiency-summary').innerHTML, /0\.000000001/);
  assert.match(get('efficiency-summary').innerHTML, /Unavailable/);
  assert.match(get('efficiency-models').innerHTML, /title="0\.000000001/);
});

test('efficiency context is explicit, escaped and independent of refresh; review stays frozen with copy fallback', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests, server } = await mountPanel(report);
  assert.equal(requests.some(r => r.method === 'efficiency.context'), false);
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-result').innerHTML, /not available|unavailable/i);
  server.contextSnapshot = { available: true, checkedAt: '2026-11-14T12:00:00Z', totalTokens: 1000, limit: 10000, modelId: '<PRIVATE-MODEL>', modelSource: 'autoResolved',
    categories: { customInstructions: 100, messages: 900 }, entries: [{ id: 's', kind: 'skill', label: '<PRIVATE>', tokens: 100 }], omitted: 0 };
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-result').innerHTML, /&lt;PRIVATE&gt;/);
  assert.match(get('efficiency-context-result').innerHTML, /Auto-resolved model: &lt;PRIVATE-MODEL&gt;/);
  assert.doesNotMatch(get('efficiency-context-result').innerHTML, /<PRIVATE>/);
  get('project').value = 'new filter not yet loaded';
  await get('efficiency-review-open').onclick();
  const frozen = get('efficiency-review-output').value;
  assert.equal(JSON.parse(frozen).scope.project, undefined);
  assert.doesNotMatch(frozen, /PRIVATE/);
  report.efficiency.summary.requests = 50;
  await get('refresh').onclick();
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 2);
  assert.equal(get('efficiency-review-output').value, frozen);
  await get('efficiency-review-copy').onclick();
  assert.equal(server.copied.at(-1), frozen);
  server.clipboardError = true;
  await get('efficiency-review-copy').onclick();
  assert.equal(get('efficiency-review-output').selected, true);
});

test('MCP efficiency findings use known outcomes and open the existing filtered MCP panel', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  report.mcp.rows = [{ name: '<server>', calls: 55, failures: 3, successes: 2, unknown: 50, successRate: 40, lastUsed: null, status: 'unavailable' }];
  const { get, requests } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('tiles').hidden, true);
  assert.match(get('efficiency-insights').innerHTML, /3 of 5.*60%.*50 outcomes/);
  assert.doesNotMatch(get('efficiency-insights').innerHTML, /More recorded requests|<server>/);
  const before = requests.length;
  get('efficiency-insights').onclick({ target: { closest: () => ({ dataset: { efficiencyMcp: 'true' } }) } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(get('mcp-panel').hidden, false);
  assert.equal(get('tiles').hidden, false);
  assert.equal(requests.length, before);
});


function jumpPatternTopic(get, id) {
  get('pattern-topic-stops').onclick({ target: { closest: () => ({ dataset: { patternStop: id } }) } });
}

function jumpTokenTopic(get, id) {
  get('token-topic-stops').onclick({ target: { closest: () => ({ dataset: { tokenStop: id } }) } });
}

test('token insights reuse the explicit snapshot across sections and filters without hidden reads', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests, server, document } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.match(get('token-overview-insight').innerHTML, /data-token-jump="prompts"/);
  get('token-overview-panel').onclick({ target: { closest: () => ({ dataset: { tokenJump: 'prompts' } }) } });
  assert.equal(get('token-selected-title').textContent, 'Work behind each prompt');
  assert.equal(document.activeElement, get('efficiency-topic'));
  const before = requests.length;
  jumpTokenTopic(get, 'skills');
  assert.match(get('token-topic-body').innerHTML, /not been measured/);
  get('token-detail-panel').onclick({ target: { closest: () => ({ dataset: { tokenContext: 'true' } }) } });
  assert.equal(requests.length, before, 'opening the inspector is local navigation');
  server.contextSnapshot = { available: true, checkedAt: '2026-11-14T12:00:00Z', totalTokens: 1000, limit: 10000,
    categories: { systemPrompt: 100, customInstructions: 50, systemTools: 80, mcpTools: 20, messages: 750 },
    entries: [{ id: 'skill', kind: 'skill', label: '<Snapshot skill>', tokens: 50 }, { id: 'tool', kind: 'tool', label: '<Snapshot result>', tokens: 100 }], omitted: 0 };
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-result').innerHTML, /Instructions \+ definitions/);
  assert.match(get('efficiency-context-result').innerHTML, />250<\/strong>/);
  const inspected = requests.length;
  jumpTokenTopic(get, 'skills');
  assert.match(get('token-topic-body').innerHTML, /&lt;Snapshot skill&gt;/);
  assert.doesNotMatch(get('token-topic-body').innerHTML, /Snapshot result/);
  jumpTokenTopic(get, 'results');
  assert.match(get('token-topic-body').innerHTML, /&lt;Snapshot result&gt;/);
  assert.doesNotMatch(get('token-topic-body').innerHTML, /Snapshot skill/);
  assert.equal(requests.length, inspected);
  get('efficiency-topic').focus();
  await get('refresh').onclick();
  get('model').value = 'Another model';
  await get('model').onchange();
  assert.equal(get('token-selected-title').textContent, 'Files, searches, and tool results');
  assert.equal(document.activeElement, get('efficiency-topic'));
  assert.match(get('token-topic-body').innerHTML, /&lt;Snapshot result&gt;/);
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 1);
  server.contextSnapshot = { available: false, reason: 'empty' };
  await get('efficiency-context-read').onclick();
  assert.doesNotMatch(get('token-topic-body').innerHTML, /Snapshot result/);
  assert.match(get('token-topic-body').innerHTML, /not been measured/);
  jumpTokenTopic(get, 'overview');
  const shortcut = get('token-overview-insight').querySelector('[data-token-jump="output"]');
  shortcut.focus();
  await get('refresh').onclick();
  assert.equal(document.activeElement.dataset.tokenJump, 'output');
});

test('slow inventory does not hide usage and merges into the latest filtered history', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, requests } = await mountPanel(report, undefined, undefined, () => pending);
  assert.equal(get('content').hidden, false);
  assert.equal(get('refresh').disabled, false);
  assert.match(get('plugins').innerHTML, /Loading current plugin inventory/);
  report.mcp = { available: false, calls: 7, omitted: 0, rows: [{ name: 'one', calls: 7, failures: 1, successes: 6, unknown: 0, successRate: 6 / 7 * 100, status: 'unavailable' }] };
  get('model').value = 'Filtered model';
  await get('model').onchange();
  assert.equal(requests.filter(r => r.method === 'usage.inventory').length, 1);
  finish({ mcp: { available: true, rows: [{ name: 'one', status: 'connected' }] }, plugins: { available: true, rows: [{ name: '<Plugin>', installed: true, enabled: true }] } });
  await new Promise(setImmediate);
  assert.equal(get('model').value, 'Filtered model');
  assert.match(get('mcp-summary').textContent, /7 calls/);
  assert.match(get('mcp').innerHTML, /Connected/);
  assert.match(get('plugins').innerHTML, /&lt;Plugin&gt;/);
  server.inventory = () => { throw new Error('unavailable'); };
  await get('refresh').onclick();
  await new Promise(setImmediate);
  assert.equal(get('content').hidden, false);
  assert.match(get('mcp-summary').textContent, /7 calls/);
  assert.match(get('plugins').innerHTML, /unavailable/i);
});

test('refresh during pending inventory queues one new read while filters coalesce', async () => {
  let finish, reads = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const inventory = name => ({ mcp: { available: true, rows: [] }, plugins: { available: true, rows: [{ name, installed: true, enabled: true }] } });
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get } = await mountPanel(report, undefined, undefined, () => ++reads === 1 ? pending : inventory('Fresh plugin'));
  await get('refresh').onclick();
  await get('refresh').onclick();
  await get('model').onchange();
  assert.equal(reads, 1, 'pending reads are not duplicated');
  finish(inventory('Old plugin'));
  await new Promise(setImmediate);
  assert.equal(reads, 2, 'multiple refreshes queue one follow-up inventory read');
  assert.match(get('plugins').innerHTML, /Fresh plugin/);
  assert.doesNotMatch(get('plugins').innerHTML, /Old plugin/);
});

test('inventory updates restore server focus or fall back to the MCP sort control', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, document, server } = await mountPanel(report);
  const summary = { focus() { document.activeElement = this; }, closest: () => ({ dataset: { server: 'fixture' } }) };
  get('mcp').querySelectorAll = () => [{ dataset: { server: 'fixture' }, querySelector: () => summary }];
  let finish;
  server.inventory = () => new Promise(resolve => { finish = resolve; });
  await get('refresh').onclick();
  await new Promise(setImmediate);
  document.activeElement = { closest: () => ({ dataset: { server: 'fixture' } }) };
  finish({ mcp: { available: true, rows: [{ name: 'fixture' }] }, plugins: { available: true, rows: [] } });
  await new Promise(setImmediate);
  assert.equal(document.activeElement, summary, 'retained server keeps focus');
  document.activeElement = null;
  await get('refresh').onclick();
  await new Promise(setImmediate);
  document.activeElement = summary;
  get('mcp').querySelectorAll = () => [];
  finish({ mcp: { available: false, rows: [] }, plugins: { available: false, rows: [] } });
  await new Promise(setImmediate);
  assert.equal(document.activeElement, get('mcp-sort'), 'removed server has a stable focus destination');
});

test('inactive token details are not regenerated until selected', async () => {
  const { get } = await requestPanel();
  assert.equal(get('token-cache-detail').innerHTML, '');
  jumpTokenTopic(get, 'cache');
  assert.match(get('token-cache-detail').innerHTML, /Uncached input/);
  jumpTokenTopic(get, 'tools');
  get('token-cache-detail').innerHTML = 'retained hidden cache';
  await get('refresh').onclick();
  assert.equal(get('token-cache-detail').innerHTML, 'retained hidden cache');
  jumpTokenTopic(get, 'cache');
  assert.match(get('token-cache-detail').innerHTML, /Uncached input/);
});

test('Efficiency section pickers separate topics, switch locally, and retain independent selections', async () => {
  const { get, requests, windowListeners, timeouts, document } = await requestPanel();
  const tokenPanels = ['overview', 'context', 'cache', 'detail'];
  const tokenTopics = TOKEN_TOPICS.map(topic => topic.id);
  const patternPanels = ['findings', 'habits', 'growth', 'recovery', 'models', 'detail'];
  const patternTopics = ['findings', 'habits', 'growth', 'compaction', 'recovery', 'transitions', 'repetition', 'models'];
  const choose = (picker, id) => {
    if (picker === 'efficiency-topic') jumpTokenTopic(get, id);
    else jumpPatternTopic(get, id);
  };
  const visible = (prefix, panels) => panels.filter(id => !get(prefix + '-' + id + '-panel').hidden);
  const switchTab = efficiencySection => get('efficiency-sections').onclick({ target: { dataset: { efficiencySection } } });
  assert.deepEqual(visible('token', tokenPanels), ['overview']);
  assert.deepEqual(visible('pattern', patternPanels), ['findings']);
  assert.equal(get('token-topic-stops').querySelectorAll('[data-token-stop]').length, 10);
  assert.equal(get('pattern-topic-stops').querySelectorAll('[data-pattern-stop]').length, 8);
  const before = requests.length;
  for (const topic of tokenTopics) {
    choose('efficiency-topic', topic);
    assert.deepEqual(visible('token', tokenPanels), [tokenPanels.includes(topic) ? topic : 'detail']);
    assert.equal(get('efficiency-topic').value, String(tokenTopics.indexOf(topic)));
    assert.equal(get('token-selected-title').textContent, TOKEN_TOPICS[tokenTopics.indexOf(topic)].label);
    if (!tokenPanels.includes(topic)) assert.ok(get('token-topic-body').innerHTML.length > 0);
  }
  switchTab('patterns');
  for (const topic of patternTopics) {
    choose('efficiency-pattern-topic', topic);
    assert.deepEqual(visible('pattern', patternPanels), [patternPanels.includes(topic) ? topic : 'detail']);
    assert.equal(get('efficiency-pattern-topic').value, String(patternTopics.indexOf(topic)));
    if (!patternPanels.includes(topic)) assert.ok(get('pattern-topic-body').innerHTML.length > 0);
    assert.equal(get('efficiency-topic').value, '9');
  }
  choose('efficiency-topic', 'growth');
  choose('efficiency-pattern-topic', 'cache');
  assert.equal(get('efficiency-topic').value, '9', 'wrong dashboard topic is ignored');
  assert.equal(get('efficiency-pattern-topic').value, '7');
  assert.equal(requests.length, before, 'navigation never loads logs, inspects context, or invokes AI');
  switchTab('review');
  assert.equal(get('efficiency-patterns-panel').hidden, true);
  assert.equal(get('efficiency-tokens-panel').hidden, true);
  switchTab('patterns');
  get('efficiency-pattern-topic').focus();
  await get('refresh').onclick();
  assert.equal(get('efficiency-pattern-topic').value, '7');
  assert.equal(document.activeElement, get('efficiency-pattern-topic'));
  choose('efficiency-pattern-topic', 'growth');
  const oldGrowth = get('pattern-topic-body').innerHTML;
  get('model').value = 'Alpha';
  await get('model').onchange();
  assert.equal(get('efficiency-pattern-topic').value, '2');
  assert.equal(get('efficiency-topic').value, '9');
  assert.ok(oldGrowth.length && get('pattern-topic-body').innerHTML.length);
  windowListeners.get('resize')();
  timeouts.at(-1).callback();
  assert.equal(get('efficiency-pattern-topic').value, '2');
  await get('settings-open').onclick();
  get('text-size').value = 'large';
  await get('settings-save').onclick();
  assert.equal(get('efficiency-pattern-topic').value, '2');
  const contextBefore = requests.length;
  choose('efficiency-pattern-topic', 'habits');
  get('token-detail-panel').onclick({ target: { closest: () => ({ dataset: { action: 'open-context' } }) } });
  assert.equal(get('efficiency-tokens-panel').hidden, false);
  assert.equal(get('efficiency-topic').value, '1');
  assert.equal(get('efficiency-pattern-topic').value, '1');
  assert.equal(document.activeElement, get('efficiency-context-read'));
  assert.equal(requests.length, contextBefore, 'opening the inspector does not run it');
  assert.equal(get('token-selected-title').textContent, 'Always-loaded context');
  assert.equal(get('token-topic-position').textContent, 'Context · 2 of 10');
  assert.equal(get('efficiency-topic').getAttribute('aria-valuetext'), 'Always-loaded context, section 2 of 10');
  assert.equal(get('token-topic-stops').querySelector('[data-token-stop="context"]').getAttribute('aria-current'), 'true');
});

test('token explorer maps every stop, preserves its focused lens, and only rerenders changed selections', async () => {
  const { get, requests, document } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const lens = get('efficiency-topic'), stops = get('token-topic-stops').querySelectorAll('[data-token-stop]');
  const nodes = get('token-track-nodes').querySelectorAll('[data-token-node]');
  assert.equal(lens.getAttribute('type'), 'range');
  assert.equal(lens.getAttribute('step'), '1');
  assert.equal(lens.getAttribute('min'), '0');
  assert.equal(lens.max, '9');
  assert.equal(lens.getAttribute('aria-label'), 'Token usage section');
  assert.equal(lens.value, '0');
  assert.equal(get('token-topic-prev').disabled, true);
  assert.equal(get('token-topic-next').disabled, false);
  const before = requests.length;
  lens.focus();
  for (const [index, topic] of TOKEN_TOPICS.entries()) {
    lens.value = String(index); lens.oninput();
    assert.equal(document.activeElement, lens);
    assert.equal(get('token-selected-title').textContent, topic.label);
    assert.equal(lens.getAttribute('aria-valuetext'), `${topic.label}, section ${index + 1} of 10`);
    assert.equal(lens.title, topic.label);
    assert.equal(lens.style['--lens-icon'], `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(topic, true))}")`);
    assert.equal(stops[index].getAttribute('aria-label'), topic.label);
    assert.equal(stops[index].getAttribute('title'), topic.label, 'icon buttons retain full hover names');
    assert.equal(stops.filter(b => b.getAttribute('aria-current') === 'true').length, 1);
    assert.equal(stops[index].getAttribute('aria-current'), 'true');
    assert.deepEqual(nodes.map(n => n.classList.current), TOKEN_TOPICS.map((_, i) => i === index));
    const panel = ['overview', 'context', 'cache'].includes(topic.id) ? topic.id : 'detail';
    assert.equal(get(`token-${panel}-panel`).hidden, false);
    if (panel === 'detail') assert.equal(get('token-topic-title').textContent, topic.label);
  }
  assert.equal(get('token-topic-next').disabled, true);
  jumpTokenTopic(get, 'tools');
  let renders = 0, body = get('token-topic-body').innerHTML;
  Object.defineProperty(get('token-topic-body'), 'innerHTML', { get: () => body, set(value) { renders++; body = value; } });
  lens.oninput(); lens.oninput(); jumpTokenTopic(get, 'tools');
  assert.equal(renders, 0, 'repeated input on the same stop does not rerender');
  jumpTokenTopic(get, 'results');
  assert.equal(renders, 1);
  assert.equal(requests.length, before, 'navigation never fetches or inspects context');
  await get('refresh').onclick();
  get('model').value = 'Alpha'; await get('model').onchange();
  assert.equal(lens.value, '3');
  assert.equal(lens.style['--lens-icon'], `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(TOKEN_TOPICS[3], true))}")`);
  assert.equal(document.activeElement, lens);
  assert.equal(renders, 3, 'fresh reports update the selected content');
  assert.equal(get('token-topic-stops').querySelectorAll('[data-token-stop]')[0], stops[0], 'stop nodes are never rebuilt');
});

for (const { prefix, rangeId, topics, heights, jump } of [
  { prefix: 'token', rangeId: 'efficiency-topic', topics: TOKEN_TOPICS, heights: { overview: 1100, context: 180, cache: 460, detail: 900 }, jump: jumpTokenTopic },
  { prefix: 'pattern', rangeId: 'efficiency-pattern-topic', topics: PATTERN_TOPICS, heights: { findings: 1100, habits: 180, growth: 980, recovery: 460, models: 400, detail: 900 }, jump: jumpPatternTopic },
]) {
test(`${prefix} explorer keeps the viewport steady when a warning pushes it down and topic heights change`, async () => {
  const { get, requests, document, viewport } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('coverage').hidden, false, 'fixture includes the orange coverage notice');
  const content = get(prefix + '-topic-content'), lens = get(rangeId);

  const contentTop = 980, footerHeight = 100;
  let scrollY = 640;
  viewport.innerHeight = 800;
  content.getBoundingClientRect = () => ({ top: contentTop - scrollY });
  const layout = () => {
    const name = Object.keys(heights).find(name => !get(`${prefix}-${name}-panel`).hidden);
    const height = Math.max(heights[name], parseFloat(content.style.minHeight) || 0);
    // A browser clamps its scroll offset when the replacement panel shortens the document.
    scrollY = Math.min(scrollY, Math.max(0, contentTop + height + footerHeight - viewport.innerHeight));
  };
  const before = requests.length;
  lens.focus();
  for (const index of [...topics.map((_, i) => i).slice(1), 0, 1]) {
    lens.value = String(index); lens.oninput(); layout();
    assert.equal(scrollY, 640, 'switching to a shorter topic must not pull the slider away from the pointer');
    assert.equal(content.getBoundingClientRect().top, 340);
    assert.equal(document.activeElement, lens);
    assert.equal(get('coverage').hidden, false);
  }
  // Without a warning, a viewport resize must also remain stable.
  get('coverage').hidden = true;
  viewport.innerHeight = 900;
  lens.onkeydown({ key: 'End', preventDefault() {} }); layout();
  jump(get, topics[1].id); layout();
  assert.equal(scrollY, 640);
  // At the top of the document, content below the fold needs no reserved space.
  scrollY = 0;
  lens.onkeydown({ key: 'Home', preventDefault() {} }); layout();
  assert.equal(scrollY, 0);
  assert.equal(parseFloat(content.style.minHeight), 0);
  scrollY = 1300;
  jump(get, topics[1].id);
  assert.equal(parseFloat(content.style.minHeight), 900, 'jumps from deep content reserve at most one viewport');
  assert.equal(requests.length, before, 'layout stabilization does not load usage or inspect context');
});

}

test('compact token explorer retains keyboard, direct jumps, and endpoint focus', async () => {
  const { get, requests, document } = await requestPanel();
  const lens = get('efficiency-topic');
  lens.focus();
  const before = requests.length;
  const key = (name, expected) => {
    let prevented = false;
    lens.onkeydown({ key: name, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(lens.value, String(expected));
    assert.equal(document.activeElement, lens);
  };
  key('ArrowLeft', 0); key('ArrowDown', 0); key('ArrowRight', 1); key('ArrowUp', 2);
  key('End', 9); key('ArrowRight', 9); key('ArrowUp', 9);
  assert.equal(get('token-topic-next').disabled, true);
  key('Home', 0);
  assert.equal(get('token-topic-prev').disabled, true);
  lens.onkeydown({ key: 'Tab', preventDefault() { assert.fail('Tab keeps native focus navigation'); } });
  get('token-topic-next').onclick();
  assert.equal(lens.value, '1');
  let previousDisabled = get('token-topic-prev').disabled;
  Object.defineProperty(get('token-topic-prev'), 'disabled', { get: () => previousDisabled, set(value) {
    previousDisabled = value;
    if (value && document.activeElement === get('token-topic-prev')) document.activeElement = null;
  } });
  get('token-topic-prev').focus();
  get('token-topic-prev').onclick(); get('token-topic-prev').onclick();
  assert.equal(lens.value, '0');
  assert.equal(get('token-topic-prev').disabled, true);
  assert.equal(document.activeElement, lens, 'endpoint button hands focus to the lens before it becomes unavailable');
  lens.value = '9'; lens.oninput();
  assert.equal(get('token-selected-title').textContent, 'Biggest spend drivers', 'input changes the content immediately');
  assert.equal(document.activeElement, lens);
  jumpTokenTopic(get, 'overview');
  assert.equal(lens.value, '0');
  assert.equal(get('token-topic-announcement').textContent, 'Showing Overview');
  key('End', 9);
  get('token-topic-next').onclick();
  assert.equal(lens.value, '9');
  assert.equal(requests.length, before);
});

test('pattern explorer shares the compact lens, maps every topic and preserves navigation through refresh', async () => {
  const { get, requests, document } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('efficiency-sections').onclick({ target: { dataset: { efficiencySection: 'patterns' } } });
  const lens = get('efficiency-pattern-topic');
  assert.equal(lens.getAttribute('type'), 'range');
  assert.equal(lens.getAttribute('class'), 'topic-lens');
  assert.equal(lens.getAttribute('min'), '0');
  assert.equal(lens.getAttribute('step'), '1');
  assert.equal(lens.max, '7');
  assert.equal(lens.getAttribute('aria-label'), 'Usage pattern section');
  assert.equal(lens.value, '0');
  assert.equal(get('pattern-topic-prev').disabled, true);
  const stops = get('pattern-topic-stops').querySelectorAll('[data-pattern-stop]');
  const nodes = get('pattern-track-nodes').querySelectorAll('[data-pattern-node]');
  const before = requests.length;
  lens.focus();
  for (const [index, topic] of PATTERN_TOPICS.entries()) {
    lens.value = String(index); lens.oninput();
    assert.equal(document.activeElement, lens);
    assert.equal(get('pattern-selected-title').textContent, topic.label);
    assert.equal(lens.title, topic.label);
    assert.equal(lens.getAttribute('aria-valuetext'), `${topic.label}, section ${index + 1} of 8`);
    assert.equal(lens.style['--lens-icon'], `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(topic, true))}")`);
    assert.equal(stops[index].getAttribute('aria-label'), topic.label);
    assert.equal(stops[index].getAttribute('title'), topic.label);
    assert.equal(stops.filter(b => b.getAttribute('aria-current') === 'true').length, 1);
    assert.equal(stops[index].getAttribute('aria-current'), 'true');
    assert.deepEqual(nodes.map(n => n.classList.current), PATTERN_TOPICS.map((_, i) => i === index));
    const panel = ['findings', 'habits', 'growth', 'recovery', 'models'].includes(topic.id) ? topic.id : 'detail';
    assert.equal(get(`pattern-${panel}-panel`).hidden, false);
    if (panel === 'detail') assert.equal(get('pattern-topic-title').textContent, topic.label);
  }
  assert.equal(get('pattern-topic-next').disabled, true);
  const key = (name, expected) => {
    let prevented = false;
    lens.onkeydown({ key: name, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(lens.value, String(expected));
    assert.equal(document.activeElement, lens);
  };
  key('ArrowRight', 7); key('ArrowUp', 7); key('Home', 0); key('ArrowLeft', 0); key('ArrowDown', 0);
  key('ArrowRight', 1); key('ArrowUp', 2); key('ArrowLeft', 1); key('ArrowDown', 0); key('End', 7);
  lens.onkeydown({ key: 'Tab', preventDefault() { assert.fail('Tab keeps native focus navigation'); } });
  get('pattern-topic-prev').onclick();
  assert.equal(lens.value, '6');
  get('pattern-topic-next').focus(); get('pattern-topic-next').onclick();
  assert.equal(lens.value, '7');
  assert.equal(document.activeElement, lens);
  jumpPatternTopic(get, 'habits');
  get('pattern-topic-prev').focus(); get('pattern-topic-prev').onclick();
  assert.equal(lens.value, '0');
  assert.equal(document.activeElement, lens);
  jumpPatternTopic(get, 'growth');
  assert.equal(get('pattern-topic-announcement').textContent, 'Showing Context growth');
  let renders = 0, body = get('pattern-topic-body').innerHTML;
  Object.defineProperty(get('pattern-topic-body'), 'innerHTML', { get: () => body, set(value) { renders++; body = value; } });
  lens.oninput(); lens.oninput(); jumpPatternTopic(get, 'growth');
  assert.equal(renders, 0);
  jumpPatternTopic(get, 'compaction');
  assert.equal(renders, 1);
  assert.equal(requests.length, before, 'navigation never fetches or inspects context');
  await get('refresh').onclick();
  get('model').value = 'Alpha'; await get('model').onchange();
  assert.equal(lens.value, '3');
  assert.equal(document.activeElement, lens);
  assert.equal(renders, 3, 'fresh reports update selected content');
  assert.equal(get('pattern-topic-stops').querySelectorAll('[data-pattern-stop]')[0], stops[0]);
});

test('Efficiency panels live only in their assigned dashboard and AI review stays separate', async () => {
  const html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  const tokens = html.split('<section id="efficiency-tokens-panel"')[1].split('<section id="efficiency-patterns-panel"')[0];
  const patterns = html.split('<section id="efficiency-patterns-panel"')[1].split('<section id="efficiency-review-panel"')[0];
  const review = html.split('<section id="efficiency-review-panel"')[1].split('<details class="efficiency-method"')[0];
  assert.match(tokens, /id="token-context-panel"/);
  assert.doesNotMatch(tokens, /id="efficiency-reliability"|id="efficiency-habits"|id="efficiency-models"/);
  for (const id of ['efficiency-reliability', 'efficiency-conversations', 'conversation-topics', 'efficiency-models']) assert.match(patterns, new RegExp('id="' + id + '"'));
  assert.match(patterns, /<h2[^>]*>Findings<\/h2>/);
  assert.match(patterns, /<h2[^>]*>Model comparisons<\/h2>/);
  assert.match(review, /id="efficiency-review-open"/);
  assert.doesNotMatch(review, /id="(?:token|pattern)-|id="efficiency-(?:topic|pattern-topic|habits|models|insights|reliability)"/);
});

test('token topic inspector links retain keyboard focus through refresh and section changes', async () => {
  const { get, document } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const body = get('token-topic-body');
  let markup = '', button;
  Object.defineProperty(body, 'innerHTML', { get: () => markup, set(value) {
    if (document.activeElement === button) document.activeElement = null;
    markup = value;
    button = value.includes('data-token-context') ? { dataset: { tokenContext: 'true' }, focus() { document.activeElement = this; } } : null;
  } });
  body.querySelector = () => button;
  for (const topic of ['tools', 'results', 'skills']) {
    jumpTokenTopic(get, topic);
    button.focus();
    const previous = button;
    await get('refresh').onclick();
    assert.notEqual(button, previous);
    assert.equal(document.activeElement, button, topic + ' restores its recreated action');
  }
  jumpTokenTopic(get, 'output');
  assert.equal(document.activeElement, get('efficiency-topic'), 'removed action returns focus to the lens');
});

test('Efficiency subviews switch locally, retain selection on refresh, and expose scoped habits and outcomes', async () => {
  const { get, requests, report, server } = await requestPanel();
  const buttons = ['tokens', 'patterns', 'review'].map(efficiencySection => ({ dataset: { efficiencySection }, setAttribute(key, value) { this[key] = value; } }));
  get('efficiency-sections').querySelectorAll = () => buttons;
  const choose = efficiencySection => get('efficiency-sections').onclick({ target: { dataset: { efficiencySection } } });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('efficiency-tokens-panel').hidden, false);
  assert.equal(get('efficiency-patterns-panel').hidden, true);
  assert.equal(get('efficiency-review-panel').hidden, true);
  const before = requests.length;
  choose('patterns'); choose('review'); choose('invalid');
  assert.equal(requests.length, before, 'subview selection never loads data or invokes AI');
  assert.equal(get('efficiency-review-panel').hidden, false);
  assert.equal(get('efficiency-method').hidden, true);
  assert.equal(buttons[2]['aria-pressed'], 'true');
  await get('refresh').onclick();
  assert.equal(get('efficiency-review-panel').hidden, false);
  report.efficiency.interactions = { prompts: 6, promptSamples: 6, promptSessions: 2, averagePromptChars: 1250,
    averagePromptsPerSession: 3, turns: 12, turnSessions: 2, averageTurnsPerSession: 6, observedSessions: 2, sessionErrors: 1 };
  report.efficiency.conversations = { windowed: true, sessions: 3, countedSessions: 2, uncertainSessions: 0, withoutPrompts: 1, prompts: 6,
    medianPrompts: 3, averagePrompts: 3, multiDaySessions: 1, priorSessions: 0,
    distribution: [{ label: '1 prompt', count: 1 }, { label: '2–5 prompts', count: 1 }, { label: '6–15 prompts', count: 0 }, { label: '16+ prompts', count: 0 }],
    workSessions: 1, workPrompts: 1, averageCallsPerPrompt: 3, workMatrix: [[0, 0, 0], [1, 0, 0], [0, 0, 0]] };
  report.tools.rows = [{ name: '<private tool>', calls: 4, successes: 2, failures: 1, unknown: 1 },
    { name: 'mcp-tool', server: '<server>', calls: 2, successes: 0, failures: 2, unknown: 0 }];
  await get('refresh').onclick();
  choose('patterns');
  assert.equal(get('efficiency-method').hidden, false);
  assert.match(get('efficiency-conversations').innerHTML, /1\.3K/);
  assert.match(get('efficiency-conversations').innerHTML, /User prompts per conversation/);
  assert.match(get('efficiency-conversations').innerHTML, /2 of 3 conversations/);
  assert.match(get('efficiency-conversations').innerHTML, /50%/);
  assert.doesNotMatch(get('efficiency-conversations').innerHTML, /Input tokens \/ call|Agent turns \/ session/);
  assert.match(get('efficiency-conversations').innerHTML, /does not measure completeness or quality/);
  assert.match(get('efficiency-reliability').innerHTML, /66\.7%|0%/);
  assert.match(get('efficiency-reliability').innerHTML, /&lt;private tool&gt;|&lt;server&gt;/);
  assert.doesNotMatch(get('efficiency-reliability').innerHTML, /<private tool>|<server>/);
  assert.match(get('efficiency-reliability').innerHTML, /1 recorded root-session error/);
  get('token-detail-panel').onclick({ target: { closest: () => ({ dataset: { tokenContext: 'true' } }) } });
  assert.equal(get('efficiency-tokens-panel').hidden, false);
  server.contextSnapshot = { available: true, checkedAt: new Date().toISOString(), totalTokens: 1000, categories: { customInstructions: 500 }, entries: [], omitted: 0 };
  await get('efficiency-context-read').onclick();
  assert.match(get('efficiency-context-result').innerHTML, /Custom instructions/);
  assert.match(get('efficiency-context-result').innerHTML, /500/);
  report.efficiency.interactions = { observedSessions: 0, omitted: 3 };
  await get('refresh').onclick();
  assert.doesNotMatch(get('efficiency-conversations').innerHTML, /Average displayed prompt length/);
  report.efficiency.interactions = { reason: 'model-filter' };
  report.efficiency.conversations = { reason: 'model-filter' };
  await get('refresh').onclick();
  assert.match(get('efficiency-conversations').innerHTML, /Clear the model filter/);
  assert.doesNotMatch(get('efficiency-conversations').innerHTML, /<table|conversation-bar/);
  assert.match(get('efficiency-reliability').innerHTML, /unavailable under a model filter/);
  choose('review'); await get('efficiency-review-open').onclick();
  assert.match(get('efficiency-review-output').value, /model filter/);
});


test('focused conversation navigation is local, keyboard accessible and survives refresh and filters', async () => {
  const { get, requests, report, document } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const nav = get('conversation-topics'), body = get('efficiency-conversations');
  const choose = topic => nav.onclick({ target: { closest: () => ({ dataset: { conversationTopic: topic } }) } });
  const before = requests.length;
  choose('work');
  assert.equal(get('conversation-tab-work').getAttribute('aria-pressed'), 'true');
  assert.match(body.innerHTML, /What happens between your messages/);
  assert.doesNotMatch(body.innerHTML, /How much do you interact/);
  choose('guidance'); assert.match(body.innerHTML, /When your messages arrive/);
  let prevented = 0;
  nav.onkeydown({ key: 'End', preventDefault() { prevented++; } });
  assert.equal(get('conversation-tab-returning').getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, get('conversation-tab-returning'));
  assert.equal(prevented, 1);
  assert.match(body.innerHTML, /Days with user messages/);
  assert.equal(requests.length, before, 'topics never scan or invoke AI');
  await get('refresh').onclick();
  assert.equal(get('conversation-tab-returning').getAttribute('aria-pressed'), 'true');
  assert.match(body.innerHTML, /Days with user messages/);
  const loaded = report.efficiency.conversations;
  report.efficiency.conversations = { reason: 'model-filter' };
  await get('refresh').onclick(); assert.match(body.innerHTML, /Clear the model filter/);
  assert.equal(get('conversation-tab-returning').getAttribute('aria-pressed'), 'true');
  report.efficiency.conversations = loaded; await get('refresh').onclick();
  assert.match(body.innerHTML, /Days with user messages/);
  const updated = requests.length;
  body.onclick({ target: { closest: () => ({ dataset: { conversationExplore: '' } }) } });
  assert.match(body.innerHTML, /Recorded conversation examples/);
  assert.equal(requests.length, updated, 'examples use only the loaded metadata');
  nav.onkeydown({ key: 'Home', preventDefault() {} });
  assert.equal(get('conversation-tab-interaction').getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(body.innerHTML, /Recorded conversation examples/);
  get('conversation-tab-returning').focus();
  nav.onkeydown({ key: 'ArrowLeft', target: { closest: () => ({ dataset: { conversationTopic: 'returning' } }) }, preventDefault() {} });
  assert.equal(document.activeElement, get('conversation-tab-guidance'), 'arrows start at the focused button, even when another topic was selected');
  assert.equal(get('conversation-tab-guidance').getAttribute('aria-pressed'), 'true');
});

test('focused conversation disclosure summaries retain focus and open state after refresh', async () => {
  const { get, nodes, document, report } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  Object.assign(report.efficiency.conversations, { workSessions: 1, workPrompts: 1, workMatrix: [[1, 0, 0], [0, 0, 0], [0, 0, 0]] });
  const root = get('efficiency-conversations');
  get('conversation-topics').onclick({ target: { closest: () => ({ dataset: { conversationTopic: 'work' } }) } });
  const pairs = [['conversation-coverage', 'conversation-coverage-toggle'], ['conversation-explanation', 'conversation-explanation-toggle'], ['conversation-work-detail', 'conversation-work-toggle']];
  let markup = root.innerHTML;
  root.querySelectorAll = () => pairs.map(([id]) => get(id)).filter(d => d.open);
  Object.defineProperty(root, 'innerHTML', { get: () => markup, set(value) {
    markup = value;
    for (const [id, summaryId] of pairs) {
      const old = get(summaryId);
      if (document.activeElement === old) document.activeElement = null;
      nodes.set(summaryId, { ...old, id: summaryId, focus() { document.activeElement = this; } });
      get(id).open = false;
    }
  } });
  for (const [id, summaryId] of pairs) {
    assert.ok(markup.includes(`id="${summaryId}"`));
    get(id).id = id; get(id).open = true;
    const old = get(summaryId); old.id = summaryId; old.focus();
    await get('refresh').onclick();
    assert.notEqual(get(summaryId), old, 'a refresh replaces generated summaries');
    assert.equal(document.activeElement, get(summaryId));
    assert.equal(get(id).open, true);
  }
});

test('Context Growth grouping and session controls stay local, keep the range mounted and survive refresh', async () => {
  const { get, requests, report, document } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const a = createContextGrowthAccumulator({}, 1, 1, new Date());
  for (let s = 0; s < 4; s++) for (let p = 0; p < 8; p++) a.add({ sessionId: `session${s}`, project: 'Project', day: 1,
    sample: { ms: p }, identity: true, humanDelivery: true, provider: true, linksKnown: true,
    contextRecord: { ms: p, inputTotal: (p + 1) * 20000, model: 'Alpha', modelId: 'raw', cacheRead: 0, cacheWrite: 0 } });
  report.efficiency.contextGrowth = a.finish();
  await get('refresh').onclick();
  jumpPatternTopic(get, 'growth');
  const root = get('efficiency-growth'), before = requests.length;
  assert.equal(get('pattern-growth-panel').hidden, false); assert.match(root.innerHTML, /shaded middle 50%/);
  const click = data => root.onclick({ target: { closest: () => ({ dataset: data }) } });
  click({ growthPattern: 'growing' }); click({ growthMode: 'change' });
  assert.match(root.innerHTML, /id="growth-mode-change" aria-pressed="true"/);
  assert.equal(requests.length, before);
  root.onchange({ target: { id: 'growth-session', value: 'session0' } });
  const slider = get('growth-prompt'); slider.id = 'growth-prompt'; slider.value = '4'; slider.focus();
  const bodyBefore = root.innerHTML;
  root.oninput({ target: slider });
  assert.equal(root.innerHTML, bodyBefore, 'dragging updates chart/readout, never the focused input');
  assert.equal(document.activeElement, slider); assert.match(get('growth-prompt-readout').textContent, /Prompt 4/);
  await get('refresh').onclick();
  assert.match(root.innerHTML, /value="session0" selected/); assert.match(root.innerHTML, /value="4" aria-describedby/);
  assert.equal(document.activeElement, slider);
  const project = get('growth-project'); project.id = 'growth-project'; project.focus();
  await project.onchange({ target: { value: 'Project' } });
  assert.equal(get('project').value, 'Project'); assert.equal(document.activeElement, project);
  assert.equal(requests.at(-1).input.project, 'Project'); assert.notEqual(requests.at(-1).refresh, true);
  assert.doesNotMatch(root.innerHTML, /value="session0" selected/);
});

