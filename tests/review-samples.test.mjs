import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareInsightReview, readReviewSamples } from '../src/node/review-evidence.mjs';
import { reviewFixture, reviewNow } from './fixtures/review.mjs';

test('sample reader bounds text, deduplicates calls, and rejects changed automated or conflicting prompts', async t => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'review-samples-'));
  t.after(() => fs.rm(source, { recursive: true, force: true }));
  const f = reviewFixture({ source }); f.user('p', { content: 'x'.repeat(3000) }); f.call('p', 'a'); f.call('p', 'b', { initiator: 'agent' });
  const file = path.join(source, 'session-state', 'session-a', 'events.jsonl'); await fs.mkdir(path.dirname(file), { recursive: true });
  const save = () => fs.writeFile(file, f.events.map(e => JSON.stringify(e)).join('\n'));
  await save();
  const s = await prepareInsightReview(f.scan(), { range: 'all' }, reviewNow);
  const samples = await readReviewSamples(s.candidates);
  assert.equal(samples.length, 1); assert.equal(samples[0].text.length, 2000); assert.equal(samples[0].truncated, true);
  const event = f.events.find(e => e.type === 'user.message'); event.data.isAutopilotContinuation = true; await save();
  assert.deepEqual(await readReviewSamples(s.candidates), []);
  delete event.data.isAutopilotContinuation;
  f.events.push({ ...event, data: { ...event.data, content: 'x'.repeat(2000) + 'different tail' } }); await save();
  assert.deepEqual(await readReviewSamples(s.candidates), []);
  const c = new AbortController(); c.abort(); await assert.rejects(readReviewSamples(s.candidates, { signal: c.signal }));
});
