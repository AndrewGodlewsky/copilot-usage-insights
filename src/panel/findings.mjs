import { esc } from './charts.mjs';

// The measured findings that come from the other Efficiency views: report.efficiency.findings,
// built by src/core/efficiency-findings.mjs. Each one pairs evidence with the obvious alternative
// explanation, one experiment, a comparison for afterward, and a button that opens the view
// holding the detail. The numbers are already checked; this only words them.
const FINDING_VIEWS = { pause: 'Cache reuse', prompts: 'Work behind each prompt', failures: 'Calls and recovery', compaction: 'Context reduction', late: 'Context growth', switch: 'Model and effort changes', repetition: 'Repeated exploration', habits: 'Conversation habits', reasoning: 'Reasoning and generated output' };
const FINDING_THEN = { succeeded: 'The next call to that operation succeeded.', unknown: 'The next call to that operation has no recorded outcome.', none: 'No later call to that operation was recorded in that conversation.', failed: 'The next call to that operation also failed.' };

function findingCopy(f, { number, credits }) {
  const pct = value => `${number(value, { maximumFractionDigits: 1 })}%`;
  const points = value => `${number(value, { maximumFractionDigits: 1 })} points`;
  if (f.kind === 'pause') return {
    title: 'Less input is reused from cache after long pauses',
    evidence: `${pct(f.long.share)} of input was read from cache on calls that came more than an hour after the previous call, across ${number(f.long.calls)} calls. After a pause under 5 minutes it was ${pct(f.quick.share)}, across ${number(f.quick.calls)} calls. That is ${points(f.gap)} lower.${f.modelFiltered ? ' With a model filter, a pause is the gap between selected-model calls.' : ''}`,
    caveat: 'Conversations that resume after a long break may also be starting different work. The logs do not say why input was or was not read from cache.',
    action: 'The next time you return to a conversation after a long break, send one short follow-up there, then compare its cache share in Cache reuse with calls sent within five minutes of the one before.',
    compare: 'Compare the cache share of calls after a long pause with calls after a short one, on similar work.',
  };
  if (f.kind === 'prompts') return {
    title: 'A small share of prompts holds much of the credits',
    evidence: `The heaviest ${number(f.heavyPrompts)} of ${number(f.prompts)} prompts (a tenth) account for ${pct(f.share)} of the credits charged to prompts, ${credits(f.credits)} credits. Only prompts with complete charges are counted.${f.modelFiltered ? ' This covers the selected models only.' : ''}`,
    caveat: 'Large tasks cost more. A heavy prompt is not necessarily a wasteful one.',
    action: 'Open Work behind each prompt and look at the heaviest prompts. For the next task of that size, send it in two or three smaller steps and compare the total.',
    compare: 'Compare credits and model calls for the whole task, and whether the result needed more follow-up.',
  };
  if (f.kind === 'failures') return {
    title: 'The same operation failed several times in a row',
    evidence: `${number(f.stretches)} ${f.stretches === 1 ? 'stretch' : 'stretches'} of ${number(f.run)} or more failed calls in a row for one operation, out of ${number(f.known)} calls with a known outcome. The longest was ${number(f.longest)} failed calls to ${f.operation} in ${f.session}${f.day ? ` on ${f.day}` : ''}. ${FINDING_THEN[f.then] || ''}`,
    caveat: 'A failed tool call can lead to a useful recovery. Calls with no recorded outcome are never counted as failures.',
    action: 'Reproduce that operation once by hand and check its status, permissions and arguments before the agent retries it again.',
    compare: 'Compare how often that operation fails in a row on similar tasks afterward.',
  };
  if (f.kind === 'compaction') return {
    title: 'Some conversations were compacted more than once',
    evidence: `${number(f.repeated)} of ${number(f.conversations)} compacted conversations (${pct(f.share)}) were compacted more than once, ${number(f.compactions)} compactions in all.${f.modelFiltered ? ' This covers conversations with calls on the selected models.' : ''}`,
    caveat: 'Long tasks can fill the context window however carefully they are run. Compaction is also a normal way for a conversation to continue.',
    action: 'In your next long task, start a fresh conversation with a short handoff at a natural break, before the context fills again.',
    compare: 'Compare how often the new conversation is compacted, and check that the handoff kept what you needed.',
  };
  if (f.kind === 'late') return {
    title: 'Most input came after conversations had doubled in size',
    evidence: `${pct(f.share)} of measured input came in calls made after a conversation's input had doubled from its first call. That is ${number(f.input)} of ${number(f.totalInput)} tokens, in ${number(f.conversations)} of ${number(f.measuredConversations)} conversations. ${number(f.measuredCalls)} calls had known input.`,
    caveat: 'Larger input can be necessary as work develops, and a long conversation is not wasteful by itself.',
    action: 'Pick one long conversation. At the next change of phase, start a new one with a concise handoff and keep related follow-ups together.',
    compare: 'Compare input per call before and after the handoff on similar work, and check that important context was kept.',
  };
  if (f.kind === 'repetition') return {
    title: 'Reading and searching calls repeated identical earlier calls',
    evidence: `${number(f.repeated)} of ${number(f.measured)} compared reading and searching calls (${pct(f.share)}) repeated an identical earlier call in the same conversation.${f.topOperation ? ` Most repeated: ${f.topOperation} (${number(f.topCount)}).` : ''}${f.afterCompaction > 0 ? ` ${number(f.afterCompaction)} happened after a compaction.` : ''}`,
    caveat: 'A repeat can be needed when a file changed or after context was compacted. Only exact tool-name and argument matches are counted.',
    action: 'In your next long conversation, ask Copilot to keep short notes of the files it read and what it found, and to re-read a file only after it changes.',
    compare: 'Compare the share of repeated reading and searching calls in conversations of a similar length.',
  };
  if (f.kind === 'habits') return {
    title: 'Later prompts cost more credits than the first prompt in most conversations',
    evidence: `In ${number(f.laterHigher)} of ${number(f.conversations)} conversations (${pct(f.share)}) with complete work figures for both first and later prompts, later prompts averaged more credits than the first.`,
    caveat: 'Later prompts in a conversation are often harder or larger tasks, and conversation position does not by itself cause higher spend.',
    action: 'On your next multi-step task, start a fresh conversation with a short handoff at a natural phase change instead of continuing in the same thread.',
    compare: 'Compare credits and calls per prompt on similar work before and after the handoff, and verify key context was kept.',
  };
  if (f.kind === 'reasoning') return {
    title: 'Higher effort averaged noticeably more credits on the same model',
    evidence: `On ${f.model}, calls at ${f.higherEffort} effort averaged ${credits(f.higherCredits)} credits (${number(f.higherCalls)} calls) against ${credits(f.lowerCredits)} credits at ${f.lowerEffort} effort (${number(f.lowerCalls)} calls), ${number(f.ratio, { maximumFractionDigits: 1 })}× higher.`,
    caveat: 'Higher effort is often chosen for harder tasks, so a higher average per call does not prove the effort was unnecessary.',
    action: `Run one routine task you know well on ${f.model} at ${f.lowerEffort} effort with the same acceptance checks, and note whether it needs rework.`,
    compare: 'Compare total credits including any follow-up fixes, call duration, and whether the output met the same bar.',
  };
  return {
    title: 'Cache reuse dropped on the first call after a model change',
    evidence: `The typical cache share was ${pct(f.before)} on the last call before a model change and ${pct(f.after)} on the first call after it, ${points(f.gap)} lower. It was lower after the change in ${number(f.lower)} of ${number(f.pairs)} changes with a complete cache split.`,
    caveat: 'Each model keeps its own cache, so some drop is expected. The size of the input can also differ between models.',
    action: 'On one task, stay on a single model for the whole conversation, then compare the cache share of its calls with a similar task where you changed model.',
    compare: 'Compare cache share on the same kind of follow-up call with and without a model change.',
  };
}

