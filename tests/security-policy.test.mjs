import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startServer } from '../src/node/canvas-server.mjs';

test('dashboard CSP authorizes only the shipped script and rejects inline event handlers', async t => {
  const server = await startServer({ html: '<!doctype html>\r\n<script>\r\nwindow.example = 1;\r\n</script><script type="application/json" id="initial-diagnostics">null</script>' });
  t.after(() => server.close());
  const response = await fetch(server.url), html = await response.text();
  const policy = response.headers.get('content-security-policy');
  const hash = createHash('sha256').update(html.match(/<script>([\s\S]*?)<\/script>/)[1]).digest('base64');
  assert.ok(policy.includes(`script-src 'sha256-${hash}'`));
  assert.match(policy, /script-src-attr 'none'/);
  assert.doesNotMatch(policy.split(';').find(p => p.trim().startsWith('script-src ')), /unsafe-inline|unsafe-eval|https:/);
  assert.match(policy, /connect-src 'self'/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});
