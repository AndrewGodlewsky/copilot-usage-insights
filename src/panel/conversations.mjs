import { esc } from './charts.mjs';
import { conversationComparison } from '../core/conversation-summary.mjs';

export const CONVERSATION_TOPICS = ['interaction', 'work', 'guidance', 'returning'];
const conversationDelivery = [['idle', 'Started while idle'], ['steering', 'Steering'], ['queued', 'Queued'], ['unknown', 'Unknown']];
const conversationPercent = (n, total) => total > 0 ? n / total * 100 : 0;
const conversationBucket = n => n === 1 ? 0 : n <= 5 ? 1 : n <= 15 ? 2 : 3;

function conversationBars(rows, total, title, n, selected) {
  if (!total) return '<p class="muted conversation-empty">No reliable measurements in this view yet.</p>';
  const largest = Math.max(1, ...rows.map(b => b.count));
  return `<div class="conversation-bars" role="group" aria-label="${esc(title)}">${rows.map((b, index) => `<button id="conversation-bar-${index}" class="conversation-bar-row" data-conversation-bucket="${index}" aria-pressed="${index === selected}" aria-label="${esc(b.label)}: ${n(b.count)}, ${n(conversationPercent(b.count, total))}%. Explore recorded examples."><span class="conversation-bar-label">${esc(b.label)}</span><span class="conversation-bar" aria-hidden="true"><i style="width:${b.count / largest * 100}%"></i></span><span class="conversation-bar-number"><strong>${n(b.count)}</strong><small>${n(conversationPercent(b.count, total))}%</small></span></button>`).join('')}</div>`;
}
function conversationDeliveryChart(d, n, selected) {
  if (!d?.prompts) return '<p class="muted conversation-empty">No confirmed prompt delivery sample in this view.</p>';
  return `<div class="conversation-delivery-chart" role="group" aria-label="Prompt delivery distribution"><div class="conversation-delivery-stack">${conversationDelivery.map(([key, label], i) => d[key] ? `<button id="conversation-delivery-${i}" class="delivery-${key}" data-conversation-bucket="${i}" style="flex:${d[key]}" aria-pressed="${i === selected}" aria-label="${label}: ${n(d[key])} prompts, ${n(conversationPercent(d[key], d.prompts))}%" title="${label}: ${n(d[key])} (${n(conversationPercent(d[key], d.prompts))}%)"></button>` : '').join('')}</div><div class="conversation-delivery-legend">${conversationDelivery.map(([key, label], i) => `<button id="conversation-legend-${i}" data-conversation-bucket="${i}" aria-pressed="${i === selected}"><span><i class="delivery-${key}" aria-hidden="true"></i>${label}</span><span>${n(d[key] || 0)} <small>(${n(conversationPercent(d[key], d.prompts))}%)</small></span></button>`).join('')}</div></div>`;
}
function conversationWorkRelationship(c, n) {
  if (!c.workSessions) return '<p class="footnote">No whole-session sample has complete, finished prompt accounting for the joint view.</p>';
  return `<details id="conversation-work-detail" class="conversation-detail"><summary id="conversation-work-toggle">Human messages × agent activity</summary><p class="footnote">Average model calls per prompt within each conversation. Bands show conversation counts.</p>${['1 prompt', '2–5 prompts', '6+ prompts'].map((label, col) => {
    const counts = c.workMatrix.map(row => row[col]);
    return `<div class="conversation-work-row"><span>${label}</span><div role="img" aria-label="${label}: ${n(counts[0])} conversations averaging 1 call per prompt; ${n(counts[1])} averaging more than 1 through 5; ${n(counts[2])} averaging more than 5">${counts.map((count, row) => count ? `<span class="conversation-band band-${row}" style="flex:${count}">${n(count)}</span>` : '').join('')}</div></div>`;
  }).join('')}<div class="conversation-band-legend"><span><i class="conversation-band band-0" aria-hidden="true"></i>1 call</span><span><i class="conversation-band band-1" aria-hidden="true"></i>&gt;1–5 calls</span><span><i class="conversation-band band-2" aria-hidden="true"></i>&gt;5 calls / prompt</span></div><p class="footnote">${n(c.workSessions)} of ${n(c.countedSessions)} counted conversations. Every observed prompt in this sample has complete, finished accounting; this is separate from the prompt-level distribution.</p></details>`;
}
function conversationTrend(c, topic, n, loading) {
  const comparison = conversationComparison(c, topic, loading);
  if (comparison.reason) return `<p class="footnote conversation-comparison">${esc(comparison.reason)}</p>`;
  const y = comparison.current === comparison.previous ? 20 : comparison.current > comparison.previous ? 6 : 34;
  return `<div class="conversation-comparison"><div><strong>${n(comparison.previous)} → ${n(comparison.current)} ${esc(comparison.unit)}</strong><p class="footnote">Compared with ${esc(comparison.startDate)} to ${esc(comparison.endDate)}</p><span class="footnote">${n(comparison.previousSamples)} of ${n(comparison.previousTotal)} previous / ${n(comparison.samples)} of ${n(comparison.total)} current observations; similar observed coverage</span></div><svg viewBox="0 0 180 55" aria-hidden="true"><path d="M10 20 170 ${y}"/><circle cx="10" cy="20" r="3"/><circle cx="170" cy="${y}" r="3"/><text x="10" y="53">Previous</text><text x="170" y="53" text-anchor="end">Selected</text></svg></div>`;
}
function conversationExamples(c, topic, bucket, index, n) {
  const examples = (c.examples || []).filter(e => {
    if (bucket == null) return true;
    if (topic === 'interaction') return !e.uncertain && conversationBucket(e.prompts) === bucket;
    if (topic === 'returning') return !e.uncertain && (e.days === 1 ? 0 : e.days <= 3 ? 1 : 2) === bucket;
    if (topic === 'work') return e.workBins?.[bucket] > 0;
    return e.delivery?.[conversationDelivery[bucket]?.[0]] > 0;
  });
  const selected = examples.find(e => e.index === index) || examples[0];
  const labelOf = e => e.name || `Conversation ${n(e.index + 1)}`;
  const openBreakdown = selected?.sessionId ? ` · <button id="conversation-open-breakdown" class="conversation-link" data-conversation-open-session="${esc(selected.sessionId)}" data-conversation-open-project="${esc(selected.project || '')}">Open in Breakdown<span class="sr-only">: ${esc(labelOf(selected))}</span></button>` : '';
  return `<section class="conversation-examples" aria-label="Recorded conversation examples"><header><div><h3>Conversation examples</h3><p class="footnote">Up to eight recent conversations, not a representative sample.${c.examplesOmitted ? ` ${n(c.examplesOmitted)} other conversations are not shown.` : ''}</p></div><button id="conversation-close" class="conversation-close" data-conversation-close aria-label="Close conversation examples"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>${bucket != null ? '<button id="conversation-clear" class="conversation-link" data-conversation-clear>Show all examples</button>' : ''}${selected ? `<div class="conversation-example-buttons" role="group" aria-label="Choose a conversation">${examples.map(e => `<button id="conversation-example-${e.index}" data-conversation-example="${e.index}" title="${esc(labelOf(e))}" aria-pressed="${e.index === selected.index}">${esc(labelOf(e))}</button>`).join('')}</div><p class="footnote">${n(selected.prompts)} confirmed prompts · ${n(selected.days)} active dates within this view${selected.uncertain ? ' · Some submissions have uncertain identity' : ''}${openBreakdown}</p><ol class="conversation-events">${selected.events.map(e => {
    const stopped = e.kind === 'stop', delivery = conversationDelivery.find(([key]) => key === e.delivery)?.[1] || 'Delivery unknown';
    const detail = stopped ? 'Explicit user stop; the reason is not recorded.' : e.calls == null ? 'Work is shared, incomplete, or cannot reliably be assigned to this prompt.' : `${n(e.calls)} linked model calls, including continuations and reliably linked subagents.`;
    return `<li class="${stopped ? 'conversation-stop' : `delivery-${conversationDelivery.some(([key]) => key === e.delivery) ? e.delivery : 'unknown'}`}" ><time>${esc(new Date(e.ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</time><span class="conversation-event-point" aria-hidden="true"></span><div><strong>${stopped ? 'You stopped the agent' : 'You sent a prompt'}</strong>${stopped ? '' : `<span>${delivery}</span>`}<p>${detail}</p></div></li>`;
  }).join('')}</ol><p class="footnote">Selected recorded events; spacing does not represent elapsed time.${selected.eventsOmitted ? ` ${n(selected.eventsOmitted)} additional events are omitted.` : ''} Linked work can extend beyond the selected dates. No prompt text is loaded.</p>` : '<p class="muted conversation-empty">None of the bounded examples match this group. This does not mean the group has no activity.</p>'}</section>`;
}

