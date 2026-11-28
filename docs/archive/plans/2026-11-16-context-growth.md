# Context Growth Implementation Plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User approved the revised B prototype and requested implementation and a release pushed to main.

**Goal:** Explain recurring input-growth patterns with grouped trends, project/model filtering and inspectable sessions.

**Architecture:** Reuse cached prompt attribution, feeding a bounded context-growth accumulator in the existing report pass. Return aggregate curves (median and middle 50%, with contributor counts) and bounded local examples. Render a dedicated Context Growth panel; reference existing dashboard filters rather than introducing independent filtering or another scan.

**Tech Stack:** Node 24, native JavaScript/SVG, existing self-contained panel build.

**Spec:** Approved revised B prototype `context-growth-patterns-7d42.html` and `docs/research/2026-11-16-context-growth-review.md`, with the latest request to reduce line clutter. Grouping is the chosen response: logarithmic scaling compresses magnitudes but does not group sessions.

## Global Constraints

- No personal history, paid inference, browser automation, dependencies, extra source scans or installation.
- Preserve recorded charges, provider attribution, privacy, date/environment/session filters, and initial load performance.
- Each point represents the first reliably linked main-agent call for a human prompt, including cache once; unknown links/inputs remain gaps. Do not equate input with retained contents or window fullness.
- Whole-session shapes require six complete, ordered prompts using one exact model identity. Partial model-filtered sequences and model changes are unclassified. Dates refer to user submissions within the selected window.
- Graphs are descriptive, not efficiency scores or causal diagnoses. Shading is the interquartile range, not a confidence interval.
- At most 40 ordinal positions per aggregate curve, minimum three contributing sessions at a position; at most 25 local examples and 80 consecutive prompts per example. Explicitly disclose limits. Statistics use all eligible sessions.
- Release version 0.1.110, synchronized manifests/README/notes, regenerated panel, build, full tests, diff check, and normal fast-forward push to main.

## Review Focus

- Equal timestamps, copied events, shared attribution, missing identity and interleaved model changes must not manufacture growth.
- Cache missingness and incomplete charges must be distinguished; input can be known without a complete bill.
- Long histories and sparse late positions must remain bounded and disclose contributors/truncation.
- Filter changes, refresh and panel selection must preserve controls without causing scans or scroll jumps.
- AI review exports only allowlisted aggregates, not local example names, paths or identifiers.

## Tasks

- [x] 1. Add synthetic accumulator and prompt-attribution tests; watch fail. Implement `createContextGrowthAccumulator` and attach its result to `report.efficiency.contextGrowth`. Verify raw identity, first main call, unknowns, filtering, quantiles, bounds and unchanged accounting.
- [x] 2. Add a pure panel renderer and a dedicated growth panel. Grouped median/range is default; selectable patterns and bounded sessions, input/change views, native selects and stable keyboard focus. Use existing model/project filter state. Add rendering and panel interaction regression tests; update flattening imports.
- [x] 3. Add allowlisted aggregate AI-review evidence and definitions. Verify privacy and unchanged preview/copy/send behavior. Document measurements, limits and the grouping choice.
- [x] 4. Measure a synthetic 100,000-prompt case, run build/tests/diff check, obtain an independent review, fix material findings and synchronize release files. Delivery: push the verified release commit to main as authorized.

## Execution ledger

- Base: `009946d`, identical to fetched `origin/main`, existing isolated `waspfish` worktree. Only existing untracked change is the prior Context Growth research note; retain and include it as feature documentation.
- Ruling: Use grouped medians and interquartile bands rather than a logarithmic scale. This directly addresses overlapping-line clutter and keeps zero/delta values readable; extreme values remain available through session inspection.
- Implemented the accumulator, dedicated panel, mirrored filters, session inspection and aggregate-only AI evidence. The guide is revision 1.1.4. Focused failures were reproduced before their fixes; native prompt-slider updates retain the input element and keyboard focus.
- Independent read-only review found three attribution edges: copied context metadata disagreements, receipts preceding prompts, and dropped unconfirmed submissions. Added failing synthetic cases, fixed each, and verified that financial totals and prompt-cost accounting remain unchanged.
- Full build and tests passed on 2026-11-17: 558 tests, 557 passing and one POSIX-only skip on Windows; `git diff --check` passed. A first suite run exposed the existing 8 KiB guide limit; concise context guidance fixed it without raising the limit.
- A 100,000-record / 500,000-event in-memory benchmark measured cold report builds at 592 ms versus 594 ms at base, with identical recorded totals. The bounded context report section was 215,610 bytes. These timings exclude disk discovery and browser paint; no speedup is claimed.
- Release 0.1.110 includes synchronized versions, README update, embedded release note and regenerated panel. Fetched main remains the verified base. No installation, personal-history read, paid inference or browser automation was performed; visual/touch checks remain manual.
