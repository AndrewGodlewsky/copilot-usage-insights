# Conversation depth implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation with one final independent review.

**Goal:** Show conversation-depth and per-prompt agent-work graphics and give AI review the same bounded evidence.
**Architecture:** A small accumulator consumes the existing prompt-accounting pass. The report exposes aggregate conversation statistics, a panel renderer displays them, and review evidence references their measured values. No new source or dependency.
**Tech stack:** Existing Node modules, HTML/CSS and Node tests.
**Spec:** [Conversation depth](../specs/2026-11-15-conversation-depth-design.md).

## Constraints and review focus

- Count by session ID, not project; automated and subagent messages are not human prompts.
- Missing charges do not erase known prompts; uncertain identities and absent metadata do not become zero-depth sessions.
- Date windows describe observations; full prompt work is linked before date filtering. Include earlier-recorded and multi-day counts with exact denominators.
- Model filters disable this session-wide view. Environment/project/session/date filters stay consistent.
- Only complete session samples enter the calls-per-prompt grid; no inference of task length, effort, success or efficiency from depth alone.
- Existing privacy bounds, source scans, report refresh and inference limits remain unchanged.

## Task 1: measures

**Files:** new `src/core/conversations.mjs`, `src/core/prompt-credits.mjs`, `src/core/copilot-report.mjs`, new `tests/conversations.test.mjs`.
**Interface:** `createConversationAccumulator(records, query, start, end, now)` returns `add(prompt, complete)` and `finish()`. `report.efficiency.conversations` contains counts, distribution and a 3×3 matrix; no identifiers or text.

- [x] Write synthetic parser-to-report regressions for distribution edges, median, multi-day/prior activity, duplicated events, source/identity gaps, automated messages, incomplete work, session identity and filters. Run red.
- [x] Implement aggregate collection during the existing prompt loop, then run focused tests green.

## Task 2: panel and reviewer

**Files:** new `src/panel/conversations.mjs`, panel HTML/CSS/JS, build script; review-evidence module and prompts/sessions guide; panel/evidence tests.
**Interface:** `renderConversations(summary, { number })` returns accessible bars, matrix and coverage. Review evidence uses existing comparison/statistic/share templates with fixed-size values and evidence IDs.

- [x] Add failing rendering/evidence tests for exact values, empty/model-filter states, coverage, semantic chart labels and anonymized payloads.
- [x] Implement responsive graphics, remove the redundant legacy message average, and add aggregate reviewer evidence and interpretation guidance.
- [x] Build, run focused and full tests, and obtain one fresh-context review. Address substantive findings with regressions.

## Task 3: delivery

- [x] Update four manifests, release notes, README and generated panel; run `npm run build`, `npm test`, and diff checks.
- [x] Prepare the authorized main release with verification recorded below; no installation.

## Results

Version 0.1.92, reviewer guidance 1.1.1. Build and full tests passed: 423 tests, 422 passed, one existing POSIX-only skip on Windows, no failures. Independent review found no actionable issue and independently passed 127 focused checks. Source tests cover human/automated identity, deduplication, provider gaps, subagents, complete and incomplete accounting, date boundaries, filters, session identity across projects, accessible graph labels and anonymized review evidence.

The first all-topic guidance check exposed an input-budget regression. Compressed the wording without raising limits and added coverage for all six guides together (7,918 bytes) and a dense evidence submission. No additional analysis pass, log scan, sample read or dependency is needed.

Remaining manual checks: narrow-panel layout, theme appearance and increased text size. Browser/desktop automation and paid inference were not performed. The release includes the generated panel and notes; delivery target is main under the existing authorization.
