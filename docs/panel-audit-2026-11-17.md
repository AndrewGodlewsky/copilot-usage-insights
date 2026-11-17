# Panel audit — 2026-11-17

Measured rendering costs were removed without changing the displayed data: hidden dashboard charts no longer rebuild during interactions on other tabs, and repeated movement over the same tooltip reuses its markup and measured size. Large session selectors also defer their options until opened, and the panel decodes the compact report transport before rendering. No exploitable HTML injection was confirmed in the reviewed panel paths. This is a source and synthetic VM review, not a browser penetration test or a frame-rate measurement.

## Reproduce the measurements

From the repository root, run:

```powershell
npm run build
node scripts/benchmark-panel-scale.mjs
```

The benchmark uses generated records only: 2,000 projects, 20 models, 2,000 sessions, and ten day-selection toggles while Usage is visible and the remembered Breakdown grouping is Projects. It uses the same VM DOM fixture as the panel tests. Each mode warms once, then reports the median of three samples. It does not open a browser, read Copilot history, invoke an SDK, or make network requests.

The comparison reconstructs the earlier behavior **in memory** from the current bundle by restoring the two unconditional render calls and bypassing the tooltip cache. Other changes made during the broader audit are identical in both modes. It does not modify the generated panel or claim a complete old-release versus new-release benchmark.

Observed on Windows with terminal Node v24.22.1 after the final rendering changes:

| Measurement | Reconstructed earlier behavior | Current behavior |
| --- | ---: | ---: |
| Ten day toggles, JavaScript time | 299.00 ms | 20.76 ms |
| Hidden Breakdown rewrites | 10 | 0 |
| Hidden Efficiency summary rewrites | 10 | 0 |
| Breakdown markup generated per rewrite | 1,541,695 characters | 0 |
| Counted `innerHTML` writes during toggles | 250 | 120 |
| 1,000 moves over one tooltip, JavaScript time | 2.80 ms | 0.98 ms |
| Tooltip markup replacements | 1,000 | 1 |
| Tooltip dimension reads | 2,000 | 2 |

The day-toggle JavaScript time fell about 93% in this fixture. Timing will vary by machine and workload. DOM counts exclude fixture properties with existing non-configurable setters. Dimension getters count operations; they do not simulate layout, paint, CSS, accessibility-tree work, or browser memory use.

The same script separately isolates the Usage chart guard: it restores only that guard's earlier behavior, retains the other improvements, uses the default Models grouping, and changes the metric ten times while another dashboard is visible. The shared skyline header continues rendering in both modes.

| Visible dashboard | Earlier JavaScript time | Current JavaScript time | Hidden Usage chart writes |
| --- | ---: | ---: | ---: |
| Breakdown | 21.55 ms | 9.68 ms | 60 → 0 |
| Efficiency | 23.97 ms | 11.25 ms | 60 → 0 |

These measurements count the daily, calendar, rhythm, token, model, and project charts. The shared header is intentionally excluded. This change reduced JavaScript time about 55% and 53% respectively in the fixture.

## Changes and preserved behavior

`renderContent` calls `renderBreakdown` only when Breakdown is active and `renderEfficiency` only when Efficiency is active. Opening a view still renders from the latest report. Refresh, changed filters, number formatting, coverage dismissal, nested request/session expansion, and local subsection navigation retain their behavior. Efficiency inspection links still open and filter Breakdown; token context links still open the captured-context subsection.

Usage-specific charts and their focus restoration run only while Usage is active. Shared header credits, the skyline, filters, coverage, sources, update times, and an open Activity dialog still update on every relevant render. Range changes update the shared skyline on every dashboard; unchanged responses still update its day/night scene. Returning to Usage regenerates its charts from current data and formatting.

The tooltip caches escaped markup and dimensions using its serialized data, number format, text size, and viewport dimensions. Every pointer move still updates placement. Changes to any cache key regenerate the content and remeasure it. Existing viewport clamping, edge flipping, keyboard focus, blur, and dismissal tests still pass.

The existing test-only `mountPanel` helper was moved into `tests/fixtures/panel.mjs` so the benchmark and tests use one fixture. Tests that inspected hidden content now open the corresponding tab first. Cross-view tests visit each relevant tab before inspecting its current contents.

When more than 1,000 sessions are available, the closed filter mounts only All sessions and the selected session. Opening Filter usage mounts every available session without another request. Collapse preserves the selection. Programmatic Efficiency inspection mounts its target option before assigning the native select value. The report still contains every session.

The panel requests `compact: true` for report endpoints and decodes the response before applying filters or rendering. The shared codec accepts legacy reports, checks its version and table shape, restricts reconstructed keys to fixed report-field allowlists, and rejects malformed compact data. Tests parse synthetic compact responses inside the VM's own realm to model browser `response.json()` accurately; the production plain-object validation was not weakened to accommodate test objects.

## Security review inventory

