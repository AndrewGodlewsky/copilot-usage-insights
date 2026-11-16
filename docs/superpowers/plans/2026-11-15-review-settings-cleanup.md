# AI Review Settings Cleanup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this approved change.

**Goal:** Reduce review-screen clutter and persist default-on prompt excerpts in Settings.

**Architecture:** Extend validated settings, freeze the choice in the existing preparation response, and enforce both snapshot and current permissions on analysis. Move explanatory copy and metadata without changing the review engine.

**Tech Stack:** Existing JavaScript/HTML/CSS and Node tests.

**Spec:** [Approved scope](../specs/2026-11-15-review-settings-cleanup.md).

## Task 1: Setting, UI and release

- [x] Add and run focused tests for default/migrated settings, saved opt-outs, unsaved UI edits, and changes between preparation and submission.
- [x] Implement setting validation and preparation/analysis constraints; move the checkbox to Settings and simplify the review surface. Retain exception notices and detailed metadata in the disclosure.
- [x] Update current documentation, release notes and four manifests for 0.1.94, rebuild, and run the full suite.
- [x] Obtain an independent review, verify the release bundle, commit and push main. No installation or browser control.

## Review focus

Persisted false must survive reopening; default true must not override explicit false. Stale clients and settings changes must not enable sampling beyond the prepared/saved permission. Routine text is removed without suppressing failure or stale-scope feedback. Existing sample limits and accounting remain intact.

## Verification record

The three initial regression tests failed before implementation, then passed. Ninety-seven focused checks passed. Independent review found that failed/cancelled preparation could hide earlier review details; a new regression reproduced that failure and passed after preserving the earlier details. Settings copy now also explains possible delay, and documentation punctuation was corrected. Final build and full suite passed: 430 tests, 429 passed, one existing platform-specific skip. Diff whitespace checks passed. No real inference or browser checks were performed; visual spacing remains a manual check.
