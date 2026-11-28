# Reviewing Copilot Usage Insights

Usage Insights is a local dashboard for Copilot usage records, with an optional AI review of prepared evidence. Start with the synthetic demo, then follow the source map below. The main review questions are whether the accounting is trustworthy, the data boundaries are clear, and the remaining performance trade-offs are acceptable.

[Documentation index](README.md) · [Project overview](../README.md)

## First look

Use Node.js 24 or later from a local checkout. No npm dependencies, Copilot sign-in, or plugin installation are needed for the synthetic browser demo:

```sh
npm run preview:demo
```

Open the printed localhost URL yourself and stop the server with Ctrl+C. Try a date filter, a model/project breakdown, and an Efficiency view. The generated fixture exercises the real parser. It contains no personal history, and its numbers are examples rather than performance or quality claims. Live MCP/plugin inventory and AI review require the desktop host.

For an initial review, read this page, [SECURITY.md](../SECURITY.md), and the relevant [user guide](README.md#user-guides). Then inspect the source and tests for the area you want to assess.

## How data reaches the dashboard

The desktop entry registers a canvas. Opening it starts a local server; usage and AI-review modules load when requested.

```text
Copilot journals / SQLite / supported VS Code logs
    → source discovery and incremental readers        src/node/
    → normalization, attribution, deduplication       src/core/
    → filtered reports and efficiency measurements    src/core/
    → token-protected localhost API                  src/node/canvas-server.mjs
    → dashboard                                      src/panel/ → panel/index.html

An explicitly started AI review:
    prepared evidence + bundled guidance + optional prompt excerpts
    → isolated Copilot helper → result + recorded review usage
```

The history scan prioritizes recent records, then completes older history in the background. Wider ranges wait for coverage; filters reuse the loaded snapshot. Journals take precedence over database fallback records for sessions with journal receipts. Historical usage is distinct from live host inventory and current-context inspection.

The main usage index is held in memory. Preferences, endpoint recovery metadata, bounded diagnostics, and the plugin's own AI-review accounting are persisted separately. Original Copilot records are read-only. See [loading and privacy details](guide/diagnostics.md) and [AI-review retention](ai-review.md#accounting-and-retention).

## Source map

| Area | Start here | Responsibility |
| --- | --- | --- |
| Desktop entry | [extension entry](../com.github.copilot/extensions/usage-insights/extension.mjs), [registration](../src/extension.mjs), [canvas lifecycle](../src/node/canvas.mjs) | Host SDK registration, opening, closing, and disposal |
| Local API | [server](../src/node/canvas-server.mjs), [usage service](../src/node/canvas-usage.mjs), [endpoint recovery](../src/node/canvas-endpoint.mjs) | Request validation, loading, report caching, pause, and reconnect |
| Readers | [journal scanner](../src/node/copilot-source.mjs), [SQLite reader](../src/node/copilot-db.mjs), [VS Code sources](../src/node/vscode-sources.mjs), [WSL sources](../src/node/wsl-sources.mjs) | Discovery, bounded reads, incremental refresh, source coverage |
| Accounting | [receipt parser](../src/core/copilot.mjs), [reports](../src/core/copilot-report.mjs), [prompt credits](../src/core/prompt-credits.mjs), [coverage](../src/core/coverage.mjs) | Normalize records, attribute work, deduplicate, preserve missing data |
| Efficiency | [accumulator](../src/core/efficiency.mjs), [findings](../src/core/efficiency-findings.mjs), [context growth](../src/core/context-growth.mjs) | Derive descriptive patterns from recorded events |
| Dashboard | [controller](../src/panel/panel.js), [markup](../src/panel/panel.html), [styles](../src/panel/panel.css) | Filters, navigation, rendering, and interaction state; topic renderers sit alongside these files |
| AI review | [API workflow](../src/node/canvas-review.mjs), [evidence](../src/node/review-evidence.mjs), [SDK helper](../src/node/ai-review.mjs), [accounting](../src/node/review-usage.mjs) | Prepare evidence, isolate inference, validate results, retain usage |
| Review guidance | [authoring guide](../src/review-guides/README.md), [benchmark facts](../data/model-benchmarks.json) | Versioned model-facing instructions and sourced reference data |
| Packaging | [build](../scripts/build.mjs), [local installer](../scripts/install-local.mjs), [plugin manifest](../plugin.json), [marketplace](../.github/plugin/marketplace.json) | Self-contained dashboard and two installation paths |

`src/core/` holds the accounting and analysis functions; `src/node/` owns filesystem, host, process, and HTTP access; `src/panel/` owns browser behavior. Tests mirror these responsibilities under `tests/`.

## Rules worth checking closely

- **Recorded charges stay recorded.** Missing charges are not zero, and token counts are not converted into estimated billing. Provider attribution and copied-source deduplication must survive filtering and refresh.
- **Prompt work stays linked.** A human prompt can produce multiple calls and delegated work. Date/model boundaries must not silently split or double-count its accounting.
- **Coverage stays visible.** Partial histories, unsupported schemas, missing fields, and uncertain attribution must not appear complete.
- **Local inspection and AI submission stay distinct.** Ordinary usage refresh does not trigger inference. AI review sends prepared evidence and, when enabled, bounded prompt excerpts. Excerpts default on; the setting and prepared evidence must be understandable to the user.
- **Findings stay descriptive.** A correlation in cache use, tool repetition, or conversation habits does not establish poor work or savings. Structural tests do not establish AI recommendation quality.

The [security policy](../SECURITY.md) is the current boundary reference. The [dated audit](security-performance-review-2026-11-17.md) explains fixes and measurements at its recorded version; those measurements are not a current benchmark of every workload.

## Feedback and decisions requested

Review feedback is useful on accounting assumptions, privacy defaults, whether the views explain their limits, and how readily another maintainer can follow the code. For a concrete concern, include the input or user action, expected behavior, observed behavior, and relevant file or test.

The [decision backlog](audit-followups.md) contains the evidence and acceptance criteria for these choices. The statuses below describe the repository's recorded decisions; check the linked issues before starting work.

| Topic | Question for review |
| --- | --- |
| History memory | Should a measured compact representation or validated local index replace full in-memory retention? |
| Older history | Should background loading remain automatic, or should users explicitly request older records? |
| Timeline retention | Is a reduced-detail mode worth the insights it would make unavailable? |
| Unused-event validation | Is a faster mode worth weaker malformed-record diagnostics? The audit recommends retaining full validation. |
| Large lists | Which paging/search interaction preserves access, sorting, and keyboard focus at scale? |

[Journal integrity is already decided](journal-integrity.md): keep full consumed-prefix verification. The audit fixes shipped in v0.1.111. A review of the remaining alternatives is not approval to remove functionality or weaken accounting.

## Reproduce the automated checks

```sh
npm run build
npm test
npm run validate:benchmarks
npm run validate:security
git diff --exit-code -- panel/index.html src/generated/model-benchmarks.mjs
git diff --check
```

The generated-file diff should be empty on a clean checkout. After source/data changes, inspect and commit the intended generated updates. [CI](../.github/workflows/test.yml) builds and tests on Windows, macOS, and Linux and checks that the committed dashboard is current.

Useful test entry points are [accounting](../tests/copilot.test.mjs), [prompt grouping](../tests/prompt-credits.test.mjs), [source integrity](../tests/journal-integrity.test.mjs), [API boundaries](../tests/canvas.test.mjs), [review isolation](../tests/ai-review.test.mjs), and [packaging](../tests/packaging.test.mjs). Panel tests use a simulated DOM; they do not verify browser paint or the actual desktop host. Use a manual desktop smoke test for install/open/refresh/close behavior. Running a real AI review may consume credits.

The offline validators check bundled data and integrity, not new online advisories. For reproducible performance work, use the synthetic harnesses linked from the [audit index](README.md#dated-reviews-and-measurements). Host-specific SDK fixtures are documented in [AI Review integration](ai-review.md#validation).

## Files that can look disposable but are required

| Files | Why they stay |
| --- | --- |
| `panel/index.html` | Committed, self-contained dashboard used by marketplace installs; regenerate with the build |
| `src/generated/model-benchmarks.mjs` | Generated from the benchmark dataset; used by the application and build |
| `src/vendor/js-yaml/`, `licenses/`, `LICENSE` | Vendored parser, provenance, and redistribution notices |
| `src/review-guides/` | Runtime review instructions and authoring examples; examples are tested and excluded from local runtime installation |
| `scripts/benchmark-*.mjs`, `scripts/synthetic-history.mjs`, `scripts/demo-data.mjs` | Reproducible measurements, tests, and synthetic preview |
| `scripts/check-review-*.mjs`, `scripts/mcp-test-server.mjs` | Documented compatibility and integration fixtures; not automatically run by opening the dashboard |

Completed planning records are in the [historical archive](archive/README.md). Use them to understand past decisions, not as current instructions or approval. Research is indexed separately with its dates and limits.
