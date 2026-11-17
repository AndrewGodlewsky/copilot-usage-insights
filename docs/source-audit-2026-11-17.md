# Source ingestion audit - 2026-11-17

The source review fixed repeated reads of unchanged archived databases, a desktop-title lookup cliff, and database input paths that could exhaust or block the main process. Recorded charges, journal precedence, source warnings, copied-session reconciliation, and all-history access remain intact. No history cutoff, sampling, or feature removal was enabled.

The baseline is commit `93117a6`, version `0.1.110`. Measurements used Node `v24.22.1` on Windows x64, synthetic temporary directories, and sequential benchmark processes. No personal histories, installed plugin, browser, paid inference, or WSL distribution startup was used. Timings are local observations, not service-level guarantees. Heap figures mean garbage-collected retained V8 heap, not peak memory or total process RSS.

## Changes and evidence

| Finding | Change | Evidence |
| --- | --- | --- |
| Every refresh reread an unchanged SQLite database and normalized every row. | Cache a completed database result only when its resolved local file identity, size, nanosecond modification/change times, and receipt-session set are unchanged before and after the read. Forced reads bypass the cache; disabled/deleted sources evict it. | 100,000-row warm scan median fell from 839.5 ms to 96.6 ms. Cache tests cover edits, force, disabling, receipt precedence, and a change during the read. |
| WAL publication cannot safely be inferred from main-file or WAL metadata alone. | Bypass this cache whenever a WAL or rollback-journal sidecar exists, and for UNC paths. Never copy a live database/WAL/SHM set. | Tests cover WAL-only commits, checkpoints, WAL creation/removal, and transition back to a cacheable closed database. Active WAL reads retain their cost. |
| Selecting 33 titles from 100,000 sessions abruptly switched from indexed lookups to reading the entire table. | Use indexed lookup for small subsets; keep a single table pass for sufficiently large selections. Preserve duplicate-ID, non-text-ID and collation fallback behavior. | Median for 33 requested titles fell from 92.6 ms to 2.7 ms; 1,000 titles fell from 88.8 ms to 25.4 ms. Existing names/collation tests and new selective-lookup tests pass. |
| A small database could substitute an expensive view for an expected table. | Only query ordinary expected tables; reject views and virtual tables, including commented declarations. Read usage and session metadata within one read-only transaction. | A 4,096-byte recursive view exhausted a bounded 128 MiB baseline child in about 620 ms. The guarded reader returned an unsupported-schema warning in 63 ms including process startup. |
| A valid large query still blocked the main JavaScript event loop. Native SQLite work could outlive `Worker.terminate()`. | Read uncached local usage databases in a short-lived child process, one local child at a time, with cancellation, a deadline, and bounded protocol output. | 100,000 rows match the synchronous reference exactly. The old direct call blocked a timer for 550 ms; the asynchronous read allowed 108 five-millisecond heartbeat ticks, with an 18.2 ms maximum observed gap. |
| Non-text optional `cwd` or repository metadata could throw and hide otherwise valid usage. | Treat invalid optional text as unknown while retaining valid charges. | BLOB/numeric metadata tests retain both valid charges and correctly count a separate invalid timestamp. A failed database source also preserves its own journal and another readable source. |
| Optional desktop title queries could block the event loop even after selective lookup improved throughput. | Reuse the disposable database child for title lookup, skip process startup when `data.db` is absent, and preserve title precedence and fresh renames. | All 100,000 title entries match the synchronous reference. A locked title read is cancellable; existing corrupt/missing/locked/title-precedence tests pass. |
| VS Code metadata retained entries after a workspace or source disappeared. | Evict metadata not encountered in the completed discovery, plus missing/invalid metadata files. | Tests preserve unchanged cache hits, then prove removed, disabled and excluded workspaces reread their metadata when reintroduced. |

Cached record objects are shared with the canonical scanner snapshot rather than keeping a second transformed copy. Session-name and cache bookkeeping still cost memory: the isolated 100,000-row database retained 87.6 MiB after the change versus 61.7 MiB before, an observed increase of 25.9 MiB. A temporary retention probe attributed about 9.9 MiB to cached session-name entries and 0.9 MiB to the records array; those figures do not explain every GC/string-layout difference. This is an explicit speed/memory tradeoff, not a memory optimization.

