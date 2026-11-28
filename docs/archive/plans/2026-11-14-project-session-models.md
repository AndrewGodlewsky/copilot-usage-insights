# Project → session → model breakdown

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

Extend the existing project sessions with an expandable model table. Reuse the shared accounting buckets and metric renderer, and query the existing in-memory snapshot only when a session is opened. Require both project and session identifiers; apply the current date, model, and cache filters. Model rows are terminal rows and follow the selected table sort.

Keep one session open within the expanded project. Clear descendants when changing project, page, group, or filters; refresh open model totals and ignore stale responses. Preserve loading, retry, empty-state, keyboard focus, escaping, and alternating table backgrounds. No prompt reads or extra log scans are needed.

Add spaces around the slash in `AI credits / prompt` and `AI credit / 1M tokens`, without changing accounting or subtitles.

Verify synthetic filter/accounting reconciliation, cross-project/session isolation, API snapshot reuse, UI expansion/reset/refresh/retry behavior, and matching columns. Build and run the full suite, obtain a focused review, update the README/version, then publish to main under the existing authorization.
