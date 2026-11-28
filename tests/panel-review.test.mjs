import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPanel } from './fixtures/panel.mjs';
import { requestPanel } from './fixtures/panel-requests.mjs';
import { buildReport } from '../src/core/copilot-report.mjs';
import { buildEfficiencyReview } from '../src/panel/efficiency.mjs';

test('settings restore saved text size and apply changes only after a successful save', async () => {
  const report = { ...buildReport([], { range: '1d' }), sources: [], coverage: {}, preferences: { textSize: 'large' } };
  const { get, requests, rootStyle, server } = await mountPanel(report, { textSize: 'large', extraHomes: ['/backup'], disabledHomes: ['/disabled'] });
  assert.equal(rootStyle.get('--text-scale'), '1.3');
  await get('settings-open').onclick();
  assert.equal(get('text-size').value, 'large');
  get('text-size').value = 'small';
  get('settings-close').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1.3');
  assert.ok(!requests.some(r => r.method === 'settings.set'));
  await get('settings-open').onclick();
  get('text-size').value = 'medium';
  await get('settings-save').onclick();
  assert.deepEqual(requests.find(r => r.method === 'settings.set').input, { textSize: 'medium', simplifyNumbers: true, includeWsl: true, readWslDatabases: true, includeVSCode: true, extraVSCodeHomes: [], extraHomes: ['/backup'], disabledHomes: ['/disabled'], reviewModel: '', reviewAllowSamples: true });
  assert.equal(rootStyle.get('--text-scale'), '1.15');
  assert.equal(get('settings-dialog').open, false);
  await get('settings-open').onclick();
  server.saveError = 'Cannot save settings';
  get('text-size').value = 'small';
  await get('settings-save').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1.15');
  assert.equal(get('settings-dialog').open, true);
  assert.equal(get('settings-error').hidden, false);
  server.saveError = '';
  await get('settings-save').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1');
  delete report.preferences;
  await get('refresh').onclick();
  assert.equal(rootStyle.get('--text-scale'), '1');
});

test('WSL source settings default on and saving a change refreshes history', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests } = await mountPanel(report);
  await get('settings-open').onclick();
  assert.equal(get('include-wsl').checked, true);
  assert.equal(get('read-wsl-databases').checked, true);
  get('include-wsl').checked = false;
  await get('settings-save').onclick();
  assert.equal(requests.findLast(r => r.method === 'settings.set').input.includeWsl, false);
  assert.equal(requests.findLast(r => r.method.startsWith('usage.') && r.method !== 'usage.inventory').method, 'usage.refresh');
  await get('settings-open').onclick();
  assert.equal(get('include-wsl').checked, false);
  get('read-wsl-databases').checked = false;
  await get('settings-save').onclick();
  assert.equal(requests.findLast(r => r.method === 'settings.set').input.readWslDatabases, false);
  assert.equal(requests.findLast(r => r.method.startsWith('usage.') && r.method !== 'usage.inventory').method, 'usage.refresh');
  await get('settings-open').onclick();
  assert.equal(get('read-wsl-databases').checked, false);
});

test('environment selector defaults to All, filters without rescanning, survives refresh and resets', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  report.options.environments = [{ id: 'windows', name: 'Windows' }, { id: 'wsl:ubuntu', name: 'WSL · Ubuntu' }];
  const { get, requests } = await mountPanel(report);
  assert.equal(get('environment').value, '');
  assert.match(get('environment').innerHTML, /All environments/);
  get('model').value = 'old'; get('project').value = 'old'; get('session').value = 'old';
  get('environment').value = 'wsl:ubuntu';
  await get('environment').onchange();
  const message = requests.findLast(r => r.method === 'usage.report');
  assert.equal(message.input.environment, 'wsl:ubuntu');
  assert.ok(!message.refresh);
  assert.equal(get('project').value, '');
  await get('refresh').onclick();
  assert.equal(requests.findLast(r => r.method === 'usage.refresh').input.environment, 'wsl:ubuntu');
  assert.equal(get('environment').value, 'wsl:ubuntu');
  get('clear-filters').onclick(); await new Promise(setImmediate);
  assert.equal(get('environment').value, '');
  assert.equal(requests.findLast(r => r.method === 'usage.report').input.environment, undefined);
});

