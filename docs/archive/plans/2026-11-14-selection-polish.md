# Selection polish implementation plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

**Goal:** Make Usage selections quieter and move the prompt-cost coverage marker into a footnote below Projects.

**Design:** Keep the selected daily column at full color and gently desaturate/fade other columns. Remove the selected-day blue outline, model row backgrounds, and pointer-focus outlines. Keep the existing daily hover enlargement and keyboard focus outlines. Project/model hover cues use an underline without a background change. Remove the prompt-average value's asterisk, keeping its tooltip and showing eligible/excluded counts below Projects when coverage is incomplete. Other accounting indicators retain their meaning.

**Scope:** `src/panel/panel.css`, `src/panel/panel.js`, `src/panel/panel.html`, existing panel tests, README, release notes, four version manifests, generated dashboard. No accounting or filtering changes.

- [x] Extend the existing credit-card test to require an unmarked prompt average and a conditional footnote covering excluded and unlinked work; observe failure.
- [x] Apply the styles and move the prompt coverage marker, preserving zero/unavailable values and filter-dependent counts.
- [x] Verify build and full tests; use synthetic Brave data to check selected/cleared/hover/focus states, both themes, keyboard access, and footnote placement. Review before publishing version 0.1.59 to main.

**Review focus:** Selection clears cleanly; daily muting affects columns only; pointer selection has no model outline but keyboard focus remains visible; project hover does not inherit the generic button background; incomplete prompt coverage stays discoverable and accurate.

**Verification:** Build and all 191 tests passed. Synthetic Brave checks passed in light/dark themes: selected day stays at full opacity, other bars are muted, clearing restores colors, no selected-day border, model hover/selection has no background or pointer outline, project hover underlines without a background, and keyboard focus remains visible. Confirmed the coverage note is below Projects and 90-day charts fit at 360px. Inspected screenshots. Independent read-only review found no issues. Copilot desktop testing remains with the user.
