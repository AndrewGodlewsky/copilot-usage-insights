import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
// A disposable synthetic child is limited to 128 MiB of V8 heap and two seconds.
// --repo=<checkout> reproduces the same malformed database against an older revision.
const target = process.argv.find(arg => arg.startsWith('--repo='))?.slice(7) || process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-hostile-view-'));
try {
  const file = path.join(root, 'session-store.db'), db = new DatabaseSync(file);
  try {
    db.exec("CREATE VIEW assistant_usage_events AS WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1000000000) SELECT n AS id, CAST(n AS TEXT) AS session_id, 'Model' AS model, '2026-11-17T12:00:00Z' AS created_at, 1 AS total_nano_aiu FROM seq;");
  } finally { db.close(); }
  const module = pathToFileURL(path.resolve(target, 'src/node/copilot-db.mjs')).href;
  const script = `import { readUsageDatabase } from ${JSON.stringify(module)}; const r=readUsageDatabase(${JSON.stringify(file)},new Set(),${JSON.stringify(root)}); console.log(JSON.stringify({records:r.records.length,warning:r.warning}));`;
  const started = performance.now();
  const result = await new Promise(resolve => execFile(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script], {timeout:2000,windowsHide:true,maxBuffer:16384}, (error,stdout,stderr)=>resolve({killed:error?.killed??false,signal:error?.signal,code:error?.code,heapExhausted:/heap out of memory|heap limit/i.test(stderr),stdout:stdout.trim()})));
  console.log(JSON.stringify({bytes:(await fs.stat(file)).size,elapsedMs:Math.round(performance.now()-started),...result}));
} finally {
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('usage-hostile-view-'));
  assert.equal((await fs.lstat(root)).isSymbolicLink(),false);
  await fs.rm(root,{recursive:true,force:true});
}
