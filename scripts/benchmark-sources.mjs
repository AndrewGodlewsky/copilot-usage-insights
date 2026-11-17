import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// Synthetic only. --repo=<checkout> compares the same fixture against another revision.
// Run with node --expose-gc scripts/benchmark-sources.mjs.
const target = process.argv.find(arg => arg.startsWith('--repo='))?.slice(7) || process.cwd();
const load = file => import(pathToFileURL(path.join(target, file)).href);
const { createScanner } = await load('src/node/copilot-source.mjs');
const { readUsageDatabase, readDesktopSessionNames } = await load('src/node/copilot-db.mjs');
const { createUsageDatabaseReader } = await load('src/node/wsl-db.mjs');
const { createDiagnostics } = await load('src/core/diagnostics.mjs');

const out = { node: process.version }, temp = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-source-audit-'));
const round = v => Math.round(v * 10) / 10;
async function timed(fn) { const at = performance.now(), value = await fn(); return { ms: round(performance.now() - at), value }; }
const rss = () => { globalThis.gc?.(); return process.memoryUsage().heapUsed; };
const receipt = id => JSON.stringify({type:'session.usage_record', id, timestamp:'2026-11-17T12:00:00Z',data:{usage:{provider:{kind:'copilot'},model:'model',inputTokens:100,outputTokens:20,copilotUsage:{totalNanoAiu:125000000}}}})+'\n';
try {
  const journalHome = path.join(temp, 'journal');
  const folder = path.join(journalHome, 'session-state', 'active');
  await fs.mkdir(folder, {recursive:true});
  const file = path.join(folder, 'events.jsonl');
  const handle = await fs.open(file, 'w');
  const block = JSON.stringify({type:'hook.start',data:{content:'x'.repeat(65500)}})+'\n';
  try { for(let i=0;i<4096;i++) await handle.write(block); await handle.write(receipt('initial')); } finally { await handle.close(); }
  const diag = createDiagnostics({limit:1000}), scanner = createScanner({diagnostics:diag});
  const cold = await timed(()=>scanner.scan([journalHome]));
  const quiet = await timed(()=>scanner.scan([journalHome]));
  const appendRuns = [];
  for(let i=0;i<3;i++) {
    await fs.appendFile(file,receipt('append-'+i));
    const run = await timed(()=>scanner.scan([journalHome]));
    assert.equal(run.value.records.length, i+2);
    appendRuns.push({ms:run.ms,...diag.snapshot().entries.filter(e=>e.event==='history.journals'&&e.phase==='finished').at(-1)});
  }
  out.prefix = {bytes:(await fs.stat(file)).size,coldMs:cold.ms,quietMs:quiet.ms,appends:appendRuns.map(({ms,bytesRead,bytesHashed,filesRead,filesAppended})=>({ms,bytesRead,bytesHashed,filesRead,filesAppended}))};
  const dbHome = path.join(temp,'database'); await fs.mkdir(dbHome);
  const dbPath = path.join(dbHome,'session-store.db'), db = new DatabaseSync(dbPath);
  try {
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, repository TEXT, cwd TEXT, summary TEXT); CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, created_at TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_nano_aiu INTEGER); BEGIN");
    const ins = db.prepare('INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const sess = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)');
    for(let i=0;i<100000;i++) { const id='session-'+i; sess.run(id,'synthetic/repo','/synthetic','Synthetic title '+i); ins.run(i,id,'model','2026-11-17T12:00:00Z',100,20,0,0,125000000); }
    db.exec('COMMIT');
  } finally { db.close(); }
  const baselineHeap = rss(), dbScanner = createScanner();
  const dbCold = await timed(()=>dbScanner.scan([dbHome])), dbWarm = [];
  assert.equal(dbCold.value.records.length,100000);
  for(let i=0;i<3;i++) { const run=await timed(()=>dbScanner.scan([dbHome])); assert.equal(run.value,dbCold.value); dbWarm.push(run.ms); }
  const retainedMB = round((rss()-baselineHeap)/1048576);
  let fired=false; const delayAt=performance.now(); const timer = setTimeout(()=>{fired=true;},0);
  const direct=await timed(()=>readUsageDatabase(dbPath,new Set(),dbHome));
  const callbackBlockedMs=round(performance.now()-delayAt), callbackFired=fired; clearTimeout(timer);
  const suppressed=await timed(()=>readUsageDatabase(dbPath,new Set(direct.value.records.map(r=>r.sessionId)),dbHome));
  assert.equal(suppressed.value.records.length,0);
  out.database = {rows:100000,fileBytes:(await fs.stat(dbPath)).size,coldMs:dbCold.ms,warmMs:dbWarm,retainedMB,directReadMs:direct.ms,callbackBlockedMs,callbackFired,suppressedReadMs:suppressed.ms};
  let ticks = 0, lastTick = performance.now(), maxTickDelay = 0;
  const heartbeat = setInterval(() => { const now = performance.now(); maxTickDelay = Math.max(maxTickDelay, now - lastTick); lastTick = now; ticks++; }, 5);
  try {
    const native = await timed(() => createUsageDatabaseReader()(dbPath, new Set(), dbHome));
    assert.equal(native.value.records.length, 100000);
    assert.equal(native.value.records.reduce((sum, record) => sum + record.nanoAiu, 0), 100000 * 125000000);
    out.database.asyncRead = { ms: native.ms, ticks, maxTickDelayMs: round(maxTickDelay) };
  } finally { clearInterval(heartbeat); }
  const desktop = path.join(dbHome,'data.db'), desktopDb = new DatabaseSync(desktop);
  try { desktopDb.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT); BEGIN'); const insert=desktopDb.prepare('INSERT INTO sessions VALUES (?,?)'); for(let i=0;i<100000;i++)insert.run('session-'+i,'Synthetic title '+i); desktopDb.exec('COMMIT');}finally{desktopDb.close();}
  out.desktopNames=[];
  for(const count of [1,32,33,1000,100000]) {const ids=new Set(Array.from({length:count},(_,i)=>'session-'+i)); const samples=[];for(let j=0;j<3;j++) {const r=await timed(()=>readDesktopSessionNames(desktop,ids));assert.equal(r.value.size,count);samples.push(r.ms);}out.desktopNames.push({requested:count,tableRows:100000,ms:samples});}
  let processReaderAvailable = true;
  try { await fs.access(path.join(target, 'src/node/copilot-db-process-reader.mjs')); } catch { processReaderAvailable = false; }
  if (processReaderAvailable) {
    const { readDesktopSessionNamesInProcess } = await load('src/node/copilot-db-process-reader.mjs');
    if (readDesktopSessionNamesInProcess) {
      out.desktopNamesAsync = [];
      for (const count of [1, 33, 100000]) {
        const ids = new Set(Array.from({ length: count }, (_, i) => 'session-' + i));
        let ticks = 0, last = performance.now(), maxTickDelay = 0;
        const heartbeat = setInterval(() => { const now = performance.now(); maxTickDelay = Math.max(maxTickDelay, now - last); last = now; ticks++; }, 5);
        try {
          const result = await timed(() => readDesktopSessionNamesInProcess(desktop, ids));
          assert.deepEqual(result.value, readDesktopSessionNames(desktop, ids));
          out.desktopNamesAsync.push({ requested: count, ms: result.ms, ticks, maxTickDelayMs: round(maxTickDelay) });
        } finally { clearInterval(heartbeat); }
      }
    }
  }
  console.log(JSON.stringify(out));
} finally {
  const resolved=path.resolve(temp);
  assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('usage-source-audit-'));
  assert.equal((await fs.lstat(resolved)).isSymbolicLink(),false);
  await fs.rm(resolved,{recursive:true,force:true});
}
