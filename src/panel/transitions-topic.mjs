import { esc } from './charts.mjs';
import { barList, openSessionButton, topicJumpButton } from './token-insights.mjs';

// Plain names for how Copilot records that a model or effort setting was changed.
const TRANSITION_SOURCES = {
  model_picker: 'Chosen in the model picker',
  sdk: 'Set by an SDK client',
  agent: 'Set by the agent',
  startup: 'Set when the session started',
  unknown: 'Source not recorded',
};
const EFFORT_LEVEL_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
// A level needs this many calls on one model before it is listed beside another level.
const EFFORT_MIN_CALLS = 10;

// "Model and effort changes": what report.efficiency.changeDetail measured, with the existing
// effort rows (report.efficiency.efforts) and change counts (report.efficiency.switches).
export function renderTransitionsTopic(detail, efforts, { number, credits = number } = {}) {
  const c = detail || {}, x = c.next || {}, u = c.usage || {}, who = c.chooser || {};
  const valid = value => Number.isFinite(value) && value >= 0;
  const n = value => valid(value) ? number(value, { simplify: false }) : 'Unavailable';
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const of = (part, total) => `${n(part ?? 0)} of ${n(total ?? 0)}`;
  const count = (value, one, many = one + 's') => `${n(value)} ${value === 1 ? one : many}`;
  const level = value => value === 'unknown' ? 'Unknown' : value;
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const empty = text => `<p class="muted token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(detail)}</span></div>`;
  const metrics = (...items) => `<div class="efficiency-metrics">${items.join('')}</div>`;
  const compare = (caption, rows, options) => `<p class="compaction-caption">${esc(caption)}</p>` + barList(rows, options);
  const scope = [
    c.modelFiltered ? 'Model filter: changes that touch a selected model are kept. Conversation shares and the call before and after need every model, so they are unavailable.' : '',
    c.omitted ? `${count(c.omitted, 'change')} left out because provider attribution is missing or mixed.` : '',
  ].filter(Boolean).join(' ');

  // Effort levels used inside one model. Unknown effort is not a level and is counted apart.
  const byModel = new Map();
  for (const r of efforts || []) {
    let group = byModel.get(r.name);
    if (!group) byModel.set(r.name, group = { name: r.name, levels: [], calls: 0, unknown: 0, requests: 0 });
    const rank = EFFORT_LEVEL_ORDER.indexOf(r.effort), requests = valid(r.requests) ? r.requests : 0;
    group.requests += requests;
    if (rank < 0) group.unknown += requests;
    else { group.calls += requests; if (requests >= EFFORT_MIN_CALLS) group.levels.push({ rank, row: r }); }
  }
  const usable = [...byModel.values()].filter(g => g.levels.length > 1).sort((a, b) => b.calls - a.calls || String(a.name).localeCompare(String(b.name)));
  const shown = usable.slice(0, 5);
  const singleLevel = [...byModel.values()].filter(g => g.levels.length === 1).length;

  if (!c.events && !(efforts || []).length) return '<p class="muted">No recorded model or effort measurements for these filters.</p>';

  let html = '';
  if (c.events) {
    html += metrics(
      metric('Model changes', n(c.modelChanges), 'Recorded changes to a different model'),
      metric('Effort changes', n(c.effortChanges), 'Both the old and the new level recorded'),
      metric('Conversations with changes', n(c.sessions), `${count(c.events, 'recorded change event')}; one event can change both`),
      metric('Used more than one model', u.sessions ? percent(u.severalModels / u.sessions * 100) : 'Unavailable',
        u.sessions ? `${of(u.severalModels, u.sessions)} main conversations with a recorded call` : c.modelFiltered ? 'Needs every model, so a model filter hides it' : 'No main-conversation call with a recorded model'));
  } else {
    html += empty('No model or effort change is recorded for these dates and filters. Missing change events are not inferred from the order of calls.');
  }

  const pairs = (rows, total, empty_) => rows.length
    ? barList(rows.map(r => ({ label: `${level(r.from) || 'Unknown'} → ${level(r.to) || 'Unknown'}`, value: r.count })), { format: number })
      + (total > rows.length ? note(`Showing ${n(rows.length)} of ${n(total)} different changes, most frequent first.`) : '')
    : empty(empty_);
  if (c.events) {
    html += section('Which models changed', pairs(c.models || [], c.modelPairsTotal, 'No change to a different model is recorded.')
      + note('Each bar counts recorded changes from one model to another, as Copilot names them.'));
    html += section('Which effort levels changed', pairs(c.efforts || [], c.effortPairsTotal, 'No change between two recorded effort levels. A change from or to an unrecorded level is not counted, because unknown is not a level.'));
  }

  // Who chose: the way each change was made, and the calls Copilot routed itself.
  if (c.events || who.calls) {
    const sources = (c.sources || []).map(r => ({ label: Object.hasOwn(TRANSITION_SOURCES, r.id) ? TRANSITION_SOURCES[r.id] : TRANSITION_SOURCES.unknown, value: r.count }));
    const recorded = (who.automatic || 0) + (who.selected || 0);
    const autoRows = who.automatic > 0 && who.autoModels?.length
      ? `<p class="compaction-caption">Models Copilot picked</p>` + barList(who.autoModels.map(m => ({
          label: m.name,
          value: m.calls,
          detail: m.creditCalls
            ? `${credits(m.averageCredits)} / call (${of(m.creditCalls, m.calls)} calls with complete charges)`
            : `Credits unavailable (${of(m.creditCalls, m.calls)} calls with complete charges)`,
        })), { total: who.automatic, format: value => `${number(value)} (${percent(value / who.automatic * 100)})` })
        + note(`${who.autoModelCount > who.autoModels.length ? `Showing ${n(who.autoModels.length)} of ${n(who.autoModelCount)} models picked by Copilot. ` : ''}Automatic routing shows where calls ran, not why Copilot chose that model.`)
      : '';
    html += section('Who chose', (sources.length ? `<p class="compaction-caption">How each change was recorded</p>` + barList(sources, { total: c.events, format: value => `${number(value)} (${percent(value / c.events * 100)})` }) : '')
      + (who.calls ? `<p class="compaction-caption">Calls where Copilot picked the model</p>` + (recorded
        ? metrics(metric('Picked by Copilot', n(who.automatic), `${percent(who.automatic / recorded * 100)} of calls that record it`),
            metric('Selected in the session', n(who.selected), `${percent(who.selected / recorded * 100)} of calls that record it`),
            metric('Not recorded', n(who.unrecorded), `${of(recorded, who.calls)} model calls record it`)) + autoRows
        : empty('No call in these filters records whether Copilot picked the model, so automatic selection is unavailable.')) : '')
      + note('These are two separate records and are not linked: the first says how a setting was changed, the second flags a call on which Copilot chose the model itself. A call picked by Copilot may not appear as a change above.'));
  }

  if (c.routing?.driftCalls > 0) {
    const r = c.routing;
    html += section('Requested vs. resolved backend model',
      metrics(
        metric('Calls with response model', n(r.resolvedCalls), 'Calls that recorded a backend response model'),
        metric('Different backend model', n(r.driftCalls), `${percent(r.resolvedCalls ? r.driftCalls / r.resolvedCalls * 100 : null)} of calls with a response model`))
      + (r.driftPairs?.length
        ? `<p class="compaction-caption">Most frequent requested → resolved pairs</p>`
          + barList(r.driftPairs.map(pair => ({ label: `${pair.from} → ${pair.to}`, value: pair.count })), { format: number })
          + (r.driftPairsTotal > r.driftPairs.length ? note(`Showing ${n(r.driftPairs.length)} of ${n(r.driftPairsTotal)} requested-to-resolved pairs, most frequent first.`) : '')
        : '')
      + note('Providers may alias or route a requested model ID to a versioned backend snapshot. A difference here shows what the response reported, not a manual model change.'));
  }

  const rows = c.conversations || [];
  if (rows.length) html += section('Conversations with the most changes',
    `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr><th scope="col">Conversation</th><th scope="col">Model changes</th><th scope="col">Effort changes</th></tr></thead><tbody>${rows.map(r => `<tr><td class="text-cell">${openSessionButton(r.name, r.id, r.project)}</td><td><span class="cell-text">${esc(n(r.modelChanges))}</span></td><td><span class="cell-text">${esc(n(r.effortChanges))}</span></td></tr>`).join('')}</tbody></table></div>`
    + note(`Showing ${of(rows.length, c.sessions)} conversations with a recorded change.`));

  if (c.events) html += section('The call before and the call after a model change', x.paired
    ? compare('Input tokens of one model call', [{ label: 'Last call before', value: x.inputBefore }, { label: 'First call after', value: x.inputAfter, color: 'var(--s3)' }], { format: number })
      + (x.cachePairs
        ? compare('Share of that input read from cache', [{ label: 'Last call before', value: x.cacheBefore }, { label: 'First call after', value: x.cacheAfter, color: 'var(--s3)' }], { format: percent, total: 100 })
        : empty('Neither call has a complete cache split, so cache reuse around a change is unavailable.'))
      + (x.creditPairs
        ? compare('AI credits of one model call', [{ label: 'Last call before', value: x.creditsBefore }, { label: 'First call after', value: x.creditsAfter, color: 'var(--s3)' }], { format: credits })
        : empty('Neither call has complete charges on both sides, so credits around a change are unavailable.'))
      + `<p class="footnote token-insight-note">${esc(`Main-conversation calls in the selected dates; subagent calls are left out. Each bar is the middle value: half of the pairs were above it and half below. ${of(x.paired, c.modelChanges)} model changes have a measured call on a different model on both sides`
        + (x.cachePairs ? `, and ${of(x.cachePairs, x.paired)} of those have a complete cache split on both calls` : '')
        + (x.creditPairs ? `; ${of(x.creditPairs, x.paired)} pairs have complete charges on both calls` : '')
        + '.' + (x.sameModel ? ` ${count(x.sameModel, 'change')} had the same model on both neighbouring calls and ${x.sameModel === 1 ? 'is' : 'are'} not compared.` : '')
        + ' Input here is what each call reported, cached input included. The two calls can be different work. See ')}${topicJumpButton('tokens', 'cache', 'Cache reuse')}${esc(' for cache reads after a model change across all calls.'
        + (x.cachePairs && x.cacheAfter < x.cacheBefore ? ' Lower cache reads after a change are consistent with a cache that does not carry across models, but this data does not record the cause. A pause before the call can lower them too.' : ''))}</p>`
    : empty(c.modelFiltered ? 'The call before and after a change needs every model, so it is unavailable while a model filter is on.' : 'No recorded model change has a measured main-conversation call on a different model both before and after it in the selected dates.'));

  html += section('Effort levels within one model', shown.length
    ? `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr><th scope="col">Model</th><th scope="col">Effort</th><th scope="col">Calls</th><th scope="col">Share of its recorded levels</th><th scope="col">AI credits per call</th></tr></thead><tbody>${shown.flatMap(g => g.levels.sort((a, b) => a.rank - b.rank).map(({ row: r }) =>
      `<tr><td class="text-cell"><span class="cell-text">${esc(g.name)}</span></td><td><span class="cell-text">${esc(r.effort)}</span></td><td><span class="cell-text">${esc(n(r.requests))}</span></td><td><span class="cell-text">${esc(percent(r.requests / g.calls * 100))}</span></td>`
      + `<td title="${esc(`${of(r.creditRequests, r.requests)} calls have complete charges`)}"><span class="cell-text">${esc(valid(r.averageCredits) ? credits(r.averageCredits) : 'Unavailable')} (${esc(of(r.creditRequests, r.requests))})</span></td></tr>`)).join('')}</tbody></table></div>`
      + `<p class="footnote token-insight-note">${esc(`Levels are compared inside one model only. A level is listed when it has at least ${number(EFFORT_MIN_CALLS)} calls, and a model needs two such levels.${usable.length > shown.length ? ` Showing ${n(shown.length)} of ${n(usable.length)} models.` : ''} Calls with no recorded effort level are not a level: ${of(shown.reduce((sum, g) => sum + g.unknown, 0), shown.reduce((sum, g) => sum + g.requests, 0))} calls on the models shown. The share is of all calls with a recorded level on that model. Credits are averaged over calls with complete charges, shown as calls counted of calls. The calls at each level were different work, so a gap is not the effect of effort alone. For reasoning, output and speed by level, see `)}${topicJumpButton('tokens', 'output', 'Reasoning and generated output')}.</p>`
    : empty(`No model has two recorded effort levels with at least ${number(EFFORT_MIN_CALLS)} calls each, so levels are not compared.${singleLevel ? ` ${count(singleLevel, 'model')} ${singleLevel === 1 ? 'has' : 'have'} a single level with that many calls.` : ''} Calls with no recorded effort level are not counted as a level.`));

  // One observation, chosen in this order: much lower cache reads right after a change, the most
  // frequent model change, the most frequent effort change.
  let observation, action, after;
  const top = (c.models || [])[0], topEffort = (c.efforts || [])[0];
  if (x.cachePairs >= 3 && x.cacheBefore - x.cacheAfter >= 20) {
    observation = `The first call after a model change read ${percent(x.cacheAfter)} of its input from cache. The last call before read ${percent(x.cacheBefore)}.`;
    action = 'For one piece of connected work, try choosing the model at the start and keeping it, then compare with a task where you switch part-way.';
    after = 'the cache share of the call after any switch, input per call and credits per prompt. Lower reads fit a cache that does not carry across models, but the cause is not recorded, and the calls can be different work.';
  } else if (top) {
    observation = `The most frequent recorded model change was ${top.from || 'an unknown model'} to ${top.to || 'an unknown model'}, ${count(top.count, 'time')}.`;
    action = 'The next time you switch models, note why, for example a harder step or a cheaper routine step. After a week, see whether the switches match what you intended.';
    after = 'how often you switch and the cache share on the first call after a switch (see Cache reuse). This view does not record why a model was changed.';
  } else if (topEffort) {
    observation = `The most frequent recorded effort change was ${level(topEffort.from)} to ${level(topEffort.to)}, ${count(topEffort.count, 'time')}.`;
    action = 'Pick one routine task you know well and run it at two effort levels on the same model, with the same checks.';
    after = 'reasoning, output and duration per call for the two runs (see Reasoning and generated output). Calls at different levels were different work.';
  } else {
    observation = 'No model or effort change is recorded in these dates.';
    action = 'Use the effort levels above for now. After you next switch models or effort, look here again.';
    after = 'how often settings change and what the calls around a change look like.';
  }
  html += `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${note(`Compare afterward: ${after}`)}</aside>`;

  return html + note('Selected dates and current filters. Change events come from Copilot session journals; a missing event is never inferred from the order of calls, and a change made in a subagent is not counted. Counts show what was recorded, not whether a change helped.' + (scope ? ' ' + scope : ''));
}
