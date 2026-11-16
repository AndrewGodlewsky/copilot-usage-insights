# Recent-first loading

Implement fresh reads of likely recent journals before older history. No persistent data cache or restored dashboard snapshot. Priority is the last 30 local calendar days, regardless of the selected filter; Rolling 30 remains month-to-date.

1. Add a serialized two-phase scanner operation. File modification times are priority hints only. Read entire candidate journals, emit an immutable provisional snapshot, then verify the remaining history and database fallback. Reuse only file reads validated during the operation; preserve deterministic final accounting. Reuse WSL discovery within the operation. The second phase repeats lightweight directory/stat checks to reuse the existing discovery and ownership rules rather than introducing a second accounting implementation.
2. Serve the provisional snapshot only for ranges wholly within the priority window. Wider ranges return a loading state. Background status requests reuse the same operation and do not start scans. Prompt-cost averages and AI review wait for full attribution.
3. Update the panel in two stages, poll only while loading and visible, preserve filters/focus, and show honest provisional/loading/failure states. Record recent-stage, background-stage, deferred counts, and UI delivery timings in copyable/downloadable diagnostics.
4. Test timestamp boundaries, older files containing recent events, copies, database fallback, refresh/config changes, concurrent requests, failed background work, visibility and eventual equality with the ordinary scan. Build, run the full suite, review and release.

Limit: without reading every file or a previously established index, modification times cannot prove complete date coverage. The early view explicitly says "Recent usage so far"; no phase claims a complete 30-day total before full reconciliation. No prompt text is cached or exported in diagnostics.

Implementation decisions and verification:

- Completed: scanner, API loading contract, dashboard polling, and privacy-filtered timing summaries. Ordinary refreshes after a completed scan retain the single-pass path so unchanged-history checks do not rebuild attribution twice. First loads, changed sources, and failed-operation retries use recent-first loading.
- Ruling: priority uses 30 local calendar days (today and the preceding 29), independent of the dropdown. On the 31st, month-to-date waits for full history because it includes an extra day.
- Synthetic scanner, HTTP, and panel regressions cover provisional/final equality, copied logs, database deferral, refresh coalescing, failure retry, filters, focus, and visibility. Existing source integration tests now explicitly await full history before asserting complete accounting.
- Final independent review found a late inventory response dereferencing a cleared report after a switch to 90 days. Reproduced as a failing test, fixed with a shared render guard, and verified green.
- Benchmark: 1.67 GB / 1,395 files, 140 recently modified. Median recent readiness 498 ms versus ordinary full scan 2,981 ms; full background completion 3,080 ms. See the performance review for limits and reproduction.
- Actual Copilot host responsiveness and the other computer's WSL timing require manual testing. No browser automation or installed-plugin edits were used.
- Release validation: v0.1.101 build passed; full suite 466 passed, one existing POSIX-only skip, zero failures. The existing scale benchmark was updated to await complete reports and separately report recent readiness; its 1,000-record synthetic smoke run passed.
