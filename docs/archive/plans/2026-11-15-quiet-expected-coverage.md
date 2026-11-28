# Quiet expected coverage gaps — implementation plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement the approved behavior below. Track completed steps here.

**Goal:** Warn about unexpected accounting/data problems while keeping recognized interruptions and background activity inspectable without an orange banner.

**Architecture:** Extend the existing metadata parser and prompt attribution graph with explicit abort/resume boundaries and known plugin provenance. Keep aggregate spending and average eligibility separate from warning classification. Reuse the existing Review coverage dialog and in-memory report.

**Tech stack:** Existing Node ESM modules, native panel JavaScript, node:test. No dependencies.

**Spec (approved in conversation):** Recorded spending always remains counted. Recognized cancellations/interrupted conversations and known background-plugin calls do not trigger the banner. Unknown links, contradictory accounting, malformed records and unreadable configured sources still warn. Prompt averages remain conservative. Fix resumed turn-ID reuse. Expected limitations remain accessible in Review coverage and tooltips.

## Constraints and review focus

- No additional scans, prompt text retention, source-file changes, network calls, browser or desktop control.
- Only explicit interruption boundaries and known plugin source identity/markers justify quiet classification; names or missing records alone do not.
- A resume must not make the preceding unfinished prompt complete or merge separate prompts; ambiguous owners/receipts remain excluded and warned.
- Preserve event/call deduplication, future-event behavior, filter semantics, scoped subagents and refresh caching.
- Optional reasoning/cache/tool-footprint/prompt-length/outcome fields are measurement limitations, available in coverage details rather than banner triggers; missing primary costs/tokens still warn.

## Task 1: Accounting metadata and classification

Files: `src/core/prompt-credits.mjs`, `src/core/copilot.mjs`, `src/node/copilot-source.mjs`; `tests/prompt-credits.test.mjs`, `tests/enhance-prompt-source.test.mjs`.

- [x] Add failing fixtures for cancellation, explicit resume with repeated turn ID and synthetic resume tool completion, unknown interruption, conflicting receipts, replay and filters.
- [x] Retain only recognized abort/resume metadata, separate open turns at explicit boundaries and attribute resumed tool completions through unique recorded tool ownership.
- [x] Classify expected exclusions separately from unexpected exclusions; classify known helper sources and copied Usage Insights markers without trusting project names. Return additive `promptCredits.coverage` counts, keeping existing metrics intact.
- [x] Run focused attribution/scanner tests and verify known costs remain in totals; commit.

## Task 2: Dashboard warning policy and release

Files: `src/panel/panel.js`, `src/panel/panel.html`, panel tests, README, release manifests/history and generated panel.

- [x] Add failing panel checks for quiet expected cases, visible unexpected cases, optional measurement details, dismissal and filter refresh behavior.
- [x] Show only unexpected prompt/call counts in the banner; move normal measurement limitations to Review coverage, reachable from the footer even without a warning. Preserve complete-cost average explanations.
- [x] Verify the original local scenario read-only, without persisting personal data; no notification for its recognized cases, recovered continuation included once.
- [x] Run build/full tests, request one independent final review, resolve material findings with regression coverage.
- [x] Release 0.1.89 using AGENTS.md, update README and bundled notes, commit, fast-forward/push main under the existing authorized workflow. No direct installation.

## Execution ledger

- Starting point: clean existing feature worktree at `ad78492` (v0.1.88), main at same commit. Implementation proceeds locally; the user already approved the design.

- Implementation reused the existing scan/cache; no extra reads or retained prompt text. Boundaries do not count as session activity by themselves. Known plugin provenance survives copied logs regardless of scan order.
- Actual read errors warn; absent directories (including VS Code ENOENT/ENOTDIR) and known availability limits stay informational. Unexpected call counts retain conflict evidence before helper/compaction classification.
- Independent final review found three material cases: conflicting helper receipts, absent VS Code source diagnostics, and conflicting child scope on recovered tool completions. All reproduced with failing synthetic tests, fixed, and verified.
- Final validation: npm run build passed; npm test: 399 tests, 398 passed, 1 platform-specific skip, 0 failures. git diff --check passed.
- Read-only local verification recovered the completed resumed prompt once, kept the earlier interrupted spending in totals, and classified one cancellation, one interruption, and 17 known helper calls without unexpected prompt warnings. No personal log text or identifiers were saved in fixtures.
- Browser/desktop controls were not used. Visual inspection of Review coverage remains a manual user check. Release 0.1.89 is prepared for the existing authorized fast-forward/main push workflow; no direct installation.
