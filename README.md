# Copilot Usage Insights

A local usage dashboard for the **GitHub Copilot desktop app**. Open it as a canvas to explore token usage, recorded AI credits, skill activations, models, projects, and sessions.

## Install in GitHub Copilot desktop

Use the GitHub Copilot desktop app with canvas support, signed in to your GitHub account. The app installs the plugin from this repository; you do not need to clone it or run npm commands.

### 1. Add the marketplace

1. Open **Customize** in the Copilot app sidebar.
2. Select the **marketplace settings control** next to the marketplace dropdown.
3. Follow the prompts to add a GitHub repository or Git URL. Paste this repository URL:

   ```text
   https://github.com/AndrewGodlewsky/copilot-usage-insights
   ```

4. Complete the add-marketplace prompts. If asked for a branch, use **`main`**.

The marketplace name is **`copilot-usage-insights`**. This repository hosts its catalog at [.github/plugin/marketplace.json](.github/plugin/marketplace.json); the URL to enter in the app is the repository URL above.

### 2. Install and enable the plugin

1. Open **Customize → Installed** and click **Add plugin**.
2. In the **Install plugin** dialog, paste this exact value into **Name**:

   ```text
   copilot-usage-insights@copilot-usage-insights
   ```

3. Click **Install**.
4. Make sure the plugin's toggle under **Customize → Installed** is **on**.

The Name field uses `plugin@marketplace`: the first part identifies the plugin and the second identifies the marketplace you added in step 1. You can also install it from **Customize → Browse** by selecting the **copilot-usage-insights** marketplace and searching for the plugin.

Adding the marketplace makes the plugin available to browse. Installing and enabling the plugin makes its canvas available to sessions. The marketplace and plugin both use the name `copilot-usage-insights`.

### 3. Open the dashboard

Start a **new session** in Copilot desktop and send:

> Open Usage Insights.

Copilot can call the plugin's `open_usage_insights` tool to open the dashboard in the right side panel. It reads local Copilot usage automatically. Use **Refresh** to reread the records or **Settings** to add other Copilot home folders.

### Update an existing installation

In **Customize → Installed**, use **Update** in the Plugins section. Version **0.1.13** tightens the Skills used table, centers details under their headers, and adds faint dotted column dividers. Start a new session and reopen Usage Insights after updating. Restart Copilot if an older canvas is still running.

### If it does not appear

- **Marketplace added, plugin missing:** check that the URL is the repository URL above and that the marketplace is included in the Browse filter. Adding the marketplace does not install the plugin automatically.
- **Plugin installed, canvas unavailable:** check the toggle under **Customize → Installed**, then start a new session. Restart Copilot if it has not picked up the installation.
- **Dashboard opens but is empty:** make a request in Copilot, then click **Refresh**. Expand **Local data sources** to check which folders were read. Only available local usage records are counted.
- **Previously used the personal installer:** move its `usage-insights` folder out of `~/.copilot/extensions` before enabling the marketplace copy. On Windows, the default folder is `%USERPROFILE%\.copilot\extensions\usage-insights`. Keep one installed copy so the same tool is not registered twice. If you set `COPILOT_HOME`, use that folder instead of `~/.copilot`.

These steps follow GitHub's [plugin and marketplace setup instructions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#adding-a-plugin-marketplace). Desktop installation and rendering still need an in-app smoke test; automated checks cover the package entry and dashboard backend.

## Local development (optional)

Use this path to test changes from a local checkout. It requires Node.js 24 or later in addition to the Copilot desktop app. There are no npm dependencies to install; the YAML parser is bundled with its license under `src/vendor/js-yaml`.

From this repository:

```sh
npm test
npm run install:local
```

Then start a **new session** in the Copilot desktop app and ask:

> Open Usage Insights.

The extension exposes `open_usage_insights`, which opens the dashboard in the right side panel. If a session predates installation, start a new one; if the app has not discovered the extension yet, restart the app. You can also look under **Customize → Installed** for the canvas.

The installer copies the extension into `~/.copilot/extensions/usage-insights` (or `$COPILOT_HOME/extensions/usage-insights`). Rerun `npm run install:local` after making changes, then use a new session. It replaces only a previous installation carrying this installer's marker. Settings are stored separately and survive upgrades.

To remove the local installation, close its sessions and delete that `usage-insights` directory. Do not install both the personal extension and its marketplace package at the same time.

## Browser preview

```sh
npm run preview:demo  # synthetic data
npm run preview       # your local Copilot usage
```

Open the printed localhost URL in your browser. Stop with Ctrl+C. A browser preview exercises the dashboard; the desktop app supplies the SDK for the actual canvas integration.

## What is counted

The **Usage** view includes a token overview with total tokens, input including cache, output, uncached input, cache reads, cache writes, and cache hit rate. The daily chart and **Tokens by type** bar show how the total is divided. Hover over a count to see its full value. The **AI credits** selector changes the daily chart; the token summary remains visible.

Click a **daily bar** to show that day's token total, input/output/cache counts, and token-type bar. Click the selected day again or choose **Show all days** to return to the overall filtered totals. Bars also support Tab, Enter, and Space. Changing a filter resets the selection; refreshing keeps it. The daily chart and the other dashboard sections continue to show the full selected date range.

