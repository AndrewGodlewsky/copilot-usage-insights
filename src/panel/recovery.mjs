import { esc, coverageValue } from './charts.mjs';
import { barList } from './token-insights.mjs';
import { toolOutcomeSummary } from './efficiency.mjs';

// The "Calls and recovery" card. Call counts come from report.tools. What followed a failure,
// failures in a row and time in failed calls come from report.efficiency.recovery. A call with
// no recorded outcome is never shown as a failure, and a measure that could not be taken reads
// "Unavailable", not 0.
export function renderRecovery(report, { number, showCoverage = true } = {}) {
  const groups = toolOutcomeSummary(report?.tools), habits = report?.efficiency?.interactions;
  const valid = value => Number.isFinite(value) && value >= 0;
  const sum = key => groups.reduce((total, row) => total + row[key], 0);
  const calls = sum('calls'), failures = sum('failures'), unknown = sum('unknown'), known = failures + sum('successes');
  const percent = value => valid(value) ? `${number(value, { maximumFractionDigits: 1 })}%` : 'Unavailable';
  const things = (value, one, many = `${one}s`) => `${number(value)} ${value === 1 ? one : many}`;
  const duration = ms => {
    if (!valid(ms)) return 'Unavailable';
    if (ms < 1000) return `${number(Math.round(ms))} ms`;
    if (ms < 60_000) return `${number(ms / 1000, { maximumFractionDigits: 1 })} s`;
    const seconds = Math.round(ms / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
    return hours ? `${number(hours)} h ${number(minutes)} min` : `${number(minutes)} min ${number(seconds % 60)} s`;
  };
  const operation = row => row.server ? `${row.server} / ${row.mcpTool || row.name}` : String(row.name ?? '');
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const metric = (label, value, detail) => `<div><span class="label">${esc(label)}</span><strong class="value">${esc(value)}</strong><span class="sub">${esc(detail)}</span></div>`;
  const insight = (observation, action, compare) => `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${compare ? note(`Compare afterward: ${compare}`) : ''}</aside>`;
  // A cell is text, or [text, hover detail].
  const table = (kind, headers, rows) => `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table recovery-${kind}"><thead><tr>${headers.map(header => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => {
    const [text, title] = Array.isArray(cell) ? cell : [cell];
    return `<td${index === 0 ? ' class="text-cell"' : ''}${title ? ` title="${esc(title)}"` : ''}><span class="cell-text">${esc(text)}</span></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
  const errors = habits?.reason === 'model-filter'
    ? '<p class="footnote">Session error counts are unavailable under a model filter.</p>'
    : habits?.observedSessions ? `<p class="footnote">${esc(number(habits.sessionErrors))} recorded root-session error events. These are incidents, not a count of failed model requests.</p>` : '';
  if (!calls) return '<p class="muted">No matching tool execution records. Missing records do not mean no tools were used.</p>' + errors;

  const r = report?.efficiency?.recovery;
  const measured = valid(r?.calls) && r.calls > 0 && r.followed && r.runs && r.time && r.operations ? r : null;
  const rate = known ? failures / known * 100 : null;
  const experiment = name => `Reproduce one failing ${name} call on its own. Check its arguments, permissions and authentication before you start a larger task.`;
  const failed = metric('Failed calls', known ? number(failures) : 'Unavailable', known
    ? `${percent(rate)} of ${things(known, 'call')} with a known outcome${unknown ? `. ${things(unknown, 'call')} had no recorded outcome` : ''}`
    : `None of ${things(calls, 'call')} has a recorded outcome`);
  // Without the recovery measurements only the per-operation counts are known.
  const counted = (report?.tools?.rows || []).filter(row => row.failures > 0).sort((a, b) => b.failures - a.failures).slice(0, 5).map(row => {
    const rowKnown = row.failures + (valid(row.successes) ? row.successes : 0);
    return { name: row.name, server: row.server, mcpTool: row.mcpTool, calls: row.calls, failures: row.failures, unknown: row.unknown, known: rowKnown, failureRate: row.failures / rowKnown * 100 };
  });
  const rows = measured ? measured.operations.byFailures || [] : counted, most = rows[0];
  let html;
  if (!failures || !measured) {
    html = `<div class="efficiency-metrics">${failed}${metric('Calls with a known outcome', number(known), `of ${things(calls, 'call')} in the selected range`)}</div>`
      + (!known ? insight('No call in this range has a recorded outcome, so failures cannot be counted.', 'A missing outcome is not a failure. Try a wider date range, or use Copilot and refresh.')
        : !failures ? insight(`None of the ${things(known, 'call')} with a known outcome failed.`, 'There is no failure to review in this range. Try a wider date range to look at older history.')
          : insight(`${things(failures, 'call')} failed, out of ${number(known)} with a known outcome.`, most ? experiment(operation(most)) : experiment('tool'),
            'failures and known outcomes for the same operation over a similar amount of work.'));
  } else {
    const f = measured.followed, runs = measured.runs, time = measured.time, top = runs.top?.[0], high = measured.operations.byRate?.[0];
    const runLength = valid(measured.runLength) ? measured.runLength : 3, minimumKnown = valid(measured.minimumKnown) ? measured.minimumKnown : 5;
    html = `<div class="efficiency-metrics">${failed}${metric('Succeeded on the next call', percent(f.share), f.known
      ? `${number(f.succeeded)} of ${things(f.known, 'failed call')} followed by a call with a known outcome`
      : 'No failed call was followed by a call with a known outcome')}${metric('Longest run of failures', !valid(runs.longest) ? 'Unavailable' : runs.longest >= 2 ? `${number(runs.longest)} in a row` : number(runs.longest),
      top ? `${operation(top)} · ${top.session} · ${top.day}` : 'No operation failed twice in a row in one conversation')}${metric('Time in failed calls', duration(time.failedMs), time.failedCalls
      ? `${number(time.failedCalls)} of ${things(measured.failures, 'failed call')} with a recorded duration${valid(time.share) ? `. ${percent(time.share)} of the time in calls with a known outcome` : ''}`
      : 'No failed call has a recorded duration')}</div>`;
    const then = { succeeded: 'A successful call', unknown: 'A call with no recorded outcome', none: 'No later call' };
    if (top && top.length >= runLength) {
      const name = operation(top);
      html += insight(`${name} failed ${number(top.length)} times in a row in one conversation (${top.session}, ${top.day}).${top.then === 'succeeded' ? ' The call after that succeeded.' : top.then === 'unknown' ? ' The call after that has no recorded outcome.' : ' No later call of that operation is recorded in that conversation for this range.'}`,
        experiment(name), `how many times ${name} fails in a row, and its failure rate, over a similar amount of work. Several failures in a row can also be the agent working through a problem one step at a time.`);
    } else if (high && high.failures >= 3 && valid(high.failureRate) && high.failureRate >= 2 * rate) {
      const name = operation(high);
      html += insight(`${name} failed in ${number(high.failures)} of ${things(high.known, 'call')} with a known outcome (${percent(high.failureRate)}). The rate across all operations was ${percent(rate)}.`,
        experiment(name), `the failure rate for ${name} with the rate across all operations, on similar work. A higher rate can come from harder requests, not from a broken tool.`);
    } else {
      html += insight(f.known ? `After a failed call, the next call of the same operation succeeded ${number(f.succeeded)} times out of ${number(f.known)}.` : `${things(failures, 'call')} failed. None was followed by a call with a known outcome.`,
        `No operation failed ${number(runLength)} times in a row.${most ? ` If one matters to you, start with ${operation(most)}, which has the most recorded failures (${number(most.failures)}): reproduce one failing call on its own, and check its arguments, permissions and authentication before a larger task.` : ''}`,
        'the failure rate and what the next call did for the same operation, over a similar amount of work.');
    }
    html += section('What followed a failed call', (barList([
      { label: 'The next call succeeded', value: f.succeeded, color: 'var(--s3)' },
      { label: 'The next call failed too', value: f.failed, color: 'var(--s2)' },
      { label: 'The next call has no recorded outcome', value: f.unknown, color: 'var(--muted-fg)' },
      { label: 'No later call', value: f.none, color: 'var(--muted-fg)' },
    ], { total: f.failures, format: value => `${number(value)} of ${number(f.failures)}` }) || '<p class="muted token-insight-note">No failed call has a usable start time, so none could be placed in order.</p>')
      + note(`Each of the ${things(f.failures, 'failed call')} is counted once. The next call is the next call of the same operation in the same conversation that started after the failed call finished. It can be a different request, not a repeat of the same one. Only calls in the selected dates and filters are compared.`));
    html += section('Operations with the most recorded failures', table('operations', ['Operation', 'Calls', 'Failed', 'Failure rate', 'Next call succeeded', 'Longest run', 'Time in failed calls'], rows.map(row => {
      const next = row.followed || {};
      return [operation(row), number(row.calls), number(row.failures),
        [coverageValue(row.failureRate, row.unknown > 0, percent, showCoverage), `${number(row.failures)} of ${things(row.known, 'call')} with a known outcome failed${row.unknown ? `. ${things(row.unknown, 'call')} had no recorded outcome` : ''}`],
        [next.known ? `${number(next.succeeded)} of ${number(next.known)}` : 'No known next call', `After a failed call: ${number(next.succeeded)} next calls succeeded, ${number(next.failed)} failed too, ${number(next.unknown)} had no recorded outcome, ${number(next.none)} had no later call`],
        valid(row.longestRun) ? number(row.longestRun) : 'Unavailable',
        [duration(row.failedMs), `${number(row.failedCalls)} of ${things(row.failures, 'failed call')} with a recorded duration`]];
    })) + note(`Showing ${number(rows.length)} of ${things(measured.operations.failing, 'operation')} with a recorded failure, most failures first. Failure rate counts only calls with a known outcome. Next call succeeded counts only failed calls followed by a call with a known outcome. Hover over a value for its counts.`)
      + note('Time in failed calls runs from the start of a call to its recorded completion. Calls can run at the same time, so these times do not add up to time spent waiting.'));
    const ranked = measured.operations.byRate || [];
    html += section('Failure rate by operation', (barList(ranked.map(row => ({ label: operation(row), value: row.failureRate, detail: `${number(row.failures)} of ${things(row.known, 'call')} with a known outcome failed` })), { total: 100, format: percent })
      || '<p class="muted token-insight-note">No operation with a recorded failure has enough known outcomes to be ranked by rate.</p>')
      + note(`An operation needs at least ${number(minimumKnown)} known outcomes to be ranked by rate. With fewer, one more call changes the rate a lot. Showing ${number(ranked.length)} of ${number(measured.operations.ranked)} that qualify and have a recorded failure. Each bar is drawn against 100%.`));
    const listed = runs.top || [];
    html += section('Failures in a row', (listed.length ? table('runs', ['Operation', 'Conversation', 'Failures in a row', 'What came next', 'First failure'], listed.map(run => [operation(run), run.session, number(run.length), then[run.then] || 'Unavailable', run.day]))
      : '<p class="muted token-insight-note">No operation failed twice in a row in one conversation in this range.</p>')
      + note(`${things(runs.repeated, 'run')} of ${number(runLength)} or more failures in a row, covering ${number(runs.repeatedFailures)} of ${things(measured.failures, 'failed call')}.${listed.length ? ` Showing the ${number(listed.length)} longest of ${things(runs.total, 'run')} of two or more.` : ''} A run is calls of one operation in one conversation that failed one after another, in order of start time. A success or a call with no recorded outcome ends a run.`));
  }
  if (failures && !measured && rows.length) html += section('Operations with the most recorded failures', table('counts', ['Operation', 'Calls', 'Failed', 'Failure rate'], rows.map(row => [operation(row), number(row.calls), number(row.failures),
    [coverageValue(row.failureRate, row.unknown > 0, percent, showCoverage), `${number(row.failures)} of ${things(row.known, 'call')} with a known outcome failed`]]))
    + note('Failure rate counts only calls with a known outcome. What followed each failure is not measured in this report.'));
  html += section('MCP tools and other tools', `<div class="table-wrap"><table class="efficiency-outcomes"><thead><tr><th>Tools</th><th>Calls</th><th>Succeeded</th><th>Failed</th><th>Unknown</th><th>Success rate</th></tr></thead><tbody>${groups.map(row => `<tr><td class="text-cell"><span class="cell-text">${esc(row.name)}</span></td><td>${esc(number(row.calls))}</td><td>${esc(number(row.successes))}</td><td>${esc(number(row.failures))}</td><td>${esc(number(row.unknown))}</td><td>${esc(row.successRate == null ? 'Unavailable' : coverageValue(row.successRate, row.unknown > 0, percent, showCoverage))}</td></tr>`).join('')}</tbody></table></div>`
    + '<p class="footnote">Success rate uses only known outcomes. Calls follow the date and usage filters.</p>');
  return html + errors;
}
