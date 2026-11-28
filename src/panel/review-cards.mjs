import { esc } from './charts.mjs';

const assessments = {
  positive: { tone: 'positive', label: 'Working well' },
  opportunity: { tone: 'opportunity', label: 'Worth improving' },
  neutral: { tone: 'neutral', label: 'Mixed or unclear' },
};

function confidenceDial(level) {
  const safe = ['low', 'medium', 'high'].includes(level) ? level : 'low';
  const index = ['low', 'medium', 'high'].indexOf(safe);
  const shortLabel = `${safe[0].toUpperCase() + safe.slice(1)} confidence`;
  const sectors = ['M8 30A22 22 0 0 1 19 10.95', 'M19 10.95A22 22 0 0 1 41 10.95', 'M41 10.95A22 22 0 0 1 52 30'];
  const needle = ['16 22', '30 14', '44 22'][index];
  return `<span class="review-confidence-meta"><span class="review-gauge" data-confidence="${safe}" role="img" aria-label="${shortLabel}" title="${shortLabel}"><svg viewBox="0 0 60 36" aria-hidden="true" focusable="false">${sectors.map((d, i) => `<path class="gauge-sector${i === index ? ' selected' : ''}" d="${d}"/>`).join('')}<path class="gauge-needle" d="M30 30L${needle}"/><circle cx="30" cy="30" r="2.5"/></svg></span><span class="review-confidence-label">${shortLabel}</span></span>`;
}

function roundForCard(n, unit) {
  const numeric = Number(n);
  if (!Number.isFinite(numeric)) return n;
  if (unit?.startsWith('%')) {
    const abs = Math.abs(numeric);
    if (abs > 0 && abs < 0.1) return Math.round(numeric * 100) / 100;
    return Math.round(numeric * 10) / 10;
  }
  const abs = Math.abs(numeric);
  if (abs >= 100) return Math.round(numeric);
  if (abs >= 1) return Math.round(numeric * 10) / 10;
  if (abs >= 0.01) return Math.round(numeric * 100) / 100;
  return numeric;
}

function formatMetric(n, unit, { number, credits }) {
  if (unit?.startsWith('AI credits')) return { display: credits(n), unitLabel: unit };
  if (unit?.startsWith('%')) {
    const rounded = roundForCard(n, unit);
    const rest = unit.slice(1).trim();
    return { display: `${number(rounded, { maximumFractionDigits: 1 })}%`, unitLabel: rest };
  }
  const rounded = roundForCard(n, unit);
  return { display: number(rounded, { maximumFractionDigits: 1 }), unitLabel: unit || '' };
}

function formatEvidenceText(n, unit, formatters) {
  const { display, unitLabel } = formatMetric(n, unit, formatters);
  return unitLabel ? `${display} ${unitLabel}` : display;
}