**Cache hit rate** is cache-read tokens divided by all input tokens. If a cache split is missing, the rate is unavailable. Turning off **Include cache tokens** removes cache from totals and charts; the individual input/output/cache counts remain visible for reference. An asterisk marks incomplete coverage. Missing counts show **Unavailable**.

- Only requests attributed to GitHub Copilot in local records. Models used **through Copilot** appear regardless of their model vendor. Custom-provider and bring-your-own-key requests are excluded.
- Both desktop and CLI usage can appear when they share the same Copilot home. This is local recorded activity, not an account-wide billing report.
- Durable `session.usage_record` receipts from `session-state/*/events.jsonl` take precedence. The read-only `session-store.db` usage table is a fallback for sessions with no receipts. Checkpoints and session summary totals are not added again.
- Copilot input totals already include cache tokens. The dashboard separates cache reads and writes without counting them twice. Reasoning tokens are part of output and are not added again.
- **AI credits** use Copilot's recorded `totalNanoAiu` divided by one billion. No model-price estimates, dollar totals, remaining balances, or subscription limits are inferred. Missing charges show as unavailable; partial amounts and incomplete totals are marked.
- Date ranges use local calendar days. Activity and streak show filtered history; the daily chart and breakdown use the selected dates. Excluding cache changes token totals, not credit charges.

**Usage breakdown** includes **Reasoning** and **Avg. tokens / request** for each model, project, or session. Reasoning is reported separately but remains part of output, so it is not added to totals again. The average uses only requests whose input and output counts are both known, follows **Include cache tokens**, and shows an asterisk when some requests are excluded for incomplete counts. Hover over an average to see how many requests contributed; if none have complete counts, it shows **Unavailable**. These are request metrics, not token charges assigned to individual skills.

**Group by → Session** and the **Session** filter show Copilot's saved session names. The reader uses `name` from `session-state/<session>/workspace.yaml` when available, then falls back to `summary` in the existing `session-store.db` sessions table. Names refresh with the report, including when usage logs have not changed. Missing names fall back to the project and the date/time of the earliest available usage record; duplicate names also include that date/time. Session IDs remain the grouping and filter keys, so identically named sessions stay separate. Hover over a session name to see its ID.

Use **Settings** to add mounted/copied Copilot homes or disable a home. Sources are scanned incrementally while the canvas is visible. **Refresh** forces a complete reread. Source diagnostics explain missing homes, unsupported schemas, and skipped records. Copilot's local event format and canvas APIs are experimental; app updates can require a reader update.

Settings live in `%LOCALAPPDATA%/copilot-usage-insights/settings.json` on Windows, `~/Library/Application Support/copilot-usage-insights/settings.json` on macOS, or `$XDG_CONFIG_HOME/copilot-usage-insights/settings.json` on Linux (default `~/.config`).

In **Settings → Text size**, choose **Small** (the original size, and the default), **Medium** (15% larger), or **Large** (30% larger), then click **Save settings**. The same proportional scale applies to headings, tables, controls, chart labels, tooltips, and the Settings dialog. Charts allow more room for larger labels, and wide tables can scroll horizontally. The choice is saved locally with your source settings and restored when you reopen the dashboard. Closing Settings without saving leaves the current size unchanged.

## Skills used

Open **Breakdown** to see **Skills used** below the token table. Its columns are **Skill** (with folder actions), **Activations**, **By user**, **By agent**, **Sessions**, **Projects**, **Source plugin**, **Plugin version**, **Skill version (installed)**, and **Last used**, in that order. Skill names stay left-aligned, while the remaining headers and values are centered with faint dotted column dividers. The skill column narrows as space becomes limited, and long names wrap. All columns remain available; scroll horizontally when they no longer fit. Rows distinguish recorded plugin versions and locations. Date, project, and session filters apply to the activation itself. The model filter does not filter skill activations because those events do not consistently record a model.

**By user** counts events whose `data.trigger` is `user-invoked` (a slash command or explicit UI action); **By agent** counts `agent-invoked`. **Activations** includes those plus **Preloaded** (`context-load`) and **Unknown** (missing or unrecognized triggers). Hover over an activation count to see all four counts. Preloaded and unknown activations are not assigned to either trigger column, so **By user** plus **By agent** can be less than **Activations**. A replayed event is counted once; a prompt that reuses an already loaded skill is not necessarily another activation.

