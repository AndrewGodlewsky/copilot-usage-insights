import { esc, usageValue, coverageValue } from './charts.mjs';
import { renderOverviewTopic } from './overview-topic.mjs';
import { renderContextTopic } from './context-topic.mjs';

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
  const labelHtml = row => row.action
    ? `<button class="model-toggle token-bar-button" ${row.action.attr}="${esc(row.action.value)}" title="${esc(row.action.title)}">${esc(row.label)}<span class="sr-only">: ${esc(row.action.sr)}</span></button>`
    : esc(row.label);
  return `<div class="token-bar-list" role="list">${drawn.map(row => `<div class="token-bar-row" role="listitem"><span class="token-bar-label">${labelHtml(row)}</span><span class="token-bar-track" aria-hidden="true"><i style="width:${Math.min(100, row.value / scale * 100).toFixed(1)}%${row.color ? `;background:${row.color}` : ''}"></i></span><span class="token-bar-value">${esc(format(row.value))}</span>${row.detail ? `<span class="token-bar-detail">${esc(row.detail)}</span>` : ''}</div>`).join('')}</div>`;
}
// Shared conversation drill-down button and Efficiency cross-topic jump button.
export function openSessionButton(name, id, project = '') {
  const label = name || 'Unnamed session';
  if (!id) return `<span class="cell-text">${esc(label)}</span>`;
  return `<button class="model-toggle cell-text" data-efficiency-open-session="${esc(id)}" data-efficiency-open-project="${esc(project || '')}" aria-label="${esc(label)}: open this conversation in Breakdown" title="Open this conversation in Breakdown">${esc(label)}</button>`;
}
export function topicJumpButton(section, topic, label) {
  return `<button class="model-toggle" data-efficiency-jump-section="${esc(section)}" data-efficiency-jump-topic="${esc(topic)}">${esc(label)}</button>`;
}