test('VS Code source settings load defaults and trigger a refresh when custom storage changes', async () => {
  const report = { ...buildReport([], {}), sources: [], coverage: {} };
  const { get, requests } = await mountPanel(report);
  await get('settings-open').onclick();
  assert.equal(get('include-vscode').checked, true);
  get('include-vscode').checked = false;
  get('extra-vscode-homes').value = '/custom/User';
  await get('settings-save').onclick();
  const saved = requests.findLast(r => r.method === 'settings.set').input;
  assert.equal(saved.includeVSCode, false);
  assert.deepEqual(saved.extraVSCodeHomes, ['/custom/User']);
  assert.equal(requests.findLast(r => r.method.startsWith('usage.') && r.method !== 'usage.inventory').method, 'usage.refresh');
});

test('AI review uses saved excerpt preferences, ignoring unsaved Settings edits', async () => {
  const { report } = await requestPanel();
  const { get, server, requests } = await mountPanel(report, { reviewModel: 'fixture-model', reviewAllowSamples: false, extraHomes: [], disabledHomes: [] });
  server.prepare = () => ({ id: 'snapshot', preview: '{}', model: 'fixture-model', reasoningEffort: 'default', hasEvidence: true, allowSamples: server.config.reviewAllowSamples !== false });
  server.review = () => ({ cards: [], emptyReason: 'Limited evidence', model: 'fixture-model' });
  await get('settings-open').onclick();
  assert.equal(get('review-samples').checked, false);
  get('review-samples').checked = true;
  get('settings-close').onclick();
  await get('efficiency-review-open').onclick();
  assert.equal(requests.findLast(r => r.method === 'review.analyze').input.allowSamples, false);
  await get('settings-open').onclick();
  assert.equal(get('review-samples').checked, false, 'closing without saving discards the edit');
  get('review-samples').checked = true;
  await get('settings-save').onclick();
  assert.equal(server.config.reviewAllowSamples, true);
  await get('settings-open').onclick();
  assert.equal(get('review-samples').checked, true);
  get('review-samples').checked = false;
  get('settings-close').onclick();
  await get('efficiency-review-open').onclick();
  assert.equal(requests.findLast(r => r.method === 'review.analyze').input.allowSamples, true);
  assert.equal(get('efficiency-review-status').textContent, '', 'routine completion copy does not clutter the cards');
  assert.equal(get('review-result-note').hidden, true);
  server.review = () => ({ cards: [], emptyReason: 'Limited evidence', model: 'fixture-model', enrichment: 'failed' });
  await get('efficiency-review-open').onclick();
  assert.equal(get('review-result-note').hidden, false, 'failed optional work remains visible');
  assert.match(get('review-result-note').textContent, /follow-up failed/);
});

test('review settings show Sonnet High, retain choices, and save an explicitly changed model and effort', async () => {
  const { report } = await requestPanel();
  const { get, server, requests, document } = await mountPanel(report, { reviewModel: 'claude-sonnet-5.5', reviewReasoning: 'high', extraHomes: [], disabledHomes: [] });
  server.review = () => ({ models: [
    { id: 'claude-sonnet-5.5', label: 'Claude Sonnet 5.5', reasoningEfforts: ['medium', 'high'] },
    { id: 'alternative', label: 'Alternative', reasoningEfforts: ['medium', 'high'] },
  ] });
  assert.ok(!requests.some(r => r.method === 'review.catalog'), 'startup does not load models');
  await get('review-settings').onclick();
  assert.equal(document.activeElement, get('review-model'));
  assert.equal(get('review-model').value, 'claude-sonnet-5.5');
  assert.match(get('review-model').innerHTML, /Claude Sonnet 5.5/);
  assert.equal(get('review-reasoning').value, 'high');
  await get('review-models-refresh').onclick();
  assert.equal(get('review-reasoning').value, 'high');
  get('review-model').value = 'alternative'; get('review-model').onchange();
  assert.equal(get('review-reasoning').value, 'high');
  get('review-reasoning').value = 'medium'; get('review-reasoning').onchange();
  await get('review-models-refresh').onclick();
  assert.equal(get('review-model').value, 'alternative');
  assert.equal(get('review-reasoning').value, 'medium', 'refresh preserves unsaved effort selection');
  await get('settings-save').onclick();
  assert.equal(server.config.reviewModel, 'alternative'); assert.equal(server.config.reviewReasoning, 'medium');
  const reads = requests.filter(r => r.method === 'review.catalog').length;
  await get('settings-open').onclick();
  assert.match(get('review-model').innerHTML, /Claude Sonnet 5.5/);
  assert.equal(get('review-model').value, 'alternative'); assert.equal(get('review-reasoning').value, 'medium');
  assert.equal(requests.filter(r => r.method === 'review.catalog').length, reads);
  assert.ok(!requests.some(r => r.method === 'review.analyze'));
});

