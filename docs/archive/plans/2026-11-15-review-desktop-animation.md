# Review desktop animation implementation plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement this approved plan in the current worktree.

**Goal:** Integrate the approved desktop loading scene with four variations and the real AI review lifecycle.

**Architecture:** Static inline SVG in the panel, isolated animation CSS bundled by the existing build, and small lifecycle hooks alongside reviewProgress(). No changes to the SDK or evidence pipeline.

**Tech stack:** HTML, SVG, CSS, existing JavaScript and Node test harness.

**Spec:** [Approved design](../specs/2026-11-15-review-desktop-animation-design.md).

## Constraints and review focus

- Four nine-second scenes; preparation-to-analysis and unrelated refreshes preserve the sequence.
- Finish, error and cancellation remove the illustration; cancellation stops motion immediately.
- Inactive dashboard/subview/document pauses motion; explicit pause survives hide/show.
- Reduced motion shows a still scene and does not create extra requests or frame timers.
- Real results and account/usage handling remain unchanged; no prototype demo data ships.

## Task 1: illustration and lifecycle

**Files:** `src/panel/panel.html`, new `src/panel/review-desktop.css`, `src/panel/panel.js`, `scripts/build.mjs`, `tests/panel.test.mjs`.

**Interfaces:** Existing `reviewProgress(phase)`, `syncReviewScope()`, `cancelReview()` and visibility handler manage a persistent `#review-progress`; its `data-scene`, `data-paused` and `data-still` attributes control decorative CSS. `#review-desktop-record` emits the cycle event. `#review-animation-toggle` changes only motion.

- [x] Add lifecycle regressions: four scenes, ignored child events, refresh/phase persistence, pause/resume, hidden view/document, cancellation, reduced motion and no additional requests.
- [x] Run focused tests against the old bundle and confirm the missing illustration fails.
- [x] Integrate the static art, four content/cursor variations and lifecycle controls; bundle CSS without dependencies.
- [x] Build and run panel tests; verify the SVG structure, semantic status and generated assets. Run `npm test` and obtain one independent focused review.

## Task 2: delivery

**Files:** README, release notes, four version manifests, generated `panel/index.html` and this plan.

- [x] Update release version and notes, describe motion behavior in README, and run `npm run build` and `npm test`. Expected: build success and no test failures (existing POSIX-only skip on Windows).
- [x] Prepare the release for the authorized main fast-forward and push, with test outcomes and remaining manual checks recorded below. No installation or real inference.

## Verification and delivery

Version 0.1.91. `npm run build` passed. `npm test` passed: 411 tests, 410 passed, one existing POSIX-only skip on Windows, zero failures. The panel tests cover all four variants, no requests from scene changes, refresh and phase continuity, cancellation, dynamic reduced motion and focus after errors. The SVG parses successfully and `git diff --check` passes.

The independent review found that hiding an ancestor cancels CSS clocks. Added clock capture/restoration around navigation, plus a regression that first reproduced the reset and then passed. Restoring within the current iteration avoids replaying elapsed loops. No frame timer or additional inference was introduced.

Manual checks still required: motion feel, cursor/content timing in the browser, narrow-panel layout, light/dark appearance and native focus visibility. Browser/desktop automation and paid inference were not performed. Delivery target is main; the release commit includes the generated panel and bundled release notes.
