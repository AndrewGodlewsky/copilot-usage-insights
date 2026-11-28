# Model → session → request breakdown

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

The requested hierarchy is model → session → recorded request timestamp → original prompt. All three table levels use Requests, Input, Output, Reasoning, Cache read, Cache write, Avg. tokens / request, Tokens, and AI credits. Request rows remain model calls, including continuations, so their sums reconcile with the parent rows.

Implementation choices:

- Add a paged model-session query over the existing in-memory usage snapshot. Reuse accounting buckets, filter semantics, and human-readable session labels; never rescan history for expansion.
- Load 25 sessions on model expansion and 25 requests on session expansion. Sessions follow the selected table sort; requests stay newest first. Keep project grouping unchanged.
- Use the same table renderer and metric formatting for all levels, with alternating expansion backgrounds and clear disclosure buttons. Show only the original prompt beneath a request, without repeating its token metrics.
- Read prompt text only after an explicit request click. Cache expanded prompt details only for the current request page; clear on refresh, paging, session/model changes, or filter changes.
- Preserve keyboard focus, retries, loading states, refresh behavior, and stale-response protection at both paging levels. Collapsing an ancestor discards its descendants.

Verification:

1. Synthetic aggregation tests: model/session isolation, same-named sessions, cross-project sessions, filters, incomplete counts/credits, exact reconciliation, and stable pagination.
2. API tests: cached scan reuse, no prompt reads for session/request pages, validation, and enabled-source changes.
3. UI tests: hierarchy, identical columns, escaped labels/prompts, page limits, focus, retries, refresh, and ignored late responses. Existing project grouping and metric emphasis tests must remain green.
4. Build, full suite, focused review, README/version update, and publish to main using the existing authorized workflow. No desktop automation required.
