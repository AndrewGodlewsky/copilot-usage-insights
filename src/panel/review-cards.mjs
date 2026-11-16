import { esc } from './charts.mjs';

const assessments = { positive: ['🙂', 'Working well'], opportunity: ['🙁', 'Worth improving'], neutral: ['😐', 'Mixed or unclear'] };
function confidenceDial(level) {
  const index = ['low', 'medium', 'high'].indexOf(level), label = `${level[0].toUpperCase() + level.slice(1)} confidence`;
  const sectors = ['M8 30A22 22 0 0 1 19 10.95', 'M19 10.95A22 22 0 0 1 41 10.95', 'M41 10.95A22 22 0 0 1 52 30'];
  const needle = ['16 22', '30 14', '44 22'][index];
  return `<span class="review-gauge" data-confidence="${level}" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 60 36" aria-hidden="true" focusable="false">${sectors.map((d, i) => `<path class="gauge-sector${i === index ? ' selected' : ''}" d="${d}"/>`).join('')}<path class="gauge-needle" d="M30 30L${needle}"/><circle cx="30" cy="30" r="2.5"/></svg></span>`;
}

export function renderReviewCards(result, { number = n => Number(n).toLocaleString(), credits = number } = {}) {
  if (!result.cards?.length) return `<p class="review-empty">${esc(result.emptyReason || 'There is not enough reliable evidence for a useful finding yet.')}</p>`;
  const value = (n, unit) => unit?.startsWith('AI credits') ? credits(n) : number(n);
  const graphic = e => {
    if (e.template === 'statistic') return `<span class="review-stat">${esc(value(e.value, e.unit))}<span class="review-unit">${esc(e.unit)}</span></span>`;
    if (e.template === 'share') return `<span class="review-share"><svg viewBox="0 0 72 72" aria-hidden="true" focusable="false"><circle class="share-track" cx="36" cy="36" r="29"/><circle class="share-value" cx="36" cy="36" r="29" pathLength="100" stroke-dasharray="${Math.max(0, Math.min(100, e.value))} 100" transform="rotate(-90 36 36)"/></svg><span class="review-stat">${esc(value(e.value, e.unit))}<span class="review-unit">${esc(e.unit)}</span></span></span>`;
    const values = e.values || [], max = Math.max(1, ...values.map(p => p.value));
    if (e.template === 'comparison') return `<span class="review-comparison">${values.map(p => `<span><span class="review-small-label">${esc(p.label)}</span><b>${esc(value(p.value, e.unit))}</b><span class="review-mini-bar" style="width:${Math.max(1, p.value / max * 100)}%"></span></span>`).join('')}<span class="review-unit">${esc(e.unit)}</span></span>`;
    const points = values.map((p, i) => `${i * 220 / Math.max(1, values.length - 1)},${52 - p.value / max * 48}`).join(' ');
    return `<span class="review-trend"><svg viewBox="0 0 220 56" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg><span class="review-trend-endpoints">${esc(value(values[0]?.value || 0, e.unit))} <span>to</span> ${esc(value(values.at(-1)?.value || 0, e.unit))}</span><span class="review-unit">${esc(e.unit)}</span></span>`;
  };
  const measurement = e => `<div class="review-evidence"><strong>${esc(e.label)}</strong><p>${e.template === 'statistic' || e.template === 'share' ? `${esc(value(e.value, e.unit))} ${esc(e.unit)}` : e.values.map(p => `${esc(p.label)}: ${esc(value(p.value, e.unit))} ${esc(e.unit)}`).join(' · ')}</p><p class="footnote">${esc(number(e.samples))} of ${esc(number(e.total))} recorded samples. ${esc(e.limitation || '')}</p></div>`;
  return `<div class="review-card-grid">${result.cards.map(card => {
    const [face, meaning] = assessments[card.assessment] || assessments.neutral;
    return `<details class="review-insight"><summary><span class="review-card-heading"><span class="review-card-title">${esc(card.title)}</span><span class="review-assessment" role="img" aria-label="${meaning}" title="${meaning}">${face}</span></span>${graphic(card.evidence)}<span class="review-confidence">${confidenceDial(card.confidence)}<span class="review-expand" aria-hidden="true">+</span></span></summary><div class="review-card-detail"><p>${esc(card.observation)}</p>${measurement(card.evidence)}${(card.supportingEvidence || []).map(measurement).join('')}<dl>${[['Confidence', card.confidenceReason + (card.confidenceLimited ? ' Confidence is limited by sparse or incomplete recorded evidence.' : '')], ['Other explanations', card.alternatives], ['Try this', card.experiment], ['Compare afterward', card.compare], ['What is missing', card.missing]].map(([label, text]) => `<div><dt>${esc(label)}</dt><dd>${esc(text)}</dd></div>`).join('')}</dl></div></details>`;
  }).join('')}</div>`;
}

export function reviewResultCaption(result, stale = false, { number = n => Number(n).toLocaleString(), credits = number } = {}) {
  const u = result.usage || {}, scope = result.scope || {};
  const cost = u.credits == null ? 'AI credits unavailable' : `${credits(u.credits)} AI credits${u.creditStatus !== 'complete' ? ' (partial recording)' : ''}`;
  const tokens = u.tokens == null ? 'tokens unavailable' : `${number(u.tokens)} tokens${u.tokenStatus !== 'complete' ? ' (partial recording)' : ''}`;
  const enrichment = result.enrichment === 'complete' ? `${number(result.samples)} prompt excerpts reviewed` : result.enrichment === 'cancelled' ? 'Optional follow-up cancelled; showing initial statistical findings' : result.enrichment === 'timed-out' ? 'Optional follow-up timed out; showing initial statistical findings' : result.enrichment === 'failed' ? 'Optional follow-up failed; showing statistical findings' : result.enrichment === 'unavailable' ? 'Requested excerpts unavailable; showing statistical findings' : 'Statistics only';
  const filters = result.filterLabels || ['model', 'project', 'session', 'environment'].filter(k => scope[`${k}Filtered`]).map(k => `${k} filter active`);
  return `${result.model || 'Copilot'} · ${result.reasoningEffort === 'default' ? 'model default reasoning' : (result.reasoningEffort || 'default') + ' reasoning'} · ${scope.startDate || ''} to ${scope.endDate || ''}${filters.length ? ' · ' + filters.join(' · ') : ''}. ${stale ? 'Previous filter snapshot. ' : ''}${enrichment}. Analysis usage: ${cost}, ${tokens}. ${number(result.passes || 1)} pass${result.passes === 1 ? '' : 'es'} · Guide ${result.guidanceVersion || 'unknown'}. Later filter changes do not change this review.`;
}