## Realistic journal scale

The existing synthetic generator writes receipts, prompts, tool activity, skills, delegated work, long identifiers, and large unused text payloads across 180 days. Seed 7 and 2,000 empty session directories were used. The 50k fixture generated 50,009 receipts in 1,697 journal files (1,814.8 MiB); the 100k fixture generated 100,012 receipts in 3,385 files (3,623.9 MiB). The benchmark holds back part of the largest journal and appends it in stages. Both revisions returned the same 50,005 and 100,008 requests at the measured report stage.

Cold scan and first report are single samples. Warm scans, filter builds and most HTTP refresh results are medians of three; append scan/report results are medians of four. Generation time is excluded. These fixtures contain journals rather than a large SQLite fallback database, so they do not measure the database-cache improvement.

| Measurement | 50k baseline | 50k updated | 100k baseline | 100k updated |
| --- | ---: | ---: | ---: | ---: |
| Cold scan | 3,751.1 ms | 4,392.6 ms | 7,293.6 ms | 7,278.2 ms |
| Cold throughput | 483.8 MiB/s | 413.1 MiB/s | 496.9 MiB/s | 497.9 MiB/s |
| Retained scanner heap | 209.9 MiB | 209.9 MiB | 417.6 MiB | 417.7 MiB |
| Heap per generated request | 4,401 B | 4,401 B | 4,378 B | 4,379 B |
| Unchanged scan | 66.9 ms | 84.4 ms | 101.6 ms | 101.8 ms |
| First all-history report | 543.8 ms | 540.5 ms | 1,058.9 ms | 1,001.0 ms |
| Append scan, active journal 8.1 MiB | 76.4 ms | 92.0 ms | 119.6 ms | 120.1 ms |
| All-history report after append | 229.2 ms | 241.6 ms | 446.3 ms | 423.0 ms |
| HTTP recent data first observed | 1,232.4 ms | 1,358.9 ms | 2,264.0 ms | 2,157.2 ms |
| HTTP first complete 7-day response | 5,101.2 ms | 5,588.3 ms | 9,782.6 ms | 9,342.7 ms |
| HTTP switch to all history | 227.6 ms | 215.4 ms | 414.8 ms | 464.3 ms |
| HTTP switch back to 7 days | 7.0 ms | 6.6 ms | 10.6 ms | 8.4 ms |
| HTTP unchanged refresh, 7 days | 66.7 ms | 69.2 ms | 116.1 ms | 106.4 ms |
| HTTP unchanged refresh, all history | 70.8 ms | 76.2 ms | 96.4 ms | 96.9 ms |
| HTTP activity refresh, all history | 456.7 ms | 384.3 ms | 741.7 ms | 715.4 ms |
| HTTP activity refresh, 7 days | 292.5 ms | 316.6 ms | 532.7 ms | 504.8 ms |
| Retained server heap | 204.5 MiB | 204.5 MiB | 405.2 MiB | 404.8 MiB |

There is no demonstrated broad journal-scan speedup: the updated 50k cold sample was 17.1% slower, while the 100k sample was effectively unchanged. Different disk/cache/GC runs vary; these measurements do not isolate a cause for the 50k difference. The demonstrated ingestion improvement is the isolated database/title work below. Unchanged HTTP responses remain below 1 KiB; no report data was dropped to obtain that result.

| Filter/report operation | 50k baseline | 50k updated | 100k baseline | 100k updated |
| --- | ---: | ---: | ---: | ---: |
| 1 day | 67.1 ms | 84.4 ms | 127.6 ms | 120.4 ms |
| 7 days | 69.7 ms | 75.8 ms | 131.7 ms | 122.9 ms |
| 30 days | 73.7 ms | 91.9 ms | 166.5 ms | 145.6 ms |
| 90 days | 106.9 ms | 126.1 ms | 233.3 ms | 200.8 ms |
| All history | 145.6 ms | 174.9 ms | 299.2 ms | 275.1 ms |
| One model | 76.0 ms | 81.9 ms | 133.8 ms | 126.0 ms |
| One project | 64.4 ms | 68.0 ms | 134.4 ms | 125.1 ms |
| Model-session page | 16.1 ms | 18.6 ms | 30.4 ms | 31.3 ms |
| Session-request page | 4.9 ms | 3.7 ms | 7.7 ms | 7.5 ms |
| Session-model detail | 28.1 ms | 33.7 ms | 58.5 ms | 59.8 ms |
| On-demand prompt read | 28.4 ms | 27.4 ms | 27.1 ms | 23.2 ms |

