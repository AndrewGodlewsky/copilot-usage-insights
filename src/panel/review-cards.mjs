import { esc } from './charts.mjs';

export function renderReviewCards(result, { number = n => Number(n).toLocaleString(), credits = number } = {}) {
  if (!result.cards?.length) return `<p class="review-empty">${esc(result.emptyReason || 'There is not enough reliable evidence for a useful finding yet.')}</p>`;
  const value = (n, unit) => unit?.startsWith('AI credits') ? credits(n) : number(n);
  const graphic = e => {
    if (e.template === 'statistic') return `<span class="review-stat">${esc(value(e.value, e.unit))}<span class="review-unit">${esc(e.unit)}</span></span>`;
    const values = e.values || [], max = Math.max(1, ...values.map(p => p.value));
    if (e.template === 'comparison') return `<span class="review-comparison">${values.map(p => `<span><span class="review-small-label">${esc(p.label)}</span><b>${esc(value(p.value, e.unit))}</b><span class="review-mini-bar" style="width:${Math.max(1, p.value / max * 100)}%"></span></span>`).join('')}<span class="review-unit">${esc(e.unit)}</span></span>`;
    const points = values.map((p, i) => `${i * 220 / Math.max(1, values.length - 1)},${52 - p.value / max * 48}`).join(' ');
    return `<span class="review-trend"><svg viewBox="0 0 220 56" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg><span class="review-trend-endpoints">${esc(value(values[0]?.value || 0, e.unit))} <span>to</span> ${esc(value(values.at(-1)?.value || 0, e.unit))}</span><span class="review-unit">${esc(e.unit)}</span></span>`;
  };
  const measurement = e => `<div class="review-evidence"><strong>${esc(e.label)}</strong><p>${e.template === 'statistic' ? `${esc(value(e.value, e.unit))} ${esc(e.unit)}` : e.values.map(p => `${esc(p.label)}: ${esc(value(p.value, e.unit))} ${esc(e.unit)}`).join(' · ')}</p><p class="footnote">${esc(number(e.samples))} of ${esc(number(e.total))} recorded samples. ${esc(e.limitation || '')}</p></div>`;
  return `<div class="review-card-grid">${result.cards.map(card => `<details class="review-insight"><summary><span class="review-card-title">${esc(card.title)}</span>${graphic(card.evidence)}<span class="review-confidence">${esc(card.confidence[0].toUpperCase() + card.confidence.slice(1))} confidence <span aria-hidden="true">+</span></span></summary><div class="review-card-detail"><p>${esc(card.observation)}</p>${measurement(card.evidence)}${(card.supportingEvidence || []).map(measurement).join('')}<dl>${[['Confidence', card.confidenceReason + (card.confidenceLimited ? ' Confidence is limited by sparse or incomplete recorded evidence.' : '')], ['Other explanations', card.alternatives], ['Try this', card.experiment], ['Compare afterward', card.compare], ['What is missing', card.missing]].map(([label, text]) => `<div><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>`).join('')}</dl></div></details>`).join('')}</div>`;
}

export function reviewResultCaption(result, stale = false, { number = n => Number(n).toLocaleString(), credits = number } = {}) {
  const u = result.usage || {}, scope = result.scope || {};
  const cost = u.credits == null ? 'AI credits unavailable' : `${credits(u.credits)} AI credits${u.creditStatus !== 'complete' ? ' (partial recording)' : ''}`;
  const tokens = u.tokens == null ? 'tokens unavailable' : `${number(u.tokens)} tokens${u.tokenStatus !== 'complete' ? ' (partial recording)' : ''}`;
  const enrichment = result.enrichment === 'complete' ? `${number(result.samples)} prompt excerpts reviewed` : result.enrichment === 'cancelled' ? 'Optional follow-up cancelled; showing initial statistical findings' : result.enrichment === 'timed-out' ? 'Optional follow-up timed out; showing initial statistical findings' : result.enrichment === 'failed' ? 'Optional follow-up failed; showing statistical findings' : result.enrichment === 'unavailable' ? 'Requested excerpts unavailable; showing statistical findings' : 'Statistics only';
  const filters = result.filterLabels || ['model', 'project', 'session', 'environment'].filter(k => scope[`${k}Filtered`]).map(k => `${k} filter active`);
  return `${result.model || 'Copilot'} · ${result.reasoningEffort === 'default' ? 'model default reasoning' : (result.reasoningEffort || 'default') + ' reasoning'} · ${scope.startDate || ''} to ${scope.endDate || ''}${filters.length ? ' · ' + filters.join(' · ') : ''}. ${stale ? 'Previous filter snapshot. ' : ''}${enrichment}. Analysis usage: ${cost}, ${tokens}. ${number(result.passes || 1)} pass${result.passes === 1 ? '' : 'es'} · Guide ${result.guidanceVersion || 'unknown'}. Later filter changes do not change this review.`;
}
