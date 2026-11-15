import { esc, usageValue } from './charts.mjs';

// Render from the report and the explicitly requested context snapshot only.
export function renderTokenInsight(id, report, { number, credits, context } = {}) {
  const s = report.efficiency?.summary || {}, models = report.efficiency?.models || [];
  const valid = value => Number.isFinite(value) && value >= 0;
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const share = (part, total) => valid(part) && total > 0 && part <= total ? part / total * 100 : null;
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const empty = text => `<p class="muted token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail, format = number) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(value == null ? 'Unavailable' : format(value))}</strong><span class="sub">${esc(detail)}</span></div>`;
  const metrics = (...items) => `<div class="efficiency-metrics">${items.join('')}</div>`;
  const coverage = (count, total = s.requests) => `${number(count ?? 0)} of ${number(total ?? 0)} model calls`;
  const table = (headers, rows) => `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' class="text-cell"' : ''}><span class="cell-text">${esc(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const insight = (observation, action, compare) => `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${note(`Compare afterward: ${compare}`)}</aside>`;
  const jump = (topic, label) => `<button data-token-jump="${topic}">${esc(label)}</button>`;
  const inspect = '<button data-token-context="true">Open context inspector</button>';
  const bars = parts => {
    if (parts.some(p => !valid(p.value))) return '';
    const total = parts.reduce((n, p) => n + p.value, 0);
    if (!total) return '';
    return `<div class="token-insight-bars"><div class="efficiency-track" role="img" aria-label="${esc(parts.map(p => `${p.label}: ${percent(p.value / total * 100)}`).join('; '))}">${parts.map(p => `<span style="width:${p.value / total * 100}%;background:${p.color}"></span>`).join('')}</div><div class="efficiency-flow-labels">${parts.map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${esc(number(p.value))}</b> · ${esc(percent(p.value / total * 100))}</span>`).join('')}</div></div>`;
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
    return metrics(metric('Definitions / call', s.averageToolTokens, coverage(s.toolRequests)),
      metric('Share of measured input', s.toolShare, 'Tool and input counts from the same calls', percent),
      metric('Definition tokens', s.toolRequests ? s.toolTokens : null, 'Already included in input tokens'),
      metric('Available tools / call', s.averageAvailableTools, coverage(s.toolCountRequests)))
      + (rows.length ? section('Models carrying the most tool-definition tokens', table(['Model', 'Measured calls', 'Definitions / call', 'Input share'], rows.map(r => [r.name, coverage(r.toolRequests, r.requests), number(r.averageToolTokens), percent(r.toolShare)]))) : empty('No paired tool-definition and input measurements in these filters.'))
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
    return metrics(metric('Uncached input', s.uncachedInput, 'Complete cache splits only'),
      metric('Cache read', s.cacheRequests ? s.cacheRead : null, 'Previously cached input reused'),
      metric('Cache write', s.cacheRequests ? s.cacheWrite : null, 'Input recorded as a cache write'))
      + bars([{ label: 'Uncached', value: s.uncachedInput, color: 'var(--s1)' }, { label: 'Cache read', value: s.cacheRequests ? s.cacheRead : null, color: 'var(--s3)' }, { label: 'Cache write', value: s.cacheRequests ? s.cacheWrite : null, color: 'var(--s4)' }])
      + (rows.length ? section('Cache reuse by model', table(['Model', 'Measured calls', 'Input tokens', 'Read share'], rows.map(r => [r.name, coverage(r.cacheRequests, r.requests), number(r.cacheInput), percent(r.cacheHitRate)]))) : empty('No complete cache splits were recorded.'))
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
      + note(`Skill activity ignores the model filter, matching Breakdown → Skills. ${number(skills?.omitted ?? 0)} uses and ${number(skills?.omittedFailures ?? 0)} failed loads were omitted for missing or mixed provider attribution. Context sources are not joined to uses by display name.`)
      + insight('A loaded skill has a footprint; an installed skill may have none.',
        'Review large instruction or skill sources for detail that could be loaded only when needed. Keep reusable guidance that helps the agent do the task correctly.',
        'current context after one change and whether the workflow still succeeds. Uses and failures do not price a skill or identify unused skills polluting context.');
  }
  if (id === 'prompts') {
    const p = report.promptCredits || {}, w = p.work || {};
    return (p.modelFiltered ? '<p class="token-topic-status">Selected-model contribution only</p>' : '')
      + metrics(metric('Model calls / prompt', w.averageRequests, `${number(p.eligiblePrompts ?? 0)} of ${number(p.prompts ?? 0)} prompts eligible`),
        metric('AI credits / prompt', p.averageCredits, 'Complete recorded charges only', credits),
        metric('Tokens / prompt', w.averageTokens, `${number(w.tokenPrompts ?? 0)} eligible prompts with complete token counts`),
        metric('Most calls for one prompt', w.maxRequests, 'Within the eligible prompt set'))
      + note(`Includes initial calls, agent continuations, and subagent work with reliable parent links. ${number(w.requests ?? 0)} linked calls in this view. Tokens include cached input once. Prompts are dated by submission, grouping all linked work before filters; model filters show only selected-model contributions.`)
      + section('Accounting coverage', table(['Excluded for attribution', 'Incomplete charges', 'Unfinished work', 'Unlinked requests'], [[number(p.excluded?.attribution ?? 0), number(p.excluded?.accounting ?? 0), number(p.excluded?.unfinished ?? 0), number(p.unlinkedRequests ?? 0)]]))
      + insight(w.averageRequests == null ? 'Complete prompt chains are needed for this comparison.' : `One submitted prompt led to ${number(w.averageRequests)} model calls on average${p.modelFiltered ? ' on the selected models' : ''}.`,
        'For a comparable task, state the goal, boundaries, and validation steps up front, then let the agent complete the connected work.',
        'calls, tokens, and credits per eligible prompt alongside the result. More calls may be necessary for a harder task; this does not measure prompt quality.');
  }
  if (id === 'delegation') {
    const by = report.efficiency?.byInitiator || [], delegated = by.find(r => r.id === 'sub-agent'), unknown = by.find(r => r.id === 'unknown');
    const labels = { user: 'User-initiated call', agent: 'Agent continuation', 'sub-agent': 'Subagent', unknown: 'Not recorded' };
    const rows = (report.efficiency?.delegatedModels || []).slice(0, 5);
    return metrics(metric('Recorded subagent calls', delegated?.requests ?? null, 'Explicit sub-agent initiator only'),
      metric('Share of model calls', share(delegated?.requests, s.requests), 'Includes unknown initiators in the denominator', percent),
      metric('Subagent input + output', delegated?.pairedRequests ? delegated.pairedInput + delegated.pairedOutput : null, coverage(delegated?.pairedRequests, delegated?.requests)),
      metric('Unknown initiator', unknown?.requests ?? null, 'May contain additional delegated work'))
      + (by.length ? section('Who initiated the model calls?', table(['Recorded initiator', 'Calls', 'Measured tokens', 'Complete credits'], by.map(r => [labels[r.id] || r.id, number(r.requests), r.pairedRequests ? `${number(r.pairedInput + r.pairedOutput)} (${coverage(r.pairedRequests, r.requests)})` : 'Unavailable', r.creditRequests ? `${credits(r.credits)} (${coverage(r.creditRequests, r.requests)})` : 'Unavailable']))) : empty('No initiator measurements are available.'))
      + (rows.length ? section('Models used by subagents', table(['Model', 'Calls', 'Input / call', 'Output / call'], rows.map(r => [r.name, number(r.requests), `${number(r.averageInput)} (${coverage(r.inputRequests, r.requests)})`, `${number(r.averageOutput)} (${coverage(r.outputRequests, r.requests)})`]))) : '')
      + insight(delegated?.requests ? `${number(delegated.requests)} calls are explicitly labelled as subagent work.` : 'No explicitly labelled subagent calls in this view.',
        'When delegating, give each agent a bounded task, the relevant context, and a concise return format so the parent does not need to repeat the investigation.',
        'delegated token volume and total credits for similar work. These calls are already part of usage totals; this table does not infer parent links or the value of delegation.');
  }
  if (id === 'output') {
    const rows = measuredModels('outputRequests', 'outputTokens');
    return metrics(metric('Generated output', s.outputRequests ? s.outputTokens : null, coverage(s.outputRequests)),
      metric('Reported reasoning', s.reasoningRequests ? s.reasoningTokens : null, coverage(s.reasoningRequests)),
      metric('Reasoning share', s.reasoningShare, 'Only calls with valid reasoning and output counts', percent),
      metric('Other output, matched calls', s.otherOutput, 'Not necessarily user-visible answer text'))
      + bars([{ label: 'Reasoning', value: s.reasoningRequests ? s.reasoningTokens : null, color: 'var(--s5)' }, { label: 'Other output', value: s.otherOutput, color: 'var(--s2)' }])
      + (rows.length ? section('Output by model', table(['Model', 'Output / call', 'Output coverage', 'Reasoning share', 'Reasoning coverage'], rows.map(r => [r.name, number(r.averageOutput), coverage(r.outputRequests, r.requests), percent(r.reasoningShare), coverage(r.reasoningRequests, r.requests)]))) : empty('No output measurements were recorded for these filters.'))
      + note('Reasoning is part of output. The split subtracts only on the same measured calls; it can cover fewer calls than Generated output. Other output can include tool-call arguments and is not an answer-length estimate.')
      + insight(s.reasoningShare == null ? 'Reasoning share needs matched output measurements.' : `${percent(s.reasoningShare)} of matched output was reported reasoning.`,
        'Specify the deliverable and useful level of detail. For routine work, compare an available lighter model while keeping the same validation checks.',
        'output and credits per completed comparable task. Less reasoning is not automatically more efficient if it leads to rework.');
  }
  if (id === 'drivers') {
    const all = (report.sessions || []).filter(r => valid(r.credits)).slice().sort((a, b) => b.credits - a.credits || a.name.localeCompare(b.name));
    if (!all.length) return empty('No session charges are recorded for these filters. Unavailable charges are not zero.') + insight('Start with complete charge records.', 'Try a wider range or check enabled data sources before comparing spend.', 'charge coverage and whether the same workload is represented.');
    const rows = all.slice(0, 5), total = all.reduce((sum, r) => sum + r.credits, 0), top = rows.reduce((sum, r) => sum + r.credits, 0);
    return metrics(metric('Recorded AI credits', total, 'Includes partial reported charges', credits),
      metric('Top five groups', share(top, total), `${number(rows.length)} of ${number(all.length)} groups with charges`, percent))
      + section('Largest session / project groups', table(['Session', 'Project', 'Calls', 'AI credits', 'Recorded share'], rows.map(r => [r.name, r.project, number(r.requests), usageValue(r, 'credits', credits), percent(share(r.credits, total))])))
      + note('An asterisk marks incomplete charges, which can affect the ranking. Shares use recorded charges only. Unavailable charges are excluded; a session spanning projects can appear more than once.')
      + insight(total ? `The largest group accounts for ${percent(share(rows[0].credits, total))} of recorded charges.` : 'The recorded charges in this range are zero.',
        'Start with a high-spend session in Breakdown. Compare its model mix, calls, and context against a similar task before changing models or workflow.',
        'actual credits for similar completed work, including follow-ups. A costly session can still be valuable; this ranking does not estimate waste.');
  }
  return '';
}
