import { esc } from './charts.mjs';
import { barList } from './token-insights.mjs';

// "Repeated exploration": what report.efficiency.repetition counted. A repeat is a tool call with
// the same recorded name and arguments as an earlier call in the same conversation. Calls are
// compared while journals are read; this view receives counts, operation names and conversation
// names, and never an argument. A call that was not compared is never shown as a first call.
export function renderRepetitionTopic(data, { number } = {}) {
  const r = data || {}, reading = r.reading || {}, other = r.other || {}, limits = r.limits || {}, c = r.compaction || {};
  const valid = value => Number.isFinite(value) && value >= 0;
  // Counts are written in full: "1.2K of 1.2K" would hide the calls that were not compared.
  const n = value => valid(value) ? number(value, { simplify: false }) : 'Unavailable';
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const of = (part, total) => `${n(part ?? 0)} of ${n(total ?? 0)}`;
  const count = (value, one, many = one + 's') => `${n(value)} ${value === 1 ? one : many}`;
  const operation = row => row.server ? `${row.server} / ${row.mcpTool || row.name}` : String(row.name ?? '');
  const words = list => (Array.isArray(list) ? list : []).join(', ');
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const empty = text => `<p class="muted token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(detail)}</span></div>`;
  const metrics = (...items) => `<div class="efficiency-metrics">${items.join('')}</div>`;
  const caption = text => `<p class="repetition-caption">${esc(text)}</p>`;
  const uncompared = 'A call is not compared when it was made inside a subagent, when no arguments are recorded for it, '
    + (valid(limits.eventChars) ? `when the journal line that records it is longer than ${n(limits.eventChars)} characters (writing a whole file, for example), ` : 'when the journal line that records it is very long, ')
    + (valid(limits.sessionCalls) ? `after the first ${n(limits.sessionCalls)} compared calls of one conversation, ` : '')
    + 'or when copied journals each hold only part of a conversation.';
  const kept = 'Calls are compared while the journals are read. Their arguments are not kept, stored or shown.';

  if (!valid(r.calls) || !r.calls) return '<p class="muted">No tool call is recorded for these dates and filters.</p>'
    + '<p>This view counts tool calls that repeat an earlier call in the same conversation: the same tool with exactly the same arguments, for example reading one file twice.</p>'
    + note(`Try a wider date range, or clear the project, session and model filters. Tool calls are read from Copilot session journals only. ${kept}`);
  if (!valid(r.measured) || !r.measured) return metrics(
      metric('Repeated calls', 'Unavailable', `None of the ${count(r.calls, 'tool call')} in this view could be compared`),
      metric('Calls compared', of(0, r.calls), 'Tool calls whose name and arguments could be compared'))
    + '<p class="token-insight-note">Unavailable is not zero. Whether these calls repeated an earlier one was not measured.</p>'
    + note(`${uncompared} ${kept}`);

  let html = metrics(
    metric('Repeated calls', n(r.repeated), `${percent(r.share)} of ${count(r.measured, 'compared call')} repeated an identical earlier call`),
    metric('Calls compared', of(r.measured, r.calls), 'Tool calls in this view whose name and arguments could be compared'),
    metric('Conversations with a repeat', of(r.repeatSessions, r.sessions), 'Conversations with at least one compared call'),
    metric('Most times one call was made', r.most ? `${n(r.most.times)} times` : 'Once', r.most ? `${operation(r.most)} · ${r.most.session}` : 'No compared call was made twice in one conversation'));

  // One list per group: the operations that repeated most, each with the calls it rests on.
  const operations = g => {
    if (!g.calls) return empty('No call in this group is recorded in this view.');
    if (!g.measured) return empty(`None of the ${count(g.calls, 'call')} in this group could be compared. That is not zero repeats.`);
    const rows = g.top || [], coverage = `${of(g.measured, g.calls)} calls in this group could be compared.`;
    if (!g.repeated) return empty(`None of the ${count(g.measured, 'compared call')} in this group repeated an identical earlier call.`) + note(coverage);
    return barList(rows.map(row => ({ label: operation(row), value: row.repeated,
      detail: `${of(row.repeated, row.measured)} compared calls repeated an earlier one (${percent(row.share)})${row.calls > row.measured ? `. ${n(row.calls - row.measured)} more not compared` : ''}` })), { format: n })
      + note(`${of(g.repeated, g.measured)} compared calls in this group repeated an identical earlier call (${percent(g.share)}). ${coverage} Showing ${n(rows.length)} of ${count(g.operations, 'operation')} with a repeat.`);
  };
  html += section('Reading and searching', operations(reading)
    + note(`The group is chosen from the recorded tool name alone: a name with one of the words ${words(r.readingWords)} counts as reading or searching, unless it also names a shell (${words(r.shellWords)}). For an MCP call the MCP tool name is used. What a tool actually did is not checked.`));
  html += section('Everything else', operations(other)
    + note('Running a command or a test again after a change is normal, and so is checking a status twice. These repeats are listed to complete the picture, not as a problem.'));

  const gaps = (title, g) => {
    const t = g.timing || {};
    return t.timed ? caption(title) + barList([{ label: 'Under 5 minutes', value: t.under5 }, { label: '5 to 60 minutes', value: t.mid, color: 'var(--s3)' }, { label: 'Over an hour', value: t.over60, color: 'var(--s2)' }],
      { total: t.timed, format: value => `${n(value)} (${percent(value / t.timed * 100)})` }) : '';
  };
  const timed = (reading.timing?.timed || 0) + (other.timing?.timed || 0);
  html += section('How soon the same call came back', (gaps('Reading and searching', reading) + gaps('Everything else', other)
    || empty(r.repeated ? 'No repeated call has a usable start time on both calls, so the time between them is unavailable.' : 'No compared call repeated an earlier one, so there is no time between calls to show.'))
    + note(`Time from the start of the earlier identical call to the start of the repeat. ${of(timed, r.repeated)} repeated calls have a usable time on both calls.`));

  html += section('After a compaction', c.sessions
    ? metrics(
        metric('Repeats after a compaction', n(c.after), `${of(c.after, c.repeats)} repeated calls in ${count(c.sessions, 'conversation')} with a compaction`),
        metric('Reading and searching among them', n(c.afterReading), `${n(c.after - c.afterReading)} were other calls`))
      + note(`Counted when a successful compaction of the main conversation is recorded after the earlier identical call started and before the repeat did. ${count(c.sessions, 'conversation')} with compared calls in this view ${c.sessions === 1 ? 'has such a compaction. It holds' : 'have such a compaction. They hold'} ${n(c.repeats)} of the ${count(timed, 'repeated call')} with a usable time. A compaction is one explanation, not a proven cause: the file may have changed, or the call may have been needed again for another reason.`)
    : empty('No conversation with compared calls in this view has a recorded successful compaction, so no repeat can be placed after one.'));

  const rows = r.conversations || [];
  if (rows.length) html += section('Conversations with the most repeated calls',
    `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table"><thead><tr>${['Conversation', 'Calls compared', 'Repeated calls', 'Share repeated', 'Most times one call was made'].map(header => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><td class="text-cell"><span class="cell-text">${esc(row.name)}</span></td>${[n(row.measured), n(row.repeated), percent(row.share), n(row.times)].map(cell => `<td><span class="cell-text">${esc(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    + note(`Showing ${of(rows.length, r.repeatSessions)} conversations with a repeated call, most repeats first.`));

  // One observation, chosen in this order: reading repeated across a compaction, reading that
  // repeats often, any repeat, then none.
  const top = reading.top?.[0], notes = 'In the next long conversation, ask Copilot to keep short notes on the files it reads and what it found, and to read a file again only when it has changed.';
  let observation, action, after;
  if (c.afterReading >= 3) {
    observation = `${count(c.afterReading, 'reading or searching call')} repeated a call first made before a compaction of the same conversation.`;
    action = `${notes} This view cannot see what a compaction kept, so notes outside the conversation are one way to test it.`;
    after = 'reading and searching repeats after a compaction, over a similar amount of work.';
  } else if (reading.repeated >= 5 && reading.share >= 10) {
    observation = `${of(reading.repeated, reading.measured)} compared reading and searching calls (${percent(reading.share)}) repeated an identical earlier call in the same conversation.${top ? ` The most repeated was ${operation(top)}, ${count(top.repeated, 'time')}.` : ''}`;
    action = notes;
    after = 'the share of reading and searching calls that repeat, on similar work.';
  } else if (r.repeated) {
    observation = `${of(r.repeated, r.measured)} compared calls (${percent(r.share)}) repeated an identical earlier call. ${reading.repeated ? `${n(reading.repeated)} of them ${reading.repeated === 1 ? 'was' : 'were'} reading or searching.` : 'None of them was reading or searching.'}`;
    action = `Reading and searching repeats are few here. If a conversation in the table matters to you, try this there: ${notes.charAt(0).toLowerCase()}${notes.slice(1)}`;
    after = 'repeated reading and searching calls in conversations of a similar length.';
  } else {
    observation = `None of the ${count(r.measured, 'compared call')} repeated an identical earlier call.`;
    action = 'There is no repeat to review in this range. Try a wider date range to look at older history.';
  }
  html += `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${after ? note(`Compare afterward: ${after}`) : ''}</aside>`;

  return html + note('Only a call with the same tool name and exactly the same arguments counts. Reading the same file with a different line range, or searching for the same thing in other words, is not counted. A repeat can be needed: the file changed, or the context no longer held it. No tokens or credits are attributed to repeats. The earlier call can be before the selected dates.'
    + (r.modelFiltered ? ' Model filter: only calls made with a selected model are counted, and the earlier identical call can be from any model.' : ''))
    + note(`${uncompared} ${kept}`);
}
