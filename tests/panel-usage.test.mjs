import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mountPanel } from './fixtures/panel.mjs';
import { requestPanel } from './fixtures/panel-requests.mjs';
import { createReceiptParser } from '../src/core/copilot.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';

test('header credits follow filtered totals, keep fractions, and preserve unavailable or partial coverage', async () => {
  const { get, report, records, now, server } = await requestPanel();
  const earlier = new Date(2026, 10, 13, 12);
  const history = [...records, { ...records[0], key: 'earlier', ms: earlier.getTime(), ts: earlier.toISOString(), project: 'Another project' }];
  Object.assign(report, buildReport(history, { range: '7d' }, now));
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, '7.3');
  get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.equal(get('hero-credits').textContent, '7.3', 'daily selection does not replace the filter total');
  get('metric').onclick({ target: { dataset: { metric: 'credits' } } });
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.equal(get('hero-credits').textContent, '7.3');
  Object.assign(report, buildReport(history, { range: '7d', project: 'Another project' }, now));
  get('project').value = 'Another project'; await get('project').onchange();
  assert.equal(get('hero-credits').textContent, '0.25');
  Object.assign(report, buildReport(history, { range: '1d', project: 'Another project' }, now));
  get('range').value = '1d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(get('hero-credits').textContent, '0', 'no matching usage shows zero');
  Object.assign(report.totals, { requests: 2, credits: null, missingCredits: 2 });
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, 'Unavailable');
  Object.assign(report.totals, { credits: 0.25, missingCredits: 1 });
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, '0.25 *');
  assert.match(get('hero-credits').title, /Credit coverage is incomplete/);
  server.transportError = true;
  get('project').value = 'Unloaded project'; await get('project').onchange();
  assert.equal(get('hero-credits').textContent, 'Unavailable');
  assert.match(get('hero-credits').title, /could not be loaded/);
  get('view').onclick({ target: { dataset: { view: 'usage' } } });
  assert.equal(get('hero-credits').textContent, 'Unavailable', 'switching tabs does not restore stale credits');
  server.transportError = false;
  Object.assign(report.totals, { credits: 1.5, missingCredits: 0 });
  await get('refresh').onclick();
  assert.equal(get('hero-credits').textContent, '1.5');
});

test('token total card follows the loaded date range and filters instead of today', async () => {
  const { get, report, records, now } = await requestPanel();
  const earlier = new Date(2026, 10, 13, 12);
  const history = [...records, ...records.map(r => ({ ...r, key: r.key + '-earlier', ms: earlier.getTime(), ts: earlier.toISOString(), project: 'Earlier project' }))];
  const tile = () => get('tiles').innerHTML.split('<div class="tile">')[2].split('</div>')[0];
  for (const [range, label, total] of [['1d', 'Today', '3.4K'], ['7d', 'Last 7 days', '6.7K'], ['30d', 'Last 30 days', '6.7K'], ['90d', 'Last 90 days', '6.7K'], ['all', 'All history', '6.7K'], ['custom', 'Custom dates', '3.4K']]) {
    Object.assign(report, buildReport(history, { range, ...(range === 'custom' ? { startDate: '2026-11-13', endDate: '2026-11-13' } : {}) }, now));
    await get('refresh').onclick();
    assert.ok(tile().includes('<span class="label">Tokens</span>'), range);
    assert.ok(tile().includes(`<span class="sub">${label}</span>`), range);
    assert.ok(tile().includes(`>${total}</strong>`), range);
  }
  Object.assign(report, buildReport(history, { range: '7d', project: 'Earlier project', includeCache: false }, now));
  await get('refresh').onclick();
  assert.ok(tile().includes('>1.4K</strong>'), 'project and cache filters apply to the total');
  get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.ok(tile().includes('>1.4K</strong>'), 'daily chart selection does not narrow the filter total');
});

