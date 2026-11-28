# Usage sorting and borderless hover

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

**Goal:** Add right-aligned sort dropdowns to Usage's Models and Projects cards, matching Skills, and remove daily column hover outlines.

**Design:** Reuse `detail-sort` styling and `sortActivity` to sort a copy of all available choices before applying the existing 8/10 row limits. Models: Tokens, AI credits, Model turns, Name. Projects additionally offers User prompts. Default to Tokens descending; names ascending, numeric ties by name, missing values last. Preserve selected choices outside the visible limit and independent selection/filter state. Model bars continue to represent tokens. Sort changes render loaded data with no request or scan; selections survive refresh while the dashboard is open. Preserve daily hover enlargement, muting, tooltips, and keyboard focus outlines.

**Files:** Panel HTML/JS/CSS; panel tests; README/release notes/four manifests/generated panel at 0.1.60.

- [x] Add a focused UI test for all sorts, limits, missing values, selected choices, refresh, and no extra fetches; observe failure.
- [x] Add both controls, reuse the existing sorting helper, and delete the hover-outline rule.
- [x] Build/test and review. Check controls and real hover/focus in Brave at narrow/wide widths and both themes; prepare the main release.

**Review focus:** Sorting precedes truncation, unknown values do not outrank zero, sorting does not mutate the report or remove an active selection, and the remaining keyboard outline does not appear on ordinary mouse hover.

**Verification:** Build and all 193 tests passed. Synthetic Brave checks covered all sort options, alphabetical ordering, zero requests while sorting, right-aligned controls at 360px/1200px with small/large text, both themes, outline-free pointer hover with enlargement, and preserved keyboard focus/Enter behavior. Inspected wide and narrow screenshots. Copilot desktop testing remains with the user.

**Review fixes:** A report can store an unavailable token total as zero with `knownTokenRequests: 0`. Added a failing regression using generated report rows, then normalized that state only for sorting so recorded zeros precede unavailable totals in both lists. All tests passed after the fix. Corrected release-copy punctuation before rebuilding. No accounting or filtering logic changed.
