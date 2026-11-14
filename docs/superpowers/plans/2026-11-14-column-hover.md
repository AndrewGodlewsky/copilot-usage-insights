# Daily column hover and repository link

**Goal:** Link the footer product name to its GitHub repository; remove daily value labels and horizontal scrolling; highlight/enlarge only the hovered stacked bar.

**Design:** Restore width-constrained charts while retaining detailed tooltips and daily selection. Replace the full-height day hit rectangle with a transparent shape matching the bar. Scale the column slightly from its bottom center on hover/focus, with a thin outline for hover, selection, and keyboard focus. Empty days retain a small baseline target and keyboard access. Dense bars stay within their slots. Reduced-motion users receive the outline without scaling. Other charts are unchanged.

**Scope:** Chart builder, chart-specific CSS, removal of the added scroll-position handling, footer HTML, focused tests, README, release notes, and four manifests at 0.1.58. Preserve historical release notes.

- [x] Replace total-label tests with fit/tooltip/column-target tests and check the footer URL. Verify failures before changes.
- [x] Implement bar-shaped interaction and remove daily totals/scrolling; update release files.
- [x] Build/test, review, and verify real pointer/keyboard behavior and dense ranges in Brave; prepare the main release.

**Verification:** Build and all 191 tests passed. Synthetic Brave checks passed at 360px and 1200px for Today, 7 days, 90 days, and all history, with small/large text and compact/full numbers. Confirmed no chart/page horizontal overflow, bar-only pointer targeting, subtle enlargement, tooltips, click selection, empty-day keyboard selection, daily credit tooltips on keyboard focus, Escape dismissal, reduced-motion behavior, and the footer repository URL. Chart interactions made no network requests. Inspected light/dark screenshots. Chart tests also cover 500 days.

**Review:** Independent review found keyboard daily values would become unavailable after removing labels. Fixed by showing the existing tooltip on keyboard focus and linking the same values as an accessible SVG description. Re-review found no remaining blockers. Copilot desktop testing is left to the user; no usage-accounting code changed.
