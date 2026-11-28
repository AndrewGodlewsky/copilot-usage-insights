import { esc, usageValue, coverageValue } from './charts.mjs';
import { trendRow, barList } from './token-insights.mjs';

export function renderOverviewTopic(report, ctx) {
  const {
    s, number, credits, context, showCoverage,
    valid, percent, share, note, empty, section, coverage, partial, measured, insight, jump, bars, current, category,
  } = ctx;

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
  const creditsIncomplete = !!(totals.missingCredits || totals.partialCredits);
  const holder = (rows, one, many, count = 1) => {
    const size = (rows || []).length, top = largest(rows, size > count ? count : 1), held = top.reduce((sum, row) => sum + row.total, 0), value = share(held, tokenTotal);
    if (!top.length || value == null) return null;
    const tokens = `${coverageValue(held, top.some(row => row.missingTokens), number, showCoverage)} of ${usageValue(totals, 'total', number, showCoverage)} measured tokens`, name = top[0].name || `Unnamed ${one}`;
    let rowCredits = 0, creditLeader = null;
    for (const row of rows || []) if (valid(row?.credits)) {
      rowCredits += row.credits;
      if (!creditLeader || row.credits > creditLeader.credits) creditLeader = row;
    }
    const heldCredits = top.reduce((sum, row) => sum + (valid(row?.credits) ? row.credits : 0), 0);
    const anyHeldCredits = top.some(row => valid(row?.credits)), missingHeldCredits = top.some(row => !valid(row?.credits));
    const creditPart = rowCredits > 0 && anyHeldCredits ? share(heldCredits, rowCredits) : null;
    const creditNote = creditPart == null ? '' : `${coverageValue(creditPart, creditsIncomplete || missingHeldCredits, percent, showCoverage)} of recorded credits`;
    const otherLeader = top.length === 1 && creditLeader && creditLeader !== top[0] && rowCredits > 0 && creditLeader.credits > (valid(top[0].credits) ? top[0].credits : -1)
      ? `Largest by credits: ${creditLeader.name || `Unnamed ${one}`}, ${coverageValue(share(creditLeader.credits, rowCredits), creditsIncomplete, percent, showCoverage)}` : '';
    return top.length > 1
      ? { label: `${top.length === 5 ? 'Five' : number(top.length)} largest ${many}`, value, concentrated: top.length === 5 && size > 10 && value >= 50,
        detail: `${tokens} · ${number(top.length)} of ${number(size)} ${many}. Largest: ${name}, ${percent(share(top[0].total, tokenTotal))}.${creditNote ? ` ${creditNote}.` : ''}` }
      : { label: `Largest ${one}`, value, detail: [name, tokens, size === 1 ? `the only ${one} in these filters` : `largest of ${number(size)} ${many}`, creditNote, otherLeader].filter(Boolean).join(' · ') };
  };
  const conversations = holder(report.sessions, 'conversation', 'conversations', 5);
  const holders = barList([holder(report.models, 'model', 'models'), holder(report.projects, 'project', 'projects'), conversations].filter(Boolean),
    { total: 100, format: value => coverageValue(value, tokensIncomplete, percent, showCoverage) });
  const who = holders ? holders + note(`Shares of measured input and output tokens in these filters, ${report.query?.includeCache === false ? 'excluding' : 'including'} cached input. Token volume is not cost share, and a large share can simply be where most of the work happened. Credit shares use recorded charges only; missing or partial charges are not zero. A conversation that spans projects is counted once per project.`)
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
  const uses = report.skills?.invocations, skillFailures = report.skills?.failures, toolCalls = report.tools?.calls;
  const resultsIndex = current
    ? snapshot(category('messages'), 'Conversation and tool messages in the current conversation snapshot.', '')
    : valid(toolCalls)
      ? [`${number(toolCalls)} ${toolCalls === 1 ? 'tool call' : 'tool calls'}`, 'Recorded in the selected history. History does not record how many tokens their results used; inspect context for current messages.']
      : ['Needs Inspect context', 'History does not record how many tokens tool results used.'];
  const skillsIndex = current
    ? snapshot(category('customInstructions'), 'Custom instructions in the current conversation snapshot.', '')
    : valid(uses)
      ? [`${number(uses)} ${uses === 1 ? 'use' : 'uses'}${valid(skillFailures) && skillFailures > 0 ? ` · ${number(skillFailures)} failed` : ''}`, 'Recorded in the selected history. History does not record how many tokens a skill added; inspect context for current instructions.']
      : ['Needs Inspect context', 'History does not record how many tokens a skill added.'];
  const prompt1 = report.efficiency?.growthSummary?.positions?.find(row => row.prompt === 1);
  const contextIndex = current
    ? snapshot(setupTokens != null && setupTokens <= context?.totalTokens ? setupTokens : null, 'Instructions and tool definitions in the current conversation snapshot.', '')
    : valid(prompt1?.input)
      ? [`${number(prompt1.input)} tokens at start`, `Typical Prompt 1 input across ${number(prompt1.conversations)} conversations in selected history; inspect context for current setup breakdown.`]
      : valid(s.averageToolTokens)
        ? [`${number(s.averageToolTokens)} tool-def tokens`, `Average tool definitions per call in selected history; inspect context for current instructions and tool definitions.`]
        : ['Needs Inspect context', 'Instructions and tool definitions in the current conversation. History does not record them.'];
  const index = [
    ['context', 'Always-loaded context', ...contextIndex],
    ['tools', 'Tool and MCP footprint', measured(s.toolShare, s.toolRequests, s.requests, percent), `of measured input described the available tools · ${coverage(s.toolRequests)}`],
    ['results', 'Files, searches, and tool results', ...resultsIndex],
    ['cache', 'Cache reuse', measured(s.cacheHitRate, s.cacheRequests, s.requests, percent), `of measured input was read from cache · ${coverage(s.cacheRequests)}`],
    ['skills', 'Skills and instruction footprint', ...skillsIndex],
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