At 50k, the measured 7-day/30-day/90-day/all/model/project request counts were 1,499/8,096/25,133/50,005/12,381/6,601. At 100k they were 3,427/16,576/49,761/100,008/24,119/13,267. Each matched the corresponding baseline. Independent fixed-date scale tests also compare exact totals, missing fields, credits, coverage, prompt attribution, tools, skills and drilldown results against the generator's separately accumulated truth.

## Isolated database and integrity cost

The database fixture has 100,000 usage rows and 100,000 session metadata rows, occupying 15,335,424 bytes. Warm results are medians of three. These are synthetic local-disk observations; active WSL or network filesystem performance was not measured.

| Operation | Baseline | Updated |
| --- | ---: | ---: |
| Cold database-only scanner | 824.7 ms | 1,341.5 ms |
| Unchanged database scanner | 839.5 ms | 96.6 ms |
| Retained scanner heap | 61.7 MiB | 87.6 MiB |
| Exported synchronous reference reader | 548.3 ms | 550.0 ms |
| Read with all usage suppressed by journal receipts | 201.3 ms | 205.2 ms |
| Desktop titles: 1 selected of 100,000 | 0.6 ms | 0.6 ms |
| Desktop titles: 32 selected | 1.3 ms | 1.2 ms |
| Desktop titles: 33 selected | 92.6 ms | 2.7 ms |
| Desktop titles: 1,000 selected | 88.8 ms | 25.4 ms |
| Desktop titles: 100,000 selected | 150.4 ms | 143.1 ms |

The final asynchronous database call took 1,222.2 ms. Process startup, JSON encoding/decoding and transfer add latency compared with the 550 ms synchronous reference. The main event loop remains available during that work, and the child can be terminated during native SQLite operations. No claim is made that moving the read to a process increases cold throughput. Active WAL databases pay this uncached-read cost on refresh.

After extending the same child protocol to optional desktop names, a final confirmation measured the database-only cold scan at 1,307.5 ms, warm median at 114.5 ms, and retained heap at 87.6 MiB. Its asynchronous database read took 1,137.5 ms with 101 heartbeat ticks and a 17.5 ms maximum gap. These separate samples show timing variation; the same cache-hit and exact-result invariants held.

The desktop numbers in the main table measure the synchronous query algorithm. The actual scanner now invokes it in the child. Final title-process measurements were:

| Requested titles from 100,000 | Synchronous median in that run | Child call, one sample | Main-loop maximum heartbeat gap |
| --- | ---: | ---: | ---: |
| 1 | 0.9 ms | 52.9 ms | 15.8 ms |
| 33 | 3.9 ms | 54.6 ms | 18.6 ms |
| 100,000 | 182.8 ms | 273.6 ms | 18.3 ms |

Process startup therefore adds about 50 ms for a small title lookup. It is accepted to make native lock/query work cancellable and keep the event loop available. Title lookups run sequentially after usage reads, preserving one active local database child per scanner. They use no new persistent cache, so fresh desktop renames and existing workspace/database/desktop precedence remain visible. Missing `data.db` files return without launching a process. An isolated title-process failure keeps accounting and available fallback names and reports a metadata warning.

An active 256 MiB journal demonstrates a separate retained cost. Appending a 226-byte receipt hashes all 268,468,449 bytes of the previous prefix before accepting the append. Baseline append runs took 136.6/131.8/130.3 ms; updated runs took 114.0/114.6/117.7 ms, with the same full-prefix work. The parser reads only the new receipt after verification. A quiet unchanged journal took 0.9 ms before and 0.8 ms after. Full-prefix verification is intentionally retained: tail sampling or trusting size/mtime after growth cannot detect arbitrary edits to earlier receipts while preserving the same copied/replaced-file guarantees.

## Process bounds and graceful failure

The actual scanner uses the asynchronous database seam for usage and optional desktop titles. Synchronous exported readers remain available as test/reference APIs and are not execution sandboxes. The usage child reads a read-only coherent transaction and streams at most 1,000 records per JSON message. The parent does not parse one enormous JSON document.

