import { esc } from './charts.mjs';
import { barList, topicJumpButton } from './token-insights.mjs';

export function renderContextTopic(report, ctx) {
  const {
    s, number, context, previousContext, contextPart,
    valid, percent, share, note, empty, section, metric, metrics, coverage, partial, measured, table, insight, bars, current, category, contextStamp, measuredModels,
  } = ctx;

  if (!current) {
    if (contextPart === 'snapshot') return contextStamp();
    const prompt1 = report.efficiency?.growthSummary?.positions?.find(row => row.prompt === 1);
    const minConvs = report.efficiency?.growthSummary?.minimumConversations ?? 3;
    const toolModels = measuredModels('toolRequests', 'averageToolTokens');
    const skillRows = report.skills?.rows || [];
    let totalSkillUses = 0, preloadedUses = 0;
    const preloadedSkills = [];
    for (const r of skillRows) {
      const uses = valid(r.invocations) ? r.invocations : 0;
      const pre = valid(r.triggers?.preloaded) ? r.triggers.preloaded : 0;
      totalSkillUses += uses; preloadedUses += pre;
      if (pre > 0) preloadedSkills.push({ name: r.name || 'Unnamed skill', plugin: r.plugin || 'None recorded', preloaded: pre, uses, sessions: r.sessions });
    }
    preloadedSkills.sort((a, b) => b.preloaded - a.preloaded || String(a.name).localeCompare(String(b.name)));
    const preloadedShare = totalSkillUses > 0 ? preloadedUses / totalSkillUses * 100 : null;
    const liveMcp = report.mcp?.available === true && Array.isArray(report.mcp.rows) ? report.mcp.rows : null;
    const livePlugins = report.plugins?.available === true && Array.isArray(report.plugins.rows) ? report.plugins.rows : null;
    const connectedMcp = liveMcp ? liveMcp.filter(r => r.status === 'connected') : [];
    const loadedMcp = connectedMcp.filter(r => r.toolsLoaded === true);
    const installedPlugins = livePlugins ? livePlugins.filter(p => p.installed) : [];
    const enabledPlugins = installedPlugins.filter(p => p.enabled === true);
    const hasHistory = (s.requests || 0) > 0 || valid(prompt1?.input) || (s.toolRequests || 0) > 0 || skillRows.length > 0;
    const hasInventory = Boolean(liveMcp || livePlugins);
    if (!hasHistory && !hasInventory) return contextPart === 'history' ? '' : contextStamp();

    let baseline = '';
    if (hasHistory) {
      baseline += section('Starting context in selected history', metrics(
          metric('Typical conversation start (Prompt 1)', valid(prompt1?.input) ? prompt1.input : null,
            valid(prompt1?.input) ? `Median first main-agent call across ${number(prompt1.conversations)} conversations` : `Needs at least ${number(minConvs)} conversations with recorded input`),
          metric('Tool definitions / call', s.averageToolTokens,
            s.toolRequests ? `${coverage(s.toolRequests)}${valid(s.averageAvailableTools) ? ` · ${number(s.averageAvailableTools, { maximumFractionDigits: 1 })} tools available on average` : ''}` : 'Not recorded in these filters',
            number, partial(s.toolRequests)),
          metric('Tool definition share', s.toolShare,
            s.toolRequests ? 'Share of measured input describing available tools' : 'Matched input and definition counts needed',
            percent, partial(s.toolRequests)),
          metric('Preloaded skill uses', skillRows.length ? preloadedUses : null,
            totalSkillUses > 0 ? `${percent(preloadedShare)} of ${number(totalSkillUses)} recorded skill uses (ignores model filter)`
              : skillRows.length ? 'Only failed skill loads recorded' : 'No recorded skill activity in these filters'))
        + note('Measured from your selected history and filters. Prompt 1 input includes system instructions, custom instructions, tool definitions, and your opening message (cached input included). Click Inspect context above for an exact per-category breakdown of this hosting conversation.'));
    }
    if (toolModels.length) {
      baseline += section('Tool definitions by model', table(['Model', 'Definitions / call', 'Input share', 'Tools available / call', 'Measured calls'], toolModels.map(r => [
          r.name, measured(r.averageToolTokens, r.toolRequests, r.requests), measured(r.toolShare, r.toolRequests, r.requests, percent),
          r.toolCountRequests ? measured(r.averageAvailableTools, r.toolCountRequests, r.requests, value => number(value, { maximumFractionDigits: 1 })) : 'Unavailable',
          coverage(r.toolRequests, r.requests)]))
        + `<p class="footnote token-insight-note">Top models by average tool-definition tokens per call in the selected history. ${topicJumpButton('tokens', 'tools', 'Open Tool and MCP footprint')} for project and tool-count breakdowns.</p>`);
    }
    if (preloadedSkills.length) {
      const shownSkills = preloadedSkills.slice(0, 5);
      baseline += section('Skills preloaded at conversation start', table(['Skill', 'Source plugin', 'Preloaded uses', 'Share of its uses', 'Conversations'], shownSkills.map(r => [
          r.name, r.plugin, number(r.preloaded), r.uses > 0 ? percent(r.preloaded / r.uses * 100) : 'Unavailable', valid(r.sessions) ? number(r.sessions) : 'Unavailable']))
        + `<p class="footnote token-insight-note">${esc(`Showing ${number(shownSkills.length)} of ${number(preloadedSkills.length)} preloaded ${preloadedSkills.length === 1 ? 'skill' : 'skills'}. Preloaded skills load when a conversation starts whether or not the task later needs them. `)}${topicJumpButton('tokens', 'skills', 'Open Skills and instruction footprint')} for all skill activity.</p>`);
    }
    if (hasInventory) {
      baseline += section('Active setup in this session', metrics(
          ...(liveMcp ? [metric('Connected MCP servers', connectedMcp.length, `${number(connectedMcp.length)} of ${number(liveMcp.length)} listed · ${number(loadedMcp.length)} reporting tools loaded`)] : []),
          ...(livePlugins ? [metric('Enabled plugins', enabledPlugins.length, `${number(enabledPlugins.length)} of ${number(installedPlugins.length)} installed plugins enabled`)] : []))
        + note('Current hosting session inventory, separate from selected dates and filters. Connected servers and enabled plugins do not show token sizes here—click Inspect context above to measure what is loaded in this conversation.'));
    }
    let lead, act, cmp;
    if (valid(s.toolShare) && s.toolShare >= 10 && valid(s.averageToolTokens)) {
      lead = `${percent(s.toolShare)} of measured input (${number(s.averageToolTokens)} tokens per call) described available tools.`;
      act = 'Click Inspect context above to see which MCP servers or tool definitions take the largest share in this session, then disable an unused server for your next task.';
      cmp = 'tool-definition tokens per call in a fresh snapshot and in your selected history, while confirming the agent still has the tools it needs.';
    } else if (valid(preloadedShare) && preloadedShare >= 25 && preloadedUses > 0) {
      lead = `${number(preloadedUses)} of ${number(totalSkillUses)} recorded skill uses (${percent(preloadedShare)}) were preloaded at conversation start.`;
      act = 'Click Inspect context above to check how many tokens preloaded skills occupy, and try a conversation where task-specific skills load only when invoked.';
      cmp = 'starting context size in two snapshots and whether the agent still follows the guidance it needs.';
    } else if (valid(prompt1?.input)) {
      lead = `A typical conversation starts at ${number(prompt1.input)} input tokens on Prompt 1 across ${number(prompt1.conversations)} conversations.`;
      act = 'Click Inspect context above to break down how much of that starting context comes from instructions, tool definitions, and conversation messages in this session.';
      cmp = 'Prompt 1 input across similar tasks after adjusting instructions, preloaded skills, or connected MCP servers.';
    } else {
      lead = 'Historical starting-context coverage is partial in these filters.';
      act = 'Click Inspect context above for an immediate breakdown of this hosting conversation, or choose a wider date range to measure starting input and tool definitions across history.';
      cmp = 'setup tokens in the live snapshot alongside historical tool-definition averages.';
    }
    baseline += insight(lead, act, `${cmp} Historical averages reflect past sessions; the live snapshot covers only this hosting conversation.`);
    return contextPart === 'history' ? baseline : contextStamp() + baseline;
  }

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

  const prior = previousContext?.available === true && valid(previousContext.totalTokens) ? previousContext : null;
  const signed = delta => delta === 0 ? 'No change' : `${delta > 0 ? '+' : '−'}${number(Math.abs(delta))}`;
  let diff = '';
  if (prior) {
    const priorTotal = prior.totalTokens, deltaTotal = total - priorTotal;
    const pctDelta = priorTotal > 0 && deltaTotal !== 0 ? `${deltaTotal > 0 ? '+' : '−'}${percent(Math.abs(deltaTotal) / priorTotal * 100)}` : '';
    const priorCategory = key => valid(prior.categories?.[key]) && prior.categories[key] <= priorTotal ? prior.categories[key] : null;
    const catRows = [], catUnavailable = [];
    for (const part of parts) {
      const before = priorCategory(part.key);
      if (before == null || part.value == null) catUnavailable.push(part.label);
      else catRows.push([part.label, number(before), number(part.value), signed(part.value - before)]);
    }
    const prevEntries = new Map((prior.entries || []).filter(e => valid(e.tokens)).map(e => [e.id, e]));
    const currEntries = new Map((context.entries || []).filter(e => valid(e.tokens)).map(e => [e.id, e]));
    const sourceIds = new Set([...prevEntries.keys(), ...currEntries.keys()]);
    const sourceChanges = [];
    for (const entryId of sourceIds) {
      const before = prevEntries.get(entryId), after = currEntries.get(entryId);
      const beforeTokens = before?.tokens ?? null, afterTokens = after?.tokens ?? null;
      const delta = (afterTokens ?? 0) - (beforeTokens ?? 0);
      if (before && after && delta === 0) continue;
      sourceChanges.push({ id: entryId, label: after?.label || before?.label || entryId || 'Unnamed source',
        before: beforeTokens == null ? 'Added' : number(beforeTokens),
        after: afterTokens == null ? 'Removed' : number(afterTokens),
        change: signed(delta), abs: Math.abs(delta) });
    }
    sourceChanges.sort((a, b) => b.abs - a.abs || String(a.id).localeCompare(String(b.id)));
    const modelChanged = prior.modelId && context.modelId && prior.modelId !== context.modelId;
    diff = section('Changes since previous snapshot',
      `<p><strong>${esc(`${number(priorTotal)} → ${number(total)} tokens (${signed(deltaTotal)}${pctDelta ? `, ${pctDelta}` : ''})`)}</strong></p>`
      + note(`Estimates from two snapshots in this session${prior.checkedAt ? ` (previous: ${prior.checkedAt})` : ''}.${modelChanged ? ` Model changed from ${prior.modelId} to ${context.modelId}; limits and tokenization can differ.` : ''}`)
      + (catRows.length ? table(['Category', 'Previous', 'Current', 'Change'], catRows) : '')
      + (catUnavailable.length ? note(`Categories unavailable in one or both snapshots: ${catUnavailable.join(', ')}.`) : '')
      + (sourceChanges.length
        ? `<p class="compaction-caption">Largest source changes</p>`
          + table(['Source', 'Previous', 'Current', 'Change'], sourceChanges.slice(0, 5).map(r => [r.label, r.before, r.after, r.change]))
          + note(`Showing ${number(Math.min(sourceChanges.length, 5))} of ${number(sourceChanges.length)} changed sources.${context.omitted || prior.omitted ? ' One or both snapshots omitted entries.' : ''} Parent and child sources can overlap; do not add rows.`)
        : note('No individual source changes were recorded between these two snapshots.')));
  }

  const snapshot = room + diff + mix + balance + changeable, relation = history + advice;
  return contextPart === 'snapshot' ? snapshot : contextPart === 'history' ? relation : snapshot + relation;
}