**Source plugin** and **Plugin version** come from `data.pluginName` and `data.pluginVersion` in Copilot's saved `skill.invoked` or `skill.invoked_ref` events under `session-state/<session>/events.jsonl`. The tracker reads the values recorded for that activation, rather than looking up the plugin's currently installed version. They identify the plugin that supplied the skill and that plugin's version, not a version declared in the skill itself. These fields are optional in GitHub's [`skill.invoked` event reference](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events#skillinvoked). Personal skills such as `~/.copilot/skills/example-skill/SKILL.md`, and project skills, normally have no source plugin. **No plugin recorded** / **—** means those fields were absent; it does not mean the skill failed to run.

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

This is the **current installed version**, not evidence of which version ran in an older session. Neither GitHub's event reference nor the SDK's [`SkillInvokedData` type](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts) defines a dedicated `skillVersion` field. The event's injected content does not guarantee preserved YAML frontmatter; inspected local records omitted it. Historical skill-version reporting would need version information saved with the activation. The [event reader](src/core/copilot.mjs) keeps recorded plugin metadata and paths; the separate [installed-version reader](src/node/skill-version.mjs) supplies the current file metadata.

Click a skill name to open the folder containing its recorded `SKILL.md` in Explorer, Finder, or your Linux file manager. Use the copy button beside the name to copy just the containing folder path to your clipboard, then paste it into your file manager if opening the folder is blocked. The folder path is no longer displayed beneath the name. The dashboard uses that exact saved location; it does not search for another skill with the same name. Missing or moved files show an explanation. Paths from another computer may not be available locally; remote paths are not opened. Copying works from the recorded path even if the folder has moved or is on another computer. If Copilot did not record a path, the name is plain text with no copy button and a **Location not recorded** tooltip.

The reader counts persisted `skill.invoked` and `skill.invoked_ref` events from local session logs. Reference events carry activation metadata while referring to the skill body separately; counting them does not require loading that body. Each distinct event ID within a session counts once, including when several activations reference the same content. Replayed events, full/reference copies of the same event, and copied homes are deduplicated. It includes sessions with Copilot-attributed requests and omits activations in sessions with mixed or missing provider attribution, with the omitted count shown. This conservative rule can omit genuine Copilot activations in mixed-provider sessions. A skill-only session can appear once Copilot request accounting is available.

An empty list means **no recorded activations match the filters**, not that skills have never been used. Older logs and database-only history may lack skill events. Skill definitions and arguments are discarded; the dashboard keeps names, recorded file paths, current installed skill versions, and activation metadata locally. Activations show which skills were loaded, not whether every instruction was followed, and do not carry per-skill token charges.

## Tool activity

The **Tool activity** table in **Breakdown** lists calls, successes, failures, unknown outcomes, success percentage, and last use by tool. When a saved call identifies an MCP server, its server and tool names appear together; this counts actual calls, not configured servers.

The reader pairs persisted `tool.execution_start` and `tool.execution_complete` events by session and tool-call ID. A recorded `success: true` counts as success; `success: false` counts as failure. Missing or invalid outcomes remain **Unknown**, including calls still running. **Success rate = successes / (successes + failures) x 100**; unknown outcomes are excluded, and no known outcomes means **Unavailable**. These are tool outcomes, not proof that a skill or the overall task succeeded.

Date filters use the call's start time, with its latest recorded outcome. Project and session filters apply; model filters use the model explicitly recorded on the start event and exclude calls with no matching model. As with skills, calls from sessions with missing or mixed provider attribution are omitted, with coverage notices. A completion without a saved start cannot be identified as a table row. Copied logs and replayed calls are deduplicated.

Skill trigger counts, tool outcomes, and request metrics are reconstructed from Copilot's existing local records when the dashboard refreshes. No background recorder, new history database, or per-skill token estimates are introduced. Tool arguments, results, and error-message contents are discarded.

## Possible next additions

These are supported by Copilot event metadata but are **not implemented in this release**:

| Capability | What could be shown |
| --- | --- |
| Tool timing | Elapsed time when start and completion events can be paired |
| Subagents | Agent names, selected models, durations, and reported tool counts |
| Response performance | Request duration and time to first token where recorded |

GitHub documents [skill, tool, and subagent events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events). Historical coverage depends on which events the app persisted. A configured MCP server is not evidence it was used. Session token totals cannot reliably be assigned to an individual skill or MCP call without explicit accounting links. Any further activity view should retain names and counts, without retaining tool arguments or output.

## Privacy and runtime

The extension reads local usage metadata, saved session names, and a bounded prefix of recorded local `SKILL.md` files to extract installed versions. Session workspace metadata reads are limited to 64 KiB, and only the name is retained, capped at 256 characters. It never modifies Copilot's records or skill files. Conversation message bodies are discarded while parsing and are not retained in the in-memory usage index or sent to the dashboard; session names are displayed locally. Nothing is uploaded. The canvas uses a random-token URL on `127.0.0.1`, validates request origins, and shuts down its server when the last canvas closes. Treat its URL as private while it is open.

## Development and distribution

```sh
npm run build  # regenerate the committed panel/index.html
npm test
```

The root `plugin.json` and `.github/plugin/marketplace.json` package this repository for distribution. The desktop extension entry is `com.github.copilot/extensions/usage-insights/extension.mjs`; the Copilot app provides `@github/copilot-sdk/extension` at runtime. Do not run that entry as a standalone Node process.

Local installation does not publish anything. The marketplace uses the files on the repository's default branch; the personal installer supports local development without a push.

See GitHub's [canvas documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions) and [plugin reference](https://docs.github.com/en/copilot/reference/plugin-and-marketplace-reference). Licensed under [MIT](LICENSE), with original copyright retained.
