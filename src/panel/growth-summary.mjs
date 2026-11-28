import { esc } from './charts.mjs';

// "Context growth" summary above the example conversations: what report.efficiency.growthSummary
// measured across all main conversations. `efficiency` is report.efficiency, read only for the
// compaction count.
export function renderGrowthSummary(data, { number, credits = number } = {}, efficiency = {}) {
  const g = data || {}, valid = value => Number.isFinite(value) && value >= 0;
  if (!g.measuredCalls) return '';
  const n = value => valid(value) ? number(value) : 'Unavailable';
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const times = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })} times` : 'Unavailable';
  const of = (part, total) => `${n(part ?? 0)} of ${n(total ?? 0)}`;
  const share = (part, total) => valid(part) && total > 0 && part <= total ? part / total * 100 : null;
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(detail)}</span></div>`;
  const metrics = (...items) => `<div class="efficiency-metrics">${items.join('')}</div>`;
  const l = g.later || {}, positions = g.positions || [];

  let html = section('How much input grows', positions.some(p => p.input != null)
    ? `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr><th scope="col">User prompt</th><th scope="col">Conversations</th><th scope="col">Typical input</th><th scope="col">Compared with prompt 1</th></tr></thead><tbody>${positions.map(p =>
        `<tr><td><span class="cell-text">${esc(p.prompt === 1 ? '1 (the start)' : n(p.prompt))}</span></td><td><span class="cell-text">${esc(n(p.conversations))}</span></td><td><span class="cell-text">${esc(n(p.input))}</span></td><td><span class="cell-text">${esc(p.prompt === 1 ? 'Starting point' : times(p.multiple))}</span></td></tr>`).join('')}</tbody></table></div>`
      + note(`Typical means half of the conversations were below it. Input is the first main-agent call of each user prompt, cached input included. The last column is the middle of each conversation's own change since its prompt 1. Longer conversations are a different, smaller set at each position, so a row is not the same group as the row above it. A position needs at least ${n(g.minimumConversations)} conversations; below that it shows Unavailable.`)
    : '<p class="muted token-insight-note">No prompt position has enough conversations with recorded input to show a typical value.</p>');

  html += section('How many conversations grow a lot', g.measuredConversations
    ? metrics(
        metric('Reached 2 times the start', of(g.grew2, g.measuredConversations), `${percent(share(g.grew2, g.measuredConversations))} of conversations`),
        metric('Reached 5 times the start', of(g.grew5, g.measuredConversations), `${percent(share(g.grew5, g.measuredConversations))} of conversations`))
      + note(`Compares each conversation's largest call with its first call. Only main-conversation calls with recorded input count, and a conversation needs at least two (${of(g.measuredConversations, g.conversations)} conversations qualify). A conversation with one long task can grow without any habit behind it.`)
    : '<p class="muted token-insight-note">No conversation has two main-agent calls with recorded input, so growth cannot be compared.</p>');

  const inputShare = share(l.input, l.totalInput), creditShare = share(l.credits, l.totalCredits);
  html += section('Where the input is spent', l.totalInput > 0
    ? metrics(
        metric('Input after the start doubled', percent(inputShare), `${n(l.input)} of ${n(l.totalInput)} tokens, from ${of(l.calls, g.measuredCalls)} calls in ${n(l.conversations)} conversations`),
        metric('Credits after the start doubled', l.chargeCalls ? percent(creditShare) : 'Unavailable', l.chargeCalls ? `${credits(l.credits)} of ${credits(l.totalCredits)}, from ${of(l.lateChargeCalls, l.chargeCalls)} calls with complete charges` : 'No main-agent call has a complete charge'))
      + note(`Counts the first call that read at least twice its conversation's starting input and every call after it. Main-conversation calls only; ${of(g.measuredCalls, g.mainCalls)} have recorded input.`
        + (l.splitCalls ? ` In those later calls, ${percent(l.splitShare)} of the input was read from cache (${of(l.splitCalls, l.calls)} calls have a complete cache split). Cache reads are usually cheaper than other input, so a large share of input is not the same as a large share of cost.` : ' A cache split is not recorded for these later calls.')
        + '')
    : '<p class="muted token-insight-note">No main-agent call has recorded input, so the share after growth is unavailable.</p>');

  const compaction = efficiency?.compaction;
  const compactionButton = '<button class="model-toggle" data-efficiency-jump-section="patterns" data-efficiency-jump-topic="compaction">See Context reduction</button>';
  html += section('What makes it shrink again', compaction?.compactions
    ? `<p class="token-insight-note">${esc(`${compaction.sessions <= g.conversations ? of(compaction.sessions, g.conversations) : n(compaction.sessions)} conversations in these dates have a recorded compaction (${n(compaction.compactions)} in total).`)} ${compactionButton} for what a compaction removed and how soon input grew back.</p>`
    : `<p class="muted token-insight-note">No compaction is recorded for these dates and filters. ${compactionButton} for what a compaction is.</p>`);

  let observation, action;
  if (l.totalInput > 0 && l.calls) {
    observation = `${percent(inputShare)} of main-conversation input came from calls after a conversation had at least doubled its starting input.`;
    action = 'At the next natural break in a long task, try starting a new conversation with a short note of the goal, the decisions made and the files in play, instead of continuing in the same one.';
  } else {
    observation = 'No conversation here doubled its starting input.';
    action = 'Try this again after a longer task. Short conversations may never need to grow.';
  }
  html += `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${note('Compare afterward: input per call and credits per prompt on similar work. A long conversation can need its history, and a new one starts without it, so check that the answers are still as useful. This is a comparison to try, not a promised saving.')}</aside>`;
  return `<div class="growth-summary">${html}</div>`;
}
