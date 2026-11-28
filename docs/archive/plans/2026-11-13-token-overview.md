# Token Overview Implementation Plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display Copilot input, output, and cache usage prominently and document the next available telemetry features.

**Architecture:** Keep the existing receipt parser and report structure. Extend inclusive-input availability, compose existing SVG components into one overview, and reuse current filters and formatting.

**Tech Stack:** Dependency-free Node.js 24, HTML/CSS/JavaScript, SVG.

- [x] Add a report test for known, unknown, and partial inclusive input; run it before implementation.
- [x] Track inclusive-input availability in `src/core/copilot-report.mjs` and update the panel markup, rendering, and responsive styling. Reuse `usageValue` and `segmentBar`.
- [x] Document token semantics and feasible skills/MCP/performance additions in README; bump the four package/catalog versions.
- [x] Regenerate the bundled panel, run tests, and check normal/partial/empty states plus filters in Brave.
- [x] Review the diff and prepare version 0.1.2 for publication to main.

Validation: 35 tests pass. The generated panel reproduces byte-for-byte. Brave checks passed at desktop, 390px, and 320px widths, with light/dark themes, the cache filter, the credits selector, and partial/unavailable/empty summary states. No page errors or horizontal page overflow. Independent review found no blockers. Desktop canvas integration still relies on the user's in-app smoke test after updating.
