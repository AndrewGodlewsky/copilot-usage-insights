import { esc } from './charts.mjs';
import { barList } from './token-insights.mjs';

// Plain names for the reasons Copilot records for starting a compaction.
const COMPACTION_REASONS = {
  threshold: 'Automatic: context passed Copilot\'s threshold',
  context_limit_retry: 'Automatic: a model reported its context limit',
  manual: 'Requested, for example with /compact',
  memory_pressure: 'Automatic: high memory use',
  model_switch: 'Switch to a model with a smaller context window',
  unknown: 'Reason not recorded',
};

// "Context reduction": what report.efficiency.compaction measured. `summary` is
// report.efficiency.summary, used only to place the summary calls' charges among all charges.
export function renderCompactionTopic(data, { number, credits = number } = {}, summary = {}) {
  const c = data || {}, t = c.tokens || {}, m = c.messages || {}, cost = c.cost || {}, x = c.next || {};
  const valid = value => Number.isFinite(value) && value >= 0;
  const n = value => valid(value) ? number(value) : 'Unavailable';
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const of = (part, total) => `${n(part ?? 0)} of ${n(total ?? 0)}`;
  const count = (value, one, many = one + 's') => `${n(value)} ${value === 1 ? one : many}`;
  // Copilot's counts can, in principle, be larger after than before. That is not a reduction.
  const lowered = (value, format) => value == null ? 'Unavailable' : value < 0 ? 'None' : format(value);
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const empty = text => `<p class="muted token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(detail)}</span></div>`;
  const metrics = (...items) => `<div class="efficiency-metrics">${items.join('')}</div>`;
  const compare = (caption, rows, options) => `<p class="compaction-caption">${esc(caption)}</p>` + barList(rows, options);
  const scope = [
    c.modelFiltered ? 'Model filter: this view keeps compactions from conversations with calls on a selected model in these dates, and compares only those calls.' : '',
    c.subagent ? `${count(c.subagent, 'compaction')} inside subagents ${c.subagent === 1 ? 'is' : 'are'} not counted here.` : '',
    c.omitted ? `${count(c.omitted, 'compaction')} left out because provider attribution is missing or mixed.` : '',
  ].filter(Boolean).join(' ');

  if (!c.compactions) return '<p class="muted">No compaction is recorded for these dates and filters.</p>'
    + '<p>A compaction replaces earlier conversation history with a summary, so a long conversation keeps fitting the model\'s context window. One appears here once Copilot records that it finished. Copilot can start one on its own, for example when the context passes its threshold or a model reports its context limit. You can also ask for one (for example with /compact), and switching to a model with a smaller context window can start one.</p>'
    + note('Short conversations may never need one. Try a wider date range, or clear the project, session and model filters. This dashboard reads compactions from Copilot session journals only.' + (scope ? ' ' + scope : ''));

  const sizes = `${of(t.pairs, c.succeeded)} successful compactions record both sizes`;
  let html = metrics(
    metric('Compactions', n(c.compactions), `In ${count(c.sessions, 'conversation')}`),
    metric('Succeeded', n(c.succeeded), `${n(c.failed)} failed · ${n(c.unknownOutcome)} with no recorded outcome`),
    metric('Typical reduction', t.pairs ? lowered(t.reduction, percent) : 'Unavailable', t.pairs ? `Copilot's estimate; ${sizes}` : 'No successful compaction records both sizes'),
    metric('Removed from context', t.pairs ? lowered(t.removed, n) : 'Unavailable', t.pairs ? 'Tokens, added up over the same compactions' : 'Unavailable is not zero'));

  const fill = value => t.limitPairs ? `Typically ${percent(value)} of the model's context limit` : '';
  html += section('Context before and after a compaction', t.pairs
    ? barList([{ label: 'Before', value: t.before, detail: fill(t.fillBefore) }, { label: 'After', value: t.after, color: 'var(--s3)', detail: fill(t.fillAfter) }], { format: number })
      + note(`Tokens in context, as Copilot estimated them when each compaction finished. Each bar is the middle value: half of the compactions were above it and half below. ${sizes}.`
        + (t.limitPairs && t.limitPairs < t.pairs ? ` ${of(t.limitPairs, t.pairs)} of those also record the model's limit.` : '')
        + (t.larger ? ` ${count(t.larger, 'compaction')} recorded a larger size after than before.` : '')
        + (m.samples ? ` Where message counts are recorded (${count(m.samples, 'compaction')}), the middle values were ${n(m.removed)} messages removed out of ${n(m.before)}.` : ''))
    : empty('No successful compaction in this view records a size both before and after, so the reduction is unavailable. That is not a reduction of zero.'));

  const reasons = (c.triggers || []).map(r => ({ label: Object.hasOwn(COMPACTION_REASONS, r.id) ? COMPACTION_REASONS[r.id] : COMPACTION_REASONS.unknown, value: r.count }));
  html += section('Why compactions started', barList(reasons, { total: c.compactions, format: value => `${number(value)} (${percent(value / c.compactions * 100)})` })
    + note('The reason Copilot recorded with each compaction, failed ones included.'));

  const creditShare = valid(cost.credits) && summary?.credits > 0 && cost.credits <= summary.credits ? cost.credits / summary.credits * 100 : null;
  html += section('What the summaries cost', cost.calls
    ? metrics(
        metric('Summary calls', n(cost.calls), 'Model calls that wrote a summary, with recorded usage'),
        metric('Input they read', cost.inputCalls ? n(cost.inputTokens) : 'Unavailable', `${of(cost.inputCalls, cost.calls)} calls`),
        metric('Output they wrote', cost.outputCalls ? n(cost.outputTokens) : 'Unavailable', `${of(cost.outputCalls, cost.calls)} calls`),
        metric('AI credits', cost.creditCalls ? credits(cost.credits) : 'Unavailable', `${of(cost.creditCalls, cost.calls)} calls with complete charges`))
      + note('These calls are already part of your usage totals.'
        + (creditShare == null ? '' : ` They are ${percent(creditShare)} of the complete charges recorded for all model calls in this view.`)
        + (valid(cost.averageDuration) ? ` A summary call took ${number(cost.averageDuration / 1000, { maximumFractionDigits: 1 })} seconds on average (${of(cost.durationCalls, cost.calls)} calls).` : '')
        + ' A failed compaction can still be charged. Sessions read only from the usage database do not mark these calls, so a compaction can be counted above with no cost here.')
    : empty('No summary call with recorded usage matches these filters. Unavailable is not zero: sessions read only from the usage database do not mark these calls.'));

  html += section('The call before and the call after', x.paired
    ? compare('Input tokens of one model call', [{ label: 'Last call before', value: x.inputBefore }, { label: 'First call after', value: x.inputAfter, color: 'var(--s3)' }], { format: number })
      + `<p class="token-insight-note">${esc(`In ${of(x.smaller, x.paired)} compactions the first call after read less input than the last call before.${x.change > 0 ? ` The middle drop was ${percent(x.change)}.` : ''}`)}</p>`
      + (x.cachePairs
        ? compare('Share of that input read from cache', [{ label: 'Last call before', value: x.cacheBefore }, { label: 'First call after', value: x.cacheAfter, color: 'var(--s3)' }], { format: percent, total: 100 })
        : empty('Neither call has a complete cache split, so cache reuse around compactions is unavailable.'))
      + note(`Main-conversation calls in the selected dates; subagent calls are left out. ${of(x.paired, c.succeeded)} successful compactions have a measured call on both sides`
        + (x.cachePairs ? `, and ${of(x.cachePairs, x.paired)} of those have a complete cache split on both calls` : '')
        + '. Input here is what each call reported, cached input included. It is a different count from Copilot\'s estimate above.'
        + (x.cachePairs && x.cacheAfter < x.cacheBefore ? ' A changed history and a pause before the next prompt can both lower cache reads. This view cannot tell them apart.' : ''))
    : empty('No successful compaction in this view has a measured main-conversation call both before and after it in the selected dates.'));

  if (x.smaller) html += section('How soon input grew back', metrics(
      metric('Back to the earlier size', of(x.regained, x.smaller), 'Compactions after which a later call read as much input as the last call before'),
      metric('Calls it took', x.regained ? n(x.regainCalls) : 'Unavailable', x.regained ? 'Middle value where it happened, counting the first call after as 1' : 'It did not happen in this view'),
      metric('Compacted again first', n(x.compactedAgain), 'Another compaction came before input was back'),
      metric('Still smaller at the end', n(x.ended), 'The recorded calls stopped first'))
    + note(`Follows the ${count(x.smaller, 'compaction')} where the first call after read less input. Only calls in the selected dates are followed, so a conversation that continued later can still grow back.`));

  const rows = c.conversations || [];
  if (rows.length) html += section('Conversations compacted most',
    `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr><th scope="col">Conversation</th><th scope="col">Compactions</th><th scope="col">Removed from context</th></tr></thead><tbody>${rows.map(r => `<tr><td class="text-cell"><span class="cell-text">${esc(r.name)}</span></td><td><span class="cell-text">${esc(n(r.compactions))}</span></td><td><span class="cell-text">${esc(lowered(r.removed, n))}</span></td></tr>`).join('')}</tbody></table></div>`
    + note(`Showing ${of(rows.length, c.sessions)} conversations with a compaction. Removed adds up Copilot's estimate for compactions that record both sizes.`
      + (c.repeatSessions ? ` ${of(c.repeatCompactions, c.compactions)} compactions happened in ${count(c.repeatSessions, 'conversation')} compacted more than once.` : '')));

  // One observation, chosen in this order: repeated failures, input that grows straight back,
  // a first call that reuses much less cache, then the reduction itself.
  const outcomes = (c.succeeded || 0) + (c.failed || 0);
  let observation, action, after;
  if (c.failed >= 3 && c.failed / outcomes >= .2) {
    observation = `${of(c.failed, outcomes)} compactions with a recorded outcome failed.`;
    action = 'This view does not record why. If a long conversation keeps failing to compact, try starting a new one at a natural break, with a short note of the goal, the decisions made and the files in play.';
    after = 'failed compactions and input per call in the conversations that follow.';
  } else if (x.smaller >= 3 && x.regained / x.smaller >= .5) {
    observation = `After ${of(x.regained, x.smaller)} compactions, input was back to its earlier size. Half of those took ${n(x.regainCalls)} calls or fewer.`;
    action = 'Look at what refills the context between compactions. On the next long task, ask for targeted searches and the relevant excerpts instead of whole files or full command output.';
    after = 'how many calls pass before input is back, and how often the conversation is compacted. Large results can be what the task needs.';
  } else if (x.cachePairs >= 3 && x.cacheBefore - x.cacheAfter >= 20) {
    observation = `The first call after a compaction read ${percent(x.cacheAfter)} of its input from cache. The last call before read ${percent(x.cacheBefore)}.`;
    action = 'At the next natural break in a long task, try starting a new conversation with a short note of the goal, the decisions made and the files in play, instead of continuing until Copilot compacts in the middle of the work.';
    after = 'input per call, cache share and credits per prompt on similar work. A new conversation has no earlier history to reuse, and it drops what a compaction would have summarized.';
  } else if (t.pairs) {
    observation = `A typical compaction took Copilot's context estimate from ${n(t.before)} to ${n(t.after)} tokens.`;
    action = 'After the next compaction, ask Copilot to restate the goal, the decisions made and the files in play before it continues, and correct anything that is missing.';
    after = 'whether later answers still use earlier decisions, alongside input per call.';
  } else {
    observation = 'These compactions are recorded without a size before and after.';
    action = 'Use the counts and reasons above for now. After the next long conversation, look here again for a recorded size before and after.';
    after = 'how many compactions record both sizes.';
  }
  html += `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${note(`Compare afterward: ${after}`)}</aside>`;

  return html + note('Token reductions measure how much context is occupied. They are not credits returned. A smaller context does not show what information was kept. Sizes before and after are Copilot\'s own estimate, not billed tokens.' + (scope ? ' ' + scope : ''));
}
