# Efficiency redesign implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Explain where resources go and turn measured patterns into practical experiments.

**Architecture:** Extend the existing bounded report accumulator, redesign the existing canvas, and inspect current context only on demand through the joined session. A previewable, anonymized report enables optional AI review without launching an unrestricted agent.

**Tech stack:** Existing Node ESM, vanilla HTML/CSS/JavaScript, Node test runner. No new dependencies.

**Spec:** [Efficiency analysis proposal](../../research/2026-11-14-efficiency-analysis-proposal.md), with the user's authorization to redesign and implement.

## Global constraints

- Historical measures obey date, model, project, and session filters. Current context is separately labeled and never mixed into historical averages.
- Missing measurements remain unavailable, never zero. Use matched denominators and show coverage.
- No efficiency score, effectiveness claim, estimated savings, per-skill token bill, or inference that an installed skill consumed context.
- No background AI, new database, daemon, raw prompt scanning, or automatic uploads. AI review uses a frozen, previewable report with names aliased.
- Preserve existing themes, proportional text sizes, keyboard access, and long-string wrapping.

## Design

Use the existing quiet charcoal/white palette, blue for input, green for cache, amber for review cues, and existing system typography. Give the main explanation more visual weight than its evidence. No animation.

```text
Understand what each request carries                 [Prepare AI review]
Selected-range scope
| Where tokens go: input vs output, plus cache reuse                   |
| A typical request: input | output | tool definitions | credits        |
| Worth a closer look: observation -> evidence -> experiment -> inspect |
| Current conversation context                         [Inspect context]|
| Compare models (disclosure)                                          |
| How to read this (disclosure)                                         |
```

## Review focus

- Explicitly unavailable cache counts must not become a zero cache rate.
- Tool definitions are a subset of input, and reasoning is a subset of output; neither is added twice.
- Nested current-context entries must not be summed with their parents.
- A stale current-context snapshot or AI report must not silently adopt new filters.
- Host capability failures, empty samples, and long/untrusted labels must remain usable.

### Task 1: Historical measurements

**Files:** `src/core/copilot.mjs`, `src/core/efficiency.mjs`, `tests/efficiency.test.mjs`.

**Interface:** Extend efficiency summary and model rows with pairedInput/pairedOutput/pairedRequests, toolTokens/toolInput/toolRequests/averageToolTokens/toolShare, reasoningTokens/reasoningRequests. Preserve existing insights and append a tools insight for >=5 samples, >=80% coverage, >=10% definition share, and >=1000 average definition tokens.

- [x] Test matched denominators, zero/missing/invalid measurements and explicit cache unavailability; observe failure.
- [x] Retain `toolTokenCount`, `availableToolCount`, `cacheDetailsReported` in normalized receipts and implement bounded aggregation.
- [x] Run `node --test tests/efficiency.test.mjs tests/copilot.test.mjs` and commit.

### Task 2: Current context inspection

**Files:** new `src/node/context.mjs`, `src/node/canvas.mjs`, `src/node/canvas-server.mjs`, new `tests/context.test.mjs`.

**Interface:** `createContextReader(getSession, {timeoutMs})` returns an on-demand async reader of `{available, reason?, checkedAt, totalTokens, limit, categories, entries, omitted}`. Allowlist numeric fields and bounded labels only, no raw contents/attributes/errors. API `efficiency.context` accepts no options.

- [x] Test unavailable/malformed/timeout/rejection, nested entries, and concurrent requests; observe failure.
- [x] Implement the SDK reader and protected endpoint without history scanning; wire it to the joined session.
- [x] Run context and canvas tests and commit.

### Task 3: Canvas redesign and review report

**Files:** panel HTML/CSS/JS; new `src/panel/efficiency.mjs`; build module list; panel and review-report tests; README and version manifests.

**Interface:** Existing efficiency summary plus filtered MCP history feeds the UI. The report builder returns bounded JSON containing explicit units, scope, coverage, aliased models/servers, and optional numeric current-context categories; no paths, IDs, labels, raw logs, prompts, or plugin content.

- [x] Test report privacy, size bounds, review snapshot stability, on-demand context behavior, and escaping.
- [x] Build the explanation, matched-token visual, evidence/action rows, context inspection, expandable model comparison, and copyable review dialog with clipboard fallback.
- [x] Document actual behavior, bump to 0.1.30, build and run the full suite. Review the complete diff before merging and pushing main as already authorized.

## Execution record

- Existing isolated waspfish worktree verified at 5827725; main is clean at the same base.
- Preflight: Task 1's added summary fields feed Task 3; Task 2's allowlisted snapshot feeds Task 3. No conflicting ownership or dependencies.
- The prior proposal and current go-ahead authorize implementation. Use the report handoff fallback because isolated host-agent execution has not been demonstrated.

- Tasks 1?2: targeted parser/measurement and SDK/API tests passed after observed failures. On-demand context uses a five-second host wait, seven-second browser wait, and no scan.
- Task 3: preview/copy, frozen-filter scope, privacy bounds, missing data, and MCP navigation tests passed after observed failures. UI remains local and uses existing theme/text scaling.
- Integration is committed together because the generated canvas and release version must match the runtime. Native implementation was used; a fresh whole-change review is the final gate.
- Validation: build succeeded; full suite initially passed 115/115, then two focused regressions passed for frozen scope and MCP navigation. Final suite and review pending below.

- Final review: no critical or important issues. The missing snapshot model label was retained as a required clarity fix for model changes; a regression failed before the fix and then passed. The README multiplication character was corrected. Live host/visual behavior remains for the user to test as requested.
- Final validation: `npm run build` succeeded and `npm test` passed 116/116 after review fixes. No deferred code findings remain.
