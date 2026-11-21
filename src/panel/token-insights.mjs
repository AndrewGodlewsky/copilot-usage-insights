import { esc, usageValue, coverageValue } from './charts.mjs';

// Shared by the Efficiency topic views. Both return '' when there is nothing to draw.
// A measure over report.efficiency.trend.points: a small line plus the average of the earlier
// and the later half of the periods that have a value. `pick` returns null for an unmeasured period.
export function trendRow(trend, pick, { label, format = String } = {}) {
  const points = (trend?.points || []).map(point => ({ day: point.day, value: pick(point) })).filter(point => Number.isFinite(point.value));
  if (points.length < 4) return '';
  const values = points.map(point => point.value), low = Math.min(...values), high = Math.max(...values), range = high - low || 1;
  const width = 160, height = 34, x = index => 3 + index / (values.length - 1) * (width - 6), y = value => height - 4 - (value - low) / range * (height - 8);
  const half = Math.floor(values.length / 2), mean = list => list.reduce((sum, value) => sum + value, 0) / list.length;
  const earlier = mean(values.slice(0, half)), later = mean(values.slice(-half)), unit = trend.unit === 'week' ? 'week' : 'day';
  const summary = `${format(earlier)} in the earlier ${unit}s, ${format(later)} in the later ${unit}s`;
  return `<div class="token-trend"><span class="label">${esc(label)} by ${unit}</span><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${label} by ${unit}: ${summary}`)}"><polyline points="${values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}"/><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(values.at(-1)).toFixed(1)}" r="2.5"/></svg><span class="sub">${esc(summary)} · ${esc(points[0].day)} to ${esc(points.at(-1).day)}, ${points.length} ${unit}s with measurements. Averages of each period's value; periods differ in call count.</span></div>`;
}
// Labelled horizontal bars for rows of { label, value, detail }. Bars are sized against `total`
// when given (a share of a whole), otherwise against the largest row.
export function barList(rows, { format = String, total } = {}) {
  const drawn = (rows || []).filter(row => Number.isFinite(row.value) && row.value >= 0);
  const scale = total > 0 ? total : Math.max(0, ...drawn.map(row => row.value));
  if (!drawn.length || !scale) return '';
  return `<div class="token-bar-list" role="list">${drawn.map(row => `<div class="token-bar-row" role="listitem"><span class="token-bar-label">${esc(row.label)}</span><span class="token-bar-track" aria-hidden="true"><i style="width:${Math.min(100, row.value / scale * 100).toFixed(1)}%${row.color ? `;background:${row.color}` : ''}"></i></span><span class="token-bar-value">${esc(format(row.value))}</span>${row.detail ? `<span class="token-bar-detail">${esc(row.detail)}</span>` : ''}</div>`).join('')}</div>`;
}

