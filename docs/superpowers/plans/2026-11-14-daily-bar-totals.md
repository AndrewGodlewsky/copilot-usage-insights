# Daily bar totals

**Goal:** Explain the prompt-average asterisk and replace the daily chart's lone maximum label with a total above each day's bar.

**Design:** Keep the existing stacked bars, date labels, tooltip data, and daily selection. Display each day's recorded total using the active unit and number-format setting; partial/unavailable data keeps its current meaning. Days without usage have no numeric label; recorded zero-credit days show zero. Reserve headroom for labels and allow horizontal scrolling when the number of days or full-number labels would overlap. Totals stay inside the chart and use the current text-size setting.

**Scope:** `src/panel/charts.mjs`, scoped chart CSS, chart/panel tests, README, release notes, and synchronized version 0.1.57. The asterisk is explained, not removed: the prompt-average card marks excluded prompt candidates and its existing tooltip provides counts. No accounting or data-source changes.

- [x] Add focused chart coverage for daily totals, units/formatting, incomplete data, dense layouts, and text sizes. Verify new expectations fail before implementation.
- [x] Render totals, remove the maximum label, and keep dates/bars/selectable regions aligned in a scrollable chart.
- [x] Update release documentation and manifests; build/test and verify visual layout/selection in Brave. Review and publish to main under standing authorization.

## Verification

- Three new chart tests failed before implementation; all 27 chart tests then passed. Full suite: 190 passed. Build and diff whitespace checks passed.
- Independent review found no confirmed defects and passed the 27 chart tests independently.
- Headless Brave with synthetic usage: widths 360/1200px, small/large text, compact/full numbers, Today/7-day/90-day ranges. Every total fits inside its chart without overlapping neighbors; wider charts scroll without overflowing the page.
- Real pointer activation on a total, Enter to clear daily selection, token/credit switching, latest-day initial anchoring, and scroll retention through daily selection and tab switches passed. Unit/day changes made no data requests. Light/dark screenshots were inspected.
- The prompt-average asterisk remains unchanged; it indicates excluded candidates, with reasons and counts in its existing tooltip. No personal logs were inspected. Copilot desktop testing remains with the user.