| Resource | Limit/behavior |
| --- | --- |
| Local reader concurrency | One local child per reader; queued cancelled work does not launch |
| Deadline | 30 seconds for local reads; scanner cancellation kills the child and waits for close |
| Input | 32 MiB of serialized file/source/receipt-session parameters |
| Output | 512 MiB total; 8 MiB per JSON message |
| Normal Node child V8 heap | 1 GiB via `--max-old-space-size=1024`; this is not a native allocation or RSS limit |
| Embedded Copilot child | Uses the existing extension-bootstrap convention; host memory limits apply because Node CLI flags cannot be assumed |
| Completion | Explicit exit after final output flush, including error paths, so retained host handles cannot keep it alive |
| Over-limit/timeout/malformed source | Reject the entire database result, report a source warning, retain journals and other readable sources; never expose partial database totals as complete |

The 100,000-row process test compares every returned field to the synchronous reference after excluding 100 journal-covered rows. The main loop ticks during the read. Locked-database cancellation at 100 ms releases the process and a succeeding read completes; the combined test took about 179 ms. Tests also cover a hard deadline, sequential queue cancellation, a nine-MiB model result rejected with `EFBIG`, and success/failure exit with a deliberately retained timer handle. Ordinary Node execution is verified. **A real embedded Copilot-host launch remains a manual compatibility check.**

The separate WSL fallback retains its existing 2 MiB receipt-input and 16 MiB response bounds, four-second Python alarm/progress deadline and five-second parent timeout. It queries only an already-running distribution, uses argument arrays, isolated Python flags and a filtered environment, and never copies live database sidecars. Python export schema tests run against a local synthetic database; they do not start WSL. The POSIX alarm test is skipped on Windows and remains for Linux/macOS CI.

These controls reduce availability risk; they do not create an OS sandbox. A valid very large ordinary table can exceed the deadline/output/heap bounds. Its exclusion is explicit, so users can distinguish incomplete coverage from zero usage. Optional desktop-title queries keep their one-second SQLite lock timeout inside the cancellable child; title/result memory still scales with the requested names. No finite input benchmark proves that arbitrary history fits RAM.

## Reviewed paths and retained limits

| Modules reviewed | Paths/bounds checked | Remaining cost |
| --- | --- | --- |
| `node/copilot-source.mjs`, `node/read-queue.mjs`, `core/copilot.mjs` | Discovery, recent-first/background scans, forced scans, cached snapshots, journal append/rewrite detection, copied journals, coverage and source failures; 256 KiB reads, 8 MiB journal line limit, 16 concurrent reads | All retained receipt/activity metadata scales with history; active-journal integrity hashing scales with the full prefix |
| `node/copilot-db.mjs`, `node/copilot-db-process*.mjs` | Schema/type boundary, receipt precedence, project/title metadata, transaction lifetime, child cleanup, input/output/deadline failures | Cold process transfer and proportional retained data; synchronous exports are reference APIs only |
| `node/vscode-sources.mjs`, `core/vscode.mjs` | VS Code profile/workspace/log discovery, source provenance, journal parsing and coverage warnings; 50 profiles, 2,000 workspaces per base, 20,000 logs, eight concurrent journal reads; removed metadata eviction | Metadata remains proportional to currently discovered workspaces; discovery counts can still reach the explicit limits |
| `node/wsl-sources.mjs`, `node/wsl-discovery-process.mjs`, `node/wsl-db.mjs` | Running-distro discovery, validated names/UNC paths, filtered environment, bounded subprocesses and native SQLite fallback; 16 distributions and 64 users | Remote filesystem latency and actual embedded/WSL behavior require manual checks; active WAL is deliberately uncached |
| `node/source-paths.mjs` | Normalized source identity, environment attribution, case/path boundaries | Explicitly configured source homes are trusted inputs, not a filesystem sandbox |
| `scripts/benchmark-performance.mjs`, `scripts/synthetic-history.mjs`, `scripts/benchmark-vscode.mjs` | Synthetic generation, independent expected counts, cold/warm/append/filter/HTTP measurement scope and temporary cleanup | OS caching affects timing; browser layout/paint is outside these harnesses |

