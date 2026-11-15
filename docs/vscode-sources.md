# VS Code Copilot Chat usage

Version 0.1.78 imports attributable per-call receipts from retained VS Code Copilot debug logs. It does not reconstruct missing history or read an account-wide billing API.

## Setup

1. Update Usage Insights, restart Copilot desktop and open the dashboard in a new session. In Settings, leave **Include VS Code Copilot Chat** enabled.
2. Check **Local data sources**. Windows discovery checks `%APPDATA%/Code/User` and `%APPDATA%/Code - Insiders/User`. A source with no retained debug logs explains that limitation.
3. If logging is not enabled, open **VS Code Settings (JSON)** and set `"github.copilot.chat.agentDebugLog.fileLogging.enabled": true`. For WSL, check the setting in the connected remote window. If your Copilot extension does not recognize it, update VS Code/Copilot first. Reload the VS Code window, make a new Copilot Chat request, wait for logging to flush, then click **Refresh** in Usage Insights.
4. Choose **Windows** or the WSL distribution in the menu beside **AI credits** to inspect that environment. Start WSL first if its storage is needed.

The logging setting is [declared by Microsoft's Copilot extension](https://github.com/microsoft/vscode/blob/main/extensions/copilot/package.json). These upstream debug logs can contain prompts and tool payloads. Usage Insights does not enable logging itself and retains only selected accounting/attribution metadata in memory. Do not attach entire debug logs to an issue; use **Show logs** and source states first.

## Locations and controls

The importer checks `workspaceStorage/<workspace>/github.copilot-chat/debug-logs/<session>/*.jsonl` and `globalStorage/github.copilot-chat/debug-logs/<session>/*.jsonl` beneath each User folder, including profile storage. It reads `workspace.json` only for folder/workspace identity; repository files are not inspected.

Running WSL distributions are checked under `/home/*` and `/root` for `.vscode-server/data/User` and `.vscode-server-insiders/data/User`, even without a CLI home. Standard macOS and Linux Code/Insiders User storage is also supported. Other remote machines, portable installs and custom user-data locations are not automatically mounted or searched. Add a readable **User** directory under **Additional VS Code User folders**, such as `C:\custom-data\User` or `\\wsl.localhost\Ubuntu\home\alice\.vscode-server\data\User`.

Custom User folders remain enabled when automatic VS Code discovery is off. **Disabled source folders** accepts a User directory or a displayed debug-log root to exclude it. Automatic discovery is bounded to 50 profiles per User directory, 2,000 workspaces per profile and 20,000 JSONL files per scan; reaching a limit produces a source warning.

## What the numbers establish

| Data | Treatment |
| --- | --- |
| AI credits | Recorded `copilotUsageNanoAiu / 1e9`; zero is valid. No model-price estimate. |
| Provider attribution | Requires an explicit valid Copilot charge. Missing charges and explicit BYOK/custom-provider entries are excluded. A familiar model name is insufficient. |
| Tokens and model turns | Recorded inclusive input and output, with one turn per unique request receipt. Missing token counts stay unavailable. |
| Cache and reasoning | The inspected logger omits the complete cache split and reasoning count. Inclusive input remains counted once; unavailable subdivisions are not filled with zeros. |
| Prompts, skills and tool outcomes | This importer does not infer these from debug payloads. CLI histories retain their existing activity support. VS Code-only prompt counts/cost averages can remain unavailable. |
| Child sessions | Attributable child receipts are included as their own sessions; no unsupported parent-prompt attribution is invented. |
| Environment and project | Storage host plus explicit remote workspace URI. Missing workspace identity uses **VS Code** as the project. |

The [logger/schema](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/chat/vscode-node/chatDebugFileLoggerService.ts) and [response accounting](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/prompt/node/chatMLFetcher.ts) are the format references. Logging and retention vary by extension version. Absent, rotated, truncated or older incompatible logs cannot establish complete usage, and inline-completion coverage is not claimed.

Receipts use session-scoped **span IDs**. A response ID can be shared by multiple billed calls in one agent turn and is not a unique call identifier. Replays and copies count once; copies retain the first discovered source's environment. Conflicting entries for the same span within a journal are excluded. Where a CLI journal owns the same session, it takes precedence over that entire VS Code debug session directory, including child files, to avoid double-counting. This conservative rule can omit debug-only work in an overlapping session. Independent native VS Code sessions remain included. See the [0.1.79 undercount investigation](credit-undercount.md).

## Performance and verification

The existing incremental file reader and in-memory snapshot handle these logs. Unchanged files reuse parsed data, growing files are checked before tailing, and source-setting changes or manual Refresh force a reread. Selecting an environment does not discover sources or rescan history. The existing visible 15-minute refresh remains unchanged.

Synthetic tests cover Windows/WSL attribution, exact/zero charges, replay/conflicts, CLI overlap, missing fields, append/replacement/deletion, source controls, environment filters, prompt grouping, activity and request drill-downs. This development PC has no retained VS Code accounting logs or running user WSL distribution. On the affected PC, compare one newly recorded VS Code call with its source receipt, then verify its environment and project in the dashboard. Also manually check the new dropdown at narrow widths; no browser or desktop automation was used.
