# Daily Selection and Skills Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users inspect each day's tokens and see recorded skill activations in Breakdown.

**Architecture:** Extend the existing parser/scanner/report with sanitized skill metadata, then add a Skills table. Daily selection remains client-side and uses the already-aggregated daily buckets.

**Tech Stack:** Node.js 24, HTML/CSS/JavaScript, SVG; no dependencies.

- [x] Add failing tests for skill privacy, replay/copied-log deduplication, filters, missing attribution, and accessible day selections.
- [x] Implement skill parsing, scanner aggregation, report grouping, and API propagation; verify focused tests.
- [x] Add daily selection, reset behavior, keyboard controls, and Skills rendering; add synthetic demo activity.
- [x] Update README and versions; rebuild, run tests, and check selection/filters/empty states in Brave.
- [x] Obtain focused review, resolve findings, and prepare version 0.1.3 for publication to main.

Validation: all 43 tests pass and the bundled panel rebuilds byte-for-byte. Brave desktop/mobile checks cover day click/toggle/reset, Enter/Space and focus, refresh retention, metric changes, filter reset, zero days, skill project filters, empty lists, omitted-event notices, escaped metadata, and horizontal overflow. No page errors. Local metadata scan confirms the current history has no skill activations. In-app canvas smoke testing remains with the user after update.

Review follow-up: eligible skill-only projects now populate the Project dropdown; a regression test covers context changes before the next request. Dense charts constrain each bar to its own day slot so neighboring bars cannot cover click targets. Both tests were observed failing before their fixes. The final focused review has no outstanding findings.