Session metadata YAML remains bounded to 64 KiB with the configured depth/alias limits. Prompt text is read on demand rather than retained as part of statistics. Closed or replaced files release their handles; the scanner retains compact parsed metadata, not an open descriptor for every session. The recent-first server path can show provisional recent data while complete history continues; it does not label the partial result as complete. Changing filters uses the in-memory snapshot; explicit refresh verifies sources. See the [main review](security-performance-review-2026-11-17.md) for HTTP authorization, pause/cancellation integration and packaging, and the [report audit](report-scale-audit-2026-11-17.md) for aggregation and large response costs.

## Proposed tradeoffs, not enabled

The existing `--skip-unused` experimental parser path reduced the single 50k cold sample from 3,751.1 ms to 3,214.4 ms (14.3%) and complete initial HTTP loading from 5,101.2 ms to 4,292.1 ms. Retained heap stayed 209.9 MiB. It can miss malformed JSON diagnostics in unused event types that resemble a valid envelope; a regression test documents that coverage loss. The production path continues to parse those lines fully. This is a quantified proposal requiring an explicit decision, not a silent optimization.

Discarding old records or prompt/tool timelines could reduce memory but would remove all-time filtering, drilldowns or attribution evidence. No isolated benefit was measured, so no percentage is claimed and no such feature was removed. A validated persistent index, demand-loaded archive or more compact retained representation could preserve access but would need a separate storage/invalidation design. Sampling historical prefixes would weaken rewrite detection; its measured cost alone does not justify changing accounting integrity.

## Verification and reproduction

After the final title-child and metadata-eviction changes, all 36 targeted database/schema/cache/title/VS Code tests passed. The earlier 100k independent scale run plus cache/schema/fast-path/WSL suites passed 44 tests with one POSIX-only skip. Final repository-wide build/test results belong to the main review; these local results do not substitute for that check.

Regression coverage read or extended includes `copilot.test.mjs`, `vscode.test.mjs`, `scale.test.mjs`, `fast-paths.test.mjs`, `recent-loading.test.mjs`, `session-names.test.mjs`, `coverage.test.mjs`, `wsl-db.test.mjs`, `wsl-sources.test.mjs`, the three new `database-*.test.mjs` files, and `vscode-cache.test.mjs`. Cache tests additionally verify full-result identity reuse and selective title-query behavior, not only monetary sums.

Run from the repository root with an otherwise idle machine. Use an unused sibling path for the detached baseline checkout. The benchmark scripts only create synthetic temporary homes and check their resolved cleanup paths before recursive deletion. Do not run the benchmark's unrelated `--local` mode to reproduce this review.

```powershell
git worktree add --detach ../usage-audit-baseline-93117a6 93117a6
$baselineRepo = '../usage-audit-baseline-93117a6'
node --expose-gc scripts/benchmark-sources.mjs "--repo=$baselineRepo"
node --expose-gc scripts/benchmark-sources.mjs
node scripts/benchmark-database-safety.mjs "--repo=$baselineRepo"
node scripts/benchmark-database-safety.mjs

foreach ($count in @(50000, 100000)) {
  node --expose-gc scripts/benchmark-performance.mjs "--repo=$baselineRepo" --scale "--records=$count" --payload=realistic --seed=7 --empty=2000
  node --expose-gc scripts/benchmark-performance.mjs --scale "--records=$count" --payload=realistic --seed=7 --empty=2000
}
node --expose-gc scripts/benchmark-performance.mjs --scale --records=50000 --payload=realistic --seed=7 --empty=2000 --skip-unused

$env:USAGE_SCALE_RECORDS = '100000'
node --test tests/scale.test.mjs tests/database-cache.test.mjs tests/database-schema.test.mjs tests/database-process.test.mjs tests/fast-paths.test.mjs tests/wsl-db.test.mjs tests/wsl-sources.test.mjs tests/session-names.test.mjs tests/vscode.test.mjs tests/vscode-cache.test.mjs
Remove-Item Env:USAGE_SCALE_RECORDS
```

The safety benchmark runs the potentially expensive baseline view in a disposable child with a two-second timeout and 128 MiB V8 heap limit. A heap-failure result is the intended reproduction; the plugin host and main benchmark process are not used to run that unbounded query.