test('one explicit Create action reviews the date range across all filters and safely renders a frozen result', async () => {
  const { report } = await requestPanel();
  const { get, requests, server } = await mountPanel(report);
  assert.ok(!requests.some(r => r.method.startsWith('review.')));
  await get('efficiency-review-open').onclick();
  assert.match(get('review-send-model').textContent, /Choose and save/);
  await get('settings-open').onclick();
  await get('review-models-refresh').onclick();
  assert.match(get('review-model').innerHTML, /Fixture model/);
  assert.ok(!requests.some(r => r.method === 'review.analyze'));
  get('review-model').value = 'fixture-model';
  await get('settings-save').onclick(); assert.equal(server.config.reviewModel, 'fixture-model');
  await get('review-reconnect').onclick(); assert.match(get('review-connection-status').textContent, /Connection verified/);
  get('project').value = 'Existing project'; await get('project').onchange();
  get('model').value = 'Other model'; get('session').value = 'Other session'; get('environment').value = 'WSL'; get('cache').checked = false;
  server.review = () => ({ cards: [], emptyReason: '<script>untrusted</script>', model: 'fixture-model', passes: 1, samples: 0, guidanceVersion: '1.0.0' });
  const beforeSend = requests.length;
  await get('efficiency-review-open').onclick();
  assert.deepEqual(requests.findLast(r => r.method === 'review.prepare').input.filters, { range: 'mtd', includeCache: true });
  assert.ok(requests.slice(beforeSend).some(r => r.method === 'usage.report' && r.refresh === true), 'finished reviews refresh recorded usage immediately');
  assert.equal(requests.findLast(r => r.method === 'usage.report').input.project, 'Existing project', 'review refresh preserves the selected filters');
  assert.deepEqual(requests.find(r => r.method === 'review.analyze').input, { snapshotId: 'fixture-snapshot', expectedModel: 'fixture-model', expectedReasoning: 'default', allowSamples: true });
  assert.match(get('review-answer').innerHTML, /&lt;script&gt;untrusted/);
  assert.doesNotMatch(get('review-answer').innerHTML, /<script>/);
  assert.equal(get('review-result').hidden, false);
  const snapshot = get('efficiency-review-output').value;
  assert.throws(() => get('review-reference-status'), /Element review-reference-status exists/);
  await get('efficiency-review-copy').onclick();
  assert.equal(server.copied.at(-1), snapshot);
  get('project').value = ''; await get('project').onchange();
  assert.equal(get('efficiency-review-output').value, snapshot);
  assert.doesNotMatch(get('review-result-context').textContent, /different date/i);
  await get('refresh').onclick();
  assert.equal(requests.filter(r => r.method === 'review.analyze').length, 1);
  assert.match(get('review-result-context').textContent, /Later filter changes/);
});

