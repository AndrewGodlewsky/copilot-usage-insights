# Aligned Breakdown Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the steps below.

**Goal:** Keep all expanded Usage Breakdown metrics aligned without losing alternating level colors.

**Architecture:** Render expanded metrics as rows in one native table with one header and a shared fixed column layout. Indent only the name cell; keep paging/status rows and original prompts full width. Keep existing fetching, sorting, focus restoration, and expansion state.

**Tech Stack:** Existing vanilla JavaScript, HTML, CSS, Node test runner; no new dependencies.

**Spec:** User-approved design: one shared header, aligned metrics, name indentation, wrapping names, continuous dotted dividers, full-width original prompts, and alternating background colors at every expanded level.

## Constraints and review focus

- Model → session → request → prompt and project → session → model must use the same columns.
- Expansion must not change column widths. Number preferences and text sizes still apply.
- Long names, unavailable values, large full numbers, and narrow canvases must remain readable.
- Paging, loading/errors/retries, refresh, filtering, and keyboard focus retain their behavior.
- Table markup must stay valid; expanded controls expose state and the controlled rows.

## Implementation

- [x] Add focused panel regressions proving a single table/header, ten aligned metric cells per row, alternating depth markers, and full-width details for both hierarchies; run to confirm failure.
- [x] Update the shared renderer in `src/panel/panel.js` to produce row fragments for child levels. Expansion section renderers return header/status content and row fragments. Size numeric columns from the report's formatted totals before expansion.
- [x] Update `src/panel/panel.css`: fixed shared layout, name-only indentation, depth colors, shared borders, and scrolling at narrow widths.
- [x] Adapt existing structure assertions while retaining behavior checks. Build and run panel tests, then full checks. Review changes independently.
- [x] Update README and synchronized package version to 0.1.49, and regenerate `panel/index.html`.

## Verification

- All 175 tests pass; panel syntax, generated build, version consistency, and whitespace checks pass.
- Independent review identified an ARIA target-matching issue; corrected it and added coverage for unique IDs and valid controlled elements.
- Headless Brave with synthetic data verified both hierarchies: every metric column has the same position and width, and expansion leaves the table width unchanged.
- Browser checks passed at 480, 900, and 1600 pixels, with both themes, larger text, wrapped long names, alternating level backgrounds, and full-width prompt details. The default compact-number layout fits the dashboard without horizontal scrolling at full width.
- No additional requests, scans, dependencies, or changes to accounting. Copilot desktop installation is left for user testing.

Delivery follows the existing authorization to commit and push to `main`; preserve the host-managed worktree.
