# Prompt delivery in Conversation habits

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

Baseline: `6db9bb4`. User approved the researched delivery breakdown and passing it to AI review. Implement in this existing isolated worktree; retain the current scan, attribution, filtering and review limits. No browser control, installation or paid inference.

## Plan and decisions

- [x] Preserve optional `idle`, `steering`, `queued` metadata and explicit user stop events; use existing human/provider attribution and deduplication. Missing, unsupported or conflicting delivery labels stay unknown. Delivery-only conflicts must not change financial accounting.
- [x] Summarize delivery counts in the existing conversation sample. Session steering rates use only sessions with every prompt's delivery known. Stops are separate recorded events, filtered by their own timestamp/project; never infer that a later prompt caused one or that any cost was wasted.
- [x] Add compact accessible charts/statistics in Conversation habits using existing surfaces and number formatting. Explain coverage and preserve the model-filter limitation.
- [x] Supply bounded aggregate evidence and delivery labels on existing excerpt candidates; update versioned reviewer guidance to distinguish repeated corrections from collaboration, new information and scope changes. No extra model pass or prompt reads.
- [x] Add focused synthetic regressions, run build/full tests, obtain one independent final review, update release metadata and push main under standing authorization.

## Verification ledger

Core tests first failed for absent delivery data, then passed after parser/aggregation integration. UI and review evidence tests likewise failed before implementation. A dense all-topic fixture caught the guidance size limit; wording was condensed without raising any limits.

Independent final review found one financial regression: replayed stop events with differing project context could invalidate completed prompt costs. A nonzero-charge regression reproduced it, then passed after accounting comparison ignored stop-location-only differences. Ambiguous stops remain excluded from stop statistics. No remaining important findings.

Final verification: npm run build passed; npm test passed 449 tests with one existing skip (450 total). Scanner tests exercise copied journals, forced/incremental refresh and prompt-text exclusion. UI strings, number formatting, unknown coverage, filter boundaries, cached snapshots and review payload budgets are covered. No browser/desktop control, installation or paid inference. Manual theme, narrow-panel and larger-text checks remain with the user.