export function renderReviewCards(result, { number = n => Number(n).toLocaleString(), credits = number } = {}) {
  if (!result.cards?.length) return `<p class="review-empty">${esc(result.emptyReason || 'There is not enough reliable evidence for a useful finding yet.')}</p>`;
  const formatters = { number, credits };

  const graphic = (e, cardTitle) => {
    if (e.template === 'statistic') {
      const { display, unitLabel } = formatMetric(e.value, e.unit, formatters);
      const contextLabel = e.label && e.label.toLowerCase() !== (cardTitle || '').toLowerCase() ? `<span class="review-metric-context">${esc(e.label)}</span>` : '';
      return `<span class="review-stat-block"><span class="review-stat-line"><span class="review-stat">${esc(display)}</span>${unitLabel ? `<span class="review-unit">${esc(unitLabel)}</span>` : ''}</span>${contextLabel}</span>`;
    }
    if (e.template === 'share') {
      const pct = Math.round(Math.max(0, Math.min(100, Number(e.value) || 0)) * 10) / 10;
      const { display, unitLabel } = formatMetric(e.value, e.unit, formatters);
      const contextLabel = e.label && e.label.toLowerCase() !== (cardTitle || '').toLowerCase() ? `<span class="review-metric-context">${esc(e.label)}</span>` : '';
      return `<span class="review-share"><svg viewBox="0 0 72 72" aria-hidden="true" focusable="false"><circle class="share-track" cx="36" cy="36" r="29"/><circle class="share-value${pct === 0 ? ' is-zero' : ''}" cx="36" cy="36" r="29" pathLength="100" stroke-dasharray="${pct} 100" transform="rotate(-90 36 36)"/></svg><span class="review-stat-block"><span class="review-stat">${esc(display)}</span>${unitLabel ? `<span class="review-unit">${esc(unitLabel)}</span>` : ''}${contextLabel}</span></span>`;
    }
    const values = e.values || [];
    const numericValues = values.map(p => Math.max(0, Number(p.value) || 0));
    const max = Math.max(0, ...numericValues);
    if (e.template === 'comparison') {
      const unitCaption = e.unit ? `<span class="review-comparison-unit">${esc(e.unit)}</span>` : '';
      const rows = values.map((p, index) => {
        const raw = numericValues[index];
        const width = raw > 0 && max > 0 ? Math.max(3, Math.min(100, Math.round(raw / max * 1000) / 10)) : 0;
        const isLeader = raw > 0 && raw === max;
        const { display } = formatMetric(p.value, e.unit, formatters);
        return `<span class="review-bar-row${raw === 0 ? ' is-zero' : ''}${isLeader ? ' is-leader' : ''}"><span class="review-bar-head"><span class="review-small-label">${esc(p.label)}</span><b class="review-bar-value">${esc(display)}</b></span><span class="review-bar-track"><span class="review-mini-bar" style="width:${width}%"></span></span></span>`;
      }).join('');
      return `<span class="review-comparison">${unitCaption}${rows}</span>`;
    }
    const minVal = Math.min(...numericValues, 0);
    const span = max - minVal;
    const coords = values.map((p, i) => {
      const x = values.length === 1 ? 110 : Math.round(i * 220 / (values.length - 1) * 10) / 10;
      const y = span === 0 ? 28 : Math.round((46 - ((numericValues[i] - minVal) / span) * 38) * 10) / 10;
      return [x, y];
    });
    const points = coords.map(([x, y]) => `${x},${y}`).join(' ');
    const areaPoints = coords.length > 1 ? `${coords[0][0]},52 ${points} ${coords.at(-1)[0]},52` : '';
    const first = formatMetric(values[0]?.value || 0, e.unit, formatters);
    const last = formatMetric(values.at(-1)?.value || 0, e.unit, formatters);
    const endUnit = last.unitLabel || first.unitLabel;
    return `<span class="review-trend"><svg viewBox="0 0 220 56" aria-hidden="true" focusable="false">${areaPoints ? `<polygon class="review-trend-area" points="${areaPoints}"/>` : ''}${coords.length > 1 ? `<polyline class="review-trend-line" points="${points}" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : ''}${coords.length ? `<circle class="review-trend-dot" cx="${coords[0][0]}" cy="${coords[0][1]}" r="3"/><circle class="review-trend-dot is-end" cx="${coords.at(-1)[0]}" cy="${coords.at(-1)[1]}" r="3.5"/>` : ''}</svg><span class="review-trend-endpoints"><span>${esc(first.display)}</span><span class="review-trend-arrow" aria-hidden="true">→</span><span class="sr-only"> to </span><span>${esc(last.display)}</span>${endUnit ? `<span class="review-unit">${esc(endUnit)}</span>` : ''}</span></span>`;
  };

  const measurement = e => {
    const sampleNote = Number.isFinite(e.samples) && Number.isFinite(e.total) ? `${number(e.samples)} of ${number(e.total)} samples` : '';
    let body;
    if (e.template === 'statistic' || e.template === 'share') {
      body = `<p class="review-evidence-stat">${esc(formatEvidenceText(e.value, e.unit, formatters))}</p>`;
    } else {
      const unitLabel = e.unit?.startsWith('%') ? e.unit.slice(1).trim() : (e.unit || '');
      const chips = (e.values || []).map(p => {
        const raw = Number(p.value) || 0;
        const { display } = formatMetric(p.value, e.unit, formatters);
        return `<span class="review-chip${raw === 0 ? ' is-zero' : ''}"><span class="review-chip-label">${esc(p.label)}</span><b class="review-chip-value">${esc(display)}</b></span>`;
      }).join('');
      body = `<div class="review-metric-chips">${chips}${unitLabel ? `<span class="review-chip-unit">${esc(unitLabel)}</span>` : ''}</div>`;
    }
    return `<div class="review-evidence"><div class="review-evidence-head"><strong>${esc(e.label)}</strong>${sampleNote ? `<span class="review-evidence-samples">${esc(sampleNote)}</span>` : ''}</div>${body}</div>`;
  };

  const chevron = `<svg class="review-expand-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 6.25 8 9.75l3.5-3.5"/></svg>`;
  const closeIcon = `<svg class="review-close-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75"/></svg>`;

  return `<div class="review-card-grid">${result.cards.map(card => {
    const assessment = assessments[card.assessment] || assessments.neutral;
    const e = card.evidence || {};
    const allEvidence = [e, ...(card.supportingEvidence || [])].filter(Boolean);
    const sampleText = Number.isFinite(e.samples) && Number.isFinite(e.total)
      ? (e.samples === e.total ? `${number(e.samples)} samples` : `${number(e.samples)}/${number(e.total)} samples`)
      : '';
    const safeConfidence = ['low', 'medium', 'high'].includes(card.confidence) ? card.confidence : 'low';
    const confidenceTitle = `${safeConfidence[0].toUpperCase() + safeConfidence.slice(1)} confidence`;
    const confidenceText = (card.confidenceReason || '') + (card.confidenceLimited ? ' Confidence is limited by sparse or incomplete recorded evidence.' : '');

    // Deduplicate limitation notes so repeated caveats aren't shown multiple times.
    const seenNotes = new Set();
    const limitationNotes = [];
    for (const item of allEvidence) {
      const note = item.limitation?.trim();
      if (!note || seenNotes.has(note)) continue;
      seenNotes.add(note);
      limitationNotes.push({ label: item.label, note });
    }
    const caveatCount = limitationNotes.length + (card.missing ? 1 : 0);
    const caveatHint = [confidenceTitle, caveatCount ? `${caveatCount} ${caveatCount === 1 ? 'note' : 'notes'}` : ''].filter(Boolean).join(' · ');

    const caveatsSection = (confidenceText || card.missing || limitationNotes.length) ? `<details class="review-caveats"><summary><span class="review-caveats-title">Confidence &amp; measurement notes</span><span class="review-caveats-meta">${esc(caveatHint)}${chevron}</span></summary><div class="review-caveats-body"><dl class="review-detail-grid">${confidenceText ? `<div><dt>Why ${esc(safeConfidence)} confidence</dt><dd>${esc(confidenceText)}</dd></div>` : ''}${card.missing ? `<div><dt>What isn't measured</dt><dd>${esc(card.missing)}</dd></div>` : ''}</dl>${limitationNotes.length ? `<div class="review-limitations"><span class="review-sub-label">Sample &amp; scope notes</span><ul>${limitationNotes.map(({ label, note }) => `<li><strong>${esc(label)}:</strong> ${esc(note)}</li>`).join('')}</ul></div>` : ''}</div></details>` : '';

    return `<details class="review-insight" data-assessment="${assessment.tone}"><summary><span class="review-card-top"><span class="review-card-badges"><span class="review-assessment" data-assessment="${assessment.tone}" aria-label="${assessment.label}" title="${assessment.label}"><span class="review-assessment-dot" aria-hidden="true"></span><span>${assessment.label}</span></span><span class="review-open-confidence">${esc(confidenceTitle)}</span></span><span class="review-card-top-right">${sampleText ? `<span class="review-sample-meta">${esc(sampleText)}</span>` : ''}<span class="review-close-control" aria-hidden="true"><span>Close</span>${closeIcon}</span></span></span><span class="review-card-heading"><span class="review-card-title">${esc(card.title)}</span></span><span class="review-card-visual">${graphic(e, card.title)}</span>${card.observation ? `<span class="review-card-preview">${esc(card.observation)}</span>` : ''}<span class="review-confidence">${confidenceDial(card.confidence)}<span class="review-expand" aria-hidden="true"><span>Details</span>${chevron}</span></span></summary><div class="review-card-detail"><div class="review-detail-lead"><div class="review-takeaway"><span class="review-section-label">What this means</span><p class="review-card-observation">${esc(card.observation)}</p>${card.alternatives ? `<p class="review-alternatives"><strong>Other possible reasons:</strong> ${esc(card.alternatives)}</p>` : ''}</div>${card.experiment || card.compare ? `<div class="review-action-box" data-assessment="${assessment.tone}">${card.experiment ? `<div class="review-experiment"><span class="review-section-label">Try this</span><p>${esc(card.experiment)}</p></div>` : ''}${card.compare ? `<div class="review-compare"><span class="review-sub-label">How to tell if it helped</span><p>${esc(card.compare)}</p></div>` : ''}</div>` : ''}</div><div class="review-metrics-section"><span class="review-section-label">Numbers behind this insight</span><div class="review-evidence-list">${allEvidence.map(measurement).join('')}</div></div>${caveatsSection}</div></details>`;
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