test('bundled benchmark preview and copied text remain identical after refresh and filter changes', async () => {
  const { report } = await requestPanel();
  const preview = buildEfficiencyReview({ ...report, efficiency: { ...report.efficiency, models: [{ name: 'PRIVATE', modelId: 'gpt-4.1' }] } }, null);
  const { get, server, requests } = await mountPanel(report, { reviewModel: 'fixture-model' });
  server.prepare = () => ({ id: 'benchmark-snapshot', preview, model: 'fixture-model', reasoningEffort: 'default', hasEvidence: true, allowSamples: true, referenceStatus: 'Bundled Aider evidence <untrusted>' });
  server.review = () => ({ cards: [], emptyReason: 'Limited evidence', model: 'fixture-model' });
  await get('efficiency-review-open').onclick();
  assert.equal(get('efficiency-review-output').value, preview);
  assert.throws(() => get('review-reference-status'), /Element review-reference-status exists/);
  await get('efficiency-review-copy').onclick(); assert.equal(server.copied.at(-1), preview);
  get('range').value = '90d'; await get('range').onchange(); await get('refresh').onclick();
  assert.equal(get('efficiency-review-output').value, preview);
  assert.equal(requests.filter(r => r.method === 'review.prepare').length, 1);
  assert.equal(requests.filter(r => r.method === 'review.analyze').length, 1);
  assert.equal(requests.filter(r => r.method === 'review.catalog').length, 0);
});

test('failed or cancelled preparation preserves the previous review and its details', async () => {
  const { report } = await requestPanel();
  const { get, server } = await mountPanel(report, { reviewModel: 'fixture-model' });
  server.review = () => ({ cards: [], emptyReason: 'Limited evidence', model: 'fixture-model' });
  await get('efficiency-review-open').onclick();
  const caption = get('review-result-context').textContent, statistics = get('efficiency-review-output').value;
  assert.ok(caption); assert.ok(statistics);
  server.prepare = () => { throw new Error('Preparation unavailable'); };
  await get('efficiency-review-open').onclick();
  assert.equal(get('review-result').hidden, false);
  assert.equal(get('review-preview').hidden, false);
  assert.equal(get('review-result-context').textContent, caption);
  assert.equal(get('efficiency-review-output').value, statistics);
  assert.match(get('efficiency-review-status').textContent, /Preparation unavailable/);
  let resolve;
  server.prepare = () => new Promise(done => { resolve = done; });
  const pending = get('efficiency-review-open').onclick();
  await new Promise(setImmediate);
  await get('review-cancel').onclick();
  resolve({ id: 'cancelled' }); await pending;
  assert.equal(get('review-preview').hidden, false);
  assert.equal(get('review-result-context').textContent, caption);
  assert.equal(get('efficiency-review-output').value, statistics);
});

test('AI review cancellation and errors keep the response area honest and restore controls', async () => {
  const { report } = await requestPanel();
  const { get, server, requests } = await mountPanel(report, { reviewModel: 'fixture-model', extraHomes: [], disabledHomes: [] });
  let release;
  server.review = message => message.method === 'review.analyze' ? new Promise(resolve => { release = resolve; }) : { ok: true };
  const pending = get('efficiency-review-open').onclick();
  await new Promise(setImmediate);
  assert.equal(get('review-cancel').hidden, false); assert.equal(get('efficiency-review-open').disabled, true);
  await get('review-cancel').onclick();
  assert.equal(requests.at(-1).method, 'review.cancel');
  release({ cards: [], emptyReason: 'Completed before cancellation', model: 'fixture-model' }); await pending;
  assert.equal(get('review-cancel').hidden, true);
  assert.equal(get('review-result').hidden, true, 'a cancelled late response is not displayed');
  server.reviewError = 'Same-account verification failed.';
  await get('efficiency-review-open').onclick();
  assert.equal(get('efficiency-review-status').textContent, server.reviewError);
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').method, 'usage.report');
  assert.equal(requests.findLast(r => r.method !== 'usage.inventory').refresh, true, 'failed reviews may still have usage to refresh');
  assert.equal(get('efficiency-review-open').disabled, false);
  await get('settings-open').onclick(); await get('review-models-refresh').onclick();
  assert.equal(get('review-connection-status').textContent, server.reviewError);
});

test('AI review hides unrelated filters and the development notice stays dismissed during this dashboard', async () => {
  const { get, requests, document } = await requestPanel();
  const choose = efficiencySection => get('efficiency-sections').onclick({ target: { dataset: { efficiencySection } } });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  assert.equal(get('efficiency-development').hidden, false);
  get('efficiency-development-dismiss').onclick();
  choose('review');
  assert.equal(get('filters').hidden, true); assert.equal(get('environment').hidden, true);
  const before = requests.length;
  choose('tokens'); choose('review');
  assert.equal(requests.length, before);
  await get('refresh').onclick();
  assert.equal(get('filters').hidden, true); assert.equal(get('efficiency-development').hidden, true);
  await get('review-settings').onclick();
  assert.equal(get('settings-dialog').open, true); assert.equal(document.activeElement, get('review-model'));
  get('settings-close').onclick();
  get('view').onclick({ target: { dataset: { view: 'usage' } } });
  assert.equal(get('filters').hidden, false); assert.equal(get('environment').hidden, false);
});