| Reviewed source | Boundary and result |
| --- | --- |
| `src/panel/panel.js` | API responses, prompts, source paths, model/project/session names, inventory metadata, settings errors, diagnostics, release notes, and review output into DOM, clipboard, or downloads. Dynamic text uses `esc`, `textContent`, or textarea values. Local event routing and selectors use fixed topic IDs, report indices, or normalized date IDs. Review prose is not interpreted as executable markup. |
| `src/panel/charts.mjs` | Report values and labels into SVG, tooltip JSON, titles, and data attributes. Labels and tooltip attributes are escaped. Coordinates are numeric computations; IDs and palette values at current call sites are internal constants. Exported drawing helpers are not general sanitizers for arbitrary colors or IDs supplied by future callers. |
| `src/panel/art.mjs` | Locally generated decorative SVG. Scene choices, geometry, and palette are internal values; no external executable assets. |
| `src/panel/efficiency.mjs` | Report/context statistics into review text and tool summaries. No execution or markup interpretation of prompt text. |
| `src/panel/review-cards.mjs` | Validated AI card fields into HTML. Prose is escaped; confidence levels map to fixed gauge states and geometry. |
| `src/panel/context-growth.mjs` | Session/project/model labels and trend measurements into controls, HTML, and SVG. Labels and IDs are escaped; chart geometry comes from numeric calculations. |
| `src/panel/conversations.mjs` | Conversation summaries, counts, and recorded examples into HTML. Display strings are escaped or locally authored; event/button keys are fixed or numeric. |
| `src/panel/token-insights.mjs` | Report statistics into token summaries and local navigation. Dynamic labels are escaped; jump topics are fixed internal IDs. |
| `src/panel/token-topics.mjs` | Topic configuration, context labels, measurements, and instructional copy into HTML/SVG. External labels are escaped and icons/topics are internal constants. |
| `src/panel/panel.html` | Static controls, dialogs, external links, and build placeholders. External links are fixed repository destinations; generated release data is escaped by the build. |
| `src/panel/panel.css`, `src/panel/review-desktop.css` | Styles, tooltip sizing, and decorative animation. No remote stylesheet imports or remote asset fetches were found. |
| `src/core/report-wire.mjs` | Shared compact transport boundary. Fixed field/key allowlists, duplicate/unknown-key rejection, exact column counts, bounded omission indices, and an explicit version prevent arbitrary property reconstruction. This is a format decoder; the server's report normalization remains responsible for the meaning of measurements. |

The broader server audit covers the loopback bearer endpoint, Host/Origin restrictions, CSP, request limits, data normalization, path restrictions, and AI isolation. These remain part of the trust chain; the panel does not independently authenticate arbitrary fabricated report objects. A future feature accepting dynamic SVG colors, IDs, HTML, or URLs must revisit that boundary.

## Verification and remaining limits

The following synthetic suite passed 184 tests with no skips or failures:

```powershell
node --test tests/panel.test.mjs tests/charts.test.mjs tests/conversation-panel.test.mjs tests/conversation-focus.test.mjs tests/context-growth-panel.test.mjs tests/token-topics.test.mjs tests/review-cards.test.mjs tests/efficiency.test.mjs tests/efficiency-review.test.mjs
```

New focused tests check zero hidden Breakdown/Efficiency writes during repeated Usage interactions, zero hidden Usage chart writes on other dashboards, late opening after a changed report, shared skyline range/clock updates, programmatic subsection navigation, tooltip invalidation for changed content, viewport, number formatting, and text size, compact response decoding, and deferred selection of all 1,001 synthetic sessions. Existing tests exercise escaped hostile labels, prompts, inventory metadata, review text, expanded navigation, keyboard focus, refresh recovery, and chart placement. Server wire/cache tests separately cover legacy responses, alternating wire formats, unchanged revisions, filter changes, oversized responses, count/byte eviction, concurrent build reuse, and cleanup after failed version checks.

Visible top-level Breakdown tables can still be large. An active Efficiency view still refreshes several hidden subsections. The final Efficiency fixture takes about 1.1 ms per render including the common header; it does not demonstrate a substantial remaining subsection cost, so this review does not add subsection invalidation machinery. A remembered large Context Growth detail or other workloads can cost more and were not benchmarked here. Nested tables already have pagination; extending that behavior to top-level rows would require a separate feature and interaction review, tracked in [issue #8](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/8).

The follow-up also guards asynchronous Breakdown rendering. A drilldown finishing after navigation now retains its result or error without rebuilding the hidden table; returning to Breakdown displays it without another request. Two regressions reproduced the unnecessary redraw before the fix and verify successful and failed completion afterward. This saves the hidden rebuild without cancelling requested work or changing available data.

No desktop/browser UI was controlled, no real history or prompt files were read, and no paid AI inference was performed. Actual browser smoothness, embedded-host rendering, high-DPI/font changes, and memory retention still need manual verification in the supported host. The terminal Node version used for these measurements is not evidence of the embedded Copilot runtime version or its patch status; see `SECURITY.md` for the dated runtime baseline and update procedure.
