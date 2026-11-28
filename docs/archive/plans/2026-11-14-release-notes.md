# Release Notes Implementation Plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement this scoped change inline.

**Goal:** Make the footer version open a simple release-history panel with a short statement for each version.

**Architecture:** Store version/summary pairs in release-notes.json, newest first, and embed them in the standalone canvas at build time. Reuse the native dialog and footer button styles; show one release at a time in a labeled version selector. Opening resets to the installed build version. Closing by button or Escape returns focus to the footer version.

**Tech Stack:** Existing Node build, vanilla JavaScript, native HTML dialog and select. No dependencies or requests.

**Spec:** User requested clickable footer versions and a popup with clickable versions and persisted short, high-level text notes. No screenshots. Backfill Copilot versions 0.1.0 through 0.1.54 from Git's package-version history, then add this release as 0.1.55.

## Checks and tasks

- [x] Add panel tests for opening, version changes, invalid selection, closing/focus, all main tabs, offline navigation, and refresh stability; verify missing behavior fails.
- [x] Add release-notes.json and embed it safely during build; require a note for the build version and valid unique version/summary entries. Update packaging checks for complete ordered history and clickable version semantics.
- [x] Add the footer button, accessible dialog, and local selection handlers. Inherit theme/text settings and narrow-screen dialog layout.
- [x] Update README release-maintenance instructions and synchronized version; build, run relevant checks/full suite, verify in Brave, and obtain independent review.

## Boundaries

- Notes describe changes at their release, including behavior superseded by later versions.
- Git is used only to prepare historical notes, never at runtime or during installation.
- No dashboard data, accounting, or filters change. Older installs only show the history bundled with that install.

## Verification

- The new panel test failed before implementation, then passed with the dialog and notes in place.
- Build and JavaScript syntax checks passed; full suite: 186 passed, 0 failed. Diff whitespace check passed.
- Independent review found no actionable issues and independently passed all 40 panel/packaging tests. Historical notes were checked against package-version Git history.
- Headless Brave with synthetic usage: all 56 versions available offline with zero requests while browsing notes; installed version selected on opening; arrow-key selection, Close, Escape, and focus restoration verified.
- Native Tab navigation permits moving to browser controls and back into the modal; no dashboard control receives focus behind it.
- Both themes fit at 360, 600, and 1200 pixels with large text. Light/dark screenshots were visually inspected. Copilot desktop was not exercised.
