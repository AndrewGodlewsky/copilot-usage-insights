# Credit undercount investigation

## Confirmed fixes in 0.1.79

A user-supplied accounting report identified two reproducible omissions in 0.1.78. Synthetic fixtures reproduced both against the real parser/scanner before changing production code.

**VS Code call identity.** Multiple separately billed `llm_request` spans in one agent turn can share `attrs.responseId`. Using that value as a request key discarded the whole group when its charges differed. Calls now use `(sid, spanId)`. Identical span replays and copied files count once; a conflicting re-log of the same span is still rejected. Historical totals can rise substantially after a refresh.

**Conversation compaction.** `session.compaction_complete.data.compactionTokensUsed` can carry normalized Copilot accounting without a separate `session.usage_record`. The parser now retains these charges and tokens as separate compaction metadata. Charges count whether or not the compaction succeeded; a failed operation can still have billed work. Zero, partial and unavailable amounts retain their existing meanings. Legacy token-only payloads are not converted into estimated charges.

The scanner reconciles compactions after ordinary receipts and database fallback:

- A compaction never marks a session as having ordinary receipts, so older sessions keep their database fallback.
- If accepted fallback rows cover a session, those rows retain ownership of that whole session, including compactions. Its journal compactions are not added again, even if model IDs and display names differ.
- Otherwise, deduplicated journal compactions are included. This also preserves explicit charges when no database exists or a database cannot be read.
- Copied and split journals, appends, file replacement/deletion and refresh use the existing scan pipeline. No additional source, scan or background recorder was added.

Compaction charges are not assigned to an individual prompt without reliable links. They remain in totals and the unlinked-call coverage count, but do not invalidate otherwise complete ordinary prompt accounting. The credits-per-prompt tooltip explains this distinction.

## Remaining uncertainty

The report also found database rows absent from journals and WSL SQLite lock errors. Matching those rows by timestamp, amount or model is not a reliable identity rule; distinct calls can share these values. The existing whole-session database precedence remains. We do not claim that these fixes reconcile all account billing.

Opening an actively changing database with `immutable=1` would skip locking and change detection. Independently copying its live database/WAL/SHM files is not a consistent snapshot. Neither workaround was added. Version 0.1.82 instead reads a transaction inside the environment that owns the database, as described below. See SQLite's [immutable semantics](https://www.sqlite.org/uri.html), [WAL constraints](https://www.sqlite.org/wal.html) and [network-filesystem guidance](https://www.sqlite.org/useovernet.html).

The report described dashboard dates as UTC; the dashboard actually uses the computer's **local calendar dates**, including Rolling 30 starting on the local first of the month. Diagnostic timestamps are UTC. Billing comparisons must use matching dates/timezones and product scope. Cloud agents, other computers, deleted logs and unrecorded usage cannot be reconstructed from these sources.

## Diagnostics and next verification

WSL discovery outcomes, completed/failed scan summaries and source warnings now survive reopening in the existing bounded diagnostic files. They retain numeric distribution/home/environment counts, compaction and fallback counts, and sanitized error types/codes, including SQLite's numeric result code. No distro names, paths, raw error messages or usage payloads are persisted. VS Code remains a source within Windows or a WSL environment, not a separate environment option.

On the affected PC, update/restart Copilot, open a new dashboard, then Refresh with All environments selected. Compare the same dates before and after, and export Show logs if history is still missing. The report's projected totals came from that computer's private data; they were not independently reproduced here. No browser/desktop automation or installation was performed during this fix.

Validation: `npm run build` and all 340 tests passed. Regression coverage includes shared response IDs, same-span conflicts, copied/split compactions, zero/partial/unavailable charges, failed-but-billed attempts, database precedence and failures, fast parsing, refresh/file changes, filters, prompt attribution and persisted diagnostic redaction. Independent code review found no blocking issues.

## Follow-up WSL database feedback (0.1.82)

The follow-up report described SQLite lock errors on three WSL homes, rows missing from receipt-bearing sessions, and a remaining difference from approximate November billing. These are separate issues: recovering a database does not prove that its rows can safely be added to existing journal totals. The report's projected gap is not independently verified and its approximate comparison figures do not establish an exact missing amount.

On an explicit SQLite BUSY/LOCKED error for a recognized WSL UNC `session-store.db`, the reader now checks the running-distribution list and invokes that distribution's existing `/usr/bin/python3` directly, without a shell. The standard-library SQLite connection uses `mode=ro`, `query_only`, `trusted_schema=OFF`, and a read transaction so committed WAL rows are visible consistently. Only allowlisted usage columns and existing session name/project metadata are returned; conversation tables are never queried. The same normalizer, provider checks, recorded charges, date filters, and copied-database deduplication apply to local and native reads.

No database, WAL or SHM file is copied, and no package is installed. Separately copying live files can combine incompatible states even if each copy succeeds; an integrity check or retry does not create a coherent snapshot. SQLite documents [consistent backups](https://www.sqlite.org/backup.html), [WAL limitations](https://www.sqlite.org/wal.html), and [risks when copying an active database](https://www.sqlite.org/howtocorrupt.html). Python documents [read-only SQLite URI connections](https://docs.python.org/3/library/sqlite3.html).

The native fallback can be disabled in Settings. Each Windows process has a five-second timeout; a four-second Linux alarm and SQLite query deadline also bound the reader independently of its launcher. Output is capped at 16 MiB and excluded-session input at 2 MiB. The running check avoids intentionally starting stopped distributions, although a distribution can stop between that check and invocation. A missing Python/sqlite3 installation, inaccessible home, oversized export or timeout produces a source warning while journals remain available. Numeric `wslDatabases` scan diagnostics count successful native reads; exported logs omit paths, names, raw subprocess output and error messages. No additional refresh timer or filter-triggered scan is added.

The proposed timestamp/amount match across formats was not adopted. It cannot establish request identity and could both discard distinct calls and double-count replays. Whole-session journal precedence remains: the report's approximately 244 credits from database rows in a journal-bearing session are **not** automatically added. Repeated cumulative session snapshots also remain excluded from additive totals; their maximum does not establish the incremental charge, date or model for the missing calls. Cloud work, another computer, retention gaps and unsupported local records are possible explanations for differences, not confirmed causes. The dashboard footer now states this coverage limitation.

Verification uses synthetic databases and journals, including committed but uncheckpointed WAL data, read-only write rejection, no conversation payloads, zero charges, journal precedence, scanner refresh, failures, opt-out persistence and cache invalidation. Live Windows-to-WSL behavior and the affected computer's totals still require a manual refresh there. In Local data sources, look for the native-read message or warning; compare a known older session and export Show logs if needed.

Release checks: `npm run build` succeeded; `npm test` passed 343 tests with no failures. One POSIX-only alarm test is skipped on Windows and runs on the Linux/macOS CI jobs when Python 3 is available. The actual WAL export and SQLite query-cancellation tests passed locally. Independent review found no remaining blockers after adding the Linux-side deadline.
