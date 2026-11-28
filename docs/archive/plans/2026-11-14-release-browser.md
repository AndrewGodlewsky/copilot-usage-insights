# Release browser redesign

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

**Goal:** Replace the compact release dropdown with a larger panel whose visible navigation makes the history easy to browse. The user authorized interpreting and implementing this design.

**Design:** Reuse the native modal, existing system font, theme colors, and text-size setting. A roughly 1000px-wide, 640px-tall panel has three panes: release families (`0.1.x`), versions in the selected family, and the selected note. Each navigation pane scrolls independently. Current selection has a clear background and edge marker; the installed version is labeled. On narrow screens, families move into a horizontal row above the version list and notes; at phone widths both navigation lists become horizontal rows to keep notes readable. Close stays visible; reopening selects the installed release.

**Approaches:** A single flat sidebar would leave a growing history ungrouped. Nested accordions would hide versions and move nearby items. Separate family/version panes follow the user's suggested hierarchy and keep the notes stationary. Group by major.minor rather than only major because all current versions belong to the 0.1 series.

**Scope:** `src/panel/panel.html`, `src/panel/panel.css`, and `src/panel/panel.js` for the dialog; existing panel tests for local browsing and focus; `AGENTS.md` for mandatory release summaries; README for user guidance. Retain the existing JSON source and build guard. Synchronize the four manifests to 0.1.56 and rebuild the committed canvas. No data pipeline changes, network calls, or dependencies.

- [x] Update the panel test for clickable family/version lists, installed selection, all versions, refresh stability, close/focus, and no requests. Exercise multiple release families using synthetic notes. Verify the missing behavior fails.
- [x] Implement the larger responsive dialog and preserve safe text rendering and offline history.
- [x] Add concise release instructions to AGENTS.md; update README, summary, and version manifests.
- [x] Build, run focused/full tests, inspect both themes and narrow layouts in Brave, and obtain review. Publish to main under standing authorization.

## Verification

- New navigation tests failed on the missing family list before implementation, then passed. Full suite: 187 passed; build, JavaScript syntax, and diff whitespace checks passed.
- Independent review found no runtime blockers. Fixed its test-maintenance finding by deriving the installed family and switching families before iterating historical versions.
- Headless Brave with synthetic usage: all 57 notes, both themes, large text, 360/600/1200px widths, native Tab/Enter activation, Close/Escape focus restoration, all three dashboard tabs, and zero browsing requests passed. Scrolling the navigation keeps the note heading in place.
- Screenshots inspected in light/dark themes and at phone width. The phone layout was revised to keep notes full width. Copilot desktop was not exercised.