export function renderFindings(data, formats) {
  if (!data || !Array.isArray(data.shown)) return '';
  const cards = data.shown.map(f => {
    const copy = findingCopy(f, formats), view = FINDING_VIEWS[f.kind];
    return `<section class="efficiency-insight efficiency-finding" data-finding-kind="${esc(f.kind)}"><div class="efficiency-observation"><span class="efficiency-kicker">From the other views</span><h3>${esc(copy.title)}</h3><p>${esc(copy.evidence)}</p><p class="footnote">${esc(copy.caveat)}</p><button data-finding-section="${esc(f.view.section)}" data-finding-topic="${esc(f.view.topic)}">Open ${esc(view)}<span class="sr-only">: ${esc(copy.title)}</span></button></div><div class="efficiency-experiment"><span class="efficiency-kicker">Try this</span><p>${esc(copy.action)}</p><details><summary>What to compare afterward</summary><p>${esc(copy.compare)}</p></details></div></section>`;
  }).join('');
  const names = list => list.map(item => item.label).join(', ');
  const lines = [];
  if (data.qualified) lines.push(`Ordered by how many times past its own threshold each measure is. Showing ${formats.number(data.shown.length)} of ${formats.number(data.qualified)} that qualified${data.more ? `; ${formats.number(data.more)} more qualified, and is not shown here` : ''}. Thresholds select places to investigate. They are not targets.`);
  else if (data.clear?.length) lines.push(`Nothing from the other views crossed its threshold. This is different from missing data. Thresholds select places to investigate. They are not targets.`);
  if (data.clear?.length) lines.push(`Checked, and below the threshold: ${names(data.clear)}.`);
  if (data.missing?.length) lines.push(`Not enough data to check: ${data.missing.map(item => `${item.label} (${item.reason})`).join('; ')}. Missing data is not the same as nothing found.`);
  if (!lines.length) return '';
  return `${cards}<p class="footnote efficiency-findings-status">${lines.map(esc).join(' ')}</p>`;
}
