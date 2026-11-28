# AI Insight Cards Implementation Plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans in this worktree. The user approved the design and explicitly requested planning followed by uninterrupted implementation.

**Goal:** Produce bounded, evidence-backed AI review cards with optional automatic prompt enrichment.

**Architecture:** Prepare a server-owned snapshot from existing in-memory history. A small analysis module loads bundled guidance, validates structured cards against local evidence, and permits at most one targeted follow-up inside the existing isolated SDK helper. The panel renders local numeric templates and escaped explanations.

**Tech Stack:** Existing JavaScript modules, Node test runner, native HTML/CSS, installed Copilot SDK. No dependencies.

**Spec:** [Approved design](../specs/2026-11-15-ai-insight-cards-design.md).

## Global Constraints

- At most two submissions, six distinct human excerpts, 2,000 characters each and 12,000 combined.
- Statistics only by default; explicit per-review sample permission; no automatic analysis on refresh/filter changes.
- Input including instructions <=48 KiB; guidance <=8 KiB; output <=64 KiB. Existing operation deadline and cancellation remain enforced.
- No model filesystem tools or installed skills. Preserve account verification, isolation and durable accounting.
- Opus recommendation, preserved saved model, supported Medium/High effort only; no silent model/effort fallback.
- One to five validated cards or an honest no-findings state; confidence is qualitative evidence confidence.

## Review Focus

- Replayed/conflicting prompt links and multiple calls must never sample extra prompts or automated messages.
- Filters and refresh during a review must not change its frozen evidence or initiate inference.
- Second-pass failure/cancel must not erase valid first-pass evidence or lose billed usage.
- Prompt text and model output must not become paths, HTML, instructions with tool access, or diagnostics.
- Missing model capabilities and incomplete charges must remain explicit, not guessed.

## Task 1: Evidence, guidance and validation

**Files:** new `src/node/review-insights.mjs`, `src/node/review-evidence.mjs`, `src/review-guides/`; modify `src/node/request-prompts.mjs`, `src/core/prompt-credits.mjs` only to expose reliable sampling identities; tests `tests/review-insights.test.mjs`, `tests/review-evidence.test.mjs`.

**Interfaces:** `prepareInsightReview(scan, filters, now, context)` returns private snapshot plus public `preview`, `id`, `scope`. `analyzeInsights(snapshot, {send, allowSamples, readSamples, signal})` returns validated local-value cards and enrichment status. `send(prompt, schema)` is the SDK seam. `readSamples(candidates, {signal})` is app-controlled, not model filesystem access.

- [x] Write and run failing tests for evidence aliases, all six guide topics, zero/missing values, own-review exclusion and model-filter limits.
- [x] Implement snapshot preparation and fixed statistic/comparison/trend evidence entries with capped candidates and payload size.
- [x] Write and run failing tests for schema validation, unknown refs, malicious text, no findings, two-pass/permission limits and enrichment fallback.
- [x] Implement versioned guides, strict parsing and local value resolution; bounded batched prompt reader with cancellation.
- [x] Verify: `node --test tests/review-insights.test.mjs tests/review-evidence.test.mjs tests/request-prompts.test.mjs tests/prompt-credits.test.mjs` (use actual existing filenames where different). Expected: pass.

## Task 2: SDK reasoning and accounting

**Files:** `src/node/ai-review.mjs`, `src/node/review-usage.mjs`, `src/node/settings.mjs`, `src/core/diagnostics.mjs`, relevant existing tests.

**Interfaces:** `reviewService.review({model, reasoningEffort, analysis, allowSamples}, signal)` uses Task 1; existing plain prompt service contract remains for compatibility. Return cards plus reconciled usage coverage; catalog returns safe reasoning capabilities.

- [x] Add failing tests for Medium/High validation, unsupported settings, one isolated helper/two calls, interruption and usage totals.
- [x] Integrate structured sends and shared operation deadline without changing permission/account/cleanup guarantees.
- [x] Expose receipt-based usage totals after reconciliation, preserving zero/partial/missing and deduplication.
- [x] Verify: `node --test tests/ai-review.test.mjs tests/review-usage.test.mjs tests/review-api.test.mjs`. Expected: pass.

