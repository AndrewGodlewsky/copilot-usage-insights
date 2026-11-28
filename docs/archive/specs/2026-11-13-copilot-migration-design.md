# GitHub Copilot Usage Insights

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

## Intent and scope

Build a plugin for the GitHub Copilot desktop application that tracks **GitHub Copilot AI usage only**. This supersedes the earlier proposal to retain other coding-agent data sources. The user explicitly corrected that assumption.

Remove standalone Claude Code, Codex, and OpenCode scanning, their settings and documentation, and all previous desktop-host branding and integration. Preserve the MIT copyright notice. Models served through GitHub Copilot may still have Anthropic or OpenAI model names; those are valid Copilot usage, not separate agent integrations.

The product is a local usage dashboard: tokens, reported AI credits, daily trends, activity calendar, working-hour patterns, cache usage, and rankings by model, project, and session. Counts refer to available local Copilot records, not the user's entire GitHub account or organization across every device and editor.

## Approach

Use a native Copilot canvas, retaining useful chart rendering, formatting, date filters, and visual design from the existing dashboard. Replace the data ingestion and host integration. A chat-only MCP plugin would lose the dashboard; a standalone website would not meet the desktop integration goal.

User-confirmed requirements: GitHub Copilot desktop host, GitHub Copilot usage only, removal of the old host's language. Approved for implementation and local testing in the desktop app.

## Data and accounting

- Discover `${COPILOT_HOME:-~/.copilot}` and explicitly configured additional Copilot home folders. Never scan `.claude`, `.codex`, or OpenCode databases.
- Prefer durable `session.usage_record` receipts in `session-state/<session>/events.jsonl`. These were verified in this installation and contain per-call tokens, model, provider, accounting identity, and Copilot-reported credits. Read session start/context events only for session and project attribution; do not retain prompt or response content.
- Count Copilot-served models. Exclude explicitly marked bring-your-own-key/custom-provider usage. Include older records only when there is positive Copilot attribution (for example, Copilot billing metadata); otherwise show them as unclassified coverage outside the totals. Do not assert account-wide coverage.
- Use `accounting.sourceSessionId` plus `accounting.usageId` to deduplicate receipts replayed by resumes, forks, or copied roots. Do not add cumulative `session.usage_checkpoint` or `session.shutdown` totals to the same per-call records. Do not add the equivalent live `assistant.usage` event again.
- Support the local `session-store.db` `assistant_usage_events` table as a read-only fallback for sessions without durable receipts. Choose one source per session, with receipts taking priority; do not merge both representations of the same calls. Surface the fallback's attribution limits, missing schema, unavailable fields, and unreadable sources.
- Use receipt timestamps for daily/hourly charts. Do not distribute cumulative session totals across invented dates or fabricate per-model attribution from the session's last selected model.
- Label per-call counts as requests, not user turns. Histories with only aggregate checkpoints are reported as incomplete coverage rather than being assigned invented per-call dates.
- Normalize input tokens without double-counting cache reads and writes: Copilot's input total includes cache categories. Reasoning tokens are a subset of output tokens. Keep raw totals and distinguish unavailable counts from explicit zero.
- Store reported charges as integer nano-AI units; display AI credits by dividing by 1,000,000,000. Respect the receipt's availability/completeness status. Missing charges are unavailable, not free. Do not interpret request multipliers as dollars or credits.
- Remove API price catalogs, price sync, price overrides, estimated dollar costs, and estimated cache savings. No network price lookup is needed for Copilot-reported credits.
- Rework Breakdown around recorded model, project, session, and token categories. The existing file/command cost attribution and Explain workflow depend on unrelated transcript formats and must not be presented as supported Copilot analysis. Do not invent file-level spending.
- Preserve incremental reads, tolerate incomplete trailing lines, and handle log replacement/deletion, overlapping roots, and malformed records. Cache only derived usage metadata. Refresh on demand and periodically while the canvas is open.

## Desktop integration

- Use root Agent Plugins 1.0 `plugin.json`, a marketplace catalog, and `com.github.copilot/extensions/usage-insights/extension.mjs`.
- Import `createCanvas` and `joinSession` from the SDK supplied by the desktop runtime. Register an `open_usage_insights` tool that opens the canvas in the app's side panel.
- Serve bundled HTML through Node HTTP bound only to `127.0.0.1` on an assigned port. Protect it with an unguessable token, validate Host and Origin, bound request size, and expose only defined dashboard methods. Never serve arbitrary files. Disable caching and referrer leakage.
- Replace the old injected messaging API with a same-origin dashboard transport. Retain fixture preview support and the existing light/dark visual styles. Dispose the server, timers, subscriptions, and scanner cleanly when the final canvas instance closes.
- Store settings in a durable `copilot-usage-insights` config directory: `%LOCALAPPDATA%` on Windows, `~/Library/Application Support` on macOS, and `${XDG_CONFIG_HOME:-~/.config}` on Linux. Keep derived caches in the OS cache directory. Validate settings and write atomically.
- Settings offer additional Copilot homes and disabled sources. The old provider-specific folder and SSH settings are removed. Copied or mounted Copilot homes can be added explicitly; live remote SSH collection is outside this first Copilot-only release.
- If retaining the worktree scope filter, inspect `<Copilot home>/copilot-worktrees/<repository>/<worktree>`, not repository containers. Label the scope accurately and show discovery failures.
- Update README installation instructions for Copilot Customize/marketplaces, provide a safe local development install command, and generate dashboard-only screenshots from synthetic Copilot fixtures.
- Keep a dependency-light Node 24 codebase. Preserve reusable analytics/chart tests, replace obsolete provider tests with Copilot ingestion and credit-accounting tests, and remove unused source modules.

## Validation

- Synthetic fixtures cover receipts, duplicated/replayed accounting identities, cache-inclusive input, reasoning subsets, unknown/partial charges, BYOK exclusion, model changes, truncated lines, and malformed entries.
- SQLite fixtures cover source selection, missing schema, read-only access, and avoiding double-counting a session represented in both sources.
- Verify totals, local date ranges, model/project/session filters, credit aggregation, and empty/error states with fixed fixtures.
- Exercise canvas lifecycle and authenticated loopback requests, including invalid tokens, cross-origin access, malformed payloads, settings persistence, and cleanup.
- Build the panel reproducibly and check packaging against the installed desktop SDK. Smoke-test the dashboard with synthetic data in Brave and attempt an actual in-app load.
- Compare a read-only scan against available local Copilot records without committing personal data. Report what was tested and any historical coverage limitations.

## Evidence

- [Canvas documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
- [Desktop customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
- [Plugin formats](https://docs.github.com/en/copilot/reference/plugin-and-marketplace-reference)
- [Copilot session events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)
- [Copilot configuration directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- Installed SDK types confirm canvas lifecycle, accounting identities, credit units, availability semantics, and cache/usage fields. Actual local receipts and the SQLite schema confirm persisted usage records in this installation. These storage details and experimental canvas APIs may evolve; unsupported layouts must produce explicit diagnostics.
