# Usage selections and prompt counts

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

- Start with neutral metric emphasis; keep the daily chart in token units.
- Reuse the existing prompt attribution graph to count distinct, confirmed user submissions by project. Count submissions independently of complete billing; exclude automated/child messages and uncertain identities. Date by submission, and require reliable linked model evidence when a model is selected. Show unavailable or partial coverage honestly.
- Keep the prompt-cost denominator and eligibility unchanged. Shorten its caption; retain full coverage in the tooltip.
- Build model/project choice totals from the in-memory snapshot, ignoring each choice list's own filter and respecting the other filters. Keep the main report fully filtered. No file reads or prompt text collection are added.
- Make Usage model bars and project names accessible toggle controls. Keep alternatives visible in gray, retain the selected item beyond the ranking cutoff, and synchronize with the existing filter controls.
- Verify synthetic attribution/filter cases and panel interaction tests, update documentation/package versions, build, run checks, request a fresh review, and ship to main.