## Task 3: Server and cards

**Files:** `src/node/canvas-server.mjs`, new `src/panel/review-cards.mjs`, `src/panel/panel.js`, `.html`, `.css`, `scripts/build.mjs`, API/panel/card tests.

**Interfaces:** `review.prepare` accepts validated filters only and returns snapshot metadata/preview. `review.analyze` accepts snapshot ID, expected saved model/effort and explicit boolean sample permission. Store one unused preparation; consume once on Analyze. Existing review routes remain compatible.

- [x] Add failing API tests for frozen snapshots, reused in-memory history, cancellation, foreign/stale IDs, duplicate sends and no caller-controlled evidence.
- [x] Add preparation/analysis routes, saved reasoning controls and Opus recommendation from the real catalog.
- [x] Add card rendering tests for local values, escaped content, expansion, empty state, comparison/trend templates and stale scope.
- [x] Implement responsive cards, opt-in preview, status/cancel, cost/coverage display and preserved prior results on failure.
- [x] Verify: focused new tests and existing panel/API/settings tests. Expected: pass.

## Task 4: Documentation, review and release

- [x] Update AI review docs, README and guidance authoring instructions; record material implementation decisions below.
- [x] Run loopback SDK fixture if installed runtime supports it, without paid inference or browser control.
- [x] Run `npm run build` and `npm test`; inspect every failure. Expected: all supported checks pass.
- [x] Request independent whole-change review; resolve material findings and verify.
- [x] Release using AGENTS.md: synchronize versions/notes/README, rebuild, run tests, commit generated panel. Preserve existing authorized main integration workflow; no direct plugin install.

## Execution ledger

- Pre-flight: Task 1 snapshot and analysis interfaces feed Task 2 SDK execution and Task 3 API/card rendering; same evidence IDs and local numeric values throughout. Task 4 verifies all three. No conflicting interfaces.
- User approved the design and implementation on November 15, 2026. Work starts from `5d5f027` on the existing isolated feature worktree.
- Tasks 1-3 implemented: new evidence, schema, sampling, SDK/accounting, API and card tests observed failing before implementation and now pass. Focused checks: 36 evidence/attribution tests; 39 SDK/accounting/API tests; 6 new/legacy API tests; 3 card rendering tests. Full suite: 383 passed, one existing skip; build passed.
- Ruling: retain the existing plain-text `review.run` route for compatibility while the panel uses server-owned `review.prepare`/`review.analyze`. Both share isolation/accounting; the new route has stricter snapshot ownership. Cost if wrong: an older dashboard still exposes the earlier explicit single-prompt review behavior.
- Ruling: use native expandable details cards; expansion occupies the grid width, with no additional dialog or chart dependency. Cost if wrong: visual balance needs user feedback, but keyboard disclosure remains native.
- Real SDK loopback check is currently unavailable: installed SDK declarations exist, but this machine's GitHub Copilot installation no longer contains the supported `copilot.exe`/`copilot-runtime.exe` launcher. Do not substitute the desktop `github.exe` or change runtime guards speculatively. Mocked adapter/account/permission/cancellation tests pass; real model/runtime testing remains manual.

- Independent review found no critical issues and four actionable issues. Fixed with regression coverage: normalize trend buckets to tokens/day, preserve baseline on cancelled/timed-out enrichment, verify submitted-call receipt coverage before claiming complete analysis usage, and retain readable filter names locally. Also fixed stalled-read cancellation and unrelated Settings saves overriding the unset reasoning recommendation. Full suite after fixes: 388 passed, one existing POSIX-only skip.

- Release verification: v0.1.88 synchronized across four manifests, README update guidance and bundled release history. Final build passed; final full suite: 388 passed, zero failures, one existing POSIX-only skip. Independent review fixes included. No paid inference, browser/desktop control or direct installation performed. Real SDK response quality and card layout/focus/touch remain manual checks.
