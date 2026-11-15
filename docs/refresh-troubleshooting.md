# Refresh connection failures

Version 0.1.73 improves recovery and evidence collection. It does not establish or claim to fix the cause of the reported Windows connection loss.

## Evidence from the reported incident

In v0.1.71, the first usage report returned HTTP 200 in about 1.75 seconds and the following inventory read returned HTTP 200 in about 42 ms. At the first 60-second refresh, fetch failed with a TypeError in about 3 ms without an HTTP status. Manual refresh and diagnostics also failed immediately. The user confirmed Windows and that the chat remained open.

This points to the dashboard losing access to its local HTTP endpoint. The logs cannot distinguish an extension/server exit from a browser or host restriction. A normal handled scan error returns an HTTP error response, and diagnostics remains independently readable. The 60-second interval tells us when the next request noticed the problem, not when the connection was lost.

The plugin has no inactivity shutdown timer. A local test on this Windows machine successfully requested usage, waited 61 seconds, and requested usage again (HTTP 200 both times). This tested the real server directly, not the Copilot canvas on the affected computer. Closing a test server reproduces the immediate fetch TypeError; that demonstrates one possible failure path, not the incident's root cause.

The locally installed Copilot extension bootstrap watches its parent process and exits if that parent disappears. Canvas close and extension signal handlers also close the local server. An open chat does not by itself establish that its extension process remained alive. No host lifecycle behavior or cleanup rules have been changed.

## Capture after updating

1. Update the plugin, fully quit and restart Copilot, start a new session, and open Usage Insights. Leave it open through an automatic refresh. From v0.1.74 the interval is 15 minutes; clicking **Refresh** after a minute can check the connection sooner.
2. If refresh fails, use **Show logs → Copy logs** before closing the dashboard. The export includes client connection stages and any cached server snapshot, explicitly dated.
3. Close and reopen Usage Insights from Copilot, then copy logs again. This second export can include lifecycle records from the previous extension process. If the dashboard cannot reopen, the two diagnostic files in the plugin's settings directory can be inspected directly.

There is no automatic upload. Logs omit prompts, names, session IDs, paths, credentials, raw error messages, and the private canvas address. On Windows the files are `%LOCALAPPDATA%\copilot-usage-insights\diagnostics.jsonl` and `diagnostics.previous.jsonl`. They rotate at 128 KiB each; export retains at most 300 lifecycle entries. Write failures do not block the plugin, simultaneous processes may lose some rotation history, and a forced kill may leave no exit event. Browser online status alone does not establish whether loopback requests are allowed.

## Regression coverage

`tests/panel.test.mjs` covers preserving matching reports during failures, hiding mismatched filter results, keeping filters reachable, recovery, cached server evidence without extra requests, and redacted connection logs. `tests/runtime-diagnostics.test.mjs` covers real loopback shutdown/reopen, lifecycle persistence, bounded files/reads, corrupted input, redaction, and unavailable storage. `tests/diagnostics.test.mjs` checks safe fields and confirms that handled data errors still leave diagnostics reachable.

No automatic retry is added to paid AI review or other actions. Report calculations, log scanning, polling frequency, and host/server lifecycle remain unchanged.

## First-load evidence in 0.1.83

The reported 0.1.82 incident failed before any successful usage or inventory response: the first request failed at the fetch stage after 19.5 seconds, and diagnostics then failed in about 20 ms. No HTTP response or server snapshot was available. This establishes loss of access to the endpoint, not why it happened. The connection failure has not been reproduced or fixed by this logging update.

The server now embeds a sanitized runtime snapshot, including recent persisted entries, in the initial page response. This survives failure of the first usage request. Subsequent inventory snapshots include persisted entries too. Reading these bounded diagnostic files does not rescan usage or add a background polling loop. Scan-start events now persist alongside completions, so a later export can show an unfinished scan.

An already-open page cannot read new disk records through a stopped server. **Show logs → Load saved logs** provides a local file picker for that case. Select `diagnostics.jsonl`, optionally with `diagnostics.previous.jsonl`, then copy the combined export. The dialog contains folder instructions for Windows, macOS, and Linux. Reads are limited to two 1 MiB files; only known runtime events and allowlisted fields survive, with up to 300 imported entries. Filenames and raw text are not added to exports, and no upload occurs. Reopening the dashboard captures persisted records without manual file selection when its server can start again.

Synthetic tests cover failure of the first request, copying retained snapshots, malformed and oversized imports, overlapping rotated files, redaction, disk persistence, and log collection without usage scans. Actual file-picker behavior in the Copilot canvas requires a manual check.
