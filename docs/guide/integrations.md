# Skills, MCP servers, and plugins

[Documentation index](../README.md) · [Project overview](../../README.md)

Historical activity and the current host inventory measure different things. This guide explains their attribution, coverage, and optional MCP test fixture.

## On this page

- [Skills](#skills)
- [MCP Servers](#mcp-servers)
- [Plugins](#plugins)

## Skills

Open **Breakdown → Skills** to see recorded skill uses below the token table. Use the **Skills**, **Plugins**, and **MCP** buttons to switch detail panels. Skills is selected when the dashboard opens; your choice stays selected during refreshes, filter changes, and visits to the Usage view. The usage breakdown table stays visible above these buttons.

Each detail panel has its summary on the left and a **Sort by** menu on the right, without a repeated title. Each menu keeps its own selection while the dashboard is open, including across refreshes, filter changes, and panel switches. Reopening the dashboard restores the defaults.

| Panel | Sort options | Default |
| --- | --- | --- |
| Skills | Most uses, Most failures, Recently used, Name (A–Z), Most sessions | Most uses |
| Plugins | Name (A–Z), Enabled first, Marketplace (A–Z) | Name (A–Z) |
| MCP | Most calls, Most failures, Recently used, Name (A–Z) | Most calls |

Counts sort from highest to lowest; recently used sorts newest first, with missing dates last. Names and marketplaces sort alphabetically as displayed. Enabled first puts installed, enabled plugins first and plugins not yet installed last. Sorting changes only row order, not counts or filters.

The **Skills** columns are **Skill** (with a folder-path copy button), **Uses**, **By user**, **By agent**, **Sessions**, **Failures**, **Skill version (installed)**, and **Last used**, in that order. The wider Skill/Project column wraps long names; its copy button stays at the right edge. Other headers and values are centered with faint dotted dividers. Rows retain separate identities for recorded plugin versions and locations even though source-plugin and plugin-version columns are hidden. Date, project, and session filters apply to successful activations and failed load attempts. Failed attempts use the tool-start date and project. The model filter does not filter either because skill activity does not consistently record a model.

**Sessions** includes sessions with recorded uses or failed loads. **Last used** is the most recent use or failed load attempt and displays local time in a compact month/day/year format, such as **11/13/26, 10:49 PM**. Hover over it for the full timestamp, including seconds.

**By user** counts events whose `data.trigger` is `user-invoked` (a slash command or explicit UI action); **By agent** counts `agent-invoked`. **Uses** counts recorded successful skill loads, including those plus **Preloaded** (`context-load`) and **Unknown** (missing or unrecognized triggers). Hover over a use count to see all four counts. Preloaded and unknown activations are not assigned to either trigger column, so **By user** plus **By agent** can be less than **Uses**. A replayed event is counted once; a prompt that reuses an already loaded skill is not necessarily another activation.

**Failures** counts paired built-in `skill` tool calls whose completion explicitly records `success: false`. Starts and completions join by session ID and tool call ID, including copied journal portions, and each attempt counts once. Missing completions, unknown outcomes, successful tool calls, and MCP tools named `skill` do not increase this count. Failed loads never increase **Uses**, **By user**, **By agent**, or preloaded/unknown activation counts. A zero means no recorded failures in the selected filters, not proof that every load attempt was logged. This measures loading a skill, not whether work performed after a successful load was correct.

A failure carrying only a requested name is attached to an existing skill only when that exact name identifies one recorded path/plugin/version identity in the same session and project. Matching considers all available nonfuture included activations, so narrowing the date filter cannot hide a conflicting identity. Ambiguous or unmatched attempts appear in a separate **(unresolved)** row; missing names appear as **Unknown skill**. No counts are copied into multiple skill rows. Failure-only rows show zero uses. Unresolved rows have no copy action and no invented plugin or version; matched rows reuse their recorded location.

Failures reuse the existing incremental journal parser and scanner, with no additional source, scan, or network request. Activity without billing receipts is included with **provider unverified**; conflicting or rejected provider evidence still excludes it, with a separate omitted-failures count. An outcome must be recorded at or after its start and no later than the current time; duplicate outcomes follow the existing latest-completion rule.

Recorded source-plugin and plugin-version metadata comes from `data.pluginName` and `data.pluginVersion` in Copilot's saved `skill.invoked` or `skill.invoked_ref` events under `session-state/<session>/events.jsonl`. It remains available for attribution and row identity, but is no longer displayed in separate columns. It identifies the supplying plugin rather than a version declared in the skill itself; missing metadata does not mean that a skill failed to run.

A skill can declare its own optional version in its `SKILL.md` frontmatter. The [Agent Skills specification](https://agentskills.io/specification#metadata-field) demonstrates `metadata.version` as a string; it does not define a top-level `version` field:

```yaml
---
name: example-skill
description: Explain how to perform an example task.
metadata:
  version: "1.2.3"
---
```

**Skill version (installed)** reads `metadata.version` from the current `SKILL.md` at the recorded path. It is independent of **Plugin version** and can appear for personal, project, and plugin skills. It is refreshed whenever the dashboard reloads its report, including automatic refresh and the **Refresh** button. Changing a skill file does not change recorded plugin versions, activation counts, or historical row identities.

The column shows **Not declared** when a readable file has no `metadata.version` (or a blank string), and **Unavailable** when the path is missing, non-local, unreadable, or the frontmatter/version is invalid. A top-level `version` is not used. Versions must be strings of at most 256 characters without control characters. The reader checks at most the first 64 KiB for a complete frontmatter block, uses a bundled YAML parser with nesting/alias limits, and retains only the version value. Skill files are never executed or modified.

This is the **current installed version**, not evidence of which version ran in an older session. Neither GitHub's event reference nor the SDK's [`SkillInvokedData` type](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts) defines a dedicated `skillVersion` field. The event's injected content does not guarantee preserved YAML frontmatter; inspected local records omitted it. Historical skill-version reporting would need version information saved with the activation. The [event reader](../../src/core/copilot.mjs) keeps recorded plugin metadata and paths; the separate [installed-version reader](../../src/node/skill-version.mjs) supplies the current file metadata.

Click a skill name to expand its statistics by project; click it again to collapse. One skill expands at a time. Project rows show **Uses**, **By user**, **By agent**, distinct **Sessions**, **Failures**, and **Last used**, with the parent's installed skill version. The rows share the parent table's aligned columns and use a different background. Uses, failures, and trigger counts add up to the parent totals. Session counts may not: a session that changes projects appears in both projects but only once in the skill total.

Project statistics follow the same date, project, session, environment, and provider-attribution rules as their parent; the model filter still does not affect skills. Sorting and refreshing keep the expanded skill when it remains available; changing filters closes it. Expansion uses the current report with no extra scan or request. Unresolved failed loads and skills without a recorded path can also expand.

Use the copy button beside the skill name to copy its recorded containing folder path, then paste it into your file manager. Copying does not expand or collapse the row and works even if the folder has moved or is on another computer. Missing or ambiguous locations have no copy button. Clicking a skill no longer launches the file manager, and the folder-opening API has been removed.

The reader counts persisted `skill.invoked` and `skill.invoked_ref` events from local session logs. Reference events carry activation metadata while referring to the skill body separately; counting them does not require loading that body. Each distinct event ID within a session counts once, including when several activations reference the same content. Replayed events, full/reference copies of the same event, and copied homes are deduplicated. Saved activity remains countable without per-request billing receipts, including older summary-only sessions. Its row and summary are labelled **provider unverified**, with separate use/failure counts in the coverage text and AI-review evidence. This does not add tokens or charges. Sessions with rejected, non-Copilot, or mixed billing-provider evidence remain excluded; this conservative rule can omit genuine Copilot activations in mixed-provider sessions. Exclusions are visible beside the selected range. Activity-only sessions are available in the session filter.

An empty list means **no included skill uses or failed loads match the filters**, not that skills have never been used. Older logs and database-only history may lack skill events. The current VS Code debug-log reader imports model usage charges, not skill activations; VS Code token usage therefore does not establish skill coverage. VS Code's chat UI can record “Reading skill” before execution, so that string alone is not counted as a successful activation. A future importer needs verified completion, timestamp, and replay semantics; arbitrary `SKILL.md` reads are not treated as activations. Skill definitions, tool results, error details, and other arguments are discarded; the dashboard keeps requested skill names, recorded file paths, current installed skill versions, and activity metadata locally. Activations show which skills were loaded, not whether every instruction was followed, and do not carry per-skill token charges.

The Skills summary names the selected date range. Today, Last 7/30/90 days, Rolling 30 (month to date), All history, and custom dates use each activation's local calendar date. Identical lists across ranges can be valid when no additional activations were recorded in the extra days; an already loaded skill does not necessarily emit another activation when reused. Background history loading must finish before wider ranges are shown. **Show logs** includes `skills.report` for each report response: `skills` is the total deduplicated activation events in the scanned snapshot, `skillUses` and `skillFailures` are included counts after filters, `rows` is the skill-row count, and `omittedSkillUses`/`omittedSkillFailures` count matching events excluded for rejected or mixed provider evidence. `unattributedUses` and `unattributedFailures` count included activity without verified billing attribution. `range`, `scanId`, and `historyPhase` distinguish filter changes and provisional scans. These diagnostics contain counts only, without skill names, paths, or contents.

## MCP Servers

Select **Breakdown → MCP** to see the **MCP Servers** table, which replaces Tool activity. It shows **Server**, **Current status**, **Calls**, **Failures**, **Success rate**, and **Last used**. Expand a server name for its configuration name, source, source plugin/version, enabled state, whether tools have loaded, any reported connection error, and success/unknown-outcome counts. Names and details wrap; metric columns have dotted dividers and centered values.

**Current status** comes from the session hosting the dashboard, using Copilot's passive [`session.rpc.mcp.listConfigured()`](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/mcp#inspect-configuration-and-lifecycle) API. This read does not start, restart, or authenticate servers. Status can be Connected, Connecting, Needs sign-in, Failed, Disabled, Stopped, or Not started. Enabled configuration and an established connection are separate facts. A connected server can still be loading its tools. A historical server absent from the current configuration shows **Not in this session**. Live status is independent of the date, project, session, and model filters; it does not describe a session selected in the usage filter.

**Calls**, **Failures**, **Success rate**, and **Last used** come from persisted `tool.execution_start` / `tool.execution_complete` pairs that explicitly identify an MCP server. Calls are grouped by the configured server name (`mcpConfigServerName`, falling back to `mcpServerName`), across its tools. The history and current inventory are matched by that name; reusing a name for a different configuration does not establish that older calls reached the same endpoint. Ordinary shell/file tools are excluded. A server may be listed with zero calls because it is configured but has no matching recorded activity.

Date filters use each call's start time and its latest recorded outcome. Project and session filters apply; model filters require a matching recorded model. Mixed or missing provider attribution is omitted with a coverage count. Copied logs and replayed calls are deduplicated. Success rate is **successes / (successes + failures) x 100**; unknown outcomes are excluded. A dash means no known outcomes or no recorded last use. A failed tool call does not necessarily mean its server disconnected.

Connection status changes are live-only events, so this release does not calculate historical uptime, disconnections, or connection success percentages. No background recorder or new database is added. The inventory APIs are experimental: older hosts, failed requests, and timeouts show **Unavailable** while recorded usage stays visible. Both live inventories load independently after usage appears and refresh with the dashboard. Each host read waits at most three seconds and shares an already pending host request; filters reuse the latest result. Browser-only previews cannot query the hosting Copilot session.

### Optional local MCP test server

The repository includes [a small stdio MCP server](../../scripts/mcp-test-server.mjs) with two tools: `hello` returns a greeting; `intentional_failure` returns a deliberate tool error. Neither tool reads files, changes data, or contacts a network service. It needs Node.js 24 or later and is **not automatically installed** with the dashboard.

From a local checkout, register the server using its absolute path:

```text
copilot mcp add usage-insights-test -- node "/absolute/path/to/copilot-usage-insights/scripts/mcp-test-server.mjs"
```

On Windows, use the full Windows path in quotes. This uses Copilot's [supported MCP configuration command](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), which preserves other server entries. Start a new desktop session (restart Copilot if needed), then send:

> Call hello on the usage-insights-test MCP server twice, then call intentional_failure once. The failure is deliberate; do not retry it. Then open Usage Insights.

After refreshing, those calls should contribute **3 calls, 1 failure, and 66.7% success** in the matching date range. The connection can remain **Connected** despite the intentional tool failure. These are actual Copilot calls and may consume AI credits; no fake usage receipts are inserted. To remove the optional server, use `copilot mcp remove usage-insights-test`.

## Plugins

Select **Breakdown → Plugins** to see Copilot's current inventory: **Plugin**, **Installed version**, **State**, **Marketplace**, and **Management**. State distinguishes Enabled, Disabled, and Not installed (a managed desired plugin whose installation has not completed). Built-in and direct/local sources are labeled when there is no marketplace. **Managed** means an organization controls the plugin; a dash means no managed flag was reported. Missing versions show a dash.

This uses the hosting session's `session.rpc.plugins.list()` API, with its current account, working directory, and policy. Date and usage filters do not apply. Enabled means available under that configuration, not proof it was used, and an installed version is not a historical version at the time of a skill activation. The dashboard does not enable, disable, update, or uninstall plugins. Unsupported or failed inventory reads display Unavailable independently of MCP status and usage totals.