test('token type order and shares follow the selected day, filters, and cache inclusion', async () => {
  const { get, report, records, now } = await requestPanel();
  const earlier = new Date(2026, 10, 13, 12);
  const history = [records[0], { ...records[0], key: 'yesterday', ms: earlier.getTime(), ts: earlier.toISOString(),
    input: 80, inputTotal: 100, cacheRead: 10, cacheWrite: 10, output: 80 }];
  Object.assign(report, buildReport(history, { range: '7d' }, now));
  await get('refresh').onclick();
  const order = () => [...get('token-legend').innerHTML.matchAll(/<i[^>]*><\/i>(.*?) <b>/g)].map(m => m[1]);
  assert.deepEqual(order(), ['Uncached input', 'Cache read', 'Cache write', 'Output']);
  assert.match(get('token-bar').innerHTML, /Uncached input 36\.7%; Cache read 23\.3%; Cache write 6\.7%; Output 33\.3%/);
  assert.doesNotMatch(get('token-bar').innerHTML, /Reasoning/);
  get('daily').onclick({ target: { closest: () => ({ dataset: { day: '2026-11-14' } }) } });
  assert.match(get('token-bar').innerHTML, /Uncached input 25%; Cache read 50%; Cache write 8\.3%; Output 16\.7%/);
  get('all-days').onclick();
  assert.match(get('token-bar').innerHTML, /Uncached input 36\.7%/);
  Object.assign(report, buildReport(history, { range: '1d', includeCache: false }, now));
  await get('refresh').onclick();
  assert.deepEqual(order(), ['Uncached input', 'Output']);
  assert.match(get('token-bar').innerHTML, /Uncached input 60%; Output 40%/);
  const unknown = { ...records[0], input: null, inputTotal: 100, cacheRead: null, cacheWrite: null, output: 100 };
  Object.assign(report, buildReport([unknown], {}, now));
  await get('refresh').onclick();
  assert.deepEqual(order(), ['Uncached input', 'Cache read', 'Cache write', 'Input (cache split unknown)', 'Output']);
  assert.match(get('token-bar').innerHTML, /Input \(cache split unknown\) 50%; Output 50%/);
  assert.match(get('token-note').textContent, /Percentages show shares of recorded tokens/);
});

