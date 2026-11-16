import { esc } from './charts.mjs';

function renderDelivery(c, n, pct) {
  const d = c.delivery;
  if (!d) return '';
  const bars = [['idle', 'Started while idle'], ['steering', 'Steering'], ['queued', 'Queued'], ['unknown', 'Unknown']]
    .map(([key, label]) => `<li><span>${label}</span><span class="conversation-bar${key === 'unknown' ? ' delivery-unknown' : ''}" aria-hidden="true"><i style="width:${pct(d[key], c.prompts)}%"></i></span><span><strong>${n(d[key])}</strong> <span class="muted">(${n(pct(d[key], c.prompts))}%)</span></span></li>`).join('');
  const distribution = c.prompts ? `<ul class="conversation-bars delivery-bars" aria-label="Prompt delivery distribution">${bars}</ul><p class="footnote">${n(d.known)} of ${n(c.prompts)} prompts have a recorded delivery type. Missing or conflicting labels stay unknown.</p>` : '<p class="muted">No confirmed prompt delivery sample in this view.</p>';
  const stats = [
    ['Sessions with steering', d.classifiedSessions ? `${n(pct(d.steeredSessions, d.classifiedSessions))}%` : 'Unavailable'],
    ['Steering / session', d.classifiedSessions ? n(d.averageSteering) : 'Unavailable'],
    ['User stops', n(d.userStops)],
  ];
  return `<div class="conversation-layout conversation-delivery"><section aria-labelledby="conversation-delivery-title"><h3 id="conversation-delivery-title">How you guide the agent</h3><p class="footnote">Steering joins ongoing work; queued prompts wait to start a separate run.</p>${distribution}</section><section aria-labelledby="conversation-steering-title"><h3 id="conversation-steering-title">Steering and stops</h3><dl class="conversation-summary">${stats.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl><p class="footnote">Steering rates use ${n(d.classifiedSessions)} of ${n(c.countedSessions || 0)} counted sessions with delivery labels for every prompt.</p><p class="footnote">Stops count explicit user stop events on the selected dates, across ${n(d.stopSessions)} sessions. Sources without stop metadata may omit them. They are not a count of failed prompts or wasted tokens.</p></section></div><p class="footnote">Steering can mean correction, new information or deliberate collaboration. Frequency alone does not measure prompt quality or efficiency.</p>`;
}

export function renderConversations(c, { number = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }) } = {}) {
  if (c?.reason === 'model-filter') return '<p class="muted">Clear the model filter to see conversation depth across all models used in each session.</p>';
  if (!c) return '';
  const n = value => esc(number(value)), pct = (part, total) => total ? part / total * 100 : 0;
  const coverage = `<p class="footnote">${n(c.countedSessions || 0)} of ${n(c.sessions || 0)} sessions have usable user-prompt counts in these dates.${c.withoutPrompts ? ` ${n(c.withoutPrompts)} have no confirmed user prompts in this window; these may be ongoing work or sources without message metadata, including VS Code accounting.` : ''}${c.uncertainSessions ? ` ${n(c.uncertainSessions)} have uncertain prompt identity and are left out of these charts.` : ''}</p>`;
  if (!c.countedSessions) return `<p class="muted">No sessions with reliable user-prompt counts in this view.</p>${coverage}${renderDelivery(c, n, pct)}`;
  const stats = [
    ['Median prompts / session', n(c.medianPrompts), 'The middle session by prompt count'],
    ['Average prompts / session', n(c.averagePrompts), `${n(c.prompts)} prompts across ${n(c.countedSessions)} counted sessions`],
    ['Used on multiple days', `${n(c.multiDaySessions)} / ${n(c.countedSessions)}`, 'Prompts on at least two selected dates'],
    ...(c.windowed ? [['Earlier recorded activity', `${n(c.priorSessions)} / ${n(c.countedSessions)}`, 'Also have matching prompts before these dates']] : []),
  ];
  const bars = c.distribution.map(b => `<li><span>${esc(b.label)}</span><span class="conversation-bar" aria-hidden="true"><i style="width:${pct(b.count, c.countedSessions)}%"></i></span><span><strong>${n(b.count)}</strong> <span class="muted">(${n(pct(b.count, c.countedSessions))}%)</span></span></li>`).join('');
  const promptLabels = ['1 prompt', '2–5 prompts', '6+ prompts'], callLabels = ['1 call', '>1–5 calls', '>5 calls'];
  const max = Math.max(1, ...c.workMatrix.flat());
  const grid = c.workSessions ? `<table class="conversation-matrix"><caption>Model calls per prompt × user prompts per session</caption><thead><tr><th scope="col">Average calls / prompt</th>${promptLabels.map(label => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${c.workMatrix.map((row, i) => `<tr><th scope="row">${esc(callLabels[i])}</th>${row.map(count => `<td style="--shade:${count / max * .24}"><strong>${n(count)}</strong></td>`).join('')}</tr>`).join('')}</tbody></table><p class="footnote">Cells show session counts. Stronger color means more sessions. Average: <strong>${n(c.averageCallsPerPrompt)}</strong> model calls per prompt across ${n(c.workPrompts)} prompts.</p>` : '<p class="muted">Complete prompt accounting is not available for any whole session sample in this view.</p>';
  return `<div class="conversation-insights"><dl class="conversation-summary">${stats.map(([label, value, hint]) => `<div><dt>${label}</dt><dd>${value}</dd><small>${hint}</small></div>`).join('')}</dl><div class="conversation-layout"><section aria-labelledby="conversation-depth-title"><h3 id="conversation-depth-title">User prompts per session</h3><p class="footnote">Share of counted sessions in each group</p><ul class="conversation-bars" aria-label="Session depth distribution">${bars}</ul>${coverage}</section><section aria-labelledby="conversation-work-title"><h3 id="conversation-work-title">Work between your prompts</h3>${grid}<p class="footnote">Based on ${n(c.workSessions)} of ${n(c.countedSessions)} counted sessions. Every observed prompt in those sessions has complete, finished accounting. Model calls include the initial response, continuations and reliably linked subagents, even when that work crosses a date boundary.</p></section></div><p class="footnote">One prompt with many model calls can reflect autonomous work; repeated prompts can reflect iteration or clarification. Calls measure activity, not task duration, task count or success. These categories are not efficiency ratings. Counts cover selected dates, not lifetime session length; missing logs can understate activity.</p>${renderDelivery(c, n, pct)}</div>`;
}
