import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRequestPrompts } from '../src/node/request-prompts.mjs';

test('prompt reads reject traversal and a session directory link outside its configured home', async t => {
  const base = await mkdtemp(join(tmpdir(), 'usage-security-paths-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = join(base, 'home'), outside = join(base, 'outside'), state = join(source, 'session-state');
  await mkdir(state, { recursive: true }); await mkdir(outside);
  const file = join(outside, 'events.jsonl');
  await writeFile(file, [
    { type: 'user.message', id: 'prompt', data: { interactionId: 'interaction', content: 'OUTSIDE_SECRET' } },
    { type: 'assistant.message', id: 'reply', data: { interactionId: 'interaction', apiCallId: 'call' } },
  ].map(JSON.stringify).join('\n'));
  const alias = join(state, 'linked');
  await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const logFile of [file, join(state, '..', '..', 'outside', 'events.jsonl'), join(alias, 'events.jsonl')]) {
    const result = await readRequestPrompts([{ key: 'request', source, logFile, apiCallId: 'call' }]);
    assert.equal(result.get('request').available, false);
    assert.doesNotMatch(JSON.stringify([...result]), /OUTSIDE_SECRET/);
  }
});
