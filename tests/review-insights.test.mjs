import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeInsights, loadReviewGuidance, validateInsightResponse } from '../src/node/review-insights.mjs';

const evidence = { id: 'cache', topic: 'context-cache', template: 'statistic', label: 'Cache reuse', value: 20, unit: '%', samples: 8, total: 10 };
const card = () => ({ evidenceId: 'cache', supportingEvidence: [], title: 'Cache reuse', confidence: 'medium', confidenceReason: 'Eight measured turns.', observation: 'Reuse was limited in this snapshot.', alternatives: 'Changing prefixes could explain this.', experiment: 'Compare a similar task in one conversation.', compare: 'Compare cache reuse and total input.', missing: 'Prefix stability is unknown.' });
const response = (followUp = null) => ({ cards: [card()], followUp, emptyReason: '' });
const snapshot = () => ({ payload: { schema: 'usage-insights-evidence-v1', evidence: [evidence], candidates: [{ id: 'prompt-1', characters: 20 }] }, labels: { cache: 'Cache reuse' }, candidates: [{ id: 'prompt-1', promptId: 'p', sessionId: 's' }] });
const followUp = () => ({ category: 'prompts-sessions', hypothesis: 'Related tasks may be split up.', why: 'A prompt example could disprove this.', candidates: ['prompt-1'] });

test('guidance is bounded, versioned and selects only relevant topic files', async () => {
  const guide = await loadReviewGuidance(['context-cache']);
  assert.ok(Buffer.byteLength(guide.text) < 8192);
  assert.match(guide.version, /^1\./);
  assert.match(guide.text, /cache/i);
  assert.doesNotMatch(guide.text, /MCP-specific/);
  await assert.rejects(loadReviewGuidance(['../../secret']));
});

test('validated cards get numbers from local evidence, not output; malformed or invented references fail', () => {
  const result = validateInsightResponse(JSON.stringify(response()), snapshot());
  assert.equal(result.cards[0].evidence.value, 20);
  for (const change of [r => r.cards[0].evidenceId = 'fake', r => r.cards[0].value = 99, r => r.cards[0].confidence = '100%', r => r.cards[0].title = 'x'.repeat(100), r => r.cards[0].supportingEvidence = ['fake'], r => r.cards.push(card())]) {
    const r = response(); change(r); assert.throws(() => validateInsightResponse(JSON.stringify(r), snapshot()));
  }
  assert.throws(() => validateInsightResponse('not JSON', snapshot()));
  assert.throws(() => validateInsightResponse('x'.repeat(65537), snapshot()));
  const r = response(); r.cards[0].observation = '<img src=x onerror=alert(1)>';
  assert.equal(validateInsightResponse(JSON.stringify(r), snapshot()).cards[0].observation, r.cards[0].observation, 'untrusted prose is preserved as text for escaped rendering');
});

test('statistics-only review makes one call and never reads samples even when requested', async () => {
  let calls = 0;
  const result = await analyzeInsights(snapshot(), { allowSamples: false, send: async () => { calls++; return JSON.stringify(response(followUp())); }, readSamples: () => { throw new Error('must not read'); } });
  assert.equal(calls, 1); assert.equal(result.passes, 1); assert.equal(result.samples, 0);
});

test('one automatic follow-up uses at most six bounded excerpts and cannot recurse', async () => {
  const s = snapshot(); s.candidates = Array.from({ length: 6 }, (_, i) => ({ id: `prompt-${i + 1}` }));
  s.payload.candidates = s.candidates.map(c => ({ id: c.id }));
  const follow = { ...followUp(), candidates: s.candidates.map(c => c.id) }, sent = [];
  const result = await analyzeInsights(s, { allowSamples: true, send: async prompt => { sent.push(prompt); return JSON.stringify(response(follow)); },
    readSamples: async candidates => candidates.map(c => ({ id: c.id, text: 'x'.repeat(3000), truncated: false })) });
  assert.equal(sent.length, 2); assert.equal(result.passes, 2); assert.equal(result.samples, 6);
  const data = JSON.parse(sent[1].slice(sent[1].indexOf('{')));
  assert.equal(data.samples.reduce((n, p) => n + p.text.length, 0), 12000);
  assert.ok(data.samples.every(p => p.truncated));
  assert.ok(sent.every(p => Buffer.byteLength(p) < 48 * 1024));
});

test('invalid follow-ups cannot read arbitrary IDs; unavailable or failed enrichment keeps baseline', async () => {
  for (const readSamples of [async () => [], async () => { throw new Error('PRIVATE PATH'); }]) {
    let calls = 0;
    const result = await analyzeInsights(snapshot(), { allowSamples: true, send: async () => { calls++; return JSON.stringify(response(followUp())); }, readSamples });
    assert.equal(calls, 1); assert.equal(result.cards.length, 1); assert.notEqual(result.enrichment, 'complete');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  const r = response({ ...followUp(), candidates: ['not-a-candidate'] });
  assert.throws(() => validateInsightResponse(JSON.stringify(r), snapshot()));
  let calls = 0;
  const result = await analyzeInsights(snapshot(), { allowSamples: true, send: async () => { if (++calls === 2) throw Error('PRIVATE'); return JSON.stringify(response(followUp())); }, readSamples: async () => [{ id: 'prompt-1', text: 'small prompt' }] });
  assert.equal(result.cards.length, 1); assert.equal(result.enrichment, 'failed'); assert.equal(result.passes, 2);
});

test('empty findings are explicit and cancellation prevents further submissions', async () => {
  const empty = validateInsightResponse(JSON.stringify({ cards: [], followUp: null, emptyReason: 'Too little measured activity.' }), snapshot());
  assert.equal(empty.cards.length, 0);
  const c = new AbortController(); let calls = 0;
  await assert.rejects(analyzeInsights(snapshot(), { signal: c.signal, allowSamples: true, send: async () => { calls++; c.abort(); return JSON.stringify(response(followUp())); } }));
  assert.equal(calls, 1);
});

test('cancelling enrichment preserves the validated baseline, including stalled sample reads', { timeout: 2000 }, async () => {
  for (const duringRead of [true, false]) {
    const controller = new AbortController(); let calls = 0;
    const result = await analyzeInsights(snapshot(), { signal: controller.signal, allowSamples: true,
      send: async () => { if (++calls === 2) { controller.abort(); throw Error('interrupted'); } return JSON.stringify(response(followUp())); },
      readSamples: async () => { if (duringRead) { controller.abort(); return new Promise(() => {}); } return [{ id: 'prompt-1', text: 'example' }]; } });
    assert.equal(result.enrichment, 'cancelled'); assert.equal(result.cards.length, 1);
    assert.equal(calls, duringRead ? 1 : 2);
  }
});
