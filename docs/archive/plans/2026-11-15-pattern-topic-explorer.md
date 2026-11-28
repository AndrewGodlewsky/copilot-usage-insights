# Worth a closer look: shared draggable navigation

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

Baseline: `5cae6d0`. User approved using the same compact draggable selection as Where did the tokens go, with section-specific icons. Preserve all eight pattern topics, their order and existing content; Findings remains the initial selection.

- [x] Add distinct decorative icons and replace the pattern dropdown with the existing range/stop/previous-next markup and styles.
- [x] Share the navigation controller between both explorers, preserving stable DOM/focus, changed-selection-only rendering, keyboard controls, programmatic context links and viewport stabilization. Refresh/filter changes must retain both independent selections. No new data requests or inspection.
- [x] Extend synthetic panel/catalog tests; run build and full tests; obtain independent final review.
- [x] Prepare v0.1.98 with synchronized versions/notes/generated assets for main integration under standing authorization. No direct installation or browser/desktop control.

Manual verification: drag/touch feel, themes, focus visibility, narrow panels and larger text.

Verification: new range/icon tests failed against the original dropdown, then passed with the shared explorer. Build passed. Full suite: 451 passed, 1 existing platform-specific skip. All 18 topic mappings, keyboard endpoints, direct clicks, refresh/filter persistence, explicit context navigation and viewport stabilization are covered by synthetic panel tests. Independent final review found no defects. Release versions, bundled notes, unique source IDs and diff whitespace checked.