// Render from the report and the explicitly requested context snapshot only.
export function renderTokenInsight(id, report, { number, credits, context, showCoverage = true } = {}) {
  const s = report.efficiency?.summary || {}, models = report.efficiency?.models || [];
  const valid = value => Number.isFinite(value) && value >= 0;
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const share = (part, total) => valid(part) && total > 0 && part <= total ? part / total * 100 : null;
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const empty = text => `<p class="muted token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail, format = number, incomplete = false) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(coverageValue(value, incomplete, format, showCoverage))}</strong><span class="sub">${esc(detail)}</span></div>`;
  const metrics = (...items) => `<div class="efficiency-metrics">${items.join('')}</div>`;
  const coverage = (count, total = s.requests) => `${number(count ?? 0)} of ${number(total ?? 0)} model calls`;
  const partial = (count, total = s.requests) => count < total;
  const measured = (value, count, total = s.requests, format = number) => coverageValue(value, partial(count, total), format, showCoverage);
  const table = (headers, rows) => `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' class="text-cell"' : ''}><span class="cell-text">${esc(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const insight = (observation, action, compare) => `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${note(`Compare afterward: ${compare}`)}</aside>`;
  const jump = (topic, label) => `<button data-token-jump="${topic}">${esc(label)}</button>`;
  const inspect = '<button data-token-context="true">Open context inspector</button>';
  const bars = (parts, incomplete = false) => {
    if (parts.some(p => !valid(p.value))) return '';
    const total = parts.reduce((n, p) => n + p.value, 0);
    if (!total) return '';
    return `<div class="token-insight-bars"><div class="efficiency-track" role="img" aria-label="${esc(parts.map(p => `${p.label}: ${percent(p.value / total * 100)}`).join('; '))}">${parts.map(p => `<span style="width:${p.value / total * 100}%;background:${p.color}"></span>`).join('')}</div><div class="efficiency-flow-labels">${parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${esc(coverageValue(p.value, incomplete, number, showCoverage))}</b> · ${esc(coverageValue(p.value / total * 100, incomplete, percent, showCoverage))}</span>`).join('')}</div></div>`;
  };
  const current = context?.available === true;
  const category = key => current && valid(context.categories?.[key]) && context.categories[key] <= context.totalTokens ? context.categories[key] : null;
  const contextStamp = () => note(current
    ? `Current hosting conversation · snapshot ${context.checkedAt || 'time unavailable'}${context.modelId ? ' · ' + context.modelId : ''}. This estimate stays fixed until you inspect again; history filters do not change it.`
    : 'Current context has not been measured here. Open the inspector and choose Inspect context; it does not run automatically.');
  const sources = (kinds, title) => {
    if (!current) return contextStamp() + inspect;
    const rows = (context.entries || []).filter(e => kinds.includes(e.kind) && valid(e.tokens)).slice().sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
    return section(title, rows.length ? table(['Source', 'Kind', 'Context tokens', 'Of context'], rows.slice(0, 5).map(e => [e.label || e.id || 'Unnamed source', e.kind, number(e.tokens), percent(share(e.tokens, context.totalTokens))]))
      + note(`Showing ${number(Math.min(rows.length, 5))} of ${number(rows.length)} matching entries in the retained snapshot${context.omitted ? `; ${number(context.omitted)} entries were omitted from the snapshot` : ''}. Parent and child sources can overlap; do not add these rows.`)
      : empty('Copilot returned no attributed sources of these kinds in this snapshot. This does not establish that none were loaded.'));
  };
  const measuredModels = (count, order) => models.filter(r => r[count] > 0).slice().sort((a, b) => (b[order] ?? 0) - (a[order] ?? 0) || a.name.localeCompare(b.name)).slice(0, 5);

  if (id === 'overview') {
    const pairedTotal = (s.pairedInput || 0) + (s.pairedOutput || 0), inputShare = share(s.pairedInput, pairedTotal);
    return insight(inputShare == null ? 'Start with measurement coverage.' : `${percent(inputShare)} of matched token volume was input.`,
      inputShare == null ? 'Choose a range with both input and output measurements before drawing conclusions.' : inputShare >= 50
        ? 'Inspect what the model is reading repeatedly: instructions, tool definitions, conversation history, and cached context.'
        : 'Look at generated output and reasoning first, then check how many model calls follow each prompt.',
      'input and output per model call on similar tasks. Tokens measure resource use, not whether the work was valuable.')
      + `<div class="token-insight-actions">${jump('context', 'Inspect context overhead')}${jump('prompts', 'See work per prompt')}${jump('output', 'Explore output')}</div>`;
  }
  if (id === 'context') {
    if (!current) return contextStamp();
    const setup = ['systemPrompt', 'customInstructions', 'systemTools', 'mcpTools'].map(category);
    const setupTokens = setup.every(valid) && setup.reduce((a, b) => a + b, 0) <= context.totalTokens ? setup.reduce((a, b) => a + b, 0) : null;
    return metrics(metric('Instructions + definitions', setupTokens, 'System, custom instructions, built-in and MCP tool definitions'),
      metric('Of occupied context', share(setupTokens, context.totalTokens), 'Current snapshot, not a share of historical spend', percent))
      + insight(setupTokens == null ? 'Some context categories are unavailable.' : `${number(setupTokens)} tokens describe instructions and available tools.`,
        'Review the largest contributor you control. Move task-specific detail into references loaded when needed, and keep only relevant integrations enabled for the task.',
        'a new snapshot after one change, then verify the agent still has the instructions and tools it needs. This snapshot does not prove these sources are present on every request.');
  }
  if (id === 'tools') {
    const rows = measuredModels('toolRequests', 'toolTokens');
    return metrics(metric('Definitions / call', s.averageToolTokens, coverage(s.toolRequests), number, partial(s.toolRequests)),
      metric('Share of measured input', s.toolShare, 'Tool and input counts from the same calls', percent, partial(s.toolRequests)),
      metric('Definition tokens', s.toolRequests ? s.toolTokens : null, 'Already included in input tokens', number, partial(s.toolRequests)),
      metric('Available tools / call', s.averageAvailableTools, coverage(s.toolCountRequests), number, partial(s.toolCountRequests)))
      + (rows.length ? section('Models carrying the most tool-definition tokens', table(['Model', 'Measured calls', 'Definitions / call', 'Input share'], rows.map(r => [r.name, coverage(r.toolRequests, r.requests), measured(r.averageToolTokens, r.toolRequests, r.requests), measured(r.toolShare, r.toolRequests, r.requests, percent)]))) : empty('No paired tool-definition and input measurements in these filters.'))
      + insight(s.toolShare == null ? 'Tool-definition overhead is not measurable in this history.' : `${percent(s.toolShare)} of matched input described available tools.`,
        'Inspect which definitions occupy the current conversation. Try disabling an unrelated integration for a comparable task; a tool can add definitions even when it is never called.',
        'definition tokens per call and input share on the same model. Fewer definitions are useful only if the needed tools remain available.')
      + section('Current tool and MCP sources', contextStamp() + (current ? sources(['toolDefinition', 'mcpServer'], 'Largest attributed tool and MCP sources') + inspect : inspect))
      + note('Historical definitions do not distinguish built-in from MCP tokens. Current MCP source totals can mix definitions and attributed messages; these rows are not a definition-only or historical bill.');
  }
  if (id === 'results') {
    const rows = (report.tools?.rows || []).slice().sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, 5);
    const messages = category('messages');
    return metrics(metric('Conversation context', messages, 'Current user, assistant, and tool messages together'),
      metric('Of occupied context', share(messages, context?.totalTokens), 'Current snapshot only', percent),
      metric('Recorded tool calls', report.tools?.calls ?? null, 'Selected history; activity, not token charges'))
      + contextStamp() + (current ? sources(['tool'], 'Largest tool-attributed context sources') + inspect : inspect)
      + section('Most-used tools in selected history', rows.length ? table(['Tool', 'Calls', 'Failures', 'Unknown outcome'], rows.map(r => [r.server ? `${r.server} / ${r.mcpTool || r.name}` : r.name, number(r.calls), number(r.failures), number(r.unknown)])) : empty('No matching tool activity was recorded.'))
      + note(`${number(report.tools?.omitted ?? 0)} tool calls omitted for missing or mixed provider attribution. A model filter can also exclude calls with no recorded model.`)
      + insight(messages == null ? 'Tool activity is visible before its context footprint is measurable.' : `${number(messages)} tokens are in conversation and tool messages combined.`,
        'For the next exploration task, ask for a targeted search and relevant excerpts before requesting full files or large command output.',
        'tool-attributed context and input per call on similar work. Call counts do not reveal result size, repeated reads, or historical file-level token cost.');
  }
  if (id === 'cache') {
    const rows = measuredModels('cacheRequests', 'cacheInput');
    return metrics(metric('Uncached input', s.uncachedInput, 'Complete cache splits only', number, partial(s.cacheRequests)),
      metric('Cache read', s.cacheRequests ? s.cacheRead : null, 'Previously cached input reused', number, partial(s.cacheRequests)),
      metric('Cache write', s.cacheRequests ? s.cacheWrite : null, 'Input recorded as a cache write', number, partial(s.cacheRequests)))
      + bars([{ label: 'Uncached', value: s.uncachedInput, color: 'var(--s1)' }, { label: 'Cache read', value: s.cacheRequests ? s.cacheRead : null, color: 'var(--s3)' }, { label: 'Cache write', value: s.cacheRequests ? s.cacheWrite : null, color: 'var(--s4)' }], partial(s.cacheRequests))
      + (rows.length ? section('Cache reuse by model', table(['Model', 'Measured calls', 'Input tokens', 'Read share'], rows.map(r => [r.name, coverage(r.cacheRequests, r.requests), measured(r.cacheInput, r.cacheRequests, r.requests), measured(r.cacheHitRate, r.cacheRequests, r.requests, percent)]))) : empty('No complete cache splits were recorded.'))
      + insight(s.cacheHitRate == null ? 'Missing cache data is not zero reuse.' : `${percent(s.cacheHitRate)} of measured input came from cache.`,
        s.cacheRead > 0 ? 'Keep stable instructions and relevant context for related follow-ups. Use a fresh conversation when the task actually changes.' : 'Compare related follow-ups on the same model before changing your workflow based on this range.',
        'weighted cache-read share and actual credits on comparable work. Cache writes prepare context for reuse; they are not themselves cache hits or proof of waste.');
  }
  if (id === 'skills') {
    const skills = report.skills, rows = (skills?.rows || []).slice().sort((a, b) => b.invocations - a.invocations || a.name.localeCompare(b.name)).slice(0, 5);
    return metrics(metric('Custom instructions', category('customInstructions'), 'Current snapshot estimate'),
      metric('Recorded skill uses', skills?.invocations ?? null, 'Selected dates, project, and session'),
      metric('Failed skill loads', skills?.failures ?? null, 'Explicit failed load attempts'))
      + contextStamp() + (current ? sources(['skill'], 'Largest attributed skill sources') + inspect : inspect)
      + section('Most-used skills in selected history', rows.length ? table(['Skill', 'Source plugin', 'Uses', 'Load failures'], rows.map(r => [r.name, r.plugin || '—', number(r.invocations), number(r.failures ?? 0)])) : empty('No skill uses or failed loads match these filters.'))
      + note(`Skill activity ignores the model filter, matching Breakdown → Skills. ${number(skills?.unattributedUses ?? 0)} uses and ${number(skills?.unattributedFailures ?? 0)} failures are included with provider unverified. ${number(skills?.omitted ?? 0)} uses and ${number(skills?.omittedFailures ?? 0)} failed loads were omitted for rejected or mixed billing-provider evidence. Context sources are not joined to uses by display name.`)
      + insight('A loaded skill has a footprint; an installed skill may have none.',
        'Review large instruction or skill sources for detail that could be loaded only when needed. Keep reusable guidance that helps the agent do the task correctly.',
        'current context after one change and whether the workflow still succeeds. Uses and failures do not price a skill or identify unused skills polluting context.');
  }
  if (id === 'prompts') {
    const p = report.promptCredits || {}, w = p.work || {};
    const incomplete = p.eligiblePrompts < p.prompts || p.unlinkedRequests > 0;
    return (p.modelFiltered ? '<p class="token-topic-status">Selected-model contribution only</p>' : '')
      + metrics(metric('Model calls / prompt', w.averageRequests, `${number(p.eligiblePrompts ?? 0)} of ${number(p.prompts ?? 0)} prompts eligible`, number, incomplete),
        metric('AI credits / prompt', p.averageCredits, 'Complete recorded charges only', credits, incomplete),
        metric('Tokens / prompt', w.averageTokens, `${number(w.tokenPrompts ?? 0)} eligible prompts with complete token counts`, number, incomplete || w.tokenPrompts < p.eligiblePrompts),
        metric('Most calls for one prompt', w.maxRequests, 'Within the eligible prompt set', number, incomplete))
      + note(`Includes initial calls, agent continuations, and subagent work with reliable parent links. ${number(w.requests ?? 0)} linked calls in this view. Tokens include cached input once. Prompts are dated by submission, grouping all linked work before filters; model filters show only selected-model contributions.`)
      + section('Accounting coverage', table(['Excluded for attribution', 'Incomplete charges', 'Unfinished work', 'Unlinked requests'], [[number(p.excluded?.attribution ?? 0), number(p.excluded?.accounting ?? 0), number(p.excluded?.unfinished ?? 0), number(p.unlinkedRequests ?? 0)]]))
      + insight(w.averageRequests == null ? 'Complete prompt chains are needed for this comparison.' : `One submitted prompt led to ${number(w.averageRequests)} model calls on average${p.modelFiltered ? ' on the selected models' : ''}.`,
        'For a comparable task, state the goal, boundaries, and validation steps up front, then let the agent complete the connected work.',
        'calls, tokens, and credits per eligible prompt alongside the result. More calls may be necessary for a harder task; this does not measure prompt quality.');
  }
  if (id === 'delegation') {
    const by = report.efficiency?.byInitiator || [], initiator = key => by.find(r => r.id === key);
    const delegated = initiator('sub-agent'), unknown = initiator('unknown'), where = report.efficiency?.delegation;
    const labels = { user: 'User-initiated call', agent: 'Agent continuation', 'sub-agent': 'Subagent', unknown: 'Not recorded' };
    const rows = (report.efficiency?.delegatedModels || []).slice(0, 5);
    const whole = value => number(Math.round(value)), seconds = value => `${number(value / 1000, { maximumFractionDigits: 1 })} s`;
    // Coverage counts stay exact: "1.8K of 1.8K" would hide how many calls are missing.
    const exact = value => number(value ?? 0, { simplify: false }), covered = (count, total, noun = 'model calls') => `${exact(count)} of ${exact(total)} ${noun}`;
    const lead = text => `<p class="delegation-lead">${esc(text)}</p>`;
    // One side of the comparison. Sums over its initiator rows come first, then each ratio uses
    // only the calls that record that measure. A side with calls but no measurement is unavailable.
    const side = (keys, label, noun, color) => {
      const sum = field => keys.reduce((n, key) => n + (initiator(key)?.[field] || 0), 0), per = (top, bottom, scale = 1) => sum(bottom) > 0 ? sum(top) / sum(bottom) * scale : null;
      const requests = sum('requests'), known = (count, value) => count ? value : requests ? null : 0;
      return { label, noun, color, requests, tokens: known(sum('pairedRequests'), sum('pairedInput') + sum('pairedOutput')), tokenCalls: sum('pairedRequests'),
        credits: known(sum('creditRequests'), sum('credits')), creditCalls: sum('creditRequests'), perCall: per('credits', 'creditRequests'),
        input: per('inputTokens', 'inputRequests'), inputCalls: sum('inputRequests'), output: per('outputTokens', 'outputRequests'), outputCalls: sum('outputRequests'),
        cache: per('cacheRead', 'cacheInput', 100), cacheCalls: sum('cacheRequests'), duration: per('durationTotal', 'durationRequests'), durationCalls: sum('durationRequests') };
    };
    const main = side(['user', 'agent'], 'Main conversation', 'main-conversation calls', 'var(--s1)'), sub = side(['sub-agent'], 'Subagents', 'subagent calls', 'var(--s2)');
    const sides = [main, sub, side(['unknown'], 'Not recorded', 'calls with no recorded initiator', 'var(--muted-fg)')];
    // One whole split three ways. The denominator is the sum of the parts, so it matches them.
    const split = (title, basis, field, calls, format = number) => {
      const total = sides.reduce((n, p) => n + (p[field] || 0), 0), of = p => valid(p[field]) ? p[field] / total * 100 : null;
      return `<div class="delegation-split"><div class="delegation-split-head"><strong>${esc(title)}</strong><span>${esc(basis)}</span></div>`
        + (total > 0 ? `<div class="efficiency-track" role="img" aria-label="${esc(`${title}: ${sides.map(p => `${p.label} ${percent(of(p))}`).join('; ')}`)}">${sides.map(p => of(p) ? `<span style="width:${of(p).toFixed(2)}%;background:${p.color}"></span>` : '').join('')}</div>`
          + `<div class="efficiency-flow-labels">${sides.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${esc(coverageValue(of(p), p[calls] < p.requests, percent, showCoverage))}</b> · ${esc(coverageValue(p[field], false, format))}</span>`).join('')}</div>`
          : empty(sides.some(p => p.requests && valid(p[field])) ? 'The recorded total is 0, so there are no shares to show.' : 'Not recorded on any call in these filters.')) + '</div>';
    };
    // Subagents next to the main conversation for one measure or one model, as two labelled bars.
    const barRow = (p, value, text, detail, scale) => `<div class="token-bar-row" role="listitem"><span class="token-bar-label">${esc(p.label)}</span><span class="token-bar-track" aria-hidden="true"><i style="width:${(valid(value) && scale > 0 ? Math.min(100, value / scale * 100) : 0).toFixed(1)}%;background:${p.color}"></i></span><span class="token-bar-value">${esc(text)}</span><span class="token-bar-detail">${esc(detail)}</span></div>`;
    const pair = (title, a, b) => `<div class="delegation-pair"><h4>${esc(title)}</h4><div class="token-bar-list" role="list">${a}${b}</div></div>`;
    const perCall = (title, field, calls, format, scale = Math.max(sub[field] || 0, main[field] || 0)) => pair(title, ...[sub, main].map(p => barRow(p, p[field], measured(p[field], p[calls], p.requests, format), covered(p[calls], p.requests, p.noun), scale)));
    const mix = (title, m) => pair(title, ...[[sub, m.delegatedRequests, where.delegatedRequests], [main, m.mainRequests, where.mainRequests]].map(([p, count, total]) => barRow(p, share(count, total), percent(share(count, total)), covered(count, total, p.noun), 100)));
    const routed = sub.requests && where?.delegatedRequests ? where.models || [] : [], first = routed[0], top = sub.requests ? where?.topConversations || [] : [], series = where?.series;
    const callShare = share(sub.requests, s.requests);
    return metrics(metric('Recorded subagent calls', delegated?.requests ?? null, 'Explicit sub-agent initiator only'),
      metric('Share of model calls', callShare, `${covered(sub.requests, s.requests)}, counting calls with no recorded initiator in the total`, percent),
      metric('Conversations with subagent calls', where ? where.delegatedConversations : null, where ? `Of ${exact(where.conversations)} conversations with model calls` : 'Not measured in this report'),
      metric('Unknown initiator', unknown?.requests ?? null, 'May contain additional delegated work'))
      + (s.requests > 0 && by.length ? section('Share of usage at a glance', split('Model calls', `All ${exact(s.requests)} model calls`, 'requests', 'requests')
        + split('Measured tokens', `Input, cached input included, plus output on ${covered(s.pairedRequests, s.requests)}`, 'tokens', 'tokenCalls')
        + split('Recorded AI credits', `Complete charges on ${covered(s.creditRequests, s.requests)}`, 'credits', 'creditCalls', credits)
        + note('Main conversation is user-initiated calls plus agent continuations. Each bar splits only the calls that record that measure, so the three bars can rest on different calls. The table at the end gives the coverage for each initiator.')) : '')
      + (sub.requests ? section('A subagent call next to a main-conversation call', lead(!main.requests ? 'No main-conversation calls are in these filters, so subagent calls have nothing to be compared with.'
          : valid(sub.input) && valid(main.input) ? `A subagent call read ${whole(sub.input)} input tokens on average, against ${whole(main.input)} in the main conversation.`
          : 'Input per call is not recorded on both sides in these filters.')
        + `<div class="delegation-pairs">${perCall('Input tokens per call', 'input', 'inputCalls', whole)}${perCall('Output tokens per call', 'output', 'outputCalls', whole)}${perCall('AI credits per call', 'perCall', 'creditCalls', credits)}${perCall('Input read from cache', 'cache', 'cacheCalls', percent, 100)}${perCall('Time per call', 'duration', 'durationCalls', seconds)}</div>`
        + note('Averages over the calls that record each measure. A lower figure for subagents is not a saving on its own: the result still has to be passed back to the main conversation, and the two sides do different work.')) : '')
      + (routed.length || rows.length ? section('Which models did the work', (first?.delegatedRequests ? lead(`${percent(share(first.delegatedRequests, where.delegatedRequests))} of subagent calls ran on ${first.name}.${where.mainRequests > 0 ? ` That model handled ${percent(share(first.mainRequests, where.mainRequests))} of main-conversation calls.` : ''}`) : '')
        + (routed.length ? `<div class="delegation-pairs">${routed.map(m => mix(m.name, m)).join('')}${where.otherModels?.models ? mix(`Other models (${number(where.otherModels.models)})`, where.otherModels) : ''}</div>`
          + note('Each model\'s share of subagent calls next to its share of main-conversation calls. The counts show where calls ran, not why that model was chosen.') : '')
        + (rows.length ? table(['Models used by subagents', 'Calls', 'Input / call', 'Output / call'], rows.map(r => [r.name, number(r.requests), `${measured(r.averageInput, r.inputRequests, r.requests)} (${covered(r.inputRequests, r.requests)})`, `${measured(r.averageOutput, r.outputRequests, r.requests)} (${covered(r.outputRequests, r.requests)})`])) : '')) : '')
      + (where && sub.requests ? section('Where delegation happens', lead(`${covered(where.delegatedConversations, where.conversations, 'conversations')} with model calls had at least one subagent call.`)
        + (top.length ? table(['Conversation', 'Subagent calls', 'All calls', 'Subagent share of its calls'], top.map(r => [r.name, number(r.delegated), number(r.requests), percent(r.share)]))
          + note(`The ${exact(top.length)} conversations with the most subagent calls, of ${exact(where.delegatedConversations)} that had any. Together they made ${percent(share(top.reduce((n, r) => n + r.delegated, 0), where.delegatedRequests))} of subagent calls. A conversation here is one recorded session.`) : '')
        + trendRow(series, p => p.requests > 0 ? p.delegated / p.requests * 100 : null, { label: 'Subagent share of model calls', format: percent })
        + (series?.earlier ? note(`The line covers the latest ${exact(series.points.length)} ${series.unit === 'week' ? 'weeks' : 'days'} with calls. ${exact(series.earlier)} earlier ones are left out.`) : '')) : '')
      + (by.length ? section('Who initiated the model calls?', table(['Recorded initiator', 'Calls', 'Measured tokens', 'Complete credits'], by.map(r => [labels[r.id] || r.id, number(r.requests), r.pairedRequests ? `${measured(r.pairedInput + r.pairedOutput, r.pairedRequests, r.requests)} (${covered(r.pairedRequests, r.requests)})` : 'Unavailable', r.creditRequests ? `${measured(r.credits, r.creditRequests, r.requests, credits)} (${covered(r.creditRequests, r.requests)})` : 'Unavailable']))) : empty('No initiator measurements are available.'))
      + insight(!sub.requests ? 'No explicitly labelled subagent calls in this view.'
          : unknown?.requests > sub.requests ? `${number(unknown.requests)} calls have no recorded initiator, more than the ${number(sub.requests)} labelled as subagent work.`
          : valid(sub.input) && valid(main.input) ? `Subagents made ${percent(callShare)} of model calls and read ${whole(sub.input)} input tokens per call, against ${whole(main.input)} in the main conversation.`
          : `${percent(callShare)} of model calls (${number(sub.requests)}) are explicitly labelled as subagent work.`,
        'For the next task you delegate, give the subagent a bounded goal, the context it needs and a concise return format.',
        'input per subagent call, the subagent share of calls and total credits for similar work. These calls are already part of usage totals. Only calls with an explicit sub-agent initiator are counted, and calls with no recorded initiator may hide more. Parent links and the value of delegation are not inferred.');
  }
  if (id === 'output') {
    const rows = measuredModels('outputRequests', 'outputTokens');
    return metrics(metric('Generated output', s.outputRequests ? s.outputTokens : null, coverage(s.outputRequests), number, partial(s.outputRequests)),
      metric('Reported reasoning', s.reasoningRequests ? s.reasoningTokens : null, coverage(s.reasoningRequests), number, partial(s.reasoningRequests)),
      metric('Reasoning share', s.reasoningShare, 'Only calls with valid reasoning and output counts', percent, partial(s.reasoningRequests)),
      metric('Other output, matched calls', s.otherOutput, 'Not necessarily user-visible answer text', number, partial(s.reasoningRequests)))
      + bars([{ label: 'Reasoning', value: s.reasoningRequests ? s.reasoningTokens : null, color: 'var(--s5)' }, { label: 'Other output', value: s.otherOutput, color: 'var(--s2)' }], partial(s.reasoningRequests))
      + (rows.length ? section('Output by model', table(['Model', 'Output / call', 'Output coverage', 'Reasoning share', 'Reasoning coverage'], rows.map(r => [r.name, measured(r.averageOutput, r.outputRequests, r.requests), coverage(r.outputRequests, r.requests), measured(r.reasoningShare, r.reasoningRequests, r.requests, percent), coverage(r.reasoningRequests, r.requests)]))) : empty('No output measurements were recorded for these filters.'))
      + note('Reasoning is part of output. The split subtracts only on the same measured calls; it can cover fewer calls than Generated output. Other output can include tool-call arguments and is not an answer-length estimate.')
      + insight(s.reasoningShare == null ? 'Reasoning share needs matched output measurements.' : `${percent(s.reasoningShare)} of matched output was reported reasoning.`,
        'Specify the deliverable and useful level of detail. For routine work, compare an available lighter model while keeping the same validation checks.',
        'output and credits per completed comparable task. Less reasoning is not automatically more efficient if it leads to rework.');
  }
  if (id === 'drivers') {
    const all = (report.sessions || []).filter(r => valid(r.credits)).slice().sort((a, b) => b.credits - a.credits || a.name.localeCompare(b.name));
    if (!all.length) return empty('No session charges are recorded for these filters. Unavailable charges are not zero.') + insight('Start with complete charge records.', 'Try a wider range or check enabled data sources before comparing spend.', 'charge coverage and whether the same workload is represented.');
    const rows = all.slice(0, 5), total = all.reduce((sum, r) => sum + r.credits, 0), top = rows.reduce((sum, r) => sum + r.credits, 0);
    const incomplete = !!(report.totals?.missingCredits || report.totals?.partialCredits), groups = all.length, unranked = (report.sessions || []).length - groups;
    const verb = count => count === 1 ? 'makes' : 'make';
    // Concentration: the fewest of the largest groups whose recorded credits reach a share of the total.
    const reach = part => {
      if (!total) return null;
      let sum = 0, count = 0;
      while (count < groups && sum < total * part * (1 - 1e-9)) sum += all[count++].credits;
      return count;
    };
    const half = reach(.5), most = reach(.8);
    // The middle value: half of the measured rows are below it.
    const middle = values => {
      const list = values.filter(valid).sort((a, b) => a - b), mid = list.length >> 1;
      return !list.length ? null : list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
    };
    const multiple = (value, typical) => valid(value) && typical > 0 ? Math.round(value / typical * 10) / 10 : null;
    const versus = (times, what) => times === 1 ? `about the typical ${what}` : `${times === 0 ? `less than ${number(.1)}` : number(times >= 10 ? Math.round(times) : times)} times the typical ${what}`;
    // A typical group needs enough groups to be described; with fewer, each row shows only its own measures.
    const enough = groups >= 5, typicalCalls = enough ? middle(all.map(r => r.requests)) : null, typicalRate = enough ? middle(all.map(r => r.averageCredits)) : null;
    const stat = (label, value, ...details) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${details.filter(Boolean).map(detail => `<dd class="token-driver-sub">${esc(detail)}</dd>`).join('')}</div>`;
    const driver = r => {
      const calls = multiple(r.requests, typicalCalls), rate = multiple(r.averageCredits, typicalRate), missing = r.missing || {};
      const compared = [calls != null && versus(calls, 'number of calls'), rate != null && versus(rate, 'credits per call')].filter(Boolean).join(', ');
      const larger = calls == null || rate == null ? '' : calls >= rate * 1.5 ? 'Larger multiple: call count' : rate >= calls * 1.5 ? 'Larger multiple: credits per call' : 'The two multiples are similar';
      // Each per-call measure divides by the calls that recorded it, never by all calls.
      const inputCalls = valid(r.requests) && valid(missing.inputTotal) ? r.requests - missing.inputTotal : null;
      const splitCalls = valid(r.requests) && valid(missing.cacheRead) && missing.cacheRead === missing.input && missing.cacheRead === missing.cacheWrite ? r.requests - missing.cacheRead : null;
      const splitInput = splitCalls > 0 ? r.input + r.cacheRead + r.cacheWrite : null;
      return `<li><div class="token-driver-head"><strong>${esc(r.name)}</strong><span>${esc(r.project ?? 'Project unavailable')} · ${esc(usageValue(r, 'credits', credits, showCoverage))} AI credits</span></div>`
        + (compared ? `<p>${esc(compared[0].toUpperCase() + compared.slice(1))}.${larger ? ` <span class="token-driver-tag">${esc(larger)}</span>` : ''}</p>` : '')
        + `<dl class="token-driver-stats">${stat('Calls', number(r.requests), typicalCalls != null && `Typical: ${number(typicalCalls)}`)
          + stat('Credits per call', coverageValue(r.averageCredits, r.completeCreditRequests < r.requests, credits, showCoverage), valid(r.completeCreditRequests) && `${coverage(r.completeCreditRequests, r.requests)} with a complete charge`, typicalRate != null && `Typical: ${credits(typicalRate)}`)
          + stat('Input per call', measured(inputCalls > 0 && valid(r.inputTotal) ? Math.round(r.inputTotal / inputCalls) : null, inputCalls, r.requests), inputCalls != null && `${coverage(inputCalls, r.requests)} with an input count`)
          + stat('Cache-read share', measured(share(r.cacheRead, splitInput), splitCalls, r.requests, percent), splitCalls != null && `${coverage(splitCalls, r.requests)} with a cache split`)}</dl></li>`;
    };
    const opener = r => r.id == null || r.project == null ? '' : `<button class="token-driver-open" data-token-session="${esc(r.id)}" data-token-project="${esc(r.project)}">Open in Breakdown<span class="sr-only">: ${esc(r.name)}, ${esc(r.project)}</span></button>`;
    const ranking = `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr>${['Session', 'Project', 'Calls', 'AI credits', 'Recorded share'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td class="text-cell"><span class="cell-text">${esc(r.name)}</span>${opener(r)}</td>${[r.project ?? 'Unavailable', number(r.requests), usageValue(r, 'credits', credits, showCoverage), coverageValue(share(r.credits, total), incomplete, percent, showCoverage)].map(cell => `<td><span class="cell-text">${esc(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    // Where else recorded credits concentrate. Each list is ranked and shared within its own recorded rows.
    const ranked = source => (source || []).filter(r => valid(r.credits)).sort((a, b) => b.credits - a.credits || String(a.name ?? a.day).localeCompare(String(b.name ?? b.day)));
    const spread = (title, source) => {
      const list = ranked(source), sum = list.reduce((n, r) => n + r.credits, 0), shown = list.slice(0, 5), left = (source || []).length - list.length;
      const scope = list.length > shown.length ? `Largest ${number(shown.length)} of ${number(list.length)} with charges` : list.length === 1 ? 'The only one with charges' : `All ${number(list.length)} with charges`;
      // barList formats each drawn row once, in order, so the row's own charge coverage can be marked.
      let next = 0;
      const drawn = barList(shown.map(r => ({ label: r.name ?? r.day, value: r.credits, detail: `${coverageValue(share(r.credits, sum), incomplete, percent, showCoverage)} of recorded credits${valid(r.requests) ? ` · ${number(r.requests)} ${r.requests === 1 ? 'call' : 'calls'}` : ''}` })),
        { total: sum, format: () => usageValue(shown[next++], 'credits', credits, showCoverage) });
      return drawn && `<div><h4>${esc(title)}</h4><p class="token-driver-sub">${esc(`${scope}${left > 0 ? `; ${number(left)} with no recorded charge ${left === 1 ? 'is' : 'are'} not ranked` : ''}`)}</p>${drawn}</div>`;
    };
    const activeDays = (report.daily || []).filter(r => r.requests > 0), days = ranked(activeDays);
    const where = spread('Projects', report.projects) + spread('Models', report.models) + spread('Days', activeDays);
    // A day stands out when it holds a fifth of recorded credits and three times a typical day with usage.
    const dayShare = share(days[0]?.credits, days.reduce((sum, r) => sum + r.credits, 0)), dayTimes = days.length >= 5 ? multiple(days[0].credits, middle(days.map(r => r.credits))) : null;
    const lookAtOne = 'Start with a high-spend session in Breakdown. Compare its model mix, calls, and context against a similar task before changing models or workflow.';
    const [observation, action] = !total ? ['The recorded charges in this range are zero.', lookAtOne]
      : !enough ? [`The largest group accounts for ${percent(share(rows[0].credits, total))} of recorded charges.`, lookAtOne]
      : half <= Math.max(1, Math.floor(groups / 5)) ? [`Recorded credits are concentrated: ${number(half)} of ${number(groups)} session groups ${verb(half)} up half.`, 'Start with the largest group: open it in Breakdown and compare its model mix, calls, and context against a similar task before changing models or workflow.']
      : dayTimes >= 3 && dayShare >= 20 ? [`One day stands out: ${days[0].day} holds ${percent(dayShare)} of recorded credits, ${number(dayTimes >= 10 ? Math.round(dayTimes) : dayTimes)} times a typical day with usage.`, 'Narrow the date range to that day to see which sessions and models ran before reading this range as routine. One large task can account for it.']
      : half >= groups * .4 ? [`Recorded credits are spread out: it takes ${number(half)} of ${number(groups)} session groups to make up half.`, 'No small set of sessions holds most of the charges. Compare projects, models, and credits per call across similar tasks before looking at a single session.']
      : [`${number(half)} of ${number(groups)} session groups ${verb(half)} up half of recorded credits.`, lookAtOne];
    return metrics(metric('Recorded AI credits', total, 'Includes partial reported charges', credits, incomplete),
      metric('Top five groups', share(top, total), `${number(rows.length)} of ${number(groups)} groups with charges`, percent, incomplete),
      metric('Groups making up half', half, `Of ${number(groups)} session ${groups === 1 ? 'group' : 'groups'} with charges`, number, incomplete),
      metric('Groups making up 80%', most, `Of ${number(groups)} session ${groups === 1 ? 'group' : 'groups'} with charges`, number, incomplete))
      + (half == null ? '' : `<p class="token-driver-summary">${esc(groups === 1 ? 'One session group holds all recorded credits in this range.' : `${number(half)} of ${number(groups)} session groups with charges ${verb(half)} up half of recorded credits, and ${number(most)} ${verb(most)} up 80%.`)}</p>`)
      + section('Largest session / project groups', ranking)
      + note(`Incomplete charges can affect the ranking. Shares use recorded charges only. Unavailable charges are excluded; a session spanning projects can appear more than once.${unranked > 0 ? ` ${number(unranked)} with no recorded charge ${unranked === 1 ? 'is' : 'are'} not ranked.` : ''}${enough && total ? ' Charges are called concentrated when a fifth of the groups or fewer make up half, and spread out when it takes two in five or more.' : ''}`)
      + section('How the largest groups compare with a typical one', `<ol class="token-driver-list">${rows.map(driver).join('')}</ol>`
        + note(enough ? `Typical is the middle value across the ${number(groups)} session groups with charges: half are below it. Credits per call uses calls with a complete charge. The larger multiple is named when one is at least ${number(1.5)} times the other. Multiples describe size, not a cause: a long task can need many calls, and credits per call vary with the model and the input each call carries.`
          : `A typical group is described from at least five session groups with charges; this range has ${number(groups)}, so only each group's own measures are shown.`))
      + (where ? section('Where else recorded credits concentrate', `<div class="token-driver-spread">${where}</div>` + note('Each bar is the share of recorded credits held by that row in its own list. The same charges appear in all three lists; do not add them. A typical day is the middle value across days with usage and a recorded charge; a day is called out when it holds at least a fifth of recorded credits and three times a typical day.')) : '')
      + insight(observation, action,
        'actual credits for similar completed work, including follow-ups. A costly session can still be valuable; this ranking does not estimate waste, and partial charges can change it.');
  }
  return '';
}
