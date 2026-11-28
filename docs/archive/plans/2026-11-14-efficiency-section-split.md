# Efficiency Section Split Implementation Plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement this approved scope inline.

**Goal:** Separate consumption measurements from workflow findings, with compact section navigation in both Efficiency dashboards.

**Architecture:** Split the existing topic catalog into token and pattern topics. Reuse existing report renderers and static panels under their new parents, with independent in-memory selections. Fold prompt-size measurements into Conversation habits, keep Findings as the pattern default, and rename Model averages to Model comparisons.

**Tech Stack:** Existing vanilla JavaScript, HTML/CSS, generated canvas, and Node tests.

**Spec:** The user approved the preceding recommendation to move context growth, context reduction, calls/recovery, prompt size, model transitions, and repeated exploration into Worth a closer look. AI review remains a separate existing workflow, with no panels moved into it and no new AI-generation behavior.

## Constraints and review focus

- Token topics: Overview; Always-loaded context; Tool and MCP footprint; Files, searches, and tool results; Cache reuse; Work behind each prompt; Delegated work; Reasoning and generated output; Biggest spend drivers; Skills and instruction footprint.
- Pattern topics: Findings (default); Conversation habits (including prompt size versus processing); Context growth; Context reduction; Calls and recovery; Model changes and fresh starts; Repeated exploration; Model comparisons.
- One section visible per dashboard. Preserve independent selections through tab, filter, settings, resize, and refresh renders.
- Navigation is local; no log scans, context reads, or AI calls. Explicit context inspection and existing usage drilldowns remain available.
- Unknown data remains unknown. Keep model-filter exclusions, measurement coverage, current-context separation, escaping, and number formatting.
- Keep AI review separate and retain its existing manual snapshot behavior. No new insights or data collection.
- Check keyboard focus, narrow layouts, large text, invalid selections, and links from conversation habits to the context inspector.

## Implementation and verification

- [x] Update catalog and navigation tests for exact membership, isolation, defaults, local switching, and persistence; confirm they fail before implementation.
- [x] Split catalog in src/panel/token-topics.mjs; relocate HTML panels and add the pattern selector; connect state and rendering in src/panel/panel.js. Reuse selector styles.
- [x] Merge input-per-call context into Conversation habits without duplicating prompt lengths; preserve model-filter behavior and the separate-average caveat.
- [x] Build, run focused tests and the full suite, verify in Brave with synthetic data, and obtain a read-only review.
- [x] Update README, research roadmap, and synchronized version; rebuild and prepare for the authorized main push.

## Verification

- 184 tests passed, including catalog membership, panel placement, independent state through filters/settings/refresh/resize, no-request navigation, AI-review isolation, and prompt measurement coverage.
- Headless Brave verified all 18 choices at 360, 600, and 1200 pixels with large text, keyboard selection, refresh focus, zero navigation requests, and AI-review isolation. Inspected the Conversation habits screenshot.
- Independent read-only review found no blocking issues. Corrected its two copy findings: the different populations used by conversation/input averages, and navigation separators in the documentation.
- Existing manual review snapshots remain intact. No new historical analytics, data collection, dependencies, or AI calls were added. Copilot desktop validation remains with the user.
