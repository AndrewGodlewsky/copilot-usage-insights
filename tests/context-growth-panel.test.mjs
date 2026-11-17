import test from 'node:test';
import assert from 'node:assert/strict';
import { renderContextGrowth, contextGrowthChart } from '../src/panel/context-growth.mjs';
import { createContextGrowthAccumulator } from '../src/core/context-growth.mjs';
const now = new Date(2026, 10, 16), a = createContextGrowthAccumulator({}, 1, 1, now);
for (let s = 0; s < 4; s++) for (let i = 0; i < 8; i++) a.add({ identity: true, humanDelivery: true, provider: true, linksKnown: true, day: 1, sessionId: String(s), project: '<img src=x>',
  sample: { ms: i }, contextRecord: { ms: i + 1, model: '<script>MODEL</script>', modelId: 'raw', inputTotal: (i + 1) * (s + 1) * 10000, cacheRead: 0, cacheWrite: 0 } });
const growth = a.finish(), number = n => n == null ? 'Unavailable' : String(Math.round(n));
test('default growth view groups sessions into medians and middle 50%, with coverage and no raw line cloud', () => {
  const html = renderContextGrowth(growth, { number, width: 380 });
  assert.match(html, /middle 50%/); assert.match(html, /4 of 4 sessions/); assert.match(html, /First main-agent call/);
  assert.match(html, /growth-band/); assert.doesNotMatch(html, /<img src=x>|<script>MODEL/);
  assert.match(html, /&lt;img src=x&gt;/);
});
test('growth chart supports deltas, contributor counts and accessible individual measurements', () => {
  const svg = contextGrowthChart(growth, { number, width: 350, mode: 'change', pattern: 'growing' });
  assert.match(svg, /4 sessions/); assert.match(svg, /Change in input/); assert.doesNotMatch(svg, /NaN|Infinity/);
  const detail = renderContextGrowth(growth, { number, sessionKey: growth.examples[0].key });
  assert.match(detail, /growth-prompt/); assert.match(detail, /role="img"/);
  assert.doesNotMatch(detail, /<script>/);
});
test('sparse, missing and loading growth views do not invent curves or zeroes', () => {
  assert.match(renderContextGrowth(undefined, { number, loading: true }), /Loading/);
  assert.match(renderContextGrowth({ ...growth, sessions: 0 }, { number }), /No confirmed/);
  const small = structuredClone(growth); for (const b of Object.values(small.patterns)) b.curve = [];
  assert.match(renderContextGrowth(small, { number }), /three comparable sessions/);
});