export function renderConversations(c, { number = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }), topic = 'interaction', loading = false, examplesOpen = false, exampleIndex = 0, bucket = null, interactions } = {}) {
  if (c?.reason === 'model-filter') return '<p class="muted conversation-empty">Clear the model filter to see conversation habits across all models used in each session.</p>';
  if (!c) return '<p class="muted conversation-empty">Conversation measurements are not available yet.</p>';
  if (!CONVERSATION_TOPICS.includes(topic)) topic = 'interaction';
  const n = value => esc(number(value, { maximumFractionDigits: 1 })), value = v => v == null ? 'Unavailable' : n(v);
  const pct = (part, total) => n(conversationPercent(part || 0, total));
  const d = c.delivery || {}, w = c.promptWork || {}, steering = c.steering || {};
  const denominator = w.totalPrompts ?? c.prompts;
  const short = (c.distribution?.[0]?.count || 0) + (c.distribution?.[1]?.count || 0);
  const highWork = (w.distribution?.[2]?.count || 0) + (w.distribution?.[3]?.count || 0);
  const config = {
    interaction: { question: 'How much do you interact?', metric: value(c.medianPrompts), unit: 'typical prompts per conversation', title: 'User prompts per conversation', rows: c.distribution || [], total: c.countedSessions,
      fact: c.countedSessions ? `${pct(short, c.countedSessions)}% of counted conversations have five or fewer prompts. The average is ${value(c.averagePrompts)}.` : 'No conversations with reliable user-prompt counts in this view.',
      coverage: `${n(c.countedSessions || 0)} of ${n(c.sessions || 0)} conversations have usable prompt counts.`,
      explanation: 'A prompt is a confirmed human submission. Steering counts even when messages share a billing group. Counts cover selected dates, not lifetime session length. Longer exchanges may be iteration, new tasks, or clarification; counts alone cannot distinguish them.' },
    work: { question: 'What happens between your messages?', metric: value(w.medianCalls), unit: 'typical model calls per linked prompt', title: 'Model calls after a user prompt', rows: w.distribution || [], total: w.prompts,
      fact: w.prompts ? `${pct(highWork, w.prompts)}% of measured prompts lead to six or more model calls. The average is ${value(w.averageCalls)} calls.` : 'Complete, finished prompt work is not available in this view.',
      coverage: `${n(w.prompts || 0)} of ${n(denominator || 0)} confirmed prompts have complete linked work.`,
      explanation: 'Includes the initial call, continuations and reliably linked subagents, even across a date boundary. Shared, incomplete or unfinished work is excluded. Calls measure activity, not task duration, task count or success. Many calls can reflect useful work, verification, or retries.' },
    guidance: { question: 'How do you guide the agent?', metric: d.steering ? n(steering.topMessages ?? d.steering) : d.known ? '0' : 'Unavailable',
      unit: d.steering ? `of ${n(d.steering)} recorded steering messages in ${n(steering.topSessions || 1)} conversations` : 'recorded steering messages', title: 'When your messages arrive',
      fact: d.steering ? `Steering is recorded in ${n(steering.sessions ?? d.steeredSessions ?? 0)} conversations. Concentration shows whether a few conversations account for most of it.` : 'Steering joins ongoing work; queued messages wait to start a run.',
      coverage: `${n(d.known || 0)} of ${n(d.prompts || 0)} prompts have a known delivery type.`,
      explanation: `Steering can mean correction, new information, changed scope or deliberate collaboration. Frequency alone does not measure prompt quality. ${n(d.unconfirmedPrompts || 0)} additional submissions lack consistent human-origin evidence and are excluded. Session steering rates use ${n(d.classifiedSessions || 0)} of ${n(d.sessions || 0)} sessions with every delivery known. User stops are explicit actions, not failed prompts or wasted tokens; absent stop metadata can undercount them.` },
    returning: { question: 'Do you return to conversations?', metric: c.countedSessions ? `${pct(c.multiDaySessions, c.countedSessions)}%` : 'Unavailable', unit: 'of conversations used on multiple days', title: 'Days with user messages', rows: c.dayDistribution || [], total: c.countedSessions,
      fact: c.countedSessions ? `You used ${n(c.multiDaySessions)} of ${n(c.countedSessions)} counted conversations on more than one selected date.` : 'No reliable conversation dates in this view.',
      coverage: `${n(c.countedSessions || 0)} of ${n(c.sessions || 0)} conversations have usable prompt dates.`,
      explanation: 'Counts local calendar dates with confirmed human messages. Multi-day use does not establish continuous work or one task. Missing earlier activity does not prove a new conversation. Review returning conversations to understand whether you keep related work together.' },
  }[topic];
  const graph = topic === 'guidance' ? conversationDeliveryChart(d, n, bucket) : conversationBars(config.rows, config.total, config.title, n, bucket);
  const coverage = `<details id="conversation-coverage" class="conversation-coverage"><summary id="conversation-coverage-toggle">Within selected dates · About these measurements</summary><p>${n(c.countedSessions || 0)} of ${n(c.sessions || 0)} conversations have usable human-prompt counts. ${n(c.withoutPrompts || 0)} have no confirmed prompts; ${n(c.uncertainSessions || 0)} have uncertain identity. Sources with accounting only may not record messages.</p><p>Counting human messages does not require assigning individual charges. Agent work, delivery and session depth have separate coverage. Missing logs may understate activity.</p></details>`;
  const extras = topic === 'guidance' ? `<dl class="conversation-secondary"><div><dt>Recorded user stops</dt><dd>${n(d.userStops || 0)}</dd></div><div><dt>Unknown delivery</dt><dd>${n(d.unknown || 0)}</dd></div></dl>` : '';
  const detail = topic === 'interaction' && interactions?.averagePromptChars != null ? `<p>Average displayed prompt length: ${n(interactions.averagePromptChars)} characters across ${n(interactions.promptSamples)} messages. Text length excludes attachments and injected context and does not measure completeness or quality.</p>` : topic === 'returning' && c.windowed ? `<p>${n(c.priorSessions || 0)} conversations also have recorded prompts before these dates.</p>` : '';
  return `<div class="conversation-focus">${coverage}<div class="conversation-focus-grid"><div><h3 class="conversation-question">${config.question}</h3><div class="conversation-measure"><strong>${config.metric}</strong><span>${config.unit}</span></div><p class="conversation-fact">${config.fact}</p></div><section aria-labelledby="conversation-chart-title"><h3 id="conversation-chart-title">${config.title}</h3>${graph}<p class="footnote">${config.coverage}</p>${extras}</section></div>${conversationTrend(c, topic, n, loading)}<div class="conversation-actions"><span class="footnote">Patterns to explore, without an efficiency rating.</span><button id="conversation-explore" class="conversation-link" data-conversation-explore aria-expanded="${examplesOpen}" aria-controls="conversation-examples">${examplesOpen ? 'Hide' : 'Explore'} conversations</button></div><details id="conversation-explanation" class="conversation-detail"><summary id="conversation-explanation-toggle">What this can tell you</summary><p>${config.explanation}</p>${detail}</details>${topic === 'work' ? conversationWorkRelationship(c, n) : ''}<div id="conversation-examples"${examplesOpen ? '' : ' hidden'}>${examplesOpen ? conversationExamples(c, topic, bucket, exampleIndex, n) : ''}</div></div>`;
}
