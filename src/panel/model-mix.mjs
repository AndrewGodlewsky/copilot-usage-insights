import { esc } from './charts.mjs';

// The fewest calls a model needs before its average is compared with another model's.
export const MODEL_MIX_MIN_CALLS = 20;
// How many models each table lists.
const MODEL_MIX_ROWS = 5;
// A model's share of credits has to differ from its share of calls by this many points to be named.
const MODEL_MIX_GAP = 10;

// The comparison view for "Model comparisons". Everything comes from report.efficiency: the
// per-model rows (`models`), the summary, and `modelMix` (who started each model's calls). A
// measure that could not be taken reads "Unavailable", never 0, and each column says how many
// calls it rests on.
export function renderModelMix(report, { number, credits = number } = {}) {
  const e = report?.efficiency || {}, s = e.summary || {}, models = Array.isArray(e.models) ? e.models : [];
  if (!models.length) return '';
  const min = MODEL_MIX_MIN_CALLS;
  const valid = value => Number.isFinite(value) && value >= 0;
  const one = value => number(value, { maximumFractionDigits: 1 });
  const percent = value => valid(value) ? `${one(value)}%` : 'Unavailable';
  const calls = value => `${number(value)} ${value === 1 ? 'call' : 'calls'}`;
  const times = value => Number.isFinite(value) ? `${number(value, { maximumFractionDigits: value < 10 ? 1 : 0 })}x` : null;
  const note = text => `<p class="footnote token-insight-note">${esc(text)}</p>`;
  const section = (title, body) => `<section class="token-insight-section"><h3>${esc(title)}</h3>${body}</section>`;
  const table = (headers, rows) => `<div class="table-wrap"><table class="efficiency-outcomes token-insight-table model-mix-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' class="text-cell"' : ''}><span class="cell-text">${esc(cell)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const insight = (observation, action, compare) => `<aside class="token-insight"><strong>${esc(observation)}</strong><p>${esc(action)}</p>${note(`Compare afterward: ${compare}`)}</aside>`;
  const more = (shown, total) => total > shown ? note(`${number(total - shown)} more ${total - shown === 1 ? 'model is' : 'models are'} not listed.`) : '';
  // A cell with its sample: the value, then how many calls it rests on. Too few calls is not zero.
  const cell = (value, sample, format) => !(sample > 0) || !valid(value) ? 'Unavailable'
    : sample < min ? `Too few calls (${number(sample)})` : `${format(value)} · ${calls(sample)}`;

  let html = '<p class="model-mix-lead"><strong>Models were given different work, so this is not a like-for-like benchmark.</strong> Differences below can come from the task, how long a conversation ran, or whether a subagent made the call.</p>';

  // 1. Share of calls beside share of credits, on the calls that have a complete charge.
  const charged = models.filter(row => row.creditRequests > 0 && valid(row.credits));
  const chargedCalls = s.creditRequests, chargedCredits = s.credits;
  const shares = chargedCalls > 0 && chargedCredits > 0 ? charged.map(row => ({ row, callShare: row.creditRequests / chargedCalls * 100, creditShare: row.credits / chargedCredits * 100 }))
    .sort((a, b) => b.row.credits - a.row.credits || a.row.name.localeCompare(b.row.name)) : [];
  const coverage = `${number(chargedCalls ?? 0)} of ${number(s.requests ?? 0)} model calls have a complete recorded charge.`;
  html += section('Share of calls and share of credits', shares.length
    ? table(['Model', 'Share of charged calls', 'Share of credits', 'Difference'], shares.slice(0, MODEL_MIX_ROWS).map(({ row, callShare, creditShare }) => {
      const gap = creditShare - callShare;
      return [row.name, percent(callShare), `${percent(creditShare)} (${credits(row.credits)})`, `${gap > 0 ? '+' : gap < 0 ? '-' : ''}${one(Math.abs(gap))} points`];
    })) + more(Math.min(MODEL_MIX_ROWS, shares.length), shares.length)
      + note(`${coverage} Shares use those calls only, so calls and credits are measured on the same set. A model whose share of credits is above its share of calls averaged more credits per call than the calls of all models together.`)
    : `<p class="muted token-insight-note">No model has a complete recorded charge, so credit shares are unavailable. That is not zero credits. ${esc(coverage)}</p>`);

  // 2. Per-call averages, against the lowest-credit model that has enough calls.
  const enough = charged.filter(row => row.creditRequests >= min && valid(row.averageCredits)).sort((a, b) => a.averageCredits - b.averageCredits || a.name.localeCompare(b.name));
  const base = enough[0];
  const ratio = (value, from, sample) => valid(value) && valid(from) && from > 0 && sample >= min ? times(value / from) : null;
  const perCall = (value, sample, from, format) => {
    const multiple = ratio(value, from, sample);
    return multiple ? `${format(value)} · ${multiple} · ${calls(sample)}` : cell(value, sample, format);
  };
  html += section('Per call, against the lowest-credit model', enough.length >= 2
    ? table(['Model', 'Credits per call', 'Input per call', 'Output per call'], enough.slice(0, MODEL_MIX_ROWS).map(row => [row.name,
      row === base ? `${credits(row.averageCredits)} · baseline · ${calls(row.creditRequests)}` : perCall(row.averageCredits, row.creditRequests, base.averageCredits, credits),
      row === base ? cell(row.averageInput, row.inputRequests, number) : perCall(row.averageInput, row.inputRequests, base.averageInput, number),
      row === base ? cell(row.averageOutput, row.outputRequests, number) : perCall(row.averageOutput, row.outputRequests, base.averageOutput, number)]))
      + more(Math.min(MODEL_MIX_ROWS, enough.length), enough.length)
      + note(`Averages per call, for models with at least ${number(min)} calls on that measure (credits: complete charges only). The baseline is ${base.name}, the lowest credits per call among them. A multiple such as 2x means twice the baseline model's figure. Multiples describe size, not value: a larger call is not better or worse.`)
    : `<p class="muted token-insight-note">${esc(`A comparison needs at least two models with ${number(min)} or more complete-charge calls each. ${enough.length ? `Only ${enough[0].name} has enough.` : 'None has enough yet.'} Try a wider date range.`)}</p>`);

  // 3. Columns people ask about, each on its own matched sample.
  const byCalls = models.slice(0, MODEL_MIX_ROWS);
  const seconds = ms => ms < 1000 ? `${number(Math.round(ms))} ms` : `${number(ms / 1000, { maximumFractionDigits: 1 })} s`;
  html += section('Cache, reasoning and speed by model', table(['Model', 'Cache read, share of input', 'Reasoning, share of output', 'Average call duration', 'Output per second'], byCalls.map(row => [row.name,
    cell(row.cacheHitRate, row.cacheRequests, percent), cell(row.reasoningShare, row.reasoningRequests, percent),
    cell(row.averageDuration, row.durationRequests, seconds), cell(row.outputPerSecond, row.paceRequests, value => `${one(value)} tokens/s`)]))
    + more(byCalls.length, models.length)
    + note(`Each column uses only the calls that record what it needs, shown beside the value. A model with fewer than ${number(min)} such calls shows "Too few calls". Cache read is the share of input tokens served from cache. Reasoning is the share of output tokens spent on reasoning. Output per second is output tokens divided by the whole recorded duration of the call, which includes the wait for the first token, so it is not a streaming rate and small outputs read slower.`));

  // 4. Who started each model's calls.
  const mix = e.modelMix, mixRows = Array.isArray(mix?.rows) ? mix.rows.filter(row => row.calls > 0) : [];
  const share = (part, total) => `${percent(part / total * 100)} (${number(part)})`;
  html += section('Who started the calls', mixRows.length
    ? table(['Model', 'Main conversation', 'Subagents', 'Not recorded'], mixRows.slice(0, MODEL_MIX_ROWS).map(row => [row.name, share(row.main, row.calls), share(row.subagent, row.calls), share(row.unrecorded, row.calls)]))
      + more(Math.min(MODEL_MIX_ROWS, mixRows.length), mix.models)
      + note('Share of each model\'s calls, with the number of calls. Main conversation means the call followed a prompt you sent or the main agent carrying on. Subagent calls run on a model chosen for the delegated work, so a model used mostly by subagents did a different job from one used mostly in the main conversation.')
    : `<p class="muted token-insight-note">Who started each call is not available for these filters.</p>`);

  // One observation, one experiment, one comparison.
  const named = shares.filter(item => item.row.creditRequests >= min).map(item => ({ ...item, gap: item.creditShare - item.callShare })).sort((a, b) => b.gap - a.gap || a.row.name.localeCompare(b.row.name))[0];
  if (named && named.gap >= MODEL_MIX_GAP) html += insight(
    `${named.row.name} made ${percent(named.callShare)} of charged calls and ${percent(named.creditShare)} of recorded credits.`,
    'Pick one kind of task you repeat. Run it once on this model and once on another model, with the same prompt and starting point, and write down the credits and the number of calls each needed.',
    'credits for the whole task, not only credits per call, and whether the result needed rework. A model that needs fewer calls can use fewer credits overall.');
  else if (shares.length) html += insight(
    named ? `Each model's share of credits is within ${number(MODEL_MIX_GAP)} points of its share of calls.` : `No model has ${number(min)} or more complete-charge calls yet, so no share gap is named.`,
    'Pick one kind of task you repeat and run it on two models with the same prompt and starting point. Write down the credits and the number of calls each needed.',
    'credits for the whole task and whether the result needed rework. Credits per call alone can mislead when one model needs more calls.');
  return html;
}