test('Create prevents duplicate requests, cancels preparation safely and cleans up progress timers', async () => {
  const { report } = await requestPanel();
  const { get, server, requests, timeouts } = await mountPanel(report, { reviewModel: 'fixture-model' });
  let release;
  server.prepare = () => new Promise(resolve => { release = resolve; });
  const pending = get('efficiency-review-open').onclick();
  await new Promise(setImmediate);
  assert.equal(get('review-progress').hidden, false);
  assert.match(get('efficiency-review-status').textContent, /Preparing/);
  await get('efficiency-review-open').onclick();
  assert.equal(requests.filter(r => r.method === 'review.prepare').length, 1);
  await get('review-cancel').onclick();
  release({ id: 'late', model: 'fixture-model', hasEvidence: true }); await pending;
  assert.ok(!requests.some(r => r.method === 'review.analyze'));
  assert.equal(get('review-progress').hidden, true);
  assert.equal(get('efficiency-review-open').disabled, false);
  assert.match(get('efficiency-review-status').textContent, /cancelled/i);
  assert.ok(timeouts.filter(t => t.ms === 5000).every(t => t.cleared));
});

test('review loading uses local phrases, respects reduced motion and freezes excerpt consent', async () => {
  const { report } = await requestPanel();
  for (const reducedMotion of [false, true]) {
    const { get, server, requests, timeouts } = await mountPanel(report, { reviewModel: 'fixture-model', reviewReasoning: 'high' }, undefined, undefined, { reducedMotion });
    let release;
    server.review = () => new Promise(resolve => { release = resolve; });
    get('review-samples').checked = true;
    const pending = get('efficiency-review-open').onclick(); await new Promise(setImmediate);
    assert.equal(get('review-samples').disabled, true);
    assert.deepEqual(requests.findLast(r => r.method === 'review.analyze').input, { snapshotId: 'fixture-snapshot', expectedModel: 'fixture-model', expectedReasoning: 'high', allowSamples: true });
    const timer = timeouts.findLast(t => t.ms === 5000 && !t.cleared);
    assert.equal(Boolean(timer), !reducedMotion);
    if (timer) {
      const before = requests.length, phrase = get('review-progress-message').textContent;
      timer.callback();
      assert.notEqual(get('review-progress-message').textContent, phrase);
      assert.equal(requests.length, before, 'phrase changes never poll or call the model');
    }
    release({ cards: [], emptyReason: 'Not enough evidence', model: 'fixture-model' }); await pending;
    assert.equal(get('review-progress').hidden, true); assert.equal(get('review-samples').disabled, false);
    assert.equal(get('efficiency-review-open').dataset.attention, 'false');
  }
});

test('AI review freezes custom dates and does not mistake unrelated filter changes for a new scope', async () => {
  const { report } = await requestPanel();
  const { get, requests, server } = await mountPanel(report, { reviewModel: 'fixture-model' });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  server.review = () => ({ cards: [], emptyReason: 'Too little evidence', model: 'fixture-model' });
  get('range').value = 'custom'; get('range').onchange();
  get('start-date').value = '2026-11-01'; get('end-date').value = '2026-11-14';
  await get('apply-dates').onclick();
  await get('efficiency-review-open').onclick();
  assert.deepEqual(requests.findLast(r => r.method === 'review.prepare').input.filters, { range: 'custom', includeCache: true, startDate: '2026-11-01', endDate: '2026-11-14' });
  get('project').value = 'Another project'; await get('project').onchange();
  assert.doesNotMatch(get('review-result-context').textContent, /Previous filter snapshot/);
  get('range').value = '7d'; get('range').onchange(); await new Promise(setImmediate);
  assert.match(get('review-result-context').textContent, /Previous filter snapshot/);
  assert.equal(get('review-result-note').hidden, false);
  assert.match(get('review-result-note').textContent, /previous date range/);
  assert.equal(requests.filter(r => r.method === 'review.analyze').length, 1);
});