test('credit rate cards replace streak and models, preserve coverage, and follow number settings', async () => {
  const { get, report, records, now } = await requestPanel();
  const card = index => get('tiles').innerHTML.split('<div class="tile">')[index + 1].split('</div>')[0];
  assert.equal(get('tiles').innerHTML.match(/class="tile"/g).length, 4);
  assert.doesNotMatch(get('tiles').innerHTML, /Current streak|>Models</);
  assert.match(card(2), /<span class="label">AI credits \/ prompt<\/span>.*>Unavailable<\/strong>.*<span class="sub">0 prompts<\/span>/);
  assert.match(card(3), /<span class="label">AI credit \/ 1M tokens<\/span>.*>2\.1K<\/strong>/);
  assert.match(card(3), /<span class="sub">input \+ output \+ cache<\/span>/);
  Object.assign(report.promptCredits, { prompts: 1, eligiblePrompts: 1, credits: 0.0678776, averageCredits: 0.0678776 });
  report.promptCredits.unlinkedRequests = 0;
  await get('refresh').onclick();
  assert.match(card(2), />0\.068<\/strong>.*<span class="sub">1 prompts<\/span>/);
  assert.equal(get('prompt-coverage-note').hidden, true);
  await get('settings-open').onclick();
  get('simplify-numbers').checked = false;
  await get('settings-save').onclick();
  await new Promise(setImmediate);
  assert.match(card(2), />0\.0678776<\/strong>/);
  assert.ok(card(3).includes(`>${(7 / 3360 * 1e6).toLocaleString(undefined, { maximumFractionDigits: 9 })}</strong>`));
  Object.assign(report, buildReport(records, { range: '7d', includeCache: false }, now));
  await get('refresh').onclick();
  assert.ok(card(3).includes(`>${(5000).toLocaleString()}</strong>`));
  assert.match(card(3), /excluding cache/);
  const incomplete = [{ ...records[0], nanoAiu: null, creditStatus: 'unavailable' }, records[1], { ...records[2], output: null }];
  Object.assign(report, buildReport(incomplete, { range: '7d' }, now));
  Object.assign(report.promptCredits, { prompts: 2, eligiblePrompts: 1, credits: 0.25, averageCredits: 0.25, modelFiltered: true, excluded: { attribution: 0, accounting: 1, unfinished: 0 } });
  await get('refresh').onclick();
  assert.match(card(2), />0\.25 \*<\/strong>.*1 prompts · selected-model contribution/);
  assert.equal(get('prompt-coverage-note').hidden, false);
  assert.match(get('prompt-coverage-note').textContent, /^\* AI credits \/ prompt: 1 of 2 prompts/);
  assert.match(get('prompt-coverage-note').textContent, /1 incomplete charges/);
  assert.match(card(2), /1 incomplete charges/);
  assert.match(card(3), /1 of 3 requests/);
  assert.match(card(3), /\*<\/strong>.*<span class="sub">input \+ output \+ cache<\/span>/);
  Object.assign(report, buildReport([incomplete[0]], { range: '7d' }, now));
  await get('refresh').onclick();
  assert.match(card(2), />Unavailable<\/strong>.*<span class="sub">0 prompts<\/span>/);
  assert.match(card(3), /0 of 1 requests.*>Unavailable<\/strong>/);
  Object.assign(report, buildReport([{ ...records[0], nanoAiu: 0 }], { range: '7d' }, now));
  Object.assign(report.promptCredits, { prompts: 1, eligiblePrompts: 1, credits: 0, averageCredits: 0, unlinkedRequests: 0 });
  await get('refresh').onclick();
  for (const index of [2, 3]) assert.match(card(index), /data-measure="credits".*>0<\/strong>/);
  Object.assign(report, buildReport([], { range: '1d' }, now));
  await get('refresh').onclick();
  for (const index of [2, 3]) assert.match(card(index), />Unavailable<\/strong>/);
  assert.equal(get('prompt-coverage-note').hidden, true, 'empty filtered data clears the note');
  Object.assign(report.promptCredits, { unlinkedRequests: 2 });
  await get('refresh').onclick();
  assert.equal(get('prompt-coverage-note').hidden, false, 'unlinked calls remain disclosed without known prompts');
  assert.match(get('prompt-coverage-note').textContent, /2 model calls could not be linked to prompts/);
});

test('metric buttons toggle emphasis off without changing chart units or loading data', async () => {
  const { get, requests } = await requestPanel();
  const html = await fs.readFile(new URL('../panel/index.html', import.meta.url), 'utf8');
  for (const metric of ['tokens', 'credits']) assert.ok(html.includes(`data-metric="${metric}" aria-pressed="false"`));
  const buttons = ['tokens', 'credits'].map(metric => ({ dataset: { metric }, 'aria-pressed': 'false',
    setAttribute(name, value) { this[name] = value; } }));
  get('metric').querySelectorAll = () => buttons;
  const press = metric => get('metric').onclick({ target: { dataset: { metric } } });
  const selected = () => buttons.map(b => b['aria-pressed']);
  const before = requests.length;
  assert.equal(get('content').dataset.metric, undefined, 'initial load is neutral');
  press('tokens');
  assert.equal(get('content').dataset.metric, 'tokens');
  press('tokens');
  assert.equal(get('content').dataset.metric, undefined, 'removing the attribute disables both accent and neutral-gray CSS');
  assert.deepEqual(selected(), ['false', 'false']);
  assert.equal(get('daily-title').textContent, 'Daily tokens');
  press('tokens');
  assert.equal(get('content').dataset.metric, 'tokens');
  assert.deepEqual(selected(), ['true', 'false']);
  press('credits');
  assert.equal(get('content').dataset.metric, 'credits');
  assert.deepEqual(selected(), ['false', 'true']);
  assert.equal(get('daily-title').textContent, 'Daily AI credits');
  const chart = get('daily').innerHTML;
  press('credits');
  assert.equal(get('content').dataset.metric, undefined);
  assert.deepEqual(selected(), ['false', 'false']);
  assert.equal(get('daily').innerHTML, chart, 'clearing credit emphasis keeps the current chart');
  press('invalid');
  get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
  assert.equal(get('content').dataset.metric, undefined);
  assert.equal(requests.length, before, 'toggling emphasis is entirely local');
  await get('refresh').onclick();
  get('range').value = '1d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(get('content').dataset.metric, undefined, 'neutral display survives refreshes and filter changes');
  assert.deepEqual(selected(), ['false', 'false']);
  press('credits');
  assert.equal(get('content').dataset.metric, 'credits');
  press('tokens');
  assert.equal(get('content').dataset.metric, 'tokens');
  assert.deepEqual(selected(), ['true', 'false']);
});

