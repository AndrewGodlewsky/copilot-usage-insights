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

test('semantic status badges and three-position confidence dials have full accessible meanings', () => {
  for (const [assessment, meaning] of [['positive', 'Working well'], ['opportunity', 'Worth improving'], ['neutral', 'Mixed or unclear']]) {
    for (const confidence of ['low', 'medium', 'high']) {
      const html = renderReviewCards({ cards: [{ ...card, assessment, confidence, evidence: { template: 'statistic', value: 12, unit: 'turns', samples: 6, total: 6 } }] });
      assert.ok(html.includes(`data-assessment="${assessment}"`));
      assert.ok(html.includes(`aria-label="${meaning}"`));
      assert.ok(html.includes(`>${meaning}<`));
      assert.ok(html.includes(`data-confidence="${confidence}"`));
      assert.match(html, /class="review-gauge"/);
      assert.equal((html.match(/class="gauge-sector/g) || []).length, 3);
      assert.ok(html.includes(`${confidence[0].toUpperCase() + confidence.slice(1)} confidence`));
    }
  }
});

test('share cards visualize measured percentages cleanly without raw excess decimals', () => {
  const html = renderReviewCards({ cards: [{ ...card, assessment: 'neutral', evidence: { template: 'share', label: 'Cache reuse', value: 72.5, unit: '%', samples: 8, total: 10 } }] });
  assert.match(html, /review-share/); assert.match(html, /stroke-dasharray="72.5 100"/);
  assert.match(html, /72\.5%/); assert.match(html, /8 of 10/);

  const messy = renderReviewCards({ cards: [{ ...card, assessment: 'opportunity', evidence: { template: 'share', label: 'Tool definitions', value: 58.956, unit: '% of input', samples: 16, total: 20 } }] });
  assert.match(messy, /59%/);
  assert.match(messy, /of input/);
  assert.doesNotMatch(messy, /58\.956/);
  assert.match(messy, /16\/20 samples/);
  assert.match(messy, /review-experiment/);
});

test('comparison cards render zero values cleanly without stub bars and highlight the leader', () => {
  const html = renderReviewCards({
    cards: [{
      ...card,
      assessment: 'positive',
      evidence: {
        template: 'comparison',
        label: 'How prompts reach the agent',
        unit: 'prompts',
        values: [
          { label: 'Started while idle', value: 35 },
          { label: 'Steering', value: 0 },
          { label: 'Queued', value: 2 },
          { label: 'Unknown', value: 0 },
        ],
        samples: 37,
        total: 37,
      },
    }],
  });
  assert.match(html, /review-bar-row is-leader/);
  assert.match(html, /review-bar-row is-zero/);
  assert.match(html, /style="width:0%"/);
  assert.match(html, /style="width:100%"/);
  assert.match(html, /review-card-preview/);
});

test('expanded card puts close control in top corner, leads with meaning and action, and tucks caveats away', () => {
  const html = renderReviewCards({
    cards: [{
      ...card,
      assessment: 'positive',
      confidence: 'high',
      evidence: {
        template: 'comparison',
        label: 'How prompts reach the agent',
        unit: 'prompts',
        values: [{ label: 'Started while idle', value: 35 }, { label: 'Steering', value: 0 }],
        samples: 37,
        total: 37,
        limitation: 'Confirmed human delivery <only>.',
      },
      supportingEvidence: [{
        template: 'share',
        label: 'Sessions containing steering',
        unit: '% of classified sessions',
        value: 0,
        samples: 8,
        total: 9,
        limitation: 'Confirmed human delivery <only>.',
      }],
    }],
  });
  assert.match(html, /review-card-top-right[^>]*>.*review-close-control/);
  assert.match(html, /What this means/);
  assert.match(html, /Try this/);
  assert.match(html, /How to tell if it helped/);
  assert.match(html, /Numbers behind this insight/);
  assert.match(html, /review-chip is-zero/);
  assert.match(html, /<details class="review-caveats">/);
  assert.match(html, /Confidence &amp; measurement notes/);
  assert.match(html, /Confirmed human delivery &lt;only&gt;\./);
  // Duplicate limitation strings across metrics are deduplicated to one entry.
  assert.equal((html.match(/Confirmed human delivery &lt;only&gt;\./g) || []).length, 1);
  assert.doesNotMatch(html, /<only>/);
});
