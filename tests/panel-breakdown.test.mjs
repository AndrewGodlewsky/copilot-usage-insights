import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPanel } from './fixtures/panel.mjs';
import { requestPanel, jumpPatternTopic, jumpTokenTopic } from './fixtures/panel-requests.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport, buildRequestPage, buildModelSessionPage, buildModelProjectPage, buildSessionModels } from '../src/core/copilot-report.mjs';
import { mergeMcpInventory } from '../src/core/integrations.mjs';
import { encodeReportWire } from '../src/core/report-wire.mjs';

test('hidden Breakdown and Efficiency views defer rendering and show the latest report when opened', async () => {
  const { get, requests, report, records, now } = await requestPanel();
  const writes = { breakdown: 0, 'efficiency-summary': 0 };
  for (const id of Object.keys(writes)) {
    let markup = get(id).innerHTML;
    assert.equal(markup, '', `${id} is deferred on initial load`);
    Object.defineProperty(get(id), 'innerHTML', { get: () => markup, set(value) { markup = value; writes[id]++; } });
  }
  const before = requests.length;
  for (let i = 0; i < 10; i++) get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.deepEqual(writes, { breakdown: 0, 'efficiency-summary': 0 });
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.deepEqual(writes, { breakdown: 1, 'efficiency-summary': 0 });
  assert.match(get('breakdown').innerHTML, /&lt;Sonnet&gt;/);
  get('view').onclick({ target: { dataset: { view: 'usage' } } });
  assert.equal(requests.length, before, 'local navigation uses the loaded report');
  Object.assign(report, buildReport([{ ...records[0], model: '<Fresh model>' }], {}, now));
  await get('refresh').onclick();
  assert.deepEqual(writes, { breakdown: 1, 'efficiency-summary': 0 }, 'refresh does not regenerate hidden views');
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.deepEqual(writes, { breakdown: 1, 'efficiency-summary': 1 });
  assert.match(get('efficiency-models').innerHTML, /&lt;Fresh model&gt;/);
  get('efficiency-sections').onclick({ target: { dataset: { efficiencySection: 'patterns' } } });
  jumpPatternTopic(get, 'growth');
  assert.equal(get('pattern-growth-panel').hidden, false);
  get('efficiency-sections').onclick({ target: { dataset: { efficiencySection: 'tokens' } } });
  jumpTokenTopic(get, 'skills');
  get('token-detail-panel').onclick({ target: { closest: () => ({ dataset: { tokenContext: 'true' } }) } });
  assert.equal(get('token-context-panel').hidden, false, 'programmatic context navigation works after deferred rendering');
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.match(get('breakdown').innerHTML, /&lt;Fresh model&gt;/);
  assert.doesNotMatch(get('breakdown').innerHTML, /&lt;Sonnet&gt;/);
});

for (const failed of [false, true]) test(`late drilldown ${failed ? 'errors' : 'results'} stay ready without rebuilding hidden Breakdown`, async () => {
  const { get, click, server, requests } = await requestPanel();
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  await click({ requestSession: 's1' });
  const original = server.requestPage;
  let finish;
  server.requestPage = input => new Promise((resolve, reject) => {
    finish = () => failed ? reject(new Error('Synthetic detail failure')) : resolve(original(input));
  });
  const loading = click({ requestId: JSON.stringify(['receipt', 's1', 'call-0']) });
  await new Promise(setImmediate);
  assert.match(get('breakdown').innerHTML, /Loading original prompt/);
  get('view').onclick({ target: { dataset: { view: 'usage' } } });
  let markup = get('breakdown').innerHTML, writes = 0;
  Object.defineProperty(get('breakdown'), 'innerHTML', { get: () => markup, set(value) { markup = value; writes++; } });
  const calls = requests.length;
  finish(); await loading;
  assert.equal(writes, 0, 'completion does not rebuild an invisible table');
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.equal(writes, 1);
  assert.equal(requests.length, calls, 'returning shows the completed result without another read');
  assert.match(markup, failed ? /Synthetic detail failure/ : /Full original prompt/);
  assert.doesNotMatch(markup, /Loading original prompt/);
});