test('empty review evidence never invokes AI and restores the single Create action', async () => {
  const { report } = await requestPanel();
  const { get, requests, server } = await mountPanel(report, { reviewModel: 'fixture-model' });
  server.prepare = () => ({ id: 'empty', preview: '{}', model: 'fixture-model', reasoningEffort: 'high', hasEvidence: false });
  await get('efficiency-review-open').onclick();
  assert.ok(!requests.some(r => r.method === 'review.analyze'));
  assert.match(get('efficiency-review-status').textContent, /No eligible evidence in this date range/);
  assert.equal(get('efficiency-review-open').disabled, false); assert.equal(get('review-progress').hidden, true);
});

test('desktop review cycles four scenes without requests and preserves its place through phases and refresh', async () => {
  const { report } = await requestPanel();
  const { get, requests, server } = await mountPanel(report, { reviewModel: 'fixture-model' });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('efficiency-sections').onclick({ target: { dataset: { efficiencySection: 'review' } } });
  let prepare, analyze;
  server.prepare = () => new Promise(resolve => { prepare = resolve; });
  server.review = () => new Promise(resolve => { analyze = resolve; });
  const pending = get('efficiency-review-open').onclick(); await new Promise(setImmediate);
  const progress = get('review-progress'), cycle = () => get('review-desktop-record').onanimationiteration({ animationName: 'review-desktop-cycle' });
  assert.equal(progress.dataset.scene, '0'); assert.equal(progress.dataset.paused, 'false');
  const before = requests.length;
  get('review-desktop-record').onanimationiteration({ animationName: 'review-desktop-trend' });
  assert.equal(progress.dataset.scene, '0', 'child animation events do not advance the scene');
  for (const scene of ['1', '2', '3', '0', '1']) { cycle(); assert.equal(progress.dataset.scene, scene); }
  assert.equal(requests.length, before, 'illustration never scans or calls AI');
  prepare({ id: 'prepared', model: 'fixture-model', preview: '{}', reasoningEffort: 'default', hasEvidence: true });
  await new Promise(setImmediate);
  assert.equal(progress.dataset.scene, '1', 'analysis does not restart the illustration');
  await get('refresh').onclick(); assert.equal(progress.dataset.scene, '1');
  analyze({ cards: [], emptyReason: 'No defensible finding', model: 'fixture-model' }); await pending;
  assert.equal(progress.hidden, true); assert.equal(progress.dataset.paused, 'true');
  assert.equal(get('review-result').hidden, false, 'only the real result is displayed');
  cycle(); assert.equal(progress.dataset.scene, '1', 'late animation events are ignored');
  const next = get('efficiency-review-open').onclick(); await new Promise(setImmediate);
  assert.equal(progress.dataset.scene, '0', 'a new review starts at the first scene');
  prepare({ id: 'empty', model: 'fixture-model', preview: '{}', hasEvidence: false }); await next;
});

