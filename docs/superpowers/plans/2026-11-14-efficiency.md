# Efficiency implementation plan

1. Add `createEfficiencyAccumulator()` in `src/core/efficiency.mjs`, with `add(record)` and `finish(sessionLabels)` methods. Accumulate request-weighted metrics and bounded first/last samples; return summary, model rows, and at most three structured directions. Integrate into the existing filtered loop in `buildReport`. Test paired denominators, zero/missing/partial data, model/session/project separation, unordered input, review thresholds, and filters.
2. Add the Efficiency tab and view in `src/panel/panel.html`. Render summary, evidence/directions, the model comparison, and collapsed methodology in `panel.js`; reuse existing colors, proportional text, wrapped names, and dotted table dividers. Centralize main-view visibility for all three tabs. Inspect usage changes only the appropriate filters and opens Breakdown. Test tab persistence, escaping, filter navigation, no extra requests on tab switches, and empty states.
3. Document definitions, thresholds, limitations, and sources in README. Bump manifests to 0.1.29 and rebuild `panel/index.html`. Run all Node tests and a synthetic large-record timing check. Request an independent code review, address findings, then commit and fast-forward/push main.

Review focus: incomplete denominators; cache counted twice; parallel/subagent requests misread as growth; stale filters on drill-down; rendering long names and retaining active tabs on refresh. No browser/computer use.

Verification: independent review found no actionable issues. A warmed synthetic accumulator-only check with four models measured median analysis times of 0.9 ms / 1,000 records, 4.4 ms / 10,000, and 57.2 ms / 100,000. These are local measurements, not end-to-end load guarantees; disk scans and browser rendering are excluded.
