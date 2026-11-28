import { esc } from './charts.mjs';
import { topicJumpButton } from './token-insights.mjs';

// The measured half of "Conversation habits": report.efficiency.habits, built by
// src/core/efficiency-habits.mjs. It sits below the interactive conversation views. A measure that
// could not be taken reads "Unavailable", never 0, and every table says how many prompts have work
// figures out of how many were seen.
export function renderHabitsTopic(data, { number, credits = number } = {}) {
  if (!data || data.reason === 'model-filter') return '';
  const valid = value => Number.isFinite(value) && value >= 0;
  const n = value => valid(value) ? number(value) : 'Unavailable';
  const one = value => valid(value) ? number(value, { maximumFractionDigits: 1 }) : 'Unavailable';
  const cr = value => valid(value) ? credits(value) : 'Unavailable';
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const of = (part, total) => `${n(part ?? 0)} of ${n(total ?? 0)}`;
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const empty = text => `<p class="muted token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(detail)}</span></div>`;
  const table = (headers, rows) => `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table habits-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' class="text-cell"' : ''}><span class="cell-text">${esc(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const insight = (observation, action, compare) => `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${note(`Compare afterward: ${compare}`)}</aside>`;
  // One row of the work tables. Typical is the middle value: half of the prompts were at or below it.
  const workRow = b => [b.label, of(b.eligible, b.prompts), b.eligible ? one(b.medianCalls) : 'Unavailable', b.eligible ? cr(b.medianCredits) : 'Unavailable',
    b.eligible ? cr(b.averageCredits) : 'Unavailable', b.tokenPrompts ? n(Math.round(b.averageTokens)) : 'Unavailable'];
  const workHeaders = first => [first, 'With work figures', 'Typical calls', 'Typical credits', 'Average credits', 'Average tokens'];

  if (!data.usable) return section('What your habits show', empty('No conversation in these dates has prompts that can be confirmed as yours with a known time, so these measures are unavailable.')
    + note(data.uncertain ? `${of(data.uncertain, data.conversations)} conversations include a submission that could not be confirmed as a prompt from you, so they are left out. Try a wider date range.` : 'Try a wider date range.'));

  const lengthRows = data.length || [], position = data.position || [], pause = data.pause || [], delivery = data.delivery || [], chars = data.chars || [];
  const deliveryRows = delivery.filter((b, index) => index < 3 || b.prompts > 0);
  let html = `<div class="efficiency-metrics">${metric('Conversations', n(data.usable), data.uncertain ? `${n(data.uncertain)} more left out: a submission could not be confirmed as yours` : 'With confirmed prompts in these dates')}`
    + `${metric('Prompts', n(data.prompts), `${of(data.eligible, data.prompts)} have complete work figures`)}`
    + `${metric('Credits recorded', data.eligible ? cr(data.credits) : 'Unavailable', 'Only for prompts with complete work figures')}</div>`;

  html += section('How long conversations run', table(['Conversation length', 'Conversations', 'Prompts', 'Credits', 'Share of credits'], lengthRows.map(b => [b.label,
    `${n(b.conversations)} (${percent(data.usable ? b.conversations / data.usable * 100 : null)})`, n(b.prompts), b.eligible ? cr(b.credits) : 'Unavailable', b.share == null ? 'Unavailable' : percent(b.share)]))
    + note(`Length counts your prompts in the selected dates, not the whole life of a conversation. Credits and their shares come only from the ${of(data.eligible, data.prompts)} prompts with complete work figures, so a conversation with unfinished or shared work counts for less than it used.`));

  html += section('Does a later prompt carry more work', table(workHeaders('Position in the conversation'), position.map(workRow))
    + (data.paired?.conversations ? `<p class="token-insight-note">${esc(`In ${of(data.paired.laterHigher, data.paired.conversations)} conversations with work figures for the first prompt and for later prompts, the later prompts averaged more credits than the first.`)}</p>` : '')
    + note('Position counts every confirmed prompt in the conversation, including ones before the selected dates. Tokens are input plus output. Typical is the middle value. Later prompts in a long conversation are often harder or larger tasks, and position is not a cause of the work that follows.'));

  html += section('Pauses before a prompt', table(workHeaders('Time since your previous prompt'), pause.map(workRow))
    + `<p class="footnote token-insight-note">${esc(`${n(data.firstPrompts)} first prompts have no earlier prompt and are not listed. The pause is measured from your previous prompt, so it includes the time the agent spent working on it. A prompt whose work is shared with another prompt, or cannot be linked to it reliably, has no work figures. The `)}${topicJumpButton('tokens', 'cache', 'Cache reuse')}${esc(' view, under Where did the tokens go, shows cache reads by pause.')}</p>`);

  if (deliveryRows.some(b => b.prompts > 0)) {
    html += section('How prompt timing relates to work', table(workHeaders('How your prompt arrived'), deliveryRows.map(workRow))
      + note('Delivery describes when your message arrived, not prompt quality. Steering prompts often share a billing group with the prompt already running, so they are counted here without separate work figures.'));
  }

  html += section('Prompt length', data.measuredChars
    ? table(workHeaders('Length of your prompt'), chars.map(workRow))
      + note(`${of(data.measuredChars, data.prompts)} prompts record a length. It is the number of characters in your message, without attachments or added context. The text itself is never read or kept. Length does not measure how clear or complete a prompt is.`)
    : empty('No prompt in these dates records a length, so this comparison is unavailable.'));

  // One observation. Order: the same conversations first against later prompts, then a long pause, then how credits split by length.
  const first = position[0], later = position.slice(1).reduce((all, b) => ({ eligible: all.eligible + b.eligible }), { eligible: 0 });
  const quick = pause[0], slow = pause[2], long = lengthRows.slice(2), longShare = long.reduce((total, b) => total + (b.share || 0), 0), longConversations = long.reduce((total, b) => total + b.conversations, 0);
  let observation, action, after;
  if (data.paired?.conversations >= 5 && first.eligible && later.eligible) {
    observation = `In ${of(data.paired.laterHigher, data.paired.conversations)} conversations, the later prompts averaged more credits than the first prompt.`;
    action = 'On your next long task, try starting a new conversation at a natural break, with a short note of the goal, the decisions made and the files in play, instead of continuing in the same one.';
    after = 'credits and calls per prompt on similar work, and whether you had to repeat context. Later prompts are often harder tasks, so a gap can reflect the task and not the length of the conversation.';
  } else if (quick?.eligible >= 5 && slow?.eligible >= 5) {
    observation = `Prompts after a pause of over an hour had typical credits of ${cr(slow.medianCredits)}, against ${cr(quick.medianCredits)} for prompts under 5 minutes after the last.`;
    action = 'When you come back after a break, try opening with two lines: the goal and where you left off. Then see whether the agent needs fewer calls to get going.';
    after = 'typical calls and credits for prompts after a long pause, and cache reads by pause in the Cache reuse view. Prompts after a break may be different kinds of task.';
  } else if (data.eligible >= 5 && longConversations && valid(longShare)) {
    observation = `Conversations of 6 or more prompts were ${percent(data.usable ? longConversations / data.usable * 100 : null)} of conversations and ${percent(longShare)} of recorded credits.`;
    action = 'Pick one long conversation and note where the task changed. Next time, start a new conversation at that point and compare.';
    after = 'credits per prompt in the shorter conversations and whether the task still got done. Long conversations may simply hold bigger tasks.';
  } else {
    observation = 'There are too few prompts with complete work figures to compare habits yet.';
    action = 'Keep using Copilot as you normally do, then look here again with a wider date range.';
    after = 'how many prompts have complete work figures.';
  }
  html += insight(observation, action, after);
  return html + note('These measures describe how work followed your prompts. They do not show quality, waste or cause. Prompts without complete, finished accounting are counted but have no work figures.');
}