test('initial load and the visible 15-minute timer scan history; fresh returns and filters reuse it', async () => {
  const { get, requests, intervals, listeners, document, server } = await requestPanel();
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 15 * 60 * 1000);
  assert.match(get('updated').textContent, /15 minutes/);
  assert.equal(requests[0].method, 'usage.report');
  assert.equal(requests[0].refresh, true, 'opening the page immediately checks for new usage');
  get('range').value = '1d'; get('range').onchange();
  await new Promise(setImmediate);
  assert.equal(requests.at(-1).refresh, undefined);
  server.now += 15 * 60 * 1000;
  intervals[0].callback(); await new Promise(setImmediate);
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').method, 'usage.report');
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').refresh, true);
  document.hidden = true;
  const count = requests.length;
  intervals[0].callback(); listeners.get('visibilitychange')();
  await new Promise(setImmediate);
  assert.equal(requests.length, count);
  document.hidden = false;
  server.now += 15 * 60 * 1000 - 1;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.length, count, 'returning before 15 minutes does not scan');
  get('range').value = '7d'; get('range').onchange(); await new Promise(setImmediate);
  assert.equal(requests.at(-1).refresh, undefined);
  server.now++;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').refresh, true);
  const afterReturn = requests.length;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.length, afterReturn, 'a successful scan resets freshness');
  server.now += 14 * 60 * 1000;
  await get('refresh').onclick();
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').method, 'usage.refresh');
  assert.equal(get('footer-refresh').onclick, get('refresh').onclick);
  server.now += 60 * 1000;
  const afterManual = requests.length;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.length, afterManual, 'manual refresh also resets freshness');
});

test('visibility refresh coalesces pending work, retains failure age, and accepts unchanged success', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, server, requests, listeners, intervals } = await mountPanel(report);
  server.now += 15 * 60 * 1000;
  let finish;
  server.report = () => new Promise(resolve => { finish = resolve; });
  listeners.get('visibilitychange')();
  await new Promise(setImmediate);
  const count = requests.length;
  listeners.get('visibilitychange')(); intervals[0].callback();
  assert.equal(requests.length, count);
  finish({ unchanged: true, generatedAt: report.generatedAt, scannedAt: report.generatedAt });
  await new Promise(setImmediate);
  const after = requests.length;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.length, after, 'unchanged success is still a fresh scan');
  server.now += 15 * 60 * 1000;
  server.transportError = true;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.match(get('status').textContent, /last successful/);
  const failed = requests.length;
  listeners.get('visibilitychange')(); await new Promise(setImmediate);
  assert.equal(requests.length, failed + 1, 'failed refresh does not mark old data fresh');
});