test('hidden Usage charts stay untouched and refresh from current data when Usage returns', async () => {
  const { get, report, records, now, requests } = await requestPanel();
  const surfaces = ['daily', 'calendar', 'rhythm', 'token-bar', 'models-summary', 'projects-summary'];
  const writes = new Map();
  for (const id of surfaces) {
    let markup = get(id).innerHTML;
    Object.defineProperty(get(id), 'innerHTML', { get: () => markup, set(value) { markup = value; writes.set(id, (writes.get(id) || 0) + 1); } });
  }
  for (const view of ['breakdown', 'efficiency']) {
    get('view').onclick({ target: { dataset: { view } } });
    writes.clear();
    const before = requests.length;
    get('metric').onclick({ target: { dataset: { metric: 'credits' } } });
    get('metric').onclick({ target: { dataset: { metric: 'tokens' } } });
    assert.equal(requests.length, before);
    Object.assign(report, buildReport([{ ...records[0], model: `<Current ${view}>`, project: `<Project ${view}>`, input: 200, inputTotal: 200, output: 20 }], {}, now));
    await get('refresh').onclick();
    assert.equal(writes.size, 0, 'hidden Usage charts are not regenerated by shared controls or refresh');
    assert.equal(get('hero-credits').textContent, '0.25', 'the shared header remains current');
    get('view').onclick({ target: { dataset: { view: 'usage' } } });
    for (const id of surfaces) assert.equal(writes.get(id), 1, `${id} redraws once on return`);
    assert.equal(get('token-total').textContent, '220');
    assert.ok(get('models-summary').innerHTML.includes(`&lt;Current ${view}&gt;`));
    assert.ok(get('projects-summary').innerHTML.includes(`&lt;Project ${view}&gt;`));
  }
  get('daily').onkeydown({ key: 'Enter', preventDefault() {}, target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.match(get('token-title').textContent, /Tokens on/);
  get('all-days').onclick();
  assert.equal(get('token-title').textContent, 'Total tokens');
});

test('compact reports decode before rendering and large session filters populate only when opened', async () => {
  const { records, now } = await requestPanel();
  const history = Array.from({ length: 1001 }, (_, i) => ({ ...records[0], key: `lazy-${i}`, sessionId: `lazy-${i}`, sessionName: `<Session ${i}>` }));
  const makeReport = input => ({ ...buildReport(history, input, now), sources: [], coverage: {} });
  const report = makeReport({ range: 'mtd' });
  const { get, server, requests } = await mountPanel(encodeReportWire(report), undefined, undefined, undefined, { serializedResponses: true });
  server.report = input => encodeReportWire(makeReport(input));
  assert.ok(requests.filter(r => ['usage.report', 'usage.refresh'].includes(r.method)).every(r => r.compact === true));
  assert.ok(requests.filter(r => !['usage.report', 'usage.refresh'].includes(r.method)).every(r => r.compact === undefined));
  assert.equal(get('token-total').textContent, '120.1K');
  assert.equal((get('session').innerHTML.match(/<option /g) || []).length, 1, 'closed filters create only All sessions');
  const before = requests.length;
  get('filters').open = true; get('filters').ontoggle();
  assert.equal((get('session').innerHTML.match(/<option /g) || []).length, 1002);
  assert.match(get('session').innerHTML, /&lt;Session 1000&gt;/);
  assert.equal(requests.length, before, 'opening a large filter list does not fetch history');
  get('session').value = 'lazy-1000';
  get('filters').open = false; get('filters').ontoggle();
  assert.equal(get('session').value, 'lazy-1000');
  assert.equal((get('session').innerHTML.match(/<option /g) || []).length, 2, 'collapse retains the selected session and All sessions');
  await get('session').onchange();
  assert.equal(get('token-total').textContent, '120');
  assert.equal(requests.at(-1).input.session, 'lazy-1000');
  assert.equal(get('session').value, 'lazy-1000');
});

test('Efficiency inspection can select a deferred session that has no mounted option yet', async () => {
  const { records, now } = await requestPanel();
  const history = Array.from({ length: 1001 }, (_, i) => ({ ...records[0], key: `inspect-${i}`, sessionId: `inspect-${i}`, sessionName: `Session ${i}` }));
  const report = { ...buildReport(history, {}, now), sources: [], coverage: {} };
  const target = { kind: 'growth', model: records[0].model, session: 'inspect-900', project: 'Unknown project', sessionName: 'Session 900', early: 1, late: 10, multiple: 10, samples: 6, requests: 6 };
  report.efficiency.insights = [target];
  const { get, requests } = await mountPanel(report);
  let selected = '';
  // Native selects reject values that have no option; the general fixture is permissive.
  Object.defineProperty(get('session'), 'value', { get: () => selected, set(value) {
    selected = value === '' || get('session').innerHTML.includes(`value="${value}"`) ? value : '';
  } });
  assert.doesNotMatch(get('session').innerHTML, /inspect-900/);
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  await get('efficiency-insights').onclick({ target: { closest: () => ({ dataset: { efficiencyInsight: '0' } }) } });
  assert.equal(get('breakdown-view').hidden, false);
  assert.equal(get('session').value, 'inspect-900');
  assert.equal(requests.at(-1).input.session, 'inspect-900');
  assert.match(get('session').innerHTML, /value="inspect-900"/);
});

test('Activity and When you work expand, inspect cached data, navigate by keyboard and restore focus', async () => {
  const { get, report, requests, document, server, listeners } = await requestPanel();
  const dialog = get('activity-dialog');
  dialog.close = () => { dialog.open = false; dialog.onclose(); };
  const requestsBefore = requests.length;
  get('activity-card').onclick();
  assert.equal(dialog.open, true);
  assert.equal(get('activity-title').textContent, 'Activity');
  assert.match(get('activity-caption').textContent, /26 weeks.*independent of the date dropdown/);
  assert.match(get('activity-detail').innerHTML, /AI credits|Model turns|Cache read/);
  assert.equal(get('activity-chart').querySelectorAll().length, 182);
  const key = key => { let prevented = false; const target = get('activity-chart').querySelectorAll().find(mark => mark.getAttribute('aria-pressed') === 'true'); get('activity-chart').onkeydown({ key, target, preventDefault() { prevented = true; } }); assert.equal(prevented, true); };
  key('Home'); assert.equal(document.activeElement.dataset.inspect, '0');
  key('ArrowRight'); assert.equal(document.activeElement.dataset.inspect, '7');
  key('ArrowDown'); assert.equal(document.activeElement.dataset.inspect, '8');
  key('End'); assert.equal(document.activeElement.dataset.inspect, '181');
  key('ArrowRight'); assert.equal(document.activeElement.dataset.inspect, '181');
  get('activity-close').onclick();
  assert.equal(document.activeElement, get('activity-expand'));
  get('rhythm-expand').onclick();
  assert.equal(get('activity-title').textContent, 'When you work');
  assert.equal(get('activity-chart').querySelectorAll().length, 168);
  key('Home'); key('ArrowDown'); key('ArrowRight');
  assert.equal(document.activeElement.dataset.inspect, '25');
  assert.match(get('activity-detail-title').textContent, /Monday.*01:00/);
  assert.match(get('activity-detail').innerHTML, /Share of recorded tokens/);
  const mark = get('activity-chart').querySelector('[data-inspect="157"]');
  get('activity-chart').onclick({ target: mark });
  assert.match(get('activity-detail-title').textContent, /Saturday.*13:00/);
  listeners.get('pointermove')({ target: mark });
  assert.equal(get('tip').hidden, true, 'dialog details replace the body-level tooltip');
  assert.equal(requests.length, requestsBefore, 'expanding and selecting do not fetch or rescan');
  mark.focus();
  await get('refresh').onclick();
  assert.equal(dialog.open, true); assert.equal(document.activeElement.dataset.inspect, '157');
  assert.match(get('activity-detail-title').textContent, /Saturday.*13:00/);
  get('activity-close').onclick(); assert.equal(document.activeElement, get('rhythm-expand'));
  server.report = () => ({ ...report, loading: { phase: 'recent' } });
  await get('refresh').onclick();
  assert.equal(get('activity-expand').disabled, true);
  get('activity-card').onclick(); assert.equal(dialog.open, false);
  get('rhythm-card').onclick(); assert.equal(dialog.open, true);
  assert.match(get('activity-caption').textContent, /history is still loading/);
  server.report = () => ({ loading: { phase: 'history' } });
  get('range').value = '90d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(dialog.open, false, 'a loading-only range cannot leave old details open');
  assert.equal(document.activeElement, get('range'));
});

test('expanded charts distinguish empty recorded slots from unavailable accounting', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const last = report.calendar.at(-1);
  Object.assign(last, { requests: 1, knownTokenRequests: 0, missingTokens: 1, credits: null, missingCredits: 1 });
  const { get, requests } = await mountPanel(report);
  const dialog = get('activity-dialog'); dialog.close = () => { dialog.open = false; dialog.onclose(); };
  const before = requests.length;
  get('activity-expand').onclick();
  assert.match(get('activity-detail').innerHTML, /<dt>Tokens<\/dt><dd>Unavailable<\/dd>/);
  assert.match(get('activity-detail').innerHTML, /<dt>AI credits<\/dt><dd>Unavailable<\/dd>/);
  get('activity-close').onclick(); get('rhythm-expand').onclick();
  assert.match(get('activity-detail').innerHTML, /<dt>Share of recorded tokens<\/dt><dd>—<\/dd>/);
  assert.doesNotMatch(get('activity-detail').innerHTML + get('activity-summary').innerHTML + get('activity-chart').innerHTML, /NaN|Infinity|undefined/);
  assert.equal(requests.length, before);
});

test('both Breakdown hierarchies share metric columns, headings, and accessible row controls', async () => {
  const { get, click, records, requests } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const html = () => get('breakdown').innerHTML;
  const layout = () => html().match(/<table[^>]*>/)[0] + html().match(/<colgroup>[\s\S]*?<\/colgroup>/)?.[0];
  const initialLayout = layout();
  const check = headings => {
    assert.equal((html().match(/<table\b/g) || []).length, 1, 'expanded metrics share the original table');
    assert.equal((html().match(/<thead>/g) || []).length, 1, 'one table head with section headings inside the body');
    const headers = [...html().matchAll(/<tr class="usage-header" data-depth="(\d)"[^>]*>([\s\S]*?)<\/tr>/g)];
    assert.deepEqual(headers.map(m => m[1]), headings.map((_, i) => String(i)));
    const labels = headers.map(([, , cells]) => [...cells.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(m => m[1]));
    assert.deepEqual(labels.map(row => row[0]), headings);
    for (const row of labels) assert.deepEqual(row.slice(1), ['User prompts', 'Input', 'Output', 'Reasoning', 'Cache read', 'Cache write', 'Avg. tokens / turn', 'Tokens', 'AI credits']);
    assert.equal(layout(), initialLayout, 'expansion does not recalculate column widths');
    const rows = [...html().matchAll(/<tr class="usage-row" data-depth="(\d)"[^>]*>([\s\S]*?)<\/tr>/g)];
    assert.deepEqual([...new Set(rows.map(m => m[1]))].sort(), headings.map((_, i) => String(i)));
    for (const [, , cells] of rows) assert.equal((cells.match(/<td\b/g) || []).length, 10);
    const ids = [...html().matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, 'row IDs remain unique across hierarchy levels');
    for (const [, controlled] of html().matchAll(/aria-controls="([^"]+)"/g)) {
      for (const id of controlled.split(' ')) assert.ok(ids.includes(id), `expanded control references an existing element: ${id}`);
    }
  };
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  await click({ requestSession: 's1' });
  check(['Model', 'Project', 'Session', 'Time']);
  await click({ requestId: records[0].key });
  check(['Model', 'Project', 'Session', 'Time']);
  assert.match(html(), /<tr class="usage-context" data-depth="4"[^>]*><td colspan="10"><div id="request-detail" class="request-detail"/);
  assert.match(html(), /Full original prompt/);
  get('group').value = 'projects'; get('group').onchange();
  await click({ projectName: records[0].project });
  await click({ projectSession: 's1' });
  check(['Project', 'Session', 'Model']);
  assert.doesNotMatch(html(), /id="request-detail"/);
  const before = requests.length;
  await click({ projectSession: 's1' });
  assert.equal(layout(), initialLayout);
  assert.equal(requests.length, before, 'collapse remains local');
});

test('refresh outages preserve expanded navigation and unchanged recovery clears the notice', async () => {
  const { get, click, server, intervals, report } = await requestPanel();
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  await click({ requestSession: 's1' });
  const expanded = get('breakdown').innerHTML;
  server.transportError = true;
  intervals[0].callback(); await new Promise(setImmediate);
  assert.equal(get('breakdown').innerHTML, expanded);
  await click({ requestSession: 's1' });
  assert.doesNotMatch(get('breakdown').innerHTML, /id="session-requests"/, 'collapse still works locally during an outage');
  assert.match(get('status').textContent, /last successful/i);
  server.transportError = false;
  server.report = () => ({ unchanged: true, generatedAt: report.generatedAt, scannedAt: report.generatedAt });
  intervals[0].callback(); await new Promise(setImmediate);
  assert.equal(get('status').hidden, true);
  assert.equal(get('content').hidden, false);
  assert.doesNotMatch(get('status').textContent, /last successful/i);
});

test('model sessions expand into matching request columns and on-demand original prompts', async () => {
  const { get, requests, click, server } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const html = () => get('breakdown').innerHTML;
  assert.equal(requests.filter(r => r.method === 'usage.requests' || r.method === 'usage.sessions').length, 0);
  await click({ requestModel: '<Sonnet>' });
  assert.match(html(), /data-model-project="Unknown project"/);
  assert.equal(requests.at(-1).method, 'usage.modelProjects');
  await click({ modelProject: 'Unknown project' });
  assert.match(html(), /data-request-session="s1" aria-expanded="false"/);
  assert.match(html(), /&lt;Session&gt;/);
  assert.equal(requests.at(-1).method, 'usage.sessions');
  assert.equal(requests.filter(r => r.method === 'usage.requests').length, 0);
  await click({ requestSession: 's1' });
  assert.match(html(), /28 model turns/);
  assert.match(html(), /1–25/);
  const headers = [...html().matchAll(/<thead>(.*?)<\/thead>/g)].map(([, h]) => [...h.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(([, text]) => text));
  assert.deepEqual(headers.map(h => h[0]), ['Model']);
  for (const h of headers) assert.deepEqual(h.slice(1), ['User prompts', 'Input', 'Output', 'Reasoning', 'Cache read', 'Cache write', 'Avg. tokens / turn', 'Tokens', 'AI credits']);
  assert.doesNotMatch(html(), /<th>Started by<\/th>|Full original prompt|<script/);
  assert.equal(requests.at(-1).input.session, 's1');
  await click({ requestPage: '25' });
  assert.match(html(), /26–28/);
  const requestId = JSON.stringify(['receipt', 's1', 'call-7']);
  await click({ requestId });
  assert.match(html(), /Original prompt/);
  assert.match(html(), /&lt;script&gt;unsafe\(\)&lt;\/script&gt; Full original prompt/);
  assert.doesNotMatch(html(), /request-metrics|<script/);
  const count = requests.length;
  await click({ requestId });
  await click({ requestId });
  assert.equal(requests.length, count, 'reopening a prompt in the same page uses its bounded cache');
  const original = server.requestPage;
  server.requestPage = input => ({ ...original(input), rows: original(input).rows.map(r => ({ ...r, prompt: { available: false, text: '', truncated: false } })) });
  await get('refresh').onclick(); await new Promise(setImmediate);
  assert.match(html(), /26–28/);
  assert.match(html(), /Prompt unavailable: the local log/);
  assert.doesNotMatch(html(), /Full original prompt/);
  get('session').value = 'another-session'; await get('session').onchange();
  assert.doesNotMatch(html(), /data-request-session|model requests|Original prompt/);
});

test('nested expansion retries failures and ignores late prompt and session responses', async () => {
  const { get, server, click } = await requestPanel();
  server.sessionError = '<Session failed>';
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  assert.match(get('breakdown').innerHTML, /Could not load sessions: &lt;Session failed&gt;/);
  server.sessionError = '';
  await click({ modelSessionPage: '0' });
  server.requestError = '<Request failed>';
  await click({ requestSession: 's1' });
  assert.match(get('breakdown').innerHTML, /Could not load requests: &lt;Request failed&gt;/);
  server.requestError = '';
  await click({ requestPage: '0' });
  const original = server.requestPage;
  let resolve;
  server.requestPage = input => new Promise(done => { resolve = () => done(original(input)); });
  const loading = click({ requestId: JSON.stringify(['receipt', 's1', 'call-0']) });
  await new Promise(setImmediate);
  assert.match(get('breakdown').innerHTML, /Loading original prompt/);
  await click({ requestSession: 's1' });
  resolve(); await loading;
  assert.doesNotMatch(get('breakdown').innerHTML, /Full original prompt|Original prompt/);
  await click({ requestModel: '<Sonnet>' });
  const sessions = server.sessionPage;
  server.sessionPage = input => new Promise(done => { resolve = () => done(sessions(input)); });
  await click({ requestModel: '<Sonnet>' });
  const reopening = click({ modelProject: 'Unknown project' });
  await new Promise(setImmediate);
  get('project').value = 'different-project'; await get('project').onchange();
  resolve(); await reopening;
  assert.doesNotMatch(get('breakdown').innerHTML, /data-request-session|model requests|Original prompt/);
});

test('request paging keeps keyboard focus during loading and moves to an enabled control at page edges', async () => {
  const { get, server, click, document } = await requestPanel();
  const node = get('breakdown');
  let markup = node.innerHTML, buttons = [];
  document.body = { dataset: {} };
  Object.defineProperty(node, 'innerHTML', { get: () => markup, set(value) {
    if (buttons.includes(document.activeElement)) document.activeElement = document.body;
    markup = value;
    buttons = [...value.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => ({
      dataset: Object.fromEntries([...attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      disabled: /\sdisabled(?:\s|$)/.test(attrs), focus() { if (!this.disabled) document.activeElement = this; },
    }));
  } });
  node.querySelectorAll = selector => selector === 'button' ? buttons : [];
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  await click({ requestSession: 's1' });
  const original = server.requestPage;
  let resolve;
  server.requestPage = input => new Promise(done => { resolve = () => done(original(input)); });
  for (const [direction, offset, expected] of [['next', '25', 'previous'], ['previous', '0', 'next']]) {
    buttons.find(b => b.dataset.requestPageDirection === direction).focus();
    const loading = click({ requestPage: offset, requestPageDirection: direction });
    await new Promise(setImmediate);
    assert.equal(document.activeElement.dataset.requestPageDirection, direction, 'loading does not remove focus');
    assert.equal(document.activeElement.disabled, false);
    resolve(); await loading;
    assert.equal(document.activeElement.dataset.requestPageDirection, expected, 'page edge restores focus to an enabled paging action');
    assert.equal(document.activeElement.disabled, false);
  }
});

test('model sessions page independently, sort before paging, and discard removed descendants on refresh', async () => {
  const { get, report, records, now, server, requests, click } = await requestPanel();
  let history = Array.from({ length: 52 }, (_, i) => ({ ...records[0], key: `r-${i}`, sessionId: `s${i}`,
    sessionName: `Session ${String(i).padStart(2, '0')}`, output: i, nanoAiu: (52 - i) * 1e9 }));
  Object.assign(report, buildReport(history, {}, now));
  server.sessionPage = input => buildModelSessionPage(history, input, now);
  server.requestPage = input => buildRequestPage(history, input, now);
  await get('refresh').onclick();
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  const html = () => get('breakdown').innerHTML;
  const ids = () => [...html().matchAll(/data-request-session="([^"]+)"/g)].map(([, id]) => id);
  assert.equal(ids().length, 25); assert.equal(ids()[0], 's51');
  await click({ requestSession: 's51' });
  assert.match(html(), /1 model turn/);
  assert.equal(requests.at(-1).input.session, 's51');
  await click({ modelSessionPage: '25' });
  assert.equal(ids()[0], 's26');
  assert.doesNotMatch(html(), /id="session-requests"/);
  await click({ modelSessionPage: '50' });
  assert.deepEqual(ids(), ['s1', 's0']);
  await click({ requestSession: 's1' });
  get('sort').value = 'credits'; await get('sort').onchange();
  assert.equal(requests.at(-1).input.sort, 'credits'); assert.equal(ids()[0], 's0');
  assert.doesNotMatch(html(), /id="session-requests"/);
  await click({ modelSessionPage: '50' });
  await click({ requestSession: 's51' });
  history = [{ ...history[0], sessionName: '<Renamed session>' }];
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick(); await new Promise(setImmediate);
  assert.deepEqual(ids(), ['s0']);
  assert.match(html(), /&lt;Renamed session&gt;/);
  assert.doesNotMatch(html(), /id="session-requests"|<Renamed session>/);
});

test('model projects page independently and scope same-ID sessions, calls, and prompt details to the selected project', async () => {
  const { get, records, report, now, server, requests, click } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  let history = Array.from({ length: 28 }, (_, i) => ({ ...records[0], key: `project-call-${i}`, project: `Project ${String(i).padStart(2, '0')}`,
    sessionId: 'shared-session', sessionName: 'Same session', output: i, nanoAiu: (28 - i) * 1e9 }));
  Object.assign(report, buildReport(history, {}, now));
  report.models[0].userPrompts = 2;
  server.modelProjects = input => buildModelProjectPage(history, input, now);
  server.sessionPage = input => buildModelSessionPage(history, input, now);
  server.requestPage = input => buildRequestPage(history, input, now);
  await get('refresh').onclick();
  const html = () => get('breakdown').innerHTML;
  assert.match(html(), /28 model turns[^>]*>2<\/td>/, 'shows the human count, with model turns kept only in the tooltip');
  assert.doesNotMatch(html(), /<th[^>]*>Requests<\/th>/);
  await click({ requestModel: '<Sonnet>' });
  const projects = () => [...html().matchAll(/data-model-project="([^"]+)"/g)].map(m => m[1]);
  assert.equal(projects().length, 25); assert.equal(projects()[0], 'Project 27');
  await click({ modelProject: 'Project 27' });
  assert.equal(requests.at(-1).input.project, 'Project 27');
  await click({ requestSession: 'shared-session' });
  assert.equal(requests.at(-1).input.project, 'Project 27');
  assert.match(html(), /1 model turn</);
  await click({ requestId: 'project-call-27' });
  assert.equal(requests.at(-1).input.project, 'Project 27');
  await click({ modelProjectPage: '25' });
  assert.deepEqual(projects(), ['Project 02', 'Project 01', 'Project 00']);
  assert.doesNotMatch(html(), /id="model-sessions"|id="session-requests"|id="request-detail"/);
  await click({ modelProject: 'Project 01' });
  await click({ requestSession: 'shared-session' });
  assert.equal(requests.at(-1).input.project, 'Project 01');
  history = [history[0]];
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick(); await new Promise(setImmediate);
  assert.deepEqual(projects(), ['Project 00']);
  assert.doesNotMatch(html(), /id="model-sessions"|id="session-requests"/);
  get('model').value = 'another'; await get('model').onchange();
  assert.doesNotMatch(html(), /data-model-project=/, 'filter changes reset the hierarchy');
});

test('model project loading can retry and late responses cannot reopen a collapsed model', async () => {
  const { get, server, click } = await requestPanel();
  server.modelProjectsError = '<Projects failed>';
  await click({ requestModel: '<Sonnet>' });
  assert.match(get('breakdown').innerHTML, /Could not load projects: &lt;Projects failed&gt;/);
  server.modelProjectsError = '';
  await click({ modelProjectPage: '0' });
  assert.match(get('breakdown').innerHTML, /data-model-project=/);
  await click({ requestModel: '<Sonnet>' });
  let resolve;
  const original = server.modelProjects;
  server.modelProjects = input => new Promise(done => { resolve = () => done(original(input)); });
  const loading = click({ requestModel: '<Sonnet>' });
  await new Promise(setImmediate);
  await click({ requestModel: '<Sonnet>' });
  resolve(); await loading;
  assert.doesNotMatch(get('breakdown').innerHTML, /id="model-projects"/);
});

test('project sessions expand and page locally, sort the full set, and reset or clamp pages as needed', async () => {
  const { get, report, records, now, requests, click, document, server } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const sessions = Array.from({ length: 52 }, (_, i) => ({ ...records[0], key: `request-${i}`, sessionId: `session-${i}`,
    sessionName: `Session ${String(i).padStart(2, '0')}`, output: i, inputTotal: 100, input: 30 }));
  Object.assign(report, buildReport(sessions, {}, now));
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  const node = get('breakdown');
  let markup = node.innerHTML, buttons = [];
  document.body = { dataset: {} };
  Object.defineProperty(node, 'innerHTML', { get: () => markup, set(value) {
    if (buttons.includes(document.activeElement)) document.activeElement = document.body;
    markup = value;
    buttons = [...value.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => ({
      dataset: Object.fromEntries([...attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      disabled: /\sdisabled(?:\s|$)/.test(attrs), focus() { if (!this.disabled) document.activeElement = this; },
    }));
  } });
  node.querySelectorAll = selector => selector === 'button' ? buttons : [];
  get('sort').value = 'total'; get('sort').onchange();
  const html = () => node.innerHTML;
  const rowCount = () => [...html().matchAll(/<tr class="usage-row" data-depth="1"/g)].length;
  const before = requests.length;
  assert.doesNotMatch(html(), /<th>Session<\/th>/);
  const project = sessions[0].project;
  buttons.find(b => b.dataset.projectName === project).focus();
  await click({ projectName: project });
  assert.equal(document.activeElement.dataset.projectName, project, 'expanding keeps the project toggle focused');
  server.sessionModels = input => buildSessionModels(sessions, input, now);
  buttons.find(b => b.dataset.projectSession === 'session-51').focus();
  await click({ projectSession: 'session-51' });
  assert.equal(document.activeElement.dataset.projectSession, 'session-51', 'opening models preserves session focus');
  await click({ projectSession: 'session-51' });
  assert.equal(document.activeElement.dataset.projectSession, 'session-51', 'collapsing models preserves session focus');
  assert.match(html(), /52 sessions/);
  assert.match(html(), /1–25/);
  assert.equal(rowCount(), 25);
  assert.match(html(), /Session 51/);
  assert.doesNotMatch(html(), /Session 00/);
  await click({ sessionPage: '25' });
  assert.match(html(), /26–50/);
  buttons.find(b => b.dataset.sessionPageDirection === 'next').focus();
  await click({ sessionPage: '50' });
  assert.match(html(), /51–52/);
  assert.equal(rowCount(), 2);
  assert.equal(document.activeElement.dataset.sessionPageDirection, 'previous');
  assert.equal(requests.length, before + 1, 'only the model expansion makes an API request');
  get('sort').value = 'output'; get('sort').onchange();
  assert.match(html(), /1–25/);
  await click({ sessionPage: '50' });
  Object.assign(report, buildReport(sessions.slice(0, 30), {}, now));
  await get('refresh').onclick();
  assert.match(html(), /26–30/);
  assert.equal(rowCount(), 5);
  get('range').value = '1d'; get('range').onchange();
  await new Promise(setImmediate);
  assert.doesNotMatch(html(), /id="project-sessions"/);
  await click({ projectName: project });
  assert.match(html(), /1–25/);
  await click({ sessionPage: '25' });
  buttons.find(b => b.dataset.sessionPageDirection === 'previous').focus();
  Object.assign(report, buildReport(sessions.slice(0, 2), {}, now));
  await get('refresh').onclick();
  assert.equal(rowCount(), 2);
  assert.doesNotMatch(html(), /data-session-page/);
  assert.equal(document.activeElement.dataset.projectName, project, 'focus returns to the project when paging controls disappear');
  await click({ projectName: project });
  assert.doesNotMatch(html(), /id="project-sessions"/);
  assert.equal(document.activeElement.dataset.projectName, project, 'collapse preserves focus');
});

test('project expansion isolates sessions, escapes names, and shares metric columns and shading', async () => {
  const { get, report, records, now, click, requests } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const projects = [
    { ...records[0], key: 'a1', project: '<Project "A">', sessionId: 'a1', sessionName: '<Session A>' },
    { ...records[0], key: 'b1', project: 'Project B', sessionId: 'b1', sessionName: 'Session B' },
  ];
  Object.assign(report, buildReport(projects, {}, now));
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  const before = requests.length, html = () => get('breakdown').innerHTML;
  await click({ projectName: projects[0].project });
  assert.match(html(), /data-project-name="&lt;Project &quot;A&quot;&gt;" aria-expanded="true" aria-controls="project-sessions [^"]+"/);
  assert.match(html(), /id="project-sessions" class="request-list"/);
  assert.match(html(), /&lt;Session A&gt;/);
  assert.doesNotMatch(html(), /Session B|<Session A>|<Project/);
  const headers = [...html().matchAll(/<thead>([\s\S]*?)<\/thead>/g)].map(([, value]) => value.replace(/<th>[^<]+<\/th>/, ''));
  assert.equal(headers.length, 1, 'projects and sessions share the same header');
  await click({ projectName: 'Project B' });
  assert.match(html(), /Session B/);
  assert.doesNotMatch(html(), /&lt;Session A&gt;/);
  report.sessions.find(s => s.id === 'b1').name = 'Renamed session';
  await get('refresh').onclick();
  assert.match(html(), /Renamed session/);
  assert.equal(requests.length, before + 2, 'explicit refresh loads usage and inventory independently');
  Object.assign(report, buildReport(projects.slice(0, 1), {}, now));
  await get('refresh').onclick();
  assert.doesNotMatch(html(), /id="project-sessions"/);
  await click({ projectName: projects[0].project });
  get('group').value = 'models'; get('group').onchange();
  assert.doesNotMatch(html(), /id="project-sessions"/);
  assert.match(html(), /data-request-model=/);
  get('group').value = 'projects'; get('group').onchange();
  assert.doesNotMatch(html(), /id="project-sessions"/);
});

test('project sessions expand into filtered model metrics, sort locally, and refresh without prompt reads', async () => {
  const { get, report, records, now, server, click, requests } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const history = [
    { ...records[0], key: 'a', project: '<Project>', sessionId: 's1', sessionName: '<Session>', model: '<Model A>', output: 500, nanoAiu: 1e9 },
    { ...records[0], key: 'b', project: '<Project>', sessionId: 's1', sessionName: '<Session>', model: '<Model B>', nanoAiu: 2e9 },
    { ...records[0], key: 'c', project: 'Other', sessionId: 's1', model: 'Excluded project' },
    { ...records[0], key: 'd', project: '<Project>', sessionId: 's2', sessionName: 'Other session', model: 'Excluded session' },
  ];
  server.sessionModels = input => buildSessionModels(history, input, now);
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  const html = () => get('breakdown').innerHTML;
  await click({ projectName: '<Project>' });
  const before = requests.length;
  await click({ projectSession: 's1' });
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).method, 'usage.sessionModels');
  assert.equal(requests.at(-1).input.project, '<Project>');
  assert.equal(requests.at(-1).input.session, 's1');
  assert.match(html(), /data-project-session="s1" aria-expanded="true" aria-controls="session-models [^"]+"/);
  assert.match(html(), /id="session-models" class="request-list" aria-label="Models for &lt;Session&gt;"/);
  assert.match(html(), /2 models/);
  assert.match(html(), /&lt;Model A&gt;/);
  assert.match(html(), /&lt;Model B&gt;/);
  assert.doesNotMatch(html(), /Excluded project|Excluded session|<Model|data-request-model|data-request-session|data-request-id/);
  const headers = [...html().matchAll(/<tr class="usage-header"[^>]*><th[^>]*>[^<]*<\/th>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  assert.equal(headers.length, 3);
  assert.ok(headers.every(h => h === headers[0]));
  const modelNames = () => [...html().slice(html().indexOf('id="session-models"')).matchAll(/<tr class="usage-row" data-depth="2"[^>]*><td class="text-cell"[^>]*><span[^>]*>(.*?)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(modelNames(), ['&lt;Model A&gt;', '&lt;Model B&gt;']);
  const beforeSort = requests.length;
  get('sort').value = 'credits'; get('sort').onchange();
  assert.deepEqual(modelNames(), ['&lt;Model B&gt;', '&lt;Model A&gt;']);
  assert.equal(requests.length, beforeSort, 'model sorting is local');
  history.push({ ...history[0], key: 'new', model: 'New model' });
  Object.assign(report, buildReport(history, {}, now));
  await get('refresh').onclick(); await new Promise(setImmediate);
  assert.match(html(), /3 models/);
  assert.match(html(), /New model/);
  assert.ok(!requests.some(r => r.method === 'usage.requests'), 'no prompt reads or request fetches');
  get('model').value = '<Model A>'; get('cache').checked = false;
  get('model').onchange(); await new Promise(setImmediate);
  assert.doesNotMatch(html(), /id="session-models"/);
  await click({ projectName: '<Project>' }); await click({ projectSession: 's1' });
  assert.deepEqual(requests.at(-1).input.models, ['<Model A>']);
  assert.equal(requests.at(-1).input.includeCache, false);
  assert.match(html(), /1 model<\/strong>/);
});

test('project session model loading retries and ignores stale results after collapse or switching groups', async () => {
  const { get, records, server, click } = await requestPanel();
  get('group').value = 'projects'; get('group').onchange();
  const html = () => get('breakdown').innerHTML;
  await click({ projectName: records[0].project });
  server.sessionModelsError = '<offline>';
  await click({ projectSession: 's1' });
  assert.match(html(), /Could not load models: &lt;offline&gt;/);
  assert.match(html(), /data-session-model-retry="true"/);
  server.sessionModelsError = '';
  await click({ projectSession: 's1', sessionModelRetry: 'true' });
  assert.match(html(), /&lt;Sonnet&gt;/);
  await click({ projectSession: 's1' });
  assert.doesNotMatch(html(), /id="session-models"/);
  let resolve;
  server.sessionModels = () => new Promise(r => { resolve = r; });
  const pending = click({ projectSession: 's1' }); await new Promise(setImmediate);
  assert.match(html(), /Loading session models/);
  await click({ projectName: records[0].project });
  await click({ projectName: records[0].project });
  resolve({ rows: [{ name: 'Stale model' }] }); await pending;
  assert.doesNotMatch(html(), /Stale model|id="session-models"/);
  const later = click({ projectSession: 's1' }); await new Promise(setImmediate);
  get('group').value = 'models'; get('group').onchange();
  resolve({ rows: [{ name: 'Stale model' }] }); await later;
  assert.doesNotMatch(html(), /Stale model|id="session-models"/);
  assert.match(html(), /data-request-model=/);
  get('group').value = 'projects'; get('group').onchange();
  await click({ projectName: records[0].project });
  server.sessionModels = () => ({ rows: [] });
  await click({ projectSession: 's1' });
  assert.match(html(), /No matching models remain/);
});

test('project session models close on paging and when refresh removes the selected session', async () => {
  const { get, records, report, now, server, click } = await requestPanel();
  const history = Array.from({ length: 26 }, (_, i) => ({ ...records[0], key: `r${i}`, sessionId: `s${i}`, sessionName: `Session ${i}`, output: 100 - i }));
  Object.assign(report, buildReport(history, {}, now));
  server.sessionModels = input => buildSessionModels(history, input, now);
  await get('refresh').onclick();
  get('group').value = 'projects'; get('group').onchange();
  await click({ projectName: records[0].project }); await click({ projectSession: 's0' });
  assert.match(get('breakdown').innerHTML, /id="session-models"/);
  await click({ sessionPage: '25' });
  assert.doesNotMatch(get('breakdown').innerHTML, /id="session-models"/);
  await click({ projectSession: 's25' });
  assert.match(get('breakdown').innerHTML, /id="session-models"/);
  Object.assign(report, buildReport(history.slice(0, 5), {}, now));
  await get('refresh').onclick();
  assert.doesNotMatch(get('breakdown').innerHTML, /id="session-models"/);
});


test('dashboard keeps skill and request metrics separate from MCP activity', async () => {
  const now = new Date(2026, 10, 13, 22, 49, 37), timestamp = now.toISOString();
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  const events = [
    { type: 'session.usage_record', id: 'u1', timestamp, data: { usage: { provider: { kind: 'copilot' }, model: 'model-a', inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 60, cacheWriteTokens: 10 } } },
    ...['user-invoked', 'user-invoked', 'agent-invoked', 'context-load', undefined].map((trigger, i) => ({ type: 'skill.invoked', id: `s${i}`, timestamp, data: { name: '<hello-test>', path: '/skills/hello/SKILL.md', pluginName: '<team-tools>', pluginVersion: '2.0', trigger } })),
    ...[true, false, null].flatMap((success, i) => [
      { type: 'tool.execution_start', id: `start-${i}`, timestamp, data: { toolName: '<view>', toolCallId: `c${i}`, model: 'model-a' } },
      ...(success === null ? [] : [{ type: 'tool.execution_complete', id: `end-${i}`, timestamp, data: { toolCallId: `c${i}`, success } }]),
    ]),
  ];
  events.forEach(e => parser.push(JSON.stringify(e)));
  const snapshot = parser.snapshot();
  snapshot.records[0].sessionName = '<Planning "work">';
  const report = { ...buildReport(snapshot.records, { range: '1d' }, now, snapshot), sources: [], coverage: {} };
  report.skills.rows[0].installedVersion = { value: '1.0.1', status: 'available' };
  const { get, nodes, requests } = await mountPanel(report, undefined, undefined, undefined, { serializedResponses: true });
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.ok(get('skills').innerHTML.includes('&lt;hello-test&gt;'), get('status').textContent);
  const headers = [...get('skills').innerHTML.matchAll(/<th(?:\s[^>]*)?>(.*?)<\/th>/g)].map(([, value]) => value);
  assert.deepEqual(headers, ['Skill', 'Uses', 'By user', 'By agent', 'Sessions', 'Failures', 'Skill version (installed)', 'Last used']);
  const cells = [...get('skills').innerHTML.matchAll(/<td(?:\s[^>]*)?>(.*?)<\/td>/g)].map(([, value]) => value.replace(/<\/?span[^>]*>/g, ''));
  assert.equal(cells.length, headers.length);
  assert.deepEqual(cells.slice(1, 7), ['5', '2', '1', '1', '0', '1.0.1']);
  assert.equal(cells.at(-1), '11/13/26, 10:49 PM');
  assert.equal(get('skills-summary').textContent, '5 uses · 0 failures · 1 session · Today');
  assert.ok(get('skills').innerHTML.includes(`title="${now.toLocaleString()}"`), 'full timestamp stays available on hover');
  assert.match(get('skills').innerHTML, /title="By user: 2; By agent: 1; Preloaded: 1; Unknown: 1"/);
  assert.doesNotMatch(get('skills').innerHTML, /Reasoning|Success rate|<th[^>]*>Projects<|<hello-test>/);
  assert.ok(!nodes.has('skill-details'));
  await get('refresh').onclick();
  assert.doesNotMatch(get('skills').innerHTML, /Source plugin|Plugin version/);
  assert.match(get('breakdown').innerHTML, /Reasoning/);
  assert.match(get('breakdown').innerHTML, /Avg\. tokens \/ turn/);
  assert.ok(!nodes.has('tools'));
  assert.doesNotMatch(get('mcp').innerHTML, /&lt;view&gt;/);
  assert.match(get('session').innerHTML, /value="s1"[^>]*>&lt;Planning &quot;work&quot;&gt;<\/option>/);
  get('group').value = 'projects';
  get('group').onchange();
  await get('breakdown').onclick({ target: { closest: () => ({ dataset: { projectName: report.projects[0].name } }) } });
  assert.match(get('breakdown').innerHTML, / &lt;Planning &quot;work&quot;&gt;<\/button>/);
  assert.match(get('breakdown').innerHTML, /title="[^"]*s1[^"]*"/);
  get('session').value = 's1';
  await get('session').onchange();
  assert.equal(requests.at(-1).input.session, 's1');
  report.sessions[0].name = report.options.sessions[0].name = 'Renamed session';
  await get('refresh').onclick();
  assert.equal(get('session').value, 's1');
  assert.match(get('session').innerHTML, />Renamed session<\/option>/);
});

test('skills table keeps eight aligned columns and makes unresolved failures readable without folder actions', async () => {
  const { get, report, records, now } = await requestPanel();
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const parser = createReceiptParser({ sessionId: 's1', source: 'fixture' });
  const timestamp = now.toISOString(), missingName = '<missing-skill-with-a-long-requested-name>';
  const events = [{ type: 'skill.invoked', id: 'success', timestamp, data: { name: 'known', trigger: 'user-invoked', path: '/skills/known/SKILL.md' } },
    ...['known', missingName].flatMap((name, i) => [
      { type: 'tool.execution_start', id: `start-${i}`, timestamp, data: { toolName: 'skill', toolCallId: `load-${i}`, arguments: { skill: name } } },
      { type: 'tool.execution_complete', id: `end-${i}`, timestamp, data: { toolCallId: `load-${i}`, success: false } },
    ])];
  events.forEach(e => parser.push(JSON.stringify(e)));
  report.skills = buildReport(records, {}, now, parser.snapshot()).skills;
  await get('refresh').onclick();
  const html = get('skills').innerHTML;
  assert.ok(html.includes('title="Recorded failed attempts to load this skill.">Failures</th>'));
  const rows = [...html.matchAll(/<tbody><tr>(.*?)<\/tr><\/tbody>/g)].map(([, row]) => row);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.split('<td').length - 1, 8, 'every row keeps a cell beneath each header');
  assert.ok(rows[0].includes('data-skill-action="toggle"'));
  assert.ok(rows[1].includes('&lt;missing-skill-with-a-long-requested-name&gt;'));
  assert.ok(rows[1].includes('(unresolved)'));
  assert.ok(rows[1].includes('data-skill-action="toggle"'), 'missing locations can still expand project statistics');
  assert.ok(!rows[1].includes('data-skill-action="copy"'), 'missing locations have no copy action');
  assert.ok(rows[1].includes('<td>0</td><td>0</td><td>1</td><td>1</td>'), 'failure-only row shows zero trigger counts, one session, and one failure');
  assert.ok(get('skills-summary').textContent.includes('2 failures'));
  assert.ok(!html.includes('<th>Projects</th>'));
});

test('MCP and plugin tables distinguish live inventory from filtered usage and escape metadata', async () => {
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {} };
  const history = { calls: 3, omitted: 0, rows: [{ name: '<server>', calls: 3, successes: 1, failures: 1, unknown: 1, successRate: 50, lastUsed: '2026-11-14T03:00:00Z' }] };
  report.mcp = mergeMcpInventory(history, { available: true, sessionId: 'current', rows: [
    { name: '<server>', status: 'failed', error: '<connection failed>', source: 'plugin', plugin: '<supplier>', version: '1.0' },
    { name: 'unused', status: 'connected' },
  ] });
  report.plugins = { available: true, rows: [
    { name: '<test-plugin>', version: '1.0', marketplace: '<marketplace>', enabled: true, installed: true, managed: false },
    { name: 'Disabled plugin', enabled: false, installed: true },
    { name: 'Managed pending', enabled: true, installed: false, managed: true },
  ] };
  const { get } = await mountPanel(report);
  assert.match(get('mcp').innerHTML, /&lt;server&gt;/);
  assert.match(get('mcp').innerHTML, /50%/);
  assert.match(get('mcp').innerHTML, /Connected/);
  assert.match(get('mcp').innerHTML, /&lt;connection failed&gt;/);
  assert.match(get('mcp').innerHTML, /&lt;supplier&gt;/);
  assert.match(get('mcp').innerHTML, /Unknown outcomes: 1/);
  assert.match(get('mcp-note').textContent, /current session/);
  assert.match(get('plugins').innerHTML, /&lt;test-plugin&gt;/);
  assert.match(get('plugins').innerHTML, /&lt;marketplace&gt;/);
  assert.match(get('plugins').innerHTML, /Disabled/);
  assert.match(get('plugins').innerHTML, /Not installed/);
  assert.match(get('plugins').innerHTML, /Managed/);
  assert.doesNotMatch(get('mcp').innerHTML + get('plugins').innerHTML, /<server>|<supplier>|<test-plugin>|<marketplace>/);
  report.mcp = mergeMcpInventory(history, { available: false, rows: [] });
  report.plugins = { available: false, rows: [] };
  await get('refresh').onclick();
  await new Promise(setImmediate);
  assert.match(get('mcp').innerHTML, /Unavailable/);
  assert.match(get('mcp').innerHTML, /50%/);
  assert.match(get('plugins').innerHTML, /unavailable/i);
});

test('skills expand aligned project statistics locally, preserve focus and refresh, and keep copying separate', async () => {
  const timestamp = new Date().toISOString();
  const counts = { invocations: 3, failures: 1, triggers: { manual: 2, agent: 1, preloaded: 0, unknown: 0 }, sessions: 2, lastUsed: timestamp };
  const longProject = '<project & ' + 'long-'.repeat(30) + '>';
  const known = { id: 'known', name: 'Known <skill>', path: 'C:\\skills\\known\\SKILL.md', plugin: 'team-tools', version: '2.0',
    installedVersion: { value: '1.0', status: 'available' }, ...counts, projectRows: [{ name: longProject, ...counts }] };
  const unknown = { id: 'unknown', name: 'Missing skill', unresolved: true, ...counts, invocations: 0,
    projectRows: [{ name: 'Failure project', ...counts, invocations: 0 }] };
  const report = { ...buildReport([], {}), sources: [], coverage: {}, skills: { invocations: 3, failures: 2, sessions: 2, rows: [known, unknown] } };
  const { get, requests, server, document } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const requestsBefore = requests.length;
  let focusCount = 0;
  const button = (skillId, skillAction = 'toggle') => ({ dataset: { skillId, skillAction }, setAttribute() {}, removeAttribute() {},
    focus() { focusCount++; document.activeElement = this; } });
  const toggle = button('known'), copy = button('known', 'copy'), unresolved = button('unknown');
  get('skills').querySelectorAll = () => [toggle, copy, unresolved].filter(control => report.skills.rows.some(skill => skill.id === control.dataset.skillId));
  const click = async control => { document.activeElement = control; await get('skills').onclick({ target: { closest: () => control } }); };
  assert.doesNotMatch(get('skills').innerHTML, /skill-project-rows|data-skill-action="open"/);
  await click(toggle);
  let html = get('skills').innerHTML;
  assert.match(html, /aria-expanded="true" aria-controls="skill-project-rows"/);
  assert.match(html, /id="skill-project-rows" class="skill-projects"/);
  assert.match(html, /aria-label="Projects for Known &lt;skill&gt;"/);
  assert.match(html, /<th scope="col">Project<\/th>/);
  assert.ok(html.includes('&lt;project &amp; '));
  assert.doesNotMatch(html, /<project|<skill>/);
  assert.equal((html.match(/<table>/g) || []).length, 1, 'expanded rows share the original table columns');
  const body = html.split('class="skill-projects"')[1].split('</tbody>')[0];
  assert.equal((body.match(/<th /g) || []).length, 8);
  assert.equal((body.match(/<td(?:\s|>)/g) || []).length, 8);
  assert.ok(focusCount > 0);
  assert.equal(document.activeElement, toggle);
  await click(copy);
  assert.deepEqual(server.copied, ['C:\\skills\\known']);
  assert.match(get('skills').innerHTML, /skill-project-rows/, 'copying does not collapse the skill');
  server.clipboardError = true;
  await click(copy);
  assert.match(get('skill-folder-status').textContent, /Could not copy folder path/);
  get('skills-sort').value = 'failures'; get('skills-sort').onchange();
  assert.match(get('skills').innerHTML, /skill-project-rows/, 'sort keeps the expanded skill');
  await click(toggle);
  assert.doesNotMatch(get('skills').innerHTML, /skill-project-rows/);
  await click(unresolved);
  assert.match(get('skills').innerHTML, /Failure project/);
  assert.doesNotMatch(get('skills').innerHTML, /aria-label="Copy folder path for Missing skill"/);
  assert.equal(requests.length, requestsBefore, 'expanding, sorting and copying issue no API calls');
  await click(toggle);
  known.projectRows[0].invocations = 4;
  await get('refresh').onclick();
  assert.match(get('skills').innerHTML, /skill-project-rows/);
  assert.match(get('skills').innerHTML, /title="By user: 2; By agent: 1; Preloaded: 0; Unknown: 0">4<\/td>/);
  get('range').value = '7d'; get('range').onchange(); await new Promise(setImmediate);
  assert.doesNotMatch(get('skills').innerHTML, /skill-project-rows/, 'changing filters closes the old breakdown');
  await click(toggle);
  report.skills.rows = [unknown];
  await get('refresh').onclick();
  assert.doesNotMatch(get('skills').innerHTML, /skill-project-rows/);
  assert.equal(document.activeElement, get('skills-sort'), 'removed skills leave focus on the sort control');
  assert.ok(!requests.some(r => r.method === 'skills.openFolder'));
});

test('detail panels sort independently and preserve choices and report data across refreshes', async () => {
  const older = '2026-11-13T10:00:00Z', newer = '2026-11-14T10:00:00Z';
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {} };
  report.skills = { invocations: 16, sessions: 8, rows: [
    { id: 'a', name: 'Alpha skill', invocations: 2, sessions: 2, projects: 1, lastUsed: newer },
    { id: 'z', name: 'Zulu skill', invocations: 12, sessions: 1, projects: 1, lastUsed: older },
    { id: 'b', name: 'Beta skill', invocations: 2, sessions: 5, projects: 1, lastUsed: older },
  ] };
  report.mcp = { available: true, calls: 12, rows: [
    { name: 'Alpha server', displayName: 'Omega server', calls: 0, failures: 0, successes: 0, unknown: 0, successRate: null, lastUsed: null },
    { name: 'Zulu server', calls: 10, failures: 0, successes: 10, unknown: 0, successRate: 100, lastUsed: older },
    { name: 'Beta server', calls: 2, failures: 1, successes: 1, unknown: 0, successRate: 50, lastUsed: newer },
  ] };
  report.plugins = { available: true, rows: [
    { name: 'Zulu plugin', enabled: true, installed: true, marketplace: 'Alpha marketplace' },
    { name: 'Alpha plugin', enabled: false, installed: true, marketplace: 'Zulu marketplace' },
    { name: 'Beta plugin', enabled: true, installed: false, source: 'builtin' },
  ] };
  const original = structuredClone(report);
  const { get, requests } = await mountPanel(report);
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  const names = id => [...get(id).innerHTML.matchAll(/<tr><td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => id === 'mcp' ? cell.match(/<summary[^>]*>(.*?)<\/summary>/)[1] : cell.replace(/<span aria-hidden="true">.*?<\/span> /g, '').replace(/<[^>]*>/g, ''));
  const sort = (id, key) => { get(`${id}-sort`).value = key; get(`${id}-sort`).onchange(); };
  assert.deepEqual(names('skills'), ['Zulu skill', 'Alpha skill', 'Beta skill']);
  assert.deepEqual(names('plugins'), ['Alpha plugin', 'Beta plugin', 'Zulu plugin']);
  assert.deepEqual(names('mcp'), ['Zulu server', 'Beta server', 'Omega server']);
  sort('skills', 'name'); assert.deepEqual(names('skills'), ['Alpha skill', 'Beta skill', 'Zulu skill']);
  sort('skills', 'lastUsed'); assert.deepEqual(names('skills'), ['Alpha skill', 'Beta skill', 'Zulu skill']);
  sort('skills', 'sessions'); assert.deepEqual(names('skills'), ['Beta skill', 'Alpha skill', 'Zulu skill']);
  sort('plugins', 'enabled'); assert.deepEqual(names('plugins'), ['Zulu plugin', 'Alpha plugin', 'Beta plugin']);
  sort('plugins', 'marketplace'); assert.deepEqual(names('plugins'), ['Zulu plugin', 'Beta plugin', 'Alpha plugin']);
  sort('mcp', 'name'); assert.deepEqual(names('mcp'), ['Beta server', 'Omega server', 'Zulu server']);
  sort('mcp', 'lastUsed'); assert.deepEqual(names('mcp'), ['Beta server', 'Zulu server', 'Omega server']);
  sort('mcp', 'failures'); assert.deepEqual(names('mcp'), ['Beta server', 'Omega server', 'Zulu server']);
  assert.equal(requests.length, 2, 'sorting uses the current report and inventory without extra requests');
  get('breakdown-sections').onclick({ target: { dataset: { section: 'plugins' } } });
  await get('refresh').onclick();
  assert.equal(get('plugins-panel').hidden, false);
  assert.equal(get('skills-panel').hidden, true);
  assert.deepEqual(names('skills'), ['Beta skill', 'Alpha skill', 'Zulu skill']);
  assert.deepEqual(names('plugins'), ['Zulu plugin', 'Beta plugin', 'Alpha plugin']);
  assert.deepEqual(names('mcp'), ['Beta server', 'Omega server', 'Zulu server']);
  assert.deepEqual(report, original, 'sorting never mutates the report or counts');
});

test('long selected filter names remain readable in full and keep their original filter IDs', async () => {
  const name = 'Planning <release> ' + 'LongUnbrokenName'.repeat(30);
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {} };
  report.options.sessions = [{ id: 'session-long', name }];
  report.options.projects = [name];
  report.options.models = [name];
  const { get, requests } = await mountPanel(report);
  for (const id of ['session', 'project', 'model']) {
    get(id).value = id === 'session' ? 'session-long' : name;
    await get(id).onchange();
    assert.equal(get(id).title, id === 'session' ? `${name} — session-long` : name);
    assert.ok(get(id).innerHTML.includes(name.replace('<release>', '&lt;release&gt;')));
    assert.ok(!get(id).innerHTML.includes('<release>'));
  }
  assert.equal(requests.at(-1).input.session, 'session-long');
  get('clear-filters').onclick();
  await new Promise(setImmediate);
  assert.equal(get('session').title, 'All sessions');
});

test('simplified numbers apply across views and context, persist, and only change after saving', async () => {
  const { get, report, records, now, requests, server, click, listeners } = await requestPanel();
  const visitAll = () => { for (const view of ['usage', 'efficiency', 'breakdown']) get('view').onclick({ target: { dataset: { view } } }); };
  const large = [{ ...records[0], inputTotal: 42_242_785, input: 42_242_785, cacheRead: 0, cacheWrite: 0, output: 2131,
    reasoning: 1000, toolTokenCount: 2131, nanoAiu: 2_131_000_000_000 }];
  Object.assign(report, buildReport(large, {}, now));
  report.skills = { invocations: 2131, sessions: 1, rows: [{ id: 'skill', name: 'Skill', invocations: 2131, sessions: 1, projects: 1, lastUsed: now.toISOString(), installedVersion: { value: '1.2.3', status: 'available' } }] };
  report.mcp.rows = [{ name: 'Server', calls: 2131, failures: 0, successes: 2131, unknown: 0, successRate: 100, lastUsed: null, status: 'unavailable' }];
  report.sources = [{ state: 'ok', path: '/fixture', records: 2131, files: 1_000_000 }];
  server.requestPage = input => buildRequestPage(large, input, now);
  server.contextSnapshot = { available: true, checkedAt: now.toISOString(), totalTokens: 2_131_000_000_000, limit: null,
    categories: { messages: 2_131_000_000_000 }, entries: [], omitted: 0 };
  await get('refresh').onclick();
  await get('efficiency-context-read').onclick();
  const snapshot = JSON.stringify(report);
  assert.equal(get('hero-credits').textContent, '2.1K');
  assert.equal(get('token-total').textContent, '42.2M');
  visitAll();
  for (const id of ['breakdown', 'token-stats', 'token-legend', 'efficiency-summary', 'mcp', 'sources']) assert.match(get(id).innerHTML, /2\.1K/, id);
  visitAll();
  for (const id of ['daily', 'models-summary']) assert.match(get(id).innerHTML, /42\.2M/, id);
  assert.match(get('skills').innerHTML, /2\.1K/);
  assert.match(get('skills').innerHTML, /1\.2\.3/, 'versions remain intact');
  assert.match(get('efficiency-context-result').innerHTML, /2\.1T/);
  get('tip').style = {};
  const tooltip = total => listeners.get('pointermove')({ clientX: 0, clientY: 0, target: { closest: () => ({ dataset: { tip: JSON.stringify({ title: 'Tokens', rows: [['Input', 2131]], total }) } }) } });
  tooltip('42.2M');
  assert.match(get('tip').innerHTML, /2\.1K/);
  assert.match(get('tip').innerHTML, /42\.2M/);
  assert.doesNotMatch(get('tip').innerHTML, /Unavailable/);
  await click({ requestModel: '<Sonnet>' });
  await click({ modelProject: 'Unknown project' });
  await click({ requestSession: 's1' });
  await click({ requestId: large[0].key });
  assert.match(get('breakdown').innerHTML.split('<tr class="usage-row" data-depth="3"')[1], /<td data-measure="tokens">2\.1K<\/td>/);
  await get('settings-open').onclick();
  assert.equal(get('simplify-numbers').checked, true);
  get('simplify-numbers').checked = false;
  get('settings-close').onclick();
  assert.equal(get('token-total').textContent, '42.2M', 'cancel does not apply a draft');
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  server.saveError = 'Could not save';
  await get('settings-save').onclick();
  visitAll();
  assert.equal(get('token-total').textContent, '42.2M', 'failure does not apply a draft');
  server.saveError = '';
  const beforeSave = requests.length;
  await get('settings-save').onclick();
  visitAll();
  await new Promise(setImmediate);
  assert.equal(server.config.simplifyNumbers, false);
  assert.ok(!requests.slice(beforeSave).some(r => r.method === 'usage.refresh'), 'display-only settings do not force a rescan');
  assert.equal(get('hero-credits').textContent, (2131).toLocaleString());
  assert.equal(get('token-total').textContent, (42_244_916).toLocaleString());
  visitAll();
  for (const id of ['daily', 'models-summary']) assert.ok(get(id).innerHTML.includes((42_244_916).toLocaleString()), id);
  visitAll();
  for (const id of ['breakdown', 'skills', 'efficiency-summary', 'mcp', 'sources']) assert.ok(get(id).innerHTML.includes((2131).toLocaleString()), id);
  tooltip(42_244_916);
  assert.ok(get('tip').innerHTML.includes((2131).toLocaleString()));
  assert.ok(get('tip').innerHTML.includes((42_244_916).toLocaleString()));
  assert.ok(get('efficiency-context-result').innerHTML.includes((2_131_000_000_000).toLocaleString()));
  assert.equal(requests.filter(r => r.method === 'efficiency.context').length, 1, 'formatting reuses the captured context');
  const { preferences, ...after } = report;
  assert.deepEqual(after, JSON.parse(snapshot), 'formatting leaves raw measurements intact');
  const reopened = await mountPanel(report, server.config);
  assert.equal(reopened.get('token-total').textContent, (42_244_916).toLocaleString());
  await get('settings-open').onclick();
  assert.equal(get('simplify-numbers').checked, false);
  get('simplify-numbers').checked = true;
  await get('settings-save').onclick();
  visitAll();
  assert.equal(get('token-total').textContent, '42.2M');
  assert.match(get('efficiency-context-result').innerHTML, /2\.1T/);

  large[0].nanoAiu = 12_345_678_901;
  Object.assign(report, buildReport(large, {}, now));
  await get('refresh').onclick();
  await new Promise(setImmediate);
  get('metric').onclick({ target: { dataset: { metric: 'credits' } } });
  assert.equal(get('hero-credits').textContent, '12.3');
  visitAll();
  for (const id of ['tiles', 'projects-summary', 'breakdown', 'efficiency-summary', 'efficiency-models', 'daily']) {
    assert.match(get(id).innerHTML, /12\.3/, id);
    assert.doesNotMatch(get(id).innerHTML, /12\.345678901/, id);
  }
  assert.match(get('breakdown').innerHTML.split('<tr class="usage-row" data-depth="3"')[1], /<td data-measure="credits">12\.3<\/td>/);
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  await get('settings-save').onclick();
  visitAll();
  await new Promise(setImmediate);
  assert.equal(get('hero-credits').textContent, '12.345678901');
  visitAll();
  for (const id of ['tiles', 'projects-summary', 'breakdown', 'efficiency-summary', 'efficiency-models', 'daily']) {
    assert.match(get(id).innerHTML, /12\.345678901/, id);
  }
  assert.equal(report.totals.credits, 12.345678901);
});
