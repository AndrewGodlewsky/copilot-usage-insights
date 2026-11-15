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

Opening an actively changing database with `immutable=1` would skip locking and change detection. Independently copying its live database/WAL/SHM files is not a consistent snapshot. Neither workaround was added. A future importer for locked WSL databases should use a consistent SQLite backup/export inside the environment that owns the database. See SQLite's [immutable semantics](https://www.sqlite.org/uri.html), [WAL constraints](https://www.sqlite.org/wal.html) and [network-filesystem guidance](https://www.sqlite.org/useovernet.html).

The report described dashboard dates as UTC; the dashboard actually uses the computer's **local calendar dates**, including Rolling 30 starting on the local first of the month. Diagnostic timestamps are UTC. Billing comparisons must use matching dates/timezones and product scope. Cloud agents, other computers, deleted logs and unrecorded usage cannot be reconstructed from these sources.

## Diagnostics and next verification

WSL discovery outcomes, completed/failed scan summaries and source warnings now survive reopening in the existing bounded diagnostic files. They retain numeric distribution/home/environment counts, compaction and fallback counts, and sanitized error types/codes, including SQLite's numeric result code. No distro names, paths, raw error messages or usage payloads are persisted. VS Code remains a source within Windows or a WSL environment, not a separate environment option.

On the affected PC, update/restart Copilot, open a new dashboard, then Refresh with All environments selected. Compare the same dates before and after, and export Show logs if history is still missing. The report's projected totals came from that computer's private data; they were not independently reproduced here. No browser/desktop automation or installation was performed during this fix.

Validation: `npm run build` and all 340 tests passed. Regression coverage includes shared response IDs, same-span conflicts, copied/split compactions, zero/partial/unavailable charges, failed-but-billed attempts, database precedence and failures, fast parsing, refresh/file changes, filters, prompt attribution and persisted diagnostic redaction. Independent code review found no blocking issues.