test('shared banner renders each range on every dashboard and keeps its scene width in narrow canvases', async () => {
  const now = new Date(2026, 10, 14, 22);
  const report = { ...buildReport([], { range: '7d' }, now), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  for (const view of ['usage', 'breakdown', 'efficiency']) {
    get('view').onclick({ target: { dataset: { view } } });
    for (const width of [1080, 500, 280]) {
      get('banner').clientWidth = width;
      for (const [range, count] of [['1d', 1], ['7d', 1], ['mtd', 1], ['30d', 1], ['90d', 1], ['all', 4], ['custom', 0]]) {
        const query = range === 'custom' ? { range, startDate: '2026-11-01', endDate: '2026-11-14' } : { range };
        Object.assign(report, buildReport([], query, now));
        await get('refresh').onclick();
        const svg = get('banner').innerHTML;
        const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
        assert.ok(w / h <= width / get('banner').clientHeight, 'the SVG must not crop buildings horizontally');
        const buildings = [...svg.matchAll(/<rect x="\d+" y="(\d+)" width="\d+" height="1" fill="#12152c"\/>/g)].filter(([, y]) => Number(y) === h - 1);
        assert.equal(buildings.length, count, `${range} at width ${width}`);
      }
    }
  }
});

test('banner cycles three patterns per building only when it reappears', async () => {
  const now = new Date(2026, 10, 14, 22);
  const report = { ...buildReport([], { range: '7d' }, now), sources: [], coverage: {} };
  const { get } = await mountPanel(report);
  const show = async range => {
    const query = range === 'custom' ? { range, startDate: '2026-11-01', endDate: '2026-11-14' } : { range };
    Object.assign(report, buildReport([], query, now));
    get('range').value = range;
    if (range === 'custom') get('apply-dates').onclick();
    else get('range').onchange();
    await new Promise(setImmediate);
    return get('banner').innerHTML;
  };
  for (const range of ['1d', '7d', '30d', '90d']) {
    const visits = [];
    for (let i = 0; i < 4; i++) {
      await show('custom');
      visits.push(await show(range));
      report.generatedAt = new Date(2026, 10, 14, 22, 15).toISOString();
      await get('refresh').onclick();
      get('view').onclick({ target: { dataset: { view: 'breakdown' } } });
      get('metric').onclick({ target: { dataset: { metric: 'credits' } } });
      assert.equal(get('banner').innerHTML, visits[i], 'refreshes and other view changes keep the current pattern');
    }
    assert.equal(new Set(visits.slice(0, 3)).size, 3, range + ' rotates through three patterns');
    assert.equal(visits[3], visits[0], range + ' repeats its first pattern on the fourth visit');
  }
  const lights = svg => [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="\d+" height="1" fill="#ffd27a"\/>/g)].map(([, x, y]) => [Number(x), Number(y)]);
  const lastBuilding = lights(get('banner').innerHTML);
  const all = lights(await show('all'));
  assert.deepEqual(all.filter(([x]) => x >= 100), lastBuilding, 'entering All history keeps an already-visible building unchanged');
  assert.deepEqual(lights(await show('90d')), lastBuilding, 'leaving All history keeps the remaining building unchanged');
  await show('custom');
  const next = lights(await show('all'));
  for (const [left, right] of [[24, 38], [45, 59], [65, 79], [105, 119]]) {
    const within = ([x]) => x >= left && x <= right;
    assert.notDeepEqual(next.filter(within), all.filter(within), 'each hidden building advances when returning to All history');
  }
});

test('an unchanged report still updates the shared skyline clock outside Usage', async () => {
  const report = { ...buildReport([], { range: '7d' }, new Date(2026, 10, 14, 22)), sources: [], coverage: {} };
  const { get, server } = await mountPanel(report, undefined, undefined, undefined, { serializedResponses: true });
  for (const [view, hour] of [['breakdown', 10], ['efficiency', 22]]) {
    get('view').onclick({ target: { dataset: { view } } });
    const before = get('banner').innerHTML;
    server.report = () => ({ unchanged: true, generatedAt: new Date(2026, 10, 14, hour).toISOString() });
    await get('refresh').onclick();
    assert.notEqual(get('banner').innerHTML, before, 'day and night still change the shared skyline');
  }
});

