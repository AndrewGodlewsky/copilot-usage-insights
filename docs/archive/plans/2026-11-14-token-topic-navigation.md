# Token Topic Navigation Implementation Plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline.

**Goal:** Make all 15 approved token-efficiency topics selectable without stacking their dashboards vertically.

**Architecture:** Add a grouped native section selector inside Where did the tokens go?, defaulting to Overview. Preserve the existing overview, context inspector, cache explanation, and recovery view as individual panels; render other topic introductions and available measurements from the existing report. Only one topic panel is visible. Selection stays local through refreshes and tab changes.

**Tech Stack:** Existing vanilla JavaScript, HTML/CSS, generated standalone canvas, Node tests; no dependencies or backend changes.

**Spec:** User approved all 15 candidate sections, with navigation between them, and intends to develop their detailed dashboards one by one. This increment establishes the sections and uses existing measurements without promising unimplemented attribution.

## Constraints and review focus

- All approved topics remain accessible in a compact, keyboard-operable selector; no long stack or row of 15 buttons.
- Switching topics makes no requests, reads no logs, and invokes no AI. Context inspection remains explicit.
- Keep current-context snapshots separate from historical filters. Unknown measurements are not zero, and overlapping token views are not summed.
- Preserve existing Efficiency tabs, context inspection links, review privacy, settings, and refresh behavior.
- Escape dynamic labels; handle missing data, large text, narrow windows, long strings, and invalid topic choices.

## Tasks

- [x] Add focused navigation and topic-rendering tests; confirm the missing behavior fails.
- [x] Add `src/panel/token-topics.mjs` for the topic catalog and bounded report-based views. Include it in `scripts/build.mjs`.
- [x] Add the selector and single-topic panels in `src/panel/panel.html`; connect selection, rendering, and existing inspector links in `panel.js`; style the compact selector and content.
- [x] Run tests, verify the layout in Brave with synthetic data, and obtain an independent review.
- [x] Update README and synchronized version, and rebuild the canvas for publication.

## Scope of the first increment

Existing report data can introduce context growth, tool definitions, cache reuse, complete prompt charges, reported reasoning, spend concentration, and prompt lengths. Current-context views can point to source attribution. Delegated-work splits, compaction effects, model-transition analysis, and repeated-exploration detection will be clearly marked as not yet measured rather than inferred from unrelated counts.

## Verification

- All 183 tests pass, including navigation, measurement coverage, escaping, and a regression test for focus restoration after refresh.
- Headless Brave checks passed for all 16 choices, keyboard selection, dark and light themes, larger text, narrow layouts, and local navigation with no requests.
- Independent review identified a focus loss on refresh; the fix also preserves focus on resize and was verified in Brave.
- Copilot desktop validation remains with the user. Publication uses the existing authorization to fast-forward and push main.