// Render from the report and the explicitly requested context snapshot only.
// `contextPart` splits the context view for the panel: 'snapshot' reads the snapshot alone and
// stays fixed until the next inspection; 'history' also reads the report and follows its filters.
export function renderTokenInsight(id, report, { number, credits, context, previousContext, showCoverage = true, contextPart } = {}) {
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
  const table = (headers, rows) => `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' class="text-cell"' : ''}>${cell && typeof cell === 'object' && 'html' in cell ? cell.html : `<span class="cell-text">${esc(cell)}</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
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
  const topicCtx = { s, models, number, credits, context, previousContext, showCoverage, contextPart, valid, percent, share, note, empty, section, metric, metrics, coverage, partial, measured, table, insight, jump, inspect, bars, current, category, contextStamp, measuredModels };

  if (id === 'overview') return renderOverviewTopic(report, topicCtx);
  if (id === 'context') return renderContextTopic(report, topicCtx);
  if (id === 'tools') {
    const rows = measuredModels('toolRequests', 'toolTokens');
    const fp = report.efficiency?.toolFootprint, trend = report.efficiency?.trend;
    const figure = value => valid(value) ? number(value) : 'Unavailable';
    const tools = n => `${number(n)} ${n === 1 ? 'tool' : 'tools'}`;

    // Does the footprint move with how many tools were available? Groups of neighbouring counts.
    const groups = fp?.buckets || [], groupName = g => g.min === g.max ? tools(g.min) : `${number(g.min)} to ${number(g.max)} tools`;
    const noCount = fp ? fp.requests - fp.countCalls : null, unmatched = fp ? fp.countCalls - fp.pairedCalls : null;
    const byCount = groups.length
      ? table(['Tools available', 'Calls with a count', 'Calls measured', 'Definitions / call', 'Input share'],
        groups.map(g => [groupName(g), number(g.calls), number(g.measured), figure(g.averageTokens), percent(g.share)]))
        + note(`Covers ${coverage(fp.pairedCalls, fp.requests)}: the calls that record both how many tools were available and their definition tokens. ${[noCount && `${number(noCount)} calls record no tool count`, unmatched && `${number(unmatched)} record a count but no usable definition size`].filter(Boolean).map(x => x + ". ").join("")}Calls missing either are left out. Groups hold about a third of the calls that record a count and never split one count.`)
      : empty(fp?.countCalls ? 'Every call that records a tool count shows the same count, so there is nothing to compare between groups.' : 'No calls in these filters record how many tools were available, so footprint cannot be grouped by it. Missing counts are not zero.');

    // Projects with the largest definition footprint per call, from a stated minimum sample.
    const projects = fp?.projects || [];
    const byProject = projects.length
      ? table(['Project', 'Measured calls', 'Definitions / call', 'Input share', 'Tools available / call'],
        projects.map(p => [p.name, number(p.calls), number(p.averageTokens), percent(p.share), p.averageAvailable == null ? 'Unavailable' : number(p.averageAvailable, { maximumFractionDigits: 1 })]))
        + note(`Showing ${number(projects.length)} of ${number(fp.listedProjects)} projects with at least ${number(fp.minimumProjectCalls)} calls that record definition tokens, largest per call first. ${fp.measuredProjects > fp.listedProjects ? `${number(fp.measuredProjects - fp.listedProjects)} projects with fewer calls are not listed. ` : ""}Projects also differ in model and task, so a gap is not proof that a project's tool setup causes it.`)
      : empty(`No project has at least ${number(fp?.minimumProjectCalls ?? 20)} calls that record definition tokens in these filters.`);

    // Available on one call against executed over the whole history: two scopes, stated as such.
    const executed = report.tools?.rows, servers = report.mcp?.rows;
    const executedServers = Array.isArray(servers) ? servers.filter(row => row.calls > 0) : null;
    const liveMcp = report.mcp?.available === true && Array.isArray(servers);
    const connectedServers = liveMcp ? servers.filter(row => row.status === 'connected') : [];
    const idleServers = liveMcp ? connectedServers.filter(row => !(row.calls > 0) && row.toolsLoaded !== false)
      .sort((a, b) => String(a.displayName || a.name).localeCompare(String(b.displayName || b.name))) : [];
    const idleList = idleServers.length
      ? `<p class="compaction-caption">Connected MCP servers with no calls in these filters</p>`
        + table(['Server', 'Current status', 'Tools loaded'], idleServers.slice(0, 8).map(r => [r.displayName || r.name || 'Unnamed server', 'Connected', r.toolsLoaded === true ? 'Yes' : 'Not reported']))
        + note(`Live inventory reflects the current hosting session, separate from the selected history. Showing ${number(Math.min(idleServers.length, 8))} of ${number(idleServers.length)} connected ${idleServers.length === 1 ? 'server' : 'servers'} with no recorded calls in these dates. A server with zero calls in this range may still be needed on other tasks.`)
      : liveMcp && connectedServers.length
        ? note('Every connected MCP server with loaded tools in the current session had at least one recorded call in these filters.')
        : '';
    const against = metrics(
      metric('Tools available, half of calls', fp?.medianAvailable ?? null, `Half of calls had this many or fewer · ${coverage(fp?.countCalls ?? 0)}`, number, partial(fp?.countCalls ?? 0)),
      metric('Different tools executed', Array.isArray(executed) ? executed.length : null, `Whole selected history, not one call · ${number(report.tools?.calls ?? 0)} tool calls`),
      metric('MCP servers with executed tools', executedServers ? executedServers.length : null, 'Whole selected history'),
      ...(liveMcp ? [metric('Connected MCP servers', connectedServers.length, 'Current session · separate from selected history')] : []))
      + idleList
      + note('These count different things. The first is per model call. The others cover every call in the selected dates. An available tool that was not executed in this period may be needed on another task, so this is not a count of unused or wasted tools. Tool names are counted as recorded: an MCP tool is one per server and tool name.')
      + note(`Tool definitions are usually served from cache after the first call of a conversation, so their input tokens are not all processed fresh. The history has no cache split by content, so this view cannot say how much of the definitions was read from cache.${report.tools?.omitted ? ` ${number(report.tools.omitted)} tool calls were omitted for missing or mixed provider attribution.` : ''}`);

    // The sentence follows the clearest evidence: groups of tool counts, then a project that stands out.
    const solid = groups.filter(g => g.measured >= (fp?.minimumGroupCalls ?? 20) && valid(g.averageTokens));
    const low = solid.reduce((a, b) => a && a.averageTokens <= b.averageTokens ? a : b, null), high = solid.reduce((a, b) => a && a.averageTokens >= b.averageTokens ? a : b, null);
    const stands = projects[0] && valid(s.averageToolTokens) && s.averageToolTokens > 0 && projects[0].averageTokens >= s.averageToolTokens * 1.25 ? projects[0] : null;
    const experiment = 'Try one task with an MCP server you do not need disconnected, then look at definition tokens per call.';
    const sentence = solid.length >= 2 && low.averageTokens > 0 && high.averageTokens >= low.averageTokens * 1.25
      ? [`Calls with ${groupName(high)} carried ${number(high.averageTokens)} definition tokens each, against ${number(low.averageTokens)} on calls with ${groupName(low)}.`,
        `${experiment} Calls with more tools available can also differ in model or project, which this comparison does not separate.`,
        'definition tokens per call and input share on the same model, and whether the agent still had the tools it needed.']
      : stands
        ? [`${stands.name} averaged ${number(stands.averageTokens)} definition tokens per call, against ${number(s.averageToolTokens)} across all measured calls.`,
          `${experiment} Tool and MCP setup often differs by project, but so can the model and the task.`,
          'definition tokens per call for that project on the same model, and whether the agent still had the tools it needed.']
        : [s.toolShare == null ? 'Tool-definition overhead is not measurable in this history.' : `${percent(s.toolShare)} of matched input described available tools.`,
          `${experiment} A tool can add definitions even when it is never called.`,
          'definition tokens per call and input share on the same model. Fewer definitions are useful only if the needed tools remain available.'];

    return metrics(metric('Definitions / call', s.averageToolTokens, coverage(s.toolRequests), number, partial(s.toolRequests)),
      metric('Share of measured input', s.toolShare, 'Tool and input counts from the same calls', percent, partial(s.toolRequests)),
      metric('Definition tokens', s.toolRequests ? s.toolTokens : null, 'Already included in input tokens', number, partial(s.toolRequests)),
      metric('Available tools / call', s.averageAvailableTools, coverage(s.toolCountRequests), value => number(value, { maximumFractionDigits: 1 }), partial(s.toolCountRequests)))
      + trendRow(trend, point => point.averageToolTokens, { label: 'Definition tokens per call', format: number })
      + trendRow(trend, point => point.toolShare, { label: 'Share of input described tools', format: percent })
      + section('Footprint by how many tools were available', byCount)
      + section('Projects with the largest footprint per call', byProject)
      + (rows.length ? section('Models carrying the most tool-definition tokens', table(['Model', 'Measured calls', 'Definitions / call', 'Input share'], rows.map(r => [r.name, coverage(r.toolRequests, r.requests), measured(r.averageToolTokens, r.toolRequests, r.requests), measured(r.toolShare, r.toolRequests, r.requests, percent)]))) : empty('No paired tool-definition and input measurements in these filters.'))
      + section('Available against executed', against)
      + insight(...sentence)
      + section('Current tool and MCP sources', contextStamp() + (current ? sources(['toolDefinition', 'mcpServer'], 'Largest attributed tool and MCP sources') + inspect : inspect))
      + note('Historical definitions do not distinguish built-in from MCP tokens. Current MCP source totals can mix definitions and attributed messages; these rows are not a definition-only or historical bill.');
  }
  if (id === 'results') {
    const rows = (report.tools?.rows || []).slice().sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, 5);
    const messages = category('messages');
    const material = report.efficiency?.toolMaterial, shown = material?.calls > 0 ? material : null;
    const things = (value, one, many = `${one}s`) => `${number(value)} ${value === 1 ? one : many}`;
    const span = ms => {
      if (!valid(ms)) return 'Unavailable';
      if (ms < 1000) return `${number(Math.round(ms))} ms`;
      if (ms < 60_000) return `${number(ms / 1000, { maximumFractionDigits: 1 })} s`;
      const seconds = Math.round(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
      return hours ? `${number(hours)} h ${number(minutes)} min` : `${number(minutes)} min ${number(seconds % 60)} s`;
    };
    // What the agent ran: calls by family, grouped by recorded tool name only, with how long calls took.
    const families = (shown?.families || []).filter(row => row.calls > 0);
    const ran = !shown ? empty('No tool calls match these filters, so there is nothing to group. Missing records do not mean no tools were used.')
      : table(['What the agent ran', 'Calls', 'Share of calls', 'Calls with a recorded duration', 'Typical duration', 'Total duration'],
        families.map(row => [row.label, number(row.calls), percent(row.share), `${number(row.timedCalls)} of ${number(row.calls)}`, row.timedCalls ? span(row.middleMs) : 'Unavailable', row.timedCalls ? span(row.totalMs) : 'Unavailable']))
        + note(`${things(shown.calls, 'tool call')} in the selected history, grouped by the recorded tool name only. Names this view does not recognise are counted as other tools${shown.otherNames?.length ? ` (most often: ${shown.otherNames.map(row => `${row.name || 'unnamed'}, ${number(row.calls)}`).join('; ')})` : ''}. A tool that records an MCP server is counted as an MCP tool, whatever its name. A group says what kind of tool ran, not how much it brought in.`)
        + note(`A duration runs from the start of a call to its recorded completion. ${shown.timedCalls === shown.calls ? `All ${number(shown.calls)} calls have one` : `Only ${number(shown.timedCalls)} of ${number(shown.calls)} calls have one`}. Typical means half of the calls took less. Calls can overlap, so a total is not time spent waiting.`);
    // Input added between model calls: an estimate, grouped by how many tool calls started in between.
    const added = shown?.added, groups = added?.groups || [], sessions = added?.sessions;
    const left = sessions ? [[sessions.subagent, 'recorded subagent calls, whose tool calls cannot be told apart from the main conversation'],
      [sessions.unknownInitiator, 'recorded model calls with no initiator'], [sessions.noToolEvents, 'recorded no tool events'], [sessions.tooShort, 'had only one model call']]
      .filter(([count]) => count > 0).map(([count, why]) => `${things(count, 'conversation')} ${why}`) : [];
    const familyRows = (added?.byFamily || []).filter(row => row.steps > 0);
    const byFamilyTable = familyRows.length
      ? '<p class="compaction-caption">Typical added input by tool kind</p>'
        + table(['Tool kind in between', 'Steps', 'Typical added input', 'Input shrank'], familyRows.map(row => [row.label, number(row.steps),
          row.grew >= 3 ? `${number(row.middle)} tokens` : row.grew > 0 ? `Too few steps (${number(row.grew)})` : 'Unavailable', number(row.shrunk)]))
        + note('Single-family steps ran only tools of that kind between two model calls. Steps mixing kinds are grouped under Multiple tool kinds so added input is not attributed to one kind. Needs at least 3 growing steps for a typical value.')
      : '';
    const between = !added?.steps ? empty(sessions?.total
      ? 'No step between two main-conversation model calls could be measured in these filters. A step needs the input and output of the earlier call and the input of the next. Missing counts are not zero.'
      : 'No main-conversation model calls match these filters, so input added between calls cannot be estimated.')
      : table(['Tool calls in between', 'Steps', 'Typical added input', 'Input shrank'], groups.map(row => [row.label, number(row.steps), row.grew ? `${number(row.middle)} tokens` : 'Unavailable', number(row.shrunk)]))
        + byFamilyTable
        + note(`An estimate, not a measurement: the next call's input minus the earlier call's input and output. It covers tool results and any new message from you. Typical means half of the steps added less. ${things(added.steps, 'step')} from ${number(sessions.used)} of ${things(sessions.total, 'conversation')}${added.unmeasured ? `; ${things(added.unmeasured, 'more step')} lacked an input or output count` : ''}. ${added.shrunk ? `${things(added.shrunk, 'step')} where input shrank (a compaction or changed history) ${added.shrunk === 1 ? 'is' : 'are'} counted but left out of the typical values. ` : ''}${left.length ? `Left out: ${left.join('; ')}. ` : ''}Subagent calls cannot be put in order, so they are not steps.${added.modelFiltered ? ' A model filter is on, so calls on other models are missing and some steps span more than one call.' : ''}`);
    // A comparison between groups needs enough steps on both sides and a clear difference.
    const enough = 10, typical = groups.filter(row => row.grew >= enough && valid(row.middle) && row.middle > 0);
    const most = typical.reduce((a, b) => !a || b.middle > a.middle ? b : a, null), least = typical.reduce((a, b) => !a || b.middle < a.middle ? b : a, null);
    const lead = typical.length > 1 && most.middle >= 1.5 * least.middle
      ? `Steps with ${most.label.toLowerCase()} between model calls added a typical ${number(most.middle)} tokens of input, against ${number(least.middle)} with ${least.label.toLowerCase()}.`
      : valid(added?.middle) && added.grew >= enough ? `Half of the ${number(added.grew)} steps where input grew added less than ${number(added.middle)} tokens of input.`
      : messages == null ? 'Tool activity is visible before its context footprint is measurable.' : `${number(messages)} tokens are in conversation and tool messages combined.`;
    const topMetrics = current
      ? metrics(metric('Conversation context', messages, 'Current user, assistant, and tool messages together'),
          metric('Of occupied context', share(messages, context?.totalTokens), 'Current snapshot only', percent),
          metric('Recorded tool calls', report.tools?.calls ?? null, 'Selected history; activity, not token charges'),
          metric('Typical added input / step', added?.grew ? added.middle : null, added?.grew ? `Half of ${things(added.grew, 'growing step')} added less` : 'Needs measured consecutive calls'))
      : metrics(metric('Recorded tool calls', report.tools?.calls ?? null, 'Selected history; activity, not token charges'),
          metric('Typical added input / step', added?.grew ? added.middle : null, added?.grew ? `Half of ${things(added.grew, 'growing step')} added less` : 'Needs measured consecutive calls'),
          metric('Calls with a recorded duration', shown ? shown.timedCalls : null, shown ? `Of ${things(shown.calls, 'recorded tool call')}` : 'Selected history'));
    return topMetrics
      + section('What the agent ran', ran)
      + section('Input added between model calls', between)
      + contextStamp() + (current ? sources(['tool'], 'Largest tool-attributed context sources') + inspect : inspect)
      + section('Most-used tools in selected history', rows.length ? table(['Tool', 'Calls', 'Failures', 'Unknown outcome'], rows.map(r => [r.server ? `${r.server} / ${r.mcpTool || r.name}` : r.name, number(r.calls), number(r.failures), number(r.unknown)])) : empty('No matching tool activity was recorded.'))
      + note(`${number(report.tools?.omitted ?? 0)} tool calls omitted for missing or mixed provider attribution. A model filter can also exclude calls with no recorded model.`)
      + insight(lead,
        'For the next exploration task, ask for a targeted search and relevant excerpts before requesting full files or large command output.',
        'added input per step and tool calls per step on similar work, and whether the answer still had what it needed. Steps with more tool calls can add more input because the results were larger, or because your message was. Call counts do not reveal result size, repeated reads, or file-level token cost.');
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
    const hasSplitDetail = listed.some(r => valid(r.cacheWrite) && valid(r.uncached));
    const conversations = !timing?.measuredCalls ? '' : section('Conversations with the most input not read from cache', listed.length
      ? table(hasSplitDetail ? ['Conversation', 'Measured calls', 'Input tokens', 'Not read from cache', 'Cache write', 'Uncached', 'Read share']
          : ['Conversation', 'Measured calls', 'Input tokens', 'Not read from cache', 'Read share'],
          listed.map(r => {
            const nameCell = { html: openSessionButton(r.name || 'Unnamed session', r.id, r.project) };
            return hasSplitDetail
              ? [nameCell, number(r.calls), number(r.input), number(r.notRead), number(r.cacheWrite), number(r.uncached), percent(r.share)]
              : [nameCell, number(r.calls), number(r.input), number(r.notRead), percent(r.share)];
          }))
        + note(`Showing ${number(listed.length)} of ${number(timing.listedSessions)} conversations with at least ${number(timing.minimumSessionCalls)} measured main-conversation calls. Not read from cache is input minus cache reads, split into cache writes and uncached input. A long conversation can lead this list with ordinary reuse; this is not proof of waste.`)
      : empty(`No conversation has at least ${number(timing.minimumSessionCalls)} measured main-conversation calls in this selection.`));
    const ratio = value => `${number(value, { maximumFractionDigits: 1 })}×`;
    return metrics(metric('Uncached input', s.uncachedInput, 'Complete cache splits only', number, partial(s.cacheRequests)),
      metric('Cache read', s.cacheRequests ? s.cacheRead : null, 'Previously cached input reused', number, partial(s.cacheRequests)),
      metric('Cache write', s.cacheRequests ? s.cacheWrite : null, 'Input recorded as a cache write', number, partial(s.cacheRequests)),
      metric('Read back per write', s.cacheRequests && valid(s.cacheRead) && valid(s.cacheWrite) && s.cacheWrite > 0 ? s.cacheRead / s.cacheWrite : null,
        s.cacheRequests ? (s.cacheWrite > 0 ? 'Tokens read from cache per token written; short chats read lower' : 'No cache writes recorded in complete splits') : 'Complete cache splits only',
        ratio, partial(s.cacheRequests)))
      + bars([{ label: 'Uncached', value: s.uncachedInput, color: 'var(--s1)' }, { label: 'Cache read', value: s.cacheRequests ? s.cacheRead : null, color: 'var(--s3)' }, { label: 'Cache write', value: s.cacheRequests ? s.cacheWrite : null, color: 'var(--s4)' }], partial(s.cacheRequests))
      + trendRow(report.efficiency?.trend, point => point.cacheHitRate, { label: 'Share of input read from cache', format: percent })
      + section('When is input reused?', when)
      + conversations
      + (rows.length ? section('Cache reuse by model', table(['Model', 'Measured calls', 'Input tokens', 'Read share', 'Write share', 'Read / write'], rows.map(r => [r.name, coverage(r.cacheRequests, r.requests), measured(r.cacheInput, r.cacheRequests, r.requests), measured(r.cacheHitRate, r.cacheRequests, r.requests, percent), measured(share(r.cacheWrite, r.cacheInput), r.cacheRequests, r.requests, percent), r.cacheRequests && valid(r.cacheRead) && valid(r.cacheWrite) && r.cacheWrite > 0 ? measured(r.cacheRead / r.cacheWrite, r.cacheRequests, r.requests, ratio) : 'Unavailable']))) : empty('No complete cache splits were recorded.'))
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

    const shownSet = new Set(rows);
    const failedSkills = all.filter(r => valid(r.failures) && r.failures > 0).sort((a, b) => b.failures - a.failures || String(a.name).localeCompare(String(b.name)));
    const hiddenFailures = failedSkills.some(r => !shownSet.has(r));
    const failedTable = hiddenFailures
      ? section('Skills with failed loads', table(['Skill', 'Source plugin', 'Failed loads', 'Successful uses', 'Conversations', 'Last used'],
          failedSkills.slice(0, 5).map(r => [r.name || 'Unnamed skill', r.plugin || 'None recorded', count(r.failures), count(r.invocations), count(r.sessions), usedOn(r)]))
        + note(`Showing ${number(Math.min(failedSkills.length, 5))} of ${things(failedSkills.length, 'skill')} with recorded failed loads, most failures first. Unresolved failures are recorded by skill name only.`))
      : '';
    const livePlugins = report.plugins?.available === true && Array.isArray(report.plugins.rows) ? report.plugins.rows : null;
    let pluginCoverage = '';
    if (livePlugins) {
      const enabledPlugins = livePlugins.filter(p => p.installed && p.enabled === true);
      const activePlugins = new Set(all.map(r => r.plugin).filter(Boolean));
      const matchedPlugins = enabledPlugins.filter(p => activePlugins.has(p.name));
      const quietPlugins = enabledPlugins.filter(p => !activePlugins.has(p.name)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const quietList = quietPlugins.slice(0, 5).map(p => p.name || 'Unnamed plugin').join(', ');
      pluginCoverage = section('Enabled plugins and recorded skill activity', metrics(
          metric('Enabled plugins', enabledPlugins.length, 'Current session · separate from selected history'),
          metric('With recorded skill activity', matchedPlugins.length, 'Matched by exact recorded source plugin in these dates'))
        + (quietPlugins.length ? note(`Enabled plugins with no recorded skill activity in these dates: ${quietList}${quietPlugins.length > 5 ? ` (and ${number(quietPlugins.length - 5)} more)` : ''}.`) : '')
        + note('Live plugin inventory reflects the current session and ignores date and usage filters. An enabled plugin with no recorded skill uses may provide tools, MCP servers, or commands rather than skills, or may not have been needed in these dates.'));
    }

    return metrics(metric('Recorded skill uses', skills?.invocations ?? null, 'Selected dates, project, and session'),
      metric('Skills used', used, failedOnly > 0 ? `Different skills with a recorded use; ${things(failedOnly, 'other')} had only failed loads` : 'Different skills with at least one recorded use'),
      metric('Conversations with skill activity', skills?.sessions ?? null, `At least one recorded use or failed load.${scale}`),
      metric('Failed skill loads', skills?.failures ?? null, 'Explicit failed load attempts'))
      + (all.length ? section('How skills were loaded', splitBar
        ? splitBar + note('A preloaded skill was loaded when the conversation\'s context was set up, so it takes up context whether or not the task goes on to need it. An invoked skill was loaded during the conversation, when the agent or you asked for it.')
        : empty('No recorded skill uses match these filters, only failed loads.')) : '')
      + section('Most-used skills in selected history', rows.length ? mostUsed() : empty('No skill uses or failed loads match these filters.'))
      + failedTable
      + pluginCoverage
      + section('Current instruction, skill and plugin footprint', footprint())
      + `<ul class="footnote token-skill-notes">${caveats.map(caveat => `<li>${esc(caveat)}</li>`).join('')}</ul>`
      + insight(...found);
  }
  if (id === 'prompts') {
    // Every figure here uses one set: eligible prompts, and under a model filter only the
    // selected models' calls and charges for them. `spread`, `mix` and `heaviest` come from the
    // same pass as the averages; a report without them keeps the averages alone.
    const p = report.promptCredits || {}, w = p.work || {}, d = p.spread, mix = p.mix;
    const incomplete = p.eligiblePrompts < p.prompts || p.unlinkedRequests > 0;
    const eligible = p.eligiblePrompts ?? 0, selected = p.modelFiltered ? ' on the selected models' : '';
    // Charges per prompt are not final while older history is still loading.
    const charged = value => p.pending ? null : value;
    const part = (value, total, of) => { const portion = share(value, total); return portion == null ? '' : `${percent(portion)} of ${of}`; };
    const details = (...items) => items.filter(Boolean).join(' · ');
    const spreadBars = d ? barList((d.bins || []).map(b => ({ label: b.label, value: b.prompts,
      detail: details(part(b.prompts, eligible, 'eligible prompts'), part(charged(b.credits), p.credits, 'their credits')) })), { format: number, total: eligible }) : '';
    const kinds = [['initial', 'Started by the message'], ['continuation', 'Agent continuations'], ['subagent', 'Subagent calls'], ['unrecorded', 'Initiator not recorded']];
    const mixBars = mix ? barList(kinds.filter(([key]) => key !== 'unrecorded' || mix[key]?.requests > 0).map(([key, label]) => ({ label, value: mix[key]?.requests,
      detail: details(part(mix[key]?.requests, w.requests, 'linked calls'), part(charged(mix[key]?.credits), p.credits, 'credits'),
        key === 'subagent' && mix.subagent?.requests > 0 ? `in ${number(mix.delegatedPrompts ?? 0)} of ${number(eligible)} eligible prompts` : '') })), { format: number, total: w.requests }) : '';
    const rows = p.pending ? [] : (p.heaviest || []).slice(0, 5), openable = rows.some(r => r.session && r.sessionName);
    const conversation = r => r.session && r.sessionName
      ? `<button class="model-toggle cell-text token-prompt-open" data-prompt-session="${esc(r.session)}" data-prompt-project="${esc(r.project ?? '')}" title="Open this conversation in Breakdown">${esc(r.sessionName)}<span class="sr-only">: open this conversation in Breakdown</span></button>`
      : `<span class="cell-text">${esc(r.sessionName || 'Unnamed conversation')}</span>`;
    const heaviest = rows.length ? `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr>${['Conversation', 'Project', 'Date', 'Model calls', 'Tokens', 'AI credits'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r =>
      `<tr><td class="text-cell">${conversation(r)}</td><td class="text-cell"><span class="cell-text">${esc(r.project || 'Unknown project')}</span></td><td>${esc(r.day || 'Unavailable')}</td><td>${esc(coverageValue(r.requests, false, number))}</td><td>${esc(coverageValue(r.tokens, false, number))}</td><td>${esc(coverageValue(r.credits, false, credits))}</td></tr>`).join('')}</tbody></table></div>`
      + note(`The ${rows.length === 1 ? 'eligible prompt' : `${number(rows.length)} eligible prompts`} with the largest complete recorded charge, largest first. No prompt text is read or shown.${openable ? ' Choose a conversation to open it in Breakdown.' : ''}${p.modelFiltered ? ' Each row counts only the selected models\' part of that prompt.' : ''} Tokens show only when every linked call has a complete count.`)
      : empty(p.pending ? 'Charges per prompt are still being verified while older history loads.' : 'No eligible prompt has a recorded charge above zero in these filters.');
    // How far the heaviest tenth sits from the typical prompt, when both are measured.
    const multiple = d && !p.pending && d.heavyPrompts > 0 && valid(d.heavyCredits) && d.medianCredits > 0 ? d.heavyCredits / d.heavyPrompts / d.medianCredits : null;
    const observation = w.averageRequests == null ? 'Complete prompt chains are needed for this comparison.'
      : multiple != null ? `The heaviest tenth of prompts averaged ${number(multiple, { maximumFractionDigits: 1 })} times the credits of a typical prompt${selected}.`
      : d && !p.pending && valid(d.heavyShare) ? `The heaviest tenth of prompts held ${percent(d.heavyShare)} of credits${selected}. A typical prompt recorded no charge.`
      : valid(d?.medianRequests) ? `A typical prompt led to ${number(d.medianRequests)} model calls${selected}. The largest led to ${number(w.maxRequests)}.`
      : `One submitted prompt led to ${number(w.averageRequests)} model calls on average${selected}.`;
    const split = p.delegationSplit;
    const splitRows = split?.delegated?.prompts > 0
      ? [['Main conversation only', split.mainOnly], ['With subagent work', split.delegated]].filter(([, row]) => row?.prompts > 0)
      : [];
    const splitTable = splitRows.length
      ? '<p class="compaction-caption">Main-only prompts beside delegated prompts</p>'
        + table(p.pending ? ['Prompt type', 'Eligible prompts', 'Typical calls', 'Average calls'] : ['Prompt type', 'Eligible prompts', 'Typical calls', 'Typical credits', 'Share of credits'],
          splitRows.map(([label, row]) => p.pending
            ? [label, number(row.prompts), number(row.medianCalls, { maximumFractionDigits: 1 }), number(row.averageCalls, { maximumFractionDigits: 1 })]
            : [label, number(row.prompts), number(row.medianCalls, { maximumFractionDigits: 1 }), credits(row.medianCredits), p.credits > 0 ? percent(share(row.credits, p.credits)) : 'Unavailable']))
        + note('Prompts that triggered subagent work often correspond to larger or multi-part tasks, so higher calls or credits do not establish that delegation was inefficient.')
      : '';
    const promptTrend = trendRow(p.trend, point => point.averageRequests, { label: 'Model calls per prompt', format: value => number(value, { maximumFractionDigits: 1 }) })
      + (!p.pending ? trendRow(p.trend, point => point.averageCredits, { label: 'Credits per prompt', format: credits }) : '');
    return (p.modelFiltered ? '<p class="token-topic-status">Selected-model contribution only</p>' : '')
      + metrics(...(d ? [metric('Typical calls / prompt', d.medianRequests, 'Half of eligible prompts needed this many or fewer', number, incomplete)] : []),
        metric(d ? 'Average calls / prompt' : 'Model calls / prompt', w.averageRequests, `${number(eligible)} of ${number(p.prompts ?? 0)} prompts eligible`, number, incomplete),
        metric('Most calls for one prompt', w.maxRequests, 'Within the eligible prompt set', number, incomplete),
        metric('Tokens / prompt', w.averageTokens, `Average of ${number(w.tokenPrompts ?? 0)} eligible prompts with complete token counts`, number, incomplete || w.tokenPrompts < p.eligiblePrompts))
      + note(`Includes initial calls, agent continuations, and subagent work with reliable parent links. ${number(w.requests ?? 0)} linked calls in this view. Tokens include cached input once. Prompts are dated by submission, grouping all linked work before filters; model filters show only selected-model contributions.`)
      + promptTrend
      + (d ? section('How many model calls prompts needed', (spreadBars || empty('No eligible prompts in these filters, so there is no spread to show. Unavailable figures are not zero.'))
        + (valid(d.medianRequests) && w.averageRequests > d.medianRequests ? note(`The average (${number(w.averageRequests)}) is above the typical prompt (${number(d.medianRequests)}). That happens when a smaller number of prompts need many more calls than the rest.`) : '')) : '')
      + section('Where the credits go', metrics(...(d ? [metric('Typical credits / prompt', charged(d.medianCredits), 'Half of eligible prompts used this much or less', credits, incomplete)] : []),
        metric(d ? 'Average credits / prompt' : 'AI credits / prompt', charged(p.averageCredits), 'Complete recorded charges only', credits, incomplete),
        ...(d ? [metric('Held by the heaviest tenth', charged(d.heavyShare), d.heavyPrompts > 0 ? details(`${number(d.heavyPrompts)} of ${number(eligible)} eligible prompts`, valid(charged(d.heavyCredits)) && valid(p.credits) ? `${credits(d.heavyCredits)} of ${credits(p.credits)} credits` : '') : 'Needs at least 10 eligible prompts', percent, incomplete),
          metric('Prompts behind half the credits', charged(d.halfPrompts), valid(d.halfPrompts) ? `The fewest prompts that together hold half, out of ${number(eligible)}` : 'Needs a recorded charge above zero', number, incomplete)] : []))
        + (d ? note(`${p.pending ? 'Charges per prompt are still being verified while older history loads. ' : ''}Eligible prompts only: every linked call has a complete charge. A heavy prompt is often a large task. This shows where credits went, not whether the work was needed.`) : ''))
      + (mix ? section('What the work consists of', (mixBars ? mixBars + note('A call counts as subagent work when it is linked to a parent tool call. Every other call uses the initiator Copilot recorded: the call a message starts, then the calls the agent makes as it continues. Nothing is inferred from timing.')
        : empty('No linked calls from eligible prompts in these filters.')) + splitTable) : '')
      + (d ? section('Heaviest prompts by credits', heaviest) : '')
      + section('Accounting coverage', table(['Excluded for attribution', 'Incomplete charges', 'Unfinished work', 'Unlinked requests'], [[number(p.excluded?.attribution ?? 0), number(p.excluded?.accounting ?? 0), number(p.excluded?.unfinished ?? 0), number(p.unlinkedRequests ?? 0)]]))
      + insight(observation,
        rows.length ? 'Pick one of the heaviest prompts listed above and recall the task. For the next task of that kind, state the goal, boundaries, and validation steps up front, then let the agent complete the connected work.'
          : 'For a comparable task, state the goal, boundaries, and validation steps up front, then let the agent complete the connected work.',
        `calls, tokens, and credits ${rows.length ? 'for the new prompt against the typical and heaviest values here' : 'per eligible prompt'}, alongside the result. More calls may be necessary for a harder task; this does not measure prompt quality.`);
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
        + (rows.length ? table(['Models used by subagents', 'Calls', 'Input / call', 'Output / call', 'Cache read', 'Credits / call', 'Complete credits'], rows.map(r => [r.name, number(r.requests),
          `${measured(r.averageInput, r.inputRequests, r.requests)} (${covered(r.inputRequests, r.requests)})`,
          `${measured(r.averageOutput, r.outputRequests, r.requests)} (${covered(r.outputRequests, r.requests)})`,
          r.cacheRequests ? `${measured(r.cacheHitRate, r.cacheRequests, r.requests, percent)} (${covered(r.cacheRequests, r.requests)})` : 'Unavailable',
          r.creditRequests ? `${measured(r.averageCredits, r.creditRequests, r.requests, credits)} (${covered(r.creditRequests, r.requests)})` : 'Unavailable',
          r.creditRequests ? `${measured(r.credits, r.creditRequests, r.requests, credits)} (${covered(r.creditRequests, r.requests)})` : 'Unavailable']))
          + note('Each column averages only the subagent calls that record that measure. Cache read uses complete cache splits; credits include complete recorded charges only.') : '')) : '')
      + (where && sub.requests ? section('Where delegation happens', lead(`${covered(where.delegatedConversations, where.conversations, 'conversations')} with model calls had at least one subagent call.`)
        + (top.length ? table(['Conversation', 'Subagent calls', 'All calls', 'Subagent share of its calls'], top.map(r => [{ html: openSessionButton(r.name, r.id, r.project) }, number(r.delegated), number(r.requests), percent(r.share)]))
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
    const singleModels = comparable.length ? [] : [...byModel.values()].filter(group => group.levels.length === 1).sort((a, b) => b.matched - a.matched || String(a.name).localeCompare(String(b.name)));
    const singleShown = singleModels.slice(0, 5);
    const effortSection = !(e.efforts || []).length ? '' : section('Reasoning by effort level', compared.length
      ? table(['Model', 'Effort', 'Reasoning share', 'Output / call', 'Average call duration', 'Credits / call'], compared.flatMap(group => group.levels.map(({ row: r }) => [group.name, r.effort,
        withCalls(r.reasoningShare, r.reasoningRequests, r.requests, percent), withCalls(r.averageOutput, r.outputRequests, r.requests, whole), withCalls(r.averageDuration, r.durationRequests, r.requests, seconds),
        withCalls(r.averageCredits, r.creditRequests, r.requests, credits)])))
        + note(`Compare rows of the same model only. A level is listed when at least ${number(enough)} of its calls report both reasoning and output, and a model needs two such levels.${comparable.length > compared.length ? ` Showing ${number(compared.length)} of ${number(comparable.length)} models with comparable levels.` : ''} Calls with no recorded effort level are left out, because unknown is not a level: ${number(compared.reduce((sum, group) => sum + group.unknown, 0))} of ${number(compared.reduce((sum, group) => sum + group.requests, 0))} calls on the models shown. Credits use complete recorded charges only. The calls at each level were different work, so a gap between levels is not the effect of effort alone.`)
      : singleShown.length
        ? note(`No model has two recorded effort levels with at least ${number(enough)} calls each, so levels cannot be compared within one model yet. These models had one recorded effort level meeting that threshold:`)
          + table(['Model', 'Effort', 'Reasoning share', 'Output / call', 'Credits / call'], singleShown.map(group => {
            const r = group.levels[0].row;
            return [group.name, r.effort, withCalls(r.reasoningShare, r.reasoningRequests, r.requests, percent), withCalls(r.averageOutput, r.outputRequests, r.requests, whole), withCalls(r.averageCredits, r.creditRequests, r.requests, credits)];
          }))
          + note(`${singleModels.length > singleShown.length ? `Showing ${number(singleShown.length)} of ${number(singleModels.length)} models with one qualifying level. ` : ''}Calls with no recorded effort level are not counted as a level. Credits use complete recorded charges only.`)
        : empty(`No model has two recorded effort levels with at least ${number(enough)} calls each that report both reasoning and output, so levels are not compared here. Calls with no recorded effort level are not counted as a level.`));

    // Main-conversation vs. subagent reasoning split, shown when both sides have matched reasoning calls.
    const init = e.byInitiator || [];
    const sumInit = ids => {
      const subset = init.filter(r => ids.includes(r.id));
      const addField = key => subset.reduce((total, r) => total + (valid(r[key]) ? r[key] : 0), 0);
      const requests = addField('requests'), outputRequests = addField('outputRequests'), outputTokens = addField('outputTokens');
      const reasoningRequests = addField('reasoningRequests'), reasoningTokens = addField('reasoningTokens'), reasoningOutput = addField('reasoningOutput');
      return { requests, outputRequests, averageOutput: outputRequests ? outputTokens / outputRequests : null,
        reasoningRequests, reasoningTokens, reasoningShare: reasoningOutput > 0 ? reasoningTokens / reasoningOutput * 100 : null };
    };
    const mainInit = sumInit(['user', 'agent']), subInit = sumInit(['sub-agent']);
    const initiatorSection = mainInit.reasoningRequests > 0 && subInit.reasoningRequests > 0
      ? section('Reasoning by initiator', table(['Initiator', 'Reasoning share', 'Output / call', 'Reported reasoning'], [
          ['Main conversation', withCalls(mainInit.reasoningShare, mainInit.reasoningRequests, mainInit.requests, percent), withCalls(mainInit.averageOutput, mainInit.outputRequests, mainInit.requests, whole), number(mainInit.reasoningTokens)],
          ['Subagents', withCalls(subInit.reasoningShare, subInit.reasoningRequests, subInit.requests, percent), withCalls(subInit.averageOutput, subInit.outputRequests, subInit.requests, whole), number(subInit.reasoningTokens)],
        ]) + note('Main conversation is user-initiated calls plus agent continuations; calls with no recorded initiator are not included here. Main-conversation and subagent calls do different work, so a difference is not proof of waste.'))
      : '';

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
      + effortSection + initiatorSection + speed + finding;
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
      const promptCount = valid(r.userPrompts) ? r.userPrompts : null;
      const callsPerPrompt = promptCount > 0 && valid(r.requests) && !(r.uncertainPrompts > 0) ? `${number(r.requests / promptCount, { maximumFractionDigits: 1 })} calls / prompt` : r.uncertainPrompts > 0 ? `${number(r.uncertainPrompts)} uncertain` : '';
      const creditRate = valid(r.creditsPerMillionTokens) ? r.creditsPerMillionTokens : null;
      const rateCalls = valid(r.creditTokenRequests) ? r.creditTokenRequests : null;
      return `<li><div class="token-driver-head"><strong>${esc(r.name)}</strong><span>${esc(r.project ?? 'Project unavailable')} · ${esc(usageValue(r, 'credits', credits, showCoverage))} AI credits</span></div>`
        + (compared ? `<p>${esc(compared[0].toUpperCase() + compared.slice(1))}.${larger ? ` <span class="token-driver-tag">${esc(larger)}</span>` : ''}</p>` : '')
        + `<dl class="token-driver-stats">${stat('Calls', number(r.requests), typicalCalls != null && `Typical: ${number(typicalCalls)}`)
          + stat('Credits per call', coverageValue(r.averageCredits, r.completeCreditRequests < r.requests, credits, showCoverage), valid(r.completeCreditRequests) && `${coverage(r.completeCreditRequests, r.requests)} with a complete charge`, typicalRate != null && `Typical: ${credits(typicalRate)}`)
          + stat('User prompts', promptCount == null ? 'Unavailable' : coverageValue(promptCount, r.uncertainPrompts > 0, number, showCoverage), callsPerPrompt)
          + stat('Credits / 1M tokens', creditRate == null ? 'Unavailable' : coverageValue(creditRate, rateCalls != null && rateCalls < r.requests, credits, showCoverage), rateCalls != null && `${coverage(rateCalls, r.requests)} with complete charge & tokens`)
          + stat('Input per call', measured(inputCalls > 0 && valid(r.inputTotal) ? Math.round(r.inputTotal / inputCalls) : null, inputCalls, r.requests), inputCalls != null && `${coverage(inputCalls, r.requests)} with an input count`)
          + stat('Cache-read share', measured(share(r.cacheRead, splitInput), splitCalls, r.requests, percent), splitCalls != null && `${coverage(splitCalls, r.requests)} with a cache split`)}</dl></li>`;
    };
    const opener = r => r.id == null || r.project == null ? '' : `<button class="token-driver-open" data-token-session="${esc(r.id)}" data-token-project="${esc(r.project)}">Open in Breakdown<span class="sr-only">: ${esc(r.name)}, ${esc(r.project)}</span></button>`;
    const ranking = `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr>${['Session', 'Project', 'Calls', 'AI credits', 'Recorded share'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td class="text-cell"><span class="cell-text">${esc(r.name)}</span>${opener(r)}</td>${[r.project ?? 'Unavailable', number(r.requests), usageValue(r, 'credits', credits, showCoverage), coverageValue(share(r.credits, total), incomplete, percent, showCoverage)].map(cell => `<td><span class="cell-text">${esc(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    // Where else recorded credits concentrate. Each list is ranked and shared within its own recorded rows.
    const ranked = source => (source || []).filter(r => valid(r.credits)).sort((a, b) => b.credits - a.credits || String(a.name ?? a.day).localeCompare(String(b.name ?? b.day)));
    const spread = (title, source, actionAttr) => {
      const list = ranked(source), sum = list.reduce((n, r) => n + r.credits, 0), shown = list.slice(0, 5), left = (source || []).length - list.length;
      const scope = list.length > shown.length ? `Largest ${number(shown.length)} of ${number(list.length)} with charges` : list.length === 1 ? 'The only one with charges' : `All ${number(list.length)} with charges`;
      // barList formats each drawn row once, in order, so the row's own charge coverage can be marked.
      let next = 0;
      const drawn = barList(shown.map(r => ({ label: r.name ?? r.day, value: r.credits,
        ...(actionAttr && r.name ? { action: { attr: actionAttr, value: r.name, title: 'Open in Breakdown', sr: 'open in Breakdown' } } : {}),
        detail: `${coverageValue(share(r.credits, sum), incomplete, percent, showCoverage)} of recorded credits${valid(r.requests) ? ` · ${number(r.requests)} ${r.requests === 1 ? 'call' : 'calls'}` : ''}` })),
        { total: sum, format: () => usageValue(shown[next++], 'credits', credits, showCoverage) });
      return drawn && `<div><h4>${esc(title)}</h4><p class="token-driver-sub">${esc(`${scope}${left > 0 ? `; ${number(left)} with no recorded charge ${left === 1 ? 'is' : 'are'} not ranked` : ''}`)}</p>${drawn}</div>`;
    };
    const activeDays = (report.daily || []).filter(r => r.requests > 0), days = ranked(activeDays);
    const where = spread('Projects', report.projects, 'data-driver-project') + spread('Models', report.models, 'data-driver-model') + spread('Days', activeDays);
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
