import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReviewCards, reviewResultCaption } from '../src/panel/review-cards.mjs';

const card = { title: '<script>title</script>', confidence: 'medium', confidenceReason: 'Evidence <limited>', observation: 'Observed <pattern>', alternatives: 'Alternative', experiment: 'Try a check', compare: 'Total resources', missing: 'Task value', supportingEvidence: [] };
test('cards render local statistics and accessible disclosure with escaped AI prose', () => {
  const html = renderReviewCards({ cards: [{ ...card, evidence: { template: 'statistic', label: 'Local value', value: 25, unit: '%', samples: 4, total: 5 } }] });
  assert.match(html, /<details/); assert.match(html, /<summary/); assert.match(html, /25/); assert.match(html, /Medium confidence/);
  assert.match(html, /4 of 5/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<pattern>/);
});
test('comparison and trend cards use fixed local graphics with a readable alternative', () => {
  const cards = ['comparison', 'trend'].map(template => ({ ...card, evidence: { template, label: 'Comparison', unit: 'tokens', values: [{ label: 'Earlier', value: 10 }, { label: 'Later', value: 20 }], samples: 10, total: 10 } }));
  const html = renderReviewCards({ cards });
  assert.match(html, /Earlier/); assert.match(html, /Later/); assert.match(html, /<svg/); assert.match(html, /aria-hidden="true"/);
  assert.match(renderReviewCards({ cards: [], emptyReason: 'Too little <data>' }), /Too little &lt;data&gt;/);
});
test('result caption distinguishes zero, unknown, partial cost, enrichment and changed filters', () => {
  const r = { model: 'Opus', reasoningEffort: 'medium', scope: { range: '7d', startDate: '2026-11-09', endDate: '2026-11-15' }, capturedAt: '2026-11-15T12:00:00Z', guidanceVersion: '1.0.0', passes: 2, samples: 2, enrichment: 'failed', usage: { credits: 0, creditStatus: 'complete', tokens: 100, tokenStatus: 'partial' } };
  const caption = reviewResultCaption(r, true);
  assert.match(caption, /0 AI credits/); assert.match(caption, /partial/i); assert.match(caption, /previous filter snapshot/i); assert.match(caption, /follow-up failed/i);
  assert.match(reviewResultCaption({ ...r, usage: { credits: null, creditStatus: 'unavailable' } }), /credits unavailable/i);
  assert.match(reviewResultCaption({ ...r, enrichment: 'cancelled' }), /follow-up cancelled; showing initial/i);
  assert.match(reviewResultCaption({ ...r, enrichment: 'timed-out' }), /follow-up timed out; showing initial/i);
  assert.match(reviewResultCaption({ ...r, filterLabels: ['Project: Original project'] }, true), /Project: Original project/);
});
