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
// `contextPart` splits the context view for the panel: 'snapshot' reads the snapshot alone and
// stays fixed until the next inspection; 'history' also reads the report and follows its filters.
export function renderTokenInsight(id, report, { number, credits, context, showCoverage = true, contextPart } = {}) {
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
    const mix = report.efficiency?.tokenMix || {}, totals = report.totals || {}, trend = report.efficiency?.trend, unit = trend?.unit === 'week' ? 'week' : 'day';
    const pairedTotal = (s.pairedInput || 0) + (s.pairedOutput || 0), inputShare = share(s.pairedInput, pairedTotal);

    // What the tokens were made of: one bar over the calls that can supply every part of it.
    // Each part also carries what to say when it is the largest: subject, experiment, other explanation.
    const parts = [
      { label: 'Uncached input', value: mix.uncachedInput, color: 'var(--s1)', lead: ['Uncached input was',
        'This input was processed fresh instead of being read from cache. Open Cache reuse to compare models. Try keeping related follow-ups in one conversation on the same model.',
        'A new conversation and new material are always processed fresh at first.'] },
      { label: 'Cache read', value: mix.cacheRead, color: 'var(--s3)', lead: ['Cache reads were',
        'Cache reads are input the model had already been sent on an earlier call, such as instructions, tool definitions and conversation history. Open Cache reuse to compare models. For the next long task, try starting a new conversation at a natural break.',
        'A large cache-read share is expected when a conversation has many steps.'] },
      { label: 'Cache write', value: mix.cacheWrite, color: 'var(--s4)', lead: ['Cache writes were',
        'A cache write stores input so that a later call can read it from cache. Open Cache reuse to see how much was read back. Try keeping related follow-ups in one conversation on the same model.',
        'A short conversation can write to the cache with few later calls to read it back.'] },
      { label: 'Output', value: mix.output, color: 'var(--s2)', lead: ['Output was',
        'Open Reasoning and generated output to see how much of it was reasoning. For routine work, try asking for a shorter result and keep the same checks.',
        'Long output can be exactly what the task needed.'] }];
    const mixIncomplete = partial(mix.mixRequests, mix.requests), mixBar = bars(parts, mixIncomplete), mixTotal = mixBar ? parts.reduce((sum, part) => sum + part.value, 0) : 0;
    const reasoned = share(mix.reasoning, mix.reasoning + mix.otherOutput);
    const made = mixBar ? mixBar + note(`Covers ${coverage(mix.mixRequests, mix.requests)}: the calls that record an output count and a complete cache split. Each token is counted once. These are token volumes, not credit shares.`
      + (!mix.reasoningRequests ? ' Reasoning is part of output. None of these calls report a reasoning count, so output is not split further.'
        : reasoned == null ? '' : ` Reasoning is part of output. ${mix.reasoningRequests === mix.mixRequests ? 'All of these calls' : `${number(mix.reasoningRequests)} of these calls`} report it, and there it was ${percent(reasoned)} of output.`))
      : empty('No tokens were recorded on calls with both an output count and a complete cache split in these filters, so the mix is unavailable. Missing counts are not zero.');

    // Who used them: rows whose token total is measured, largest first, kept to the few that are shown.
    const counted = row => valid(row?.total) && !(row.requests > 0 && row.knownTokenRequests === 0);
    const largest = (rows, count) => {
      const top = [];
      for (const row of rows || []) {
        if (!counted(row)) continue;
        let at = top.length;
        while (at > 0 && top[at - 1].total < row.total) at--;
        if (at < count) { top.splice(at, 0, row); if (top.length > count) top.pop(); }
      }
      return top;
    };
    const tokenTotal = counted(totals) && totals.total > 0 ? totals.total : null, tokensIncomplete = !!totals.missingTokens;
    const holder = (rows, one, many, count = 1) => {
      const size = (rows || []).length, top = largest(rows, size > count ? count : 1), held = top.reduce((sum, row) => sum + row.total, 0), value = share(held, tokenTotal);
      if (!top.length || value == null) return null;
      const tokens = `${coverageValue(held, top.some(row => row.missingTokens), number, showCoverage)} of ${usageValue(totals, 'total', number, showCoverage)} measured tokens`, name = top[0].name || `Unnamed ${one}`;
      return top.length > 1
        ? { label: `${top.length === 5 ? 'Five' : number(top.length)} largest ${many}`, value, concentrated: top.length === 5 && size > 10 && value >= 50,
          detail: `${tokens} · ${number(top.length)} of ${number(size)} ${many}. Largest: ${name}, ${percent(share(top[0].total, tokenTotal))}.` }
        : { label: `Largest ${one}`, value, detail: `${name} · ${tokens} · ${size === 1 ? `the only ${one} in these filters` : `largest of ${number(size)} ${many}`}` };
    };
    const conversations = holder(report.sessions, 'conversation', 'conversations', 5);
    const holders = barList([holder(report.models, 'model', 'models'), holder(report.projects, 'project', 'projects'), conversations].filter(Boolean),
      { total: 100, format: value => coverageValue(value, tokensIncomplete, percent, showCoverage) });
    const who = holders ? holders + note(`Shares of measured input and output tokens in these filters, ${report.query?.includeCache === false ? 'excluding' : 'including'} cached input. Token volume is not cost share, and a large share can simply be where most of the work happened. A conversation that spans projects is counted once per project.`)
      : empty('Measured token totals are unavailable for these filters, so shares cannot be shown. Missing counts are not zero.');

    // Is it changing: the same earlier and later averages the trend row states. The sentence below
    // names a change only when each half rests on at least 20 calls.
    const changing = trendRow(trend, point => point.averageInput, { label: 'Input per call', format: number })
      + (s.creditRequests > 0 ? trendRow(trend, point => point.averageCredits, { label: 'Credits per call', format: credits }) : '');
    const periods = (trend?.points || []).filter(point => Number.isFinite(point.averageInput)), half = Math.floor(periods.length / 2), before = periods.slice(0, half), after = periods.slice(periods.length - half);
    const mean = list => list.reduce((sum, point) => sum + point.averageInput, 0) / list.length, calls = list => list.reduce((sum, point) => sum + (point.inputRequests || 0), 0);
    const supported = periods.length >= 4 && calls(before) >= 20 && calls(after) >= 20;
    const earlier = supported ? mean(before) : null, later = supported ? mean(after) : null, ratio = earlier > 0 ? later / earlier : null;

    // The sentence follows the strongest evidence: a large change over time, then a few
    // conversations holding most tokens, then the largest part of the mix.
    const biggest = mixBar ? parts.reduce((a, b) => b.value > a.value ? b : a) : null, rose = ratio >= 1.5, moved = rose || ratio != null && ratio <= 1 / 1.5;
    const sentence = inputShare == null ? ['Start with measurement coverage.', 'Choose a range with both input and output measurements before drawing conclusions.',
        'input and output per model call on similar tasks. Tokens measure resource use, not whether the work was valuable.']
      : moved ? [`Input per call ${rose ? 'rose' : 'fell'} from ${number(earlier)} in the earlier ${unit}s to ${number(later)} in the later ${unit}s.`,
        rose ? 'Later calls read more input on average. Longer conversations, larger files and more tools can each do this. For the next long task, try starting a new conversation at a natural break.'
          : 'Later calls read less input on average. Shorter conversations, smaller tasks and fewer tools can each do this. Note what you changed, then repeat it on a similar task.',
        `input per call on similar tasks before and after. Each ${unit} counts equally in these averages, so a few unusual ${unit}s can move them.`]
      : conversations?.concentrated ? [`Five conversations hold ${coverageValue(conversations.value, tokensIncomplete, percent, showCoverage)} of measured tokens.`,
        'Open Biggest spend drivers to see which conversations carry the largest recorded charges. Pick a large one and compare it with a similar task done in a shorter conversation.',
        'tokens and credits for similar completed work. A long conversation can be the right way to do a large task.']
      : biggest ? [`${biggest.lead[0]} the largest part of measured tokens, at ${coverageValue(biggest.value / mixTotal * 100, mixIncomplete, percent, showCoverage)}.`, biggest.lead[1],
        `the same mix and tokens per call on similar tasks. ${biggest.lead[2]} Token volume is not cost share.`]
      : [`${percent(inputShare)} of matched token volume was input.`, inputShare >= 50
        ? 'Inspect what the model is reading repeatedly: instructions, tool definitions, conversation history, and cached context.'
        : 'Look at generated output and reasoning first, then check how many model calls follow each prompt.',
        'input and output per model call on similar tasks. Tokens measure resource use, not whether the work was valuable.'];

    // One line per other section: its headline number from this report and a way to open it.
    const p = report.promptCredits || {}, by = report.efficiency?.byInitiator || [], delegated = by.find(row => row.id === 'sub-agent'), unknown = by.find(row => row.id === 'unknown');
    const snapshot = (value, measuredDetail, missingDetail) => current ? [value == null ? 'Unavailable' : `${number(value)} tokens`, measuredDetail] : ['Needs Inspect context', missingDetail];
    const setup = ['systemPrompt', 'customInstructions', 'systemTools', 'mcpTools'].map(category), setupTokens = setup.every(valid) ? setup.reduce((a, b) => a + b, 0) : null;
    let charged = 0, charges = 0, topCharge = 0;
    for (const row of report.sessions || []) if (valid(row.credits)) { charged++; charges += row.credits; topCharge = Math.max(topCharge, row.credits); }
    const creditsIncomplete = !!(totals.missingCredits || totals.partialCredits), uses = report.skills?.invocations, toolCalls = report.tools?.calls;
    const index = [
      ['context', 'Always-loaded context', ...snapshot(setupTokens != null && setupTokens <= context?.totalTokens ? setupTokens : null, 'Instructions and tool definitions in the current conversation snapshot.',
        'Instructions and tool definitions in the current conversation. History does not record them.')],
      ['tools', 'Tool and MCP footprint', measured(s.toolShare, s.toolRequests, s.requests, percent), `of measured input described the available tools · ${coverage(s.toolRequests)}`],
      ['results', 'Files, searches, and tool results', ...snapshot(category('messages'), 'Conversation and tool messages in the current conversation snapshot.',
        `${valid(toolCalls) ? `${number(toolCalls)} tool calls recorded in the selected history. ` : ''}History does not record how many tokens their results used.`)],
      ['cache', 'Cache reuse', measured(s.cacheHitRate, s.cacheRequests, s.requests, percent), `of measured input was read from cache · ${coverage(s.cacheRequests)}`],
      ['skills', 'Skills and instruction footprint', ...snapshot(category('customInstructions'), 'Custom instructions in the current conversation snapshot.',
        `${valid(uses) ? `${number(uses)} skill uses recorded in the selected history. ` : ''}History does not record how many tokens a skill added.`)],
      ['prompts', 'Work behind each prompt', coverageValue(p.work?.averageRequests, p.eligiblePrompts < p.prompts || p.unlinkedRequests > 0, value => number(value, { maximumFractionDigits: 1 }), showCoverage),
        `model calls followed one submitted prompt on average · ${number(p.eligiblePrompts ?? 0)} of ${number(p.prompts ?? 0)} prompts eligible${p.modelFiltered ? ' · selected models only' : ''}`],
      ['delegation', 'Delegated work', percent(share(delegated?.requests, s.requests)),
        `of model calls were labelled as subagent work · ${coverage(delegated?.requests)}${unknown?.requests ? `, ${number(unknown.requests)} with no recorded initiator` : ''}`],
      ['output', 'Reasoning and generated output', measured(s.reasoningShare, s.reasoningRequests, s.requests, percent), `of matched output was reported reasoning · ${coverage(s.reasoningRequests)}`],
      ['drivers', 'Biggest spend drivers', coverageValue(share(topCharge, charges), creditsIncomplete, percent, showCoverage),
        !charged ? 'No conversation charges are recorded in these filters. Unavailable charges are not zero.' : !charges ? 'The recorded charges in these filters are zero.'
          : `of recorded AI credits were in the largest conversation · ${number(charged)} conversations with charges`],
    ];
    return section('What the tokens were made of', made)
      + section('Who used them', who)
      + section('Is usage per call changing?', changing || empty(`A trend needs at least four ${unit}s with measurements in these filters.`))
      + insight(...sentence)
      + section('Explore the other sections', `<ul class="token-index" role="list">${index.map(([topic, label, value, detail]) => `<li>${jump(topic, label)}<strong class="token-index-value">${esc(value)}</strong><span class="token-index-detail">${esc(detail)}</span></li>`).join('')}</ul>`);
  }
  if (id === 'context') {
    if (!current) return contextStamp();
    const total = context.totalTokens;
    const parts = [['systemPrompt', 'System instructions', 'var(--s1)'], ['customInstructions', 'Custom instructions', 'var(--s2)'], ['systemTools', 'Built-in tool definitions', 'var(--s3)'],
      ['mcpTools', 'MCP tool definitions', 'var(--s4)'], ['messages', 'Conversation and tool results', 'var(--s5)']].map(([key, label, color]) => ({ key, label, color, value: category(key) }));
    const [, customInstructions, systemTools, mcpTools, messages] = parts;
    // A sum is known only when every part is, and only while it fits inside the snapshot total.
    const sum = list => { const value = list.every(part => part.value != null) ? list.reduce((n, part) => n + part.value, 0) : null; return value != null && value <= total ? value : null; };
    const attributed = sum(parts), setupTokens = sum(parts.slice(0, 4)), definitions = sum([systemTools, mcpTools]);
    const ofContext = value => percent(share(value, total));

    const limit = valid(context.limit) && context.limit > 0 ? context.limit : null, left = limit == null ? null : limit - total;
    const room = section('Room left', limit == null ? empty('Copilot did not report an allowance for this conversation, so the room left is unavailable.')
      : left < 0 ? empty(`This estimate of ${number(total)} tokens is above the reported allowance of ${number(limit)}, so no room left is shown.`)
        : `<div class="efficiency-track" role="img" aria-label="${esc(`${percent(total / limit * 100)} of the allowance used, ${percent(left / limit * 100)} left`)}"><span style="width:${(total / limit * 100).toFixed(1)}%;background:var(--s1)"></span></div>`
          + `<div class="efficiency-flow-labels"><span><i style="background:var(--s1)"></i>Used <b>${esc(number(total))}</b> · ${esc(percent(total / limit * 100))}</span><span><i class="context-room-left"></i>Left <b>${esc(number(left))}</b> · ${esc(percent(left / limit * 100))}</span></div>`
          + note(`Out of the allowance of ${number(limit)} tokens that Copilot reported for this conversation. Both figures are estimates. This view does not show when Copilot shortens a conversation.`));

    const missing = parts.filter(part => part.value == null), remainder = attributed == null ? null : total - attributed;
    const mix = section('What fills the context now', attributed != null && total > 0
      ? `<div class="context-mix">${bars(remainder > 0 ? [...parts, { label: 'Not attributed', value: remainder, color: 'var(--muted-fg)' }] : parts)}</div>`
        + (remainder > 0 ? note(`Copilot attributed ${number(attributed)} of ${number(total)} tokens to these categories. The rest is shown as not attributed.`) : '')
      : `<dl class="efficiency-context-categories">${parts.map(part => `<div><dt>${esc(part.label)}</dt><dd>${esc(part.value == null ? 'Unavailable' : number(part.value))}</dd></div>`).join('')}</dl>`
        + note(missing.length ? `No bar is drawn because ${missing.length === 1 ? 'one category is' : 'some categories are'} unavailable: ${missing.map(part => part.label).join(', ')}. Unavailable is not zero, so a bar of the rest would mislead.`
          : total > 0 ? 'No bar is drawn because these categories add up to more than the snapshot total.' : 'This snapshot holds no tokens.'));

    const balance = section('Setup against conversation', metrics(
      metric('Instructions + definitions', setupTokens, 'Setup: system and custom instructions, built-in and MCP tool definitions'),
      metric('Setup share of context', share(setupTokens, total), 'Of this snapshot, not of historical spend', percent),
      metric('Conversation and tool results', messages.value, 'User, assistant and tool messages together'),
      metric('Conversation share of context', share(messages.value, total), 'Of this snapshot only', percent))
      + note('Setup means instructions and tool definitions. Conversation means what this conversation has added so far, so it grows as the conversation continues.'));

    const kinds = { mcpServer: ['MCP servers', 'You can disconnect a server for tasks that do not need it.'], skill: ['Skills', 'You can shorten a skill, or move detail into files it reads when needed.'],
      plugin: ['Plugins', 'You can disable a plugin for tasks that do not need it.'], toolDefinition: ['Tool definitions', 'Descriptions of tools the agent can call.'],
      tool: ['Tool results', 'Context attributed to tools used in this conversation. Targeted searches and excerpts bring in less than whole files.'],
      subagent: ['Subagents', 'Context attributed to subagents.'], other: ['Other sources', 'Kinds not grouped above. Some are set by Copilot.'] };
    const entries = context.entries || [], listed = entries.filter(entry => valid(entry.tokens) && entry.tokens > 0), parents = new Map(entries.map(entry => [entry.id, entry.label]));
    const largest = listed.reduce((max, entry) => Math.max(max, entry.tokens), 0), groups = new Map(Object.keys(kinds).map(kind => [kind, []]));
    for (const entry of listed) (groups.get(entry.kind) || groups.get('other')).push(entry);
    const shown = [...groups].filter(([, rows]) => rows.length).map(([kind, rows]) => ({ kind, rows: rows.sort((a, b) => b.tokens - a.tokens || String(a.id).localeCompare(String(b.id))) })).sort((a, b) => b.rows[0].tokens - a.rows[0].tokens);
    const sourceRow = entry => ({ label: entry.label || entry.id || 'Unnamed source', value: entry.tokens,
      detail: [share(entry.tokens, total) == null ? '' : `${ofContext(entry.tokens)} of context`, entry.parentId ? `included in ${parents.get(entry.parentId) || 'another source'}` : ''].filter(Boolean).join(' · ') });
    const changeable = section('Sources you can change', shown.length
      ? `<div class="context-source-groups">${shown.map(group => `<div class="context-source-group"><h4>${esc(kinds[group.kind][0])}</h4><span class="sub">${esc(kinds[group.kind][1] + (group.rows.length > 3 ? ` Largest 3 of ${number(group.rows.length)}.` : ''))}</span>${barList(group.rows.slice(0, 3).map(sourceRow), { format: number, total: largest })}</div>`).join('')}</div>`
        + note(`From ${number(listed.length)} attributed sources in this snapshot${context.omitted ? `; ${number(context.omitted)} more were omitted` : ''}. Bars are scaled to the largest source. Parent and child sources can overlap, so do not add rows or groups together.`)
      : empty('Copilot returned no individual sources in this snapshot. This does not establish that none were loaded.'));

    const prompts = report.promptCredits || {}, callsPerPrompt = prompts.work?.averageRequests;
    const perPrompt = setupTokens != null && valid(callsPerPrompt) ? setupTokens * callsPerPrompt : null;
    const history = section('Beside your selected history', metrics(
      metric('Tool definitions, this conversation', definitions, 'Built-in plus MCP definitions in this snapshot'),
      metric('Tool definitions per call, selected history', s.averageToolTokens, `Average over ${coverage(s.toolRequests)}`, number, partial(s.toolRequests)))
      + note('These are two different scopes. The snapshot is one moment in the conversation hosting this dashboard. The history average covers the dates and filters you selected, across conversations and models. A gap between them is expected and is not a finding on its own.')
      + `<div class="context-illustration"><span class="label">Illustration, not a measurement</span>${perPrompt == null
        ? `<p>${esc('Unavailable. It needs every setup category in the snapshot and the recorded model calls per prompt in the selected history.')}</p>`
        : `<strong>${esc(`About ${number(Math.round(perPrompt))} input tokens of setup behind one prompt`)}</strong><p>${esc(`If this setup of ${number(setupTokens)} tokens were sent with every model call, one prompt would carry it ${number(callsPerPrompt, { maximumFractionDigits: 1 })} times. That is the recorded average of model calls per prompt${prompts.modelFiltered ? ' on the selected models' : ''}, measured on ${number(prompts.eligiblePrompts ?? 0)} of ${number(prompts.prompts ?? 0)} prompts. A warm cache would normally serve most of it as cache reads.`)}</p>`
          + note('One snapshot multiplied by a history average. Treat it as a sense of scale only.')}</div>`);

    // The observation names the largest category the user can change; a missing one could be larger.
    const mine = [messages, mcpTools, customInstructions], top = mine.every(part => part.value != null) ? mine.reduce((a, b) => b.value > a.value ? b : a) : null;
    const experiments = {
      messages: ['When your next task is unrelated to this one, start a new conversation and inspect it after its first request.', 'conversation and tool result tokens in the two snapshots, and whether the agent still had the context it needed. A long conversation can need its history.'],
      mcpTools: ['Disconnect one MCP server that this task does not need, then inspect again.', 'MCP tool definition tokens in the two snapshots, and whether the agent still has the tools it needs.'],
      customInstructions: ['Move one task-specific part of your custom instructions into a file the agent reads only when needed, then inspect again.', 'custom instruction tokens in the two snapshots, and whether the agent still follows the guidance.'],
    };
    const [action, compare] = top?.value > 0 ? experiments[top.key] : ['Review the largest contributor you control. Move task-specific detail into references loaded when needed, and keep only relevant integrations enabled for the task.',
      'a new snapshot after one change, then verify the agent still has the instructions and tools it needs.'];
    const advice = insight(top == null ? 'Some context categories are unavailable.' : top.value > 0 ? `${top.label} are the largest part you can change: ${number(top.value)} tokens, ${ofContext(top.value)} of this context.` : 'The parts you can change hold no tokens in this snapshot.',
      action, `${compare} This snapshot does not prove these sources are present on every request.`);

    const snapshot = room + mix + balance + changeable, relation = history + advice;
    return contextPart === 'snapshot' ? snapshot : contextPart === 'history' ? relation : snapshot + relation;
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
    // Each measured main-conversation call sits in exactly one of these situations.
    const timing = report.efficiency?.cacheTiming, situations = timing?.situations || [], situation = key => situations.find(row => row.id === key);
    const situationNames = { under5: 'Under 5 minutes', mid: '5 to 60 minutes', over60: 'Over 60 minutes', first: 'First call of a conversation in the selected range', modelChange: 'First call after a model change' };
    const callCount = count => `${number(count)} ${count === 1 ? 'call' : 'calls'}`;
    const timingBars = (label, keys) => {
      const drawn = barList(keys.map(situation).filter(Boolean).map(row => ({ label: situationNames[row.id], value: row.share, color: 'var(--s3)',
        detail: `${callCount(row.calls)} · ${number(row.cacheRead)} of ${number(row.input)} input tokens read from cache` })), { format: percent, total: 100 });
      return drawn ? `<p class="label cache-timing-group">${esc(label)}</p>${drawn}` : '';
    };
    const unmeasured = Object.keys(situationNames).filter(key => !valid(situation(key)?.share)).map(key => situationNames[key].toLowerCase() + (['under5', 'mid', 'over60'].includes(key) ? ' since the previous call' : ''));
    // A sentence about timing needs enough calls on both sides and a clear difference. The longest
    // such pause leads, unless calls after a model change hold more input that was not read from cache.
    const enoughCalls = 10, clearGap = 20, quick = situation('under5');
    const clearlyLower = key => { const row = situation(key); return quick?.calls >= enoughCalls && valid(quick.share) && row?.calls >= enoughCalls && valid(row.share) && quick.share - row.share >= clearGap ? row : null; };
    const notRead = row => row ? row.input - row.cacheRead : 0;
    const longPause = clearlyLower('over60'), shortPause = clearlyLower('mid'), switched = clearlyLower('modelChange');
    const lower = switched && notRead(switched) > notRead(longPause) + notRead(shortPause) ? switched : longPause || shortPause || switched;
    const skipped = timing?.mainCalls - timing?.measuredCalls;
    const when = timing?.measuredCalls
      ? note(`Compares calls in the main conversation: ${number(timing.measuredCalls)} of ${number(timing.mainCalls)} have a complete cache split.${skipped > 0 ? ` ${skipped === 1 ? 'The other one is' : `The other ${number(skipped)} are`} not compared.` : ''} Subagent calls run in parallel and cannot be put in order, so they are left out, as are calls with no recorded initiator.`)
        + timingBars('Share of input read from cache, by time since the previous call in the same conversation', ['under5', 'mid', 'over60'])
        + timingBars('Share of input read from cache on a first call', ['first', 'modelChange'])
        + (unmeasured.length ? note(`Nothing measured in this selection for: ${unmeasured.join('; ')}. That is not zero reuse.`) : '')
        + note(`Each call is counted in one row. The time rows cover calls on the same model as the call before them. A conversation's first call in the selected range is not necessarily its true start: earlier calls can fall outside the range or filters. Rows can differ in other ways too, such as how long the conversation already was.${timing.modelFiltered ? ' A model filter is on, so calls on other models are not seen: some pauses look longer than they were and some model changes are missed.' : ''}`)
        + note(`The summary sentence below compares a row with the under 5 minutes row only when both have at least ${number(enoughCalls)} calls and the shares differ by at least ${number(clearGap)} percentage points.`)
      : empty('No main-conversation calls with a complete cache split match these filters, so reuse cannot be compared by timing. Missing data is not zero reuse.');
    const listed = timing?.sessions || [];
    const conversations = !timing?.measuredCalls ? '' : section('Conversations with the most input not read from cache', listed.length
      ? table(['Conversation', 'Measured calls', 'Input tokens', 'Not read from cache', 'Read share'], listed.map(r => [r.name || 'Unnamed session', number(r.calls), number(r.input), number(r.notRead), percent(r.share)]))
        + note(`Showing ${number(listed.length)} of ${number(timing.listedSessions)} conversations with at least ${number(timing.minimumSessionCalls)} measured main-conversation calls. Not read from cache is input minus cache reads, so it includes cache writes. A long conversation can lead this list with ordinary reuse; this is not proof of waste.`)
      : empty(`No conversation has at least ${number(timing.minimumSessionCalls)} measured main-conversation calls in this selection.`));
    return metrics(metric('Uncached input', s.uncachedInput, 'Complete cache splits only', number, partial(s.cacheRequests)),
      metric('Cache read', s.cacheRequests ? s.cacheRead : null, 'Previously cached input reused', number, partial(s.cacheRequests)),
      metric('Cache write', s.cacheRequests ? s.cacheWrite : null, 'Input recorded as a cache write', number, partial(s.cacheRequests)))
      + bars([{ label: 'Uncached', value: s.uncachedInput, color: 'var(--s1)' }, { label: 'Cache read', value: s.cacheRequests ? s.cacheRead : null, color: 'var(--s3)' }, { label: 'Cache write', value: s.cacheRequests ? s.cacheWrite : null, color: 'var(--s4)' }], partial(s.cacheRequests))
      + trendRow(report.efficiency?.trend, point => point.cacheHitRate, { label: 'Share of input read from cache', format: percent })
      + section('When is input reused?', when)
      + conversations
      + (rows.length ? section('Cache reuse by model', table(['Model', 'Measured calls', 'Input tokens', 'Read share'], rows.map(r => [r.name, coverage(r.cacheRequests, r.requests), measured(r.cacheInput, r.cacheRequests, r.requests), measured(r.cacheHitRate, r.cacheRequests, r.requests, percent)]))) : empty('No complete cache splits were recorded.'))
      + (lower && lower === switched
        ? insight(`Right after a model change, calls read ${percent(lower.share)} of their input from cache. With no model change and under 5 minutes since the previous call, they read ${percent(quick.share)}.`,
          'Lower reuse after a model change is consistent with a cache that is not shared between models, but the data does not record why. For one piece of connected work, try choosing the model at the start and keeping it.',
          'the share read from cache and actual credits on comparable work. Changing model can still be the right choice for a harder step.')
        : lower ? insight(`After a pause of ${lower === longPause ? 'over 60 minutes' : '5 to 60 minutes'}, calls read ${percent(lower.share)} of their input from cache. With under 5 minutes since the previous call, they read ${percent(quick.share)}.`,
          'Lower reuse after a pause is consistent with a cache that expired, but the data does not record why. When you come back to a long conversation after a break, try a new conversation with a short summary for one comparable task.',
          'input tokens and actual credits for the work after the break. A new conversation also starts with little reuse, so look at how much input is processed, not only at the share.')
        : insight(s.cacheHitRate == null ? 'Missing cache data is not zero reuse.' : `${percent(s.cacheHitRate)} of measured input came from cache.`,
          s.cacheRead > 0 ? 'Keep stable instructions and relevant context for related follow-ups. Use a fresh conversation when the task actually changes.' : 'Compare related follow-ups on the same model before changing your workflow based on this range.',
          'weighted cache-read share and actual credits on comparable work. Cache writes prepare context for reuse; they are not themselves cache hits or proof of waste.'));
  }
  if (id === 'skills') {
    const skills = report.skills, all = skills?.rows || [];
    const rows = all.slice().sort((a, b) => b.invocations - a.invocations || String(a.name).localeCompare(String(b.name))).slice(0, 5);
    const count = value => valid(value) ? number(value) : 'Unavailable';
    const things = (value, one) => `${count(value)} ${value === 1 ? one : one + 's'}`;
    const text = value => `<span class="cell-text">${esc(value)}</span>`;
    // How each recorded use came to be loaded. A use whose trigger a row does not carry stays
    // "not recorded"; it is never moved into another group.
    const loads = [['preloaded', 'Preloaded at start', 'preloaded', 'var(--s4)'], ['agent', 'Invoked by the agent', 'by the agent', 'var(--s1)'],
      ['manual', 'Invoked by you', 'by you', 'var(--s3)'], ['unknown', 'Not recorded', 'not recorded', 'var(--muted-fg)']];
    const loaded = new Map(all.map(row => {
      const counts = loads.map(([key]) => valid(row.triggers?.[key]) ? row.triggers[key] : 0);
      counts[3] += Math.max(0, (valid(row.invocations) ? row.invocations : 0) - counts.reduce((sum, n) => sum + n, 0));
      return [row, counts];
    }));
    const split = [0, 0, 0, 0];
    for (const counts of loaded.values()) counts.forEach((n, i) => { split[i] += n; });
    const uses = split.reduce((sum, n) => sum + n, 0);
    const splitBar = bars(loads.map(([, label, , color], i) => ({ label, value: split[i], color })));
    const loadCell = row => {
      const counts = loaded.get(row), total = counts.reduce((sum, n) => sum + n, 0);
      if (!total) return text('No recorded uses');
      const parts = loads.map(([, , short, color], i) => ({ short, color, value: counts[i] })).filter(part => part.value > 0);
      return `<span class="token-skill-split" aria-hidden="true">${parts.map(part => `<i style="width:${(part.value / total * 100).toFixed(1)}%;background:${part.color}"></i>`).join('')}</span>`
        + text(parts.slice().sort((a, b) => b.value - a.value).map(part => `${number(part.value)} ${part.short}`).join(', '));
    };
    const usedOn = row => {
      const at = Date.parse(row.lastUsed);
      return Number.isFinite(at) ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unavailable';
    };
    const mostUsed = () => `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table token-skill-table"><thead><tr>${['Skill', 'Source plugin', 'Uses', 'How it was loaded', 'Conversations', 'Projects', 'Last used', 'Failed loads'].map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td class="text-cell">${text(r.name || 'Unnamed skill')}</td><td>${text(r.plugin || 'None recorded')}</td><td>${text(count(r.invocations))}</td><td>${loadCell(r)}</td><td>${text(count(r.sessions))}</td><td>${text(count(r.projects))}</td><td>${text(usedOn(r))}</td><td>${text(count(r.failures))}</td></tr>`).join('')}</tbody></table></div>`
      + note(`Showing ${number(rows.length)} of ${things(all.length, 'skill')} with recorded activity, most used first. Uses count recorded loads, including preloaded ones; failed loads are counted separately. Last used is the most recent recorded use or failed load.`);

    // Conversations with model calls give a sense of scale. They are not a matched denominator:
    // skill activity ignores the model filter and can come from a conversation with no model call
    // in these dates, so no share is shown.
    const modelFiltered = Array.isArray(report.query?.models), calls = report.totals?.sessions;
    // Without all four counts, what was included or left out is unknown rather than none.
    const audited = ['unattributedUses', 'unattributedFailures', 'omitted', 'omittedFailures'].every(key => valid(skills?.[key]));
    const unverified = audited ? skills.unattributedUses + skills.unattributedFailures : null, left = audited ? skills.omitted + skills.omittedFailures : null;
    const scale = modelFiltered ? ' The model filter does not apply here.'
      : unverified === 0 && valid(calls) && valid(skills.sessions) && skills.sessions <= calls ? ` For scale, ${things(calls, 'conversation')} had model calls in this view.` : '';
    const used = skills ? all.filter(row => row.invocations > 0).length : null, failedOnly = all.length - (used ?? 0);

    const footprint = () => {
      const of = value => {
        if (value == null) return current ? 'Not available in this snapshot' : 'Needs a context snapshot';
        const part = share(value, context.totalTokens);
        return part == null ? 'Share of context unavailable' : `${percent(part)} of occupied context`;
      };
      const custom = category('customInstructions'), system = category('systemPrompt');
      const tiles = metrics(metric('Custom instructions', custom, of(custom)), metric('System instructions', system, of(system) + (system == null ? '' : '; excludes custom instructions')));
      const unmatched = 'Context sources are not joined to uses by display name';
      if (!current) return tiles + contextStamp() + note(`A snapshot covers the current conversation only. ${unmatched}.`) + inspect;
      const entries = context.entries || [], byId = new Map(entries.map(entry => [entry.id, entry]));
      const name = entry => entry.label || entry.id || 'Unnamed source';
      const lists = [['skill', 'Skill sources'], ['plugin', 'Plugin sources']].map(([kind, title]) => ({ kind, title,
        list: entries.filter(entry => entry.kind === kind && valid(entry.tokens)).sort((a, b) => b.tokens - a.tokens || String(a.id).localeCompare(String(b.id))) }));
      // One scale for both lists, so a bar in one can be compared with a bar in the other.
      const largest = Math.max(0, ...lists.map(({ list }) => list[0]?.tokens ?? 0));
      const tokens = value => { const part = share(value, context.totalTokens); return part == null ? number(value) : `${number(value)} · ${percent(part)}`; };
      const column = ({ kind, title, list }) => `<div><h4>${esc(title)}</h4>${!list.length ? empty(`Copilot returned no attributed ${kind} sources in this snapshot. This does not establish that none were loaded.`)
        : barList(list.slice(0, 5).map(entry => ({ label: name(entry), value: entry.tokens, detail: entry.parentId && byId.has(entry.parentId) ? `Parent source: ${name(byId.get(entry.parentId))}` : '' })), { format: tokens, total: largest })
          || empty(`${things(list.length, kind + ' source')} listed with 0 tokens in this snapshot.`)}</div>`;
      return tiles + contextStamp() + `<div class="token-skill-sources">${lists.map(column).join('')}</div>`
        + note(`Tokens in the current conversation, with each source's share of occupied context. Showing ${lists.map(({ kind, list }) => `${number(Math.min(list.length, 5))} of ${things(list.length, kind + ' source')}`).join(' and ')} in the retained snapshot${context.omitted ? `; ${number(context.omitted)} entries were omitted from the snapshot` : ''}. Parent and child sources can overlap; do not add these rows.`)
        + note(`These sources sit beside the recorded uses above without being matched to them. ${unmatched}, so the same name in both places does not prove the same skill.`)
        + inspect;
    };

    const caveats = ['Skill activity ignores the model filter, the same as Breakdown → Skills.',
      ...(!skills ? [] : !audited ? ['How many uses had an unverified provider, or were left out for rejected or mixed billing-provider evidence, is unavailable for this view.']
        : [`${unverified ? `${things(skills.unattributedUses, 'use')} and ${things(skills.unattributedFailures, 'failed load')} are included although the provider could not be verified.` : 'No uses or failed loads are included with an unverified provider.'} ${left ? `${things(skills.omitted, 'use')} and ${things(skills.omittedFailures, 'failed load')} were left out because the billing-provider evidence was rejected or mixed.` : 'None were left out for rejected or mixed billing-provider evidence.'}`]),
      'Counts show activity, not cost. Uses and failed loads do not price a skill, and they cannot show that a skill sat unused in context.'];

    // The most a single skill reached on one measure. Worded so that a tie stays true.
    const most = pick => all.reduce((best, row) => (pick(row) || 0) > (pick(best) || 0) ? row : best, all[0]);
    const preloadedShare = uses ? split[0] / uses * 100 : null;
    let found;
    if (!skills) found = ['Skill activity is not available for this view.', 'Refresh the report or try a wider date range.',
      'recorded skill uses and failed loads once the report loads. Unavailable is not zero.'];
    else if (preloadedShare >= 25) {
      const lead = most(row => loaded.get(row)[0]), counts = loaded.get(lead);
      found = [`${number(split[0])} of ${number(uses)} recorded skill uses (${percent(preloadedShare)}) ${split[0] === 1 ? 'was' : 'were'} preloaded at the start of a conversation.`,
        `No skill was preloaded more often than ${lead.name || 'Unnamed skill'}: ${number(counts[0])} of its ${things(counts.reduce((sum, n) => sum + n, 0), 'recorded use')}. For one comparable task, try a conversation where that skill is not preloaded, so it loads only if the task calls for it.`,
        'a new context snapshot and whether the task still succeeds. A preloaded skill may be exactly what the task needs; these counts do not show whether the agent relied on it.'];
    } else if (skills.failures > 0) {
      const lead = most(row => row.failures);
      found = [`${things(skills.failures, 'skill load')} failed in this view.`,
        lead?.failures > 0 ? `No skill had more failed loads than ${lead.name || 'Unnamed skill'} (${number(lead.failures)}). Retry it on a small task in a new conversation and note whether it loads.`
          : 'Find the skill in Breakdown → Skills, then retry it on a small task in a new conversation and note whether it loads.',
        'failed loads for that skill over the following week. A failed load can be followed by a successful retry, so this count does not show that work stopped or why the load failed.'];
    } else if (uses) {
      const common = [1, 2, 3].reduce((best, i) => split[i] > split[best] ? i : best, 1);
      found = [common === 3 ? `How the skill was loaded was not recorded for ${number(split[3])} of ${things(uses, 'skill use')}.`
        : `${number(split[common])} of ${number(uses)} recorded skill uses (${percent(split[common] / uses * 100)}) ${split[common] === 1 ? 'was' : 'were'} invoked ${common === 1 ? 'by the agent' : 'by you'} during a conversation.`,
        'Take a context snapshot before and after a task that invokes a skill, to see what that skill adds to context.',
        'the skill sources in the two snapshots. A use count does not show how many tokens a skill added or whether it helped.'];
    } else found = ['No skill uses or failed loads were recorded in this view.', 'Try a wider date range or fewer filters.',
      'recorded skill uses and failed loads in the wider view. No recorded use does not show that no skill was in context.'];

    return metrics(metric('Recorded skill uses', skills?.invocations ?? null, 'Selected dates, project, and session'),
      metric('Skills used', used, failedOnly > 0 ? `Different skills with a recorded use; ${things(failedOnly, 'other')} had only failed loads` : 'Different skills with at least one recorded use'),
      metric('Conversations with skill activity', skills?.sessions ?? null, `At least one recorded use or failed load.${scale}`),
      metric('Failed skill loads', skills?.failures ?? null, 'Explicit failed load attempts'))
      + (all.length ? section('How skills were loaded', splitBar
        ? splitBar + note('A preloaded skill was loaded when the conversation\'s context was set up, so it takes up context whether or not the task goes on to need it. An invoked skill was loaded during the conversation, when the agent or you asked for it.')
        : empty('No recorded skill uses match these filters, only failed loads.')) : '')
      + section('Most-used skills in selected history', rows.length ? mostUsed() : empty('No skill uses or failed loads match these filters.'))
      + section('Current instruction, skill and plugin footprint', footprint())
      + `<ul class="footnote token-skill-notes">${caveats.map(caveat => `<li>${esc(caveat)}</li>`).join('')}</ul>`
      + insight(...found);
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
    const rows = measuredModels('outputRequests', 'outputTokens'), e = report.efficiency || {}, mix = e.outputMix;
    const exact = value => number(value, { simplify: false }), whole = value => number(value, { maximumFractionDigits: value < 10 ? 1 : 0 });
    const seconds = value => value < 1000 ? `${number(value, { maximumFractionDigits: 0 })} ms` : `${number(value / 1000, { maximumFractionDigits: 1 })} s`;
    const withCalls = (value, count, total, format) => `${measured(value, count, total, format)} (${coverage(count, total)})`;
    const rework = 'Less reasoning is not automatically more efficient if it leads to rework.';

    // How output is spread across calls, by the size of one call's output.
    const long = mix?.concentration, longCalls = long ? `Calls over ${exact(long.over)} output tokens were ${percent(long.callShare)} of measured calls and produced ${percent(long.tokenShare)} of output.` : '';
    const sizeName = b => b.max == null ? `Over ${exact(b.min - 1)} tokens` : b.min ? `${exact(b.min)} to ${exact(b.max)} tokens` : `Up to ${exact(b.max)} tokens`;
    const spreadBars = mix?.outputRequests ? barList(mix.buckets.map(b => ({ label: sizeName(b), value: b.tokenShare,
      detail: `${number(b.calls)} ${b.calls === 1 ? 'call' : 'calls'}, ${percent(b.callShare)} of measured calls · ${number(b.tokens)} output tokens` })), { format: value => measured(value, mix.outputRequests, mix.requests, percent), total: 100 }) : '';
    const spread = !mix?.outputRequests ? '' : section('How output is spread across calls',
      (long ? `<p>${esc(longCalls)}</p>` : '')
      + (spreadBars || empty('Every call with a known output count reported zero output tokens, so there is no spread to show.'))
      + note(`Each bar is a group's share of all output tokens, and the line under it gives the same group's share of calls. Calls are grouped by the output of one model call, reasoning included. ${mix.outputRequests < mix.requests ? `${number(mix.requests - mix.outputRequests)} of ${number(mix.requests)} model calls have no known output count and are in no group.` : 'Every model call in these filters has a known output count.'}`));

    // Effort levels are compared inside one model only, and only where each level has enough calls.
    const levelOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], enough = 30, byModel = new Map();
    for (const r of e.efforts || []) {
      let group = byModel.get(r.name);
      if (!group) byModel.set(r.name, group = { name: r.name, levels: [], matched: 0, requests: 0, unknown: 0 });
      const rank = levelOrder.indexOf(r.effort);
      group.requests += r.requests || 0;
      if (rank < 0) group.unknown += r.requests || 0;
      else if (r.reasoningRequests >= enough && valid(r.reasoningShare)) { group.levels.push({ rank, row: r }); group.matched += r.reasoningRequests; }
    }
    const comparable = [...byModel.values()].filter(group => group.levels.length > 1).sort((a, b) => b.matched - a.matched || String(a.name).localeCompare(String(b.name)));
    const compared = comparable.slice(0, 5);
    for (const group of compared) group.levels.sort((a, b) => a.rank - b.rank);
    const effortSection = !(e.efforts || []).length ? '' : section('Reasoning by effort level', compared.length
      ? table(['Model', 'Effort', 'Reasoning share', 'Output / call', 'Average call duration'], compared.flatMap(group => group.levels.map(({ row: r }) => [group.name, r.effort,
        withCalls(r.reasoningShare, r.reasoningRequests, r.requests, percent), withCalls(r.averageOutput, r.outputRequests, r.requests, whole), withCalls(r.averageDuration, r.durationRequests, r.requests, seconds)])))
        + note(`Compare rows of the same model only. A level is listed when at least ${number(enough)} of its calls report both reasoning and output, and a model needs two such levels.${comparable.length > compared.length ? ` Showing ${number(compared.length)} of ${number(comparable.length)} models with comparable levels.` : ''} Calls with no recorded effort level are left out, because unknown is not a level: ${number(compared.reduce((sum, group) => sum + group.unknown, 0))} of ${number(compared.reduce((sum, group) => sum + group.requests, 0))} calls on the models shown. The calls at each level were different work, so a gap between levels is not the effect of effort alone.`)
      : empty(`No model has two recorded effort levels with at least ${number(enough)} calls each that report both reasoning and output, so levels are not compared here. Calls with no recorded effort level are not counted as a level.`));

    const speed = s.durationRequests > 0 ? section('Speed and call duration by model',
      metrics(metric('Output tokens per second of call time', s.outputPerSecond, coverage(s.paceRequests), whole, partial(s.paceRequests)),
        metric('Average call duration', s.averageDuration, coverage(s.durationRequests), seconds, partial(s.durationRequests)))
      + (rows.length ? table(['Model', 'Output tokens per second of call time', 'Speed coverage', 'Average call duration', 'Duration coverage'], rows.map(r => [r.name, measured(r.outputPerSecond, r.paceRequests, r.requests, whole), coverage(r.paceRequests, r.requests), measured(r.averageDuration, r.durationRequests, r.requests, seconds), coverage(r.durationRequests, r.requests)])) : '')
      + note('Speed is output tokens divided by the whole recorded duration of the call, which includes the wait before the first token. It is not a streaming rate. A call counts toward speed only when it records an output count and a duration above zero. Short calls spend more of their time waiting, so a model used for small outputs shows a lower figure. Compare models on similar work.'))
      : s.outputRequests > 0 ? section('Speed and call duration by model', empty('No call durations were recorded for these filters, so speed is unavailable.')) : '';

    const trends = trendRow(e.trend, point => point.averageOutput, { label: 'Output per call', format: whole })
      + trendRow(e.trend, point => point.reasoningShare, { label: 'Reasoning share of output', format: percent });
    const overTime = trends ? section('Output and reasoning over time', trends)
      : s.outputRequests > 0 ? section('Output and reasoning over time', empty('A trend line needs at least four days or weeks with measurements in the selected range.')) : '';

    // The observation comes from the clearest evidence on screen: an effort gap inside one model,
    // then a few long calls holding most of the output, then the overall reasoning share.
    let gap = null;
    for (const group of compared) {
      const ordered = group.levels.slice().sort((a, b) => a.row.reasoningShare - b.row.reasoningShare), low = ordered[0], high = ordered.at(-1);
      const size = high.row.reasoningShare - low.row.reasoningShare;
      if (size >= 10 && (!gap || size > gap.size)) gap = { size, name: group.name, upper: high.rank > low.rank ? high.row : low.row, lower: high.rank > low.rank ? low.row : high.row };
    }
    const concentrated = long && long.tokenShare >= 2 * long.callShare;
    const finding = gap ? insight(`On ${gap.name}, ${percent(gap.upper.reasoningShare)} of matched output was reported reasoning at effort level ${gap.upper.effort} and ${percent(gap.lower.reasoningShare)} at effort level ${gap.lower.effort}.`,
        'Run one routine task you know well at each of these two levels on this model, with the same validation checks.',
        `reasoning share, output per call, call duration and credits for the two runs, and whether either needed rework. The recorded calls at each level were different work, so this gap is not the effect of effort alone. ${rework}`)
      : concentrated ? insight(longCalls,
        'For the next task that would need a long generation, ask for a targeted change or a short summary first, then request the full text only where you need it.',
        `output per call and the share of output from calls over ${exact(long.over)} tokens on similar work. Long output can be what the task needs, and it can include tool-call arguments such as a file being written. ${rework}`)
      : insight(s.reasoningShare == null ? 'Reasoning share needs matched output measurements.' : `${percent(s.reasoningShare)} of matched output was reported reasoning.`,
        'Specify the deliverable and useful level of detail. For routine work, compare an available lighter model while keeping the same validation checks.',
        `output and credits per completed comparable task. ${rework}`);

    return metrics(metric('Generated output', s.outputRequests ? s.outputTokens : null, coverage(s.outputRequests), number, partial(s.outputRequests)),
      metric('Reported reasoning', s.reasoningRequests ? s.reasoningTokens : null, coverage(s.reasoningRequests), number, partial(s.reasoningRequests)),
      metric('Reasoning share', s.reasoningShare, 'Only calls with valid reasoning and output counts', percent, partial(s.reasoningRequests)),
      metric('Other output, matched calls', s.otherOutput, 'Not necessarily user-visible answer text', number, partial(s.reasoningRequests)))
      + bars([{ label: 'Reasoning', value: s.reasoningRequests ? s.reasoningTokens : null, color: 'var(--s5)' }, { label: 'Other output', value: s.otherOutput, color: 'var(--s2)' }], partial(s.reasoningRequests))
      + note('Reasoning is part of output. The split subtracts only on the same measured calls; it can cover fewer calls than Generated output. Other output can include tool-call arguments and is not an answer-length estimate.')
      + overTime + spread
      + (rows.length ? section('Output by model', table(['Model', 'Output / call', 'Output coverage', 'Reasoning share', 'Reasoning coverage'], rows.map(r => [r.name, measured(r.averageOutput, r.outputRequests, r.requests), coverage(r.outputRequests, r.requests), measured(r.reasoningShare, r.reasoningRequests, r.requests, percent), coverage(r.reasoningRequests, r.requests)]))) : empty('No output measurements were recorded for these filters.'))
      + effortSection + speed + finding;
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