test('desktop review pauses offscreen or on request, stays stopped on cancel, and restores controls', async () => {
  const { report } = await requestPanel();
  const { get, server, document, listeners, requests } = await mountPanel(report, { reviewModel: 'fixture-model' });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  const choose = efficiencySection => get('efficiency-sections').onclick({ target: { dataset: { efficiencySection } } });
  choose('review');
  let release;
  server.review = message => message.method === 'review.analyze' ? new Promise(resolve => { release = resolve; }) : { ok: true };
  const pending = get('efficiency-review-open').onclick(); await new Promise(setImmediate);
  const progress = get('review-progress'), before = requests.length;
  const clocks = ['review-desktop-record', 'review-desktop'].map(id => ({ effect: { target: get(id), getTiming: () => ({ duration: 9000 }) }, animationName: id, currentTime: 22300 }));
  // display:none cancels CSS animations. Returning creates new clocks at zero.
  for (const id of ['efficiency-review-panel', 'efficiency-view', 'content']) {
    const element = get(id); let hidden = element.hidden;
    Object.defineProperty(element, 'hidden', { get: () => hidden, set(value) { hidden = value; if (value) clocks.forEach(clock => { clock.currentTime = 0; }); } });
  }
  get('review-desktop').getAnimations = () => ['efficiency-review-panel', 'efficiency-view', 'content'].some(id => get(id).hidden) ? [] : clocks;
  get('review-animation-toggle').onclick(); assert.equal(progress.dataset.paused, 'true');
  assert.equal(get('review-animation-toggle').textContent, 'Resume animation');
  choose('tokens'); choose('review'); assert.equal(progress.dataset.paused, 'true', 'user pause survives navigation');
  assert.ok(clocks.every(clock => clock.currentTime === 4300), 'returning to a paused scene restores every CSS clock');
  get('review-animation-toggle').onclick(); assert.equal(progress.dataset.paused, 'false');
  choose('patterns'); assert.equal(progress.dataset.paused, 'true'); choose('review'); assert.equal(progress.dataset.paused, 'false');
  document.hidden = true; listeners.get('visibilitychange')(); assert.equal(progress.dataset.paused, 'true');
  document.hidden = false; listeners.get('visibilitychange')(); assert.equal(progress.dataset.paused, 'false');
  get('view').onclick({ target: { dataset: { view: 'usage' } } }); assert.equal(progress.dataset.paused, 'true');
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } }); assert.equal(progress.dataset.paused, 'false');
  assert.ok(clocks.every(clock => clock.currentTime === 4300), 'main tab navigation preserves the same frame');
  assert.equal(requests.length, before);
  await get('review-cancel').onclick(); assert.equal(progress.dataset.paused, 'true');
  assert.equal(get('review-animation-toggle').disabled, true);
  release({ cards: [] }); await pending;
  assert.equal(progress.hidden, true);
});

test('desktop review provides a decorative still image for changing motion preferences and removes it after errors', async () => {
  const { report } = await requestPanel();
  const { get, server, requests, motion } = await mountPanel(report, { reviewModel: 'fixture-model' }, undefined, undefined, { reducedMotion: true });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('efficiency-sections').onclick({ target: { dataset: { efficiencySection: 'review' } } });
  let release;
  server.review = () => new Promise(resolve => { release = resolve; });
  const pending = get('efficiency-review-open').onclick(); await new Promise(setImmediate);
  assert.equal(get('review-progress').dataset.still, 'true'); assert.equal(get('review-progress').dataset.paused, 'true');
  assert.equal(get('review-animation-toggle').hidden, true);
  assert.equal(get('review-desktop').getAttribute('aria-hidden'), 'true');
  get('review-desktop-record').onanimationiteration({ animationName: 'review-desktop-cycle' });
  assert.equal(get('review-progress').dataset.scene, '0');
  motion.matches = false; motion.changed();
  assert.equal(get('review-animation-toggle').hidden, false); assert.equal(get('review-progress').dataset.paused, 'false');
  motion.matches = true; motion.changed();
  assert.equal(get('review-progress').dataset.still, 'true');
  release({ cards: [] }); await pending;
  server.reviewError = 'Review unavailable'; await get('efficiency-review-open').onclick();
  assert.equal(get('review-progress').hidden, true); assert.equal(get('efficiency-review-status').textContent, 'Review unavailable');
  assert.equal(requests.filter(r => r.method === 'review.analyze').length, 2);
});

test('a failed review restores focus when its animation control disappears', async () => {
  const { report } = await requestPanel();
  const { get, server, document } = await mountPanel(report, { reviewModel: 'fixture-model' });
  get('view').onclick({ target: { dataset: { view: 'efficiency' } } });
  get('efficiency-sections').onclick({ target: { dataset: { efficiencySection: 'review' } } });
  let prepare;
  server.prepare = () => new Promise(resolve => { prepare = resolve; });
  const pending = get('efficiency-review-open').onclick(); await new Promise(setImmediate);
  get('review-animation-toggle').focus();
  get('review-progress').contains = node => node === get('review-animation-toggle');
  server.reviewError = 'Review unavailable';
  prepare({ id: 'ready', model: 'fixture-model', preview: '{}', reasoningEffort: 'default', hasEvidence: true }); await pending;
  assert.equal(get('review-progress').hidden, true);
  assert.equal(document.activeElement, get('efficiency-review-open'));
});

