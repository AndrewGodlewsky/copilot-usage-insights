# WSL usage sources implementation plan

**Goal:** Include accessible Copilot CLI histories in Windows Subsystem for Linux alongside Windows histories, using the existing accounting pipeline.

**Architecture:** On Windows, discover registered/running WSL distributions, then readable `.copilot` homes under `/home/*` and `/root`. Pass those homes to the existing incremental scanner. Source warnings explain stopped/unreadable distributions; no accounting estimates or cloud calls. A default-on setting controls automatic discovery, and existing additional/disabled homes support custom paths.

## Constraints and decisions

- User requested planning and implementation; implement directly in the existing worktree. No browser/desktop control, plugin installation, or paid requests.
- Enumerating WSL must be bounded, hidden, and shell-free. Do not deliberately start stopped distributions or inspect Docker-managed distributions. A distribution can stop between enumeration and filesystem access; Windows controls UNC mounting.
- Discover standard homes without recursive filesystem searches. Custom `COPILOT_HOME`, custom Linux home directories, and distributions not accessible to the current Windows account need a manually supplied home.
- Preserve provider attribution, request identities, copied-log deduplication, filters, and source disablement. WSL paths are case-sensitive below the distribution; `wsl$` and `wsl.localhost` identify the same root.
- Reuse existing scan/report caches: changing a date/model filter or expanding a row must not rerun discovery. Initial loading and refresh rediscover sources.
- Stopped sources are not counted, including after restart; warn instead of silently implying complete totals. This release does not persist historical copies.
- Native VS Code Chat debug logs are **not** CLI `events.jsonl`. Do not import them without a separate schema/attribution/overlap adapter. Record evidence and the next-stage requirements in `docs/wsl-sources.md` and explain the limit in Settings.

## Tasks

1. Add a tested WSL discovery module: UTF-16/UTF-8 command output, safe distribution names, unavailable WSL, running/stopped states, home enumeration, bounds/timeouts, no Docker probes, and sanitized diagnostics. Add shared source-path identity handling for UNC aliases and Linux case sensitivity.
2. Integrate discovered roots and warnings into the existing scanner; skip disabled roots before access, preserve source order and caches, test native + WSL-fixture sums, replay deduplication, refresh, disablement, and unchanged reports.
3. Add default-on `includeWsl` Settings support and a checkbox with scope/help text; changing it invalidates the source cache. Tests cover saved configuration, UI save/load, and no discovery on normal report filtering.
4. Document verified scope, manual UNC paths, stopped-distribution behavior, and the VS Code follow-up. Bump to 0.1.77 with all release metadata, README and bundled notes. Run build, full tests, review, then push main under existing release authorization.

## Review focus

- No guessed charges or double counting when copied histories appear in multiple homes.
- Windows path case folding must not merge different Linux homes or defeat disabled paths via UNC aliases.
- WSL absence, command failure, inaccessible homes, stopped distributions, and slow discovery must leave Windows usage usable and diagnostics honest.
- Selecting filters must reuse history, and changing source settings must invalidate it.
- Standard WSL Copilot CLI support must not be presented as support for all VS Code Chat history or remote machines.

## Verification record

- Initial local inspection: only Docker Desktop is registered, with no running distributions. No real WSL Copilot history is available here; validate ingestion using synthetic homes and mocked discovery, and ask the user to verify their other computer.
- Existing source discovery lacks WSL enumeration; the new integration test must fail on that missing path before implementation.
- Observed the new combined-history test fail before scanner integration: Windows-only totals were 110 tokens/1 credit, versus the expected Windows + WSL fixture totals of 320 tokens/3 credits. It passes after integration, including copied receipts, incremental append, source disablement, and cache reuse.
- Review found that Promise.race alone leaves timed-out UNC reads in Node's shared filesystem pool. Production discovery now runs in a disposable process and explicitly exits after its result, with a separate overall process deadline. Both installed Copilot bootstrap forms (absolute and embedded) successfully launched the helper without paid inference or account access.
- A follow-up review found that an early failed WSL list command could strand its still-running peer when the helper exited. Discovery now waits for both bounded commands to settle; a delayed-peer regression test verifies cleanup ordering.
- Final verification: `npm run build` passed, `npm test` passed all 318 tests, and `git diff --check` reported no whitespace errors. Live WSL history and desktop UI checks remain for the affected computer; no plugin was installed and no browser/desktop was controlled during development.
