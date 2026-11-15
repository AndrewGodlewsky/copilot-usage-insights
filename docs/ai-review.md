# AI Review integration

Added in 0.1.66. The panel previews the existing filtered, allowlisted statistics snapshot, sends it only on **Analyze my usage**, and displays plain-text feedback. Choosing which additional insights to include is separate work; this release establishes the model request/response path.

## Implementation

- `src/node/ai-review.mjs`: desktop SDK discovery, catalog filtering, same-account verification, isolated helper, cancellation, deadlines, and safe errors.
- `src/node/review-usage.mjs`: allowlisted accounting, atomic writes, live/durable receipt deduplication, and stopped-journal reconciliation.
- `src/node/canvas-server.mjs`: same-origin, per-canvas secret URL endpoints for catalog, reconnect, run, and cancel. Request ownership starts before asynchronous settings reads. A disconnected request cannot start a later review or cancel another request.
- `src/node/canvas.mjs`: separate server and cancellation ownership for each canvas instance. Closing one does not stop another canvas's work.
- `src/node/settings.mjs`: saved model preference and optional usage-source path. No credentials are stored.
- `src/panel/efficiency.mjs`: existing snapshot projection; no new history scan or automatic context inspection.

The service uses the attached session only for identity/catalog checks. It never changes its model, sends it a prompt, or stops it. A fresh helper uses the verified desktop executable, `mode: empty`, an empty workspace, separate temporary home, restricted environment, replacement system instructions, disabled discovery/skills/hooks/memory, no tools/plugins/MCP, and denied permissions. Tool metadata, canonical workspace, account, eligible model, and actual selected model are checked before inference. No provider fallback or automatic retry can incur a second charge.

The panel starts no automatic review. One operation per canvas runs at a time, with a three-minute overall limit and shorter startup/access deadlines. Input is limited to 48 KiB and accepted output to 64 KiB. The output limit validates the received answer; it is not a billing/token cap. Cancellation stops the owned helper. Shutdown awaits cleanup, with bounded storage and stop waits. Responses and preview snapshots are not persisted by the plugin.

## Account and compatibility boundaries

**Refresh models** reads the attached account's catalog, accepting only explicit `provider.kind: copilot` entries with enabled policy or no policy object. **Reconnect to GitHub** creates and validates a fresh helper, then closes it without inference. It does not initiate OAuth, switch the desktop account, or copy credentials. If sign-in fails, the UI directs the user to the existing Copilot/GitHub CLI sign-in. This deliberately preserves the reference adapter's authentication boundary.

Reference: [complete Enhance Prompt handoff](https://github.com/AndrewGodlewsky/copilot-enhance-prompt/blob/main/docs/copilot-sdk-agent-handoff.md), based on Enhance Prompt commit `38d1c70ad913f1d627a7c2a4fbe6c8bb6994be31`. The models, accounting, extension, services, diagnostics, build boundary and research notes were inspected before adaptation. The MIT notice is retained in `licenses/enhance-prompt-LICENSE`.

The installed SDK identifies runtime `1.0.106-8.unstable.r43566476370.g869eef3`. Inspected declarations include `types.d.ts`, `session.d.ts`, `extension.d.ts`, generated RPC/event types, and `index.js` implementations of session creation and `forceStop`. The latter can dispose listeners before final usage delivery, requiring durable reconciliation. SDK imports stay external and are resolved by the extension host; preview mode cannot perform AI reviews.

**Managed-policy limitation:** `types.d.ts` documents `enableManagedSettings: true` as requiring a session-level token. The reference options use logged-in-user authentication without that token, and the installed runtime accepts them. SDK forwarding confirms the options are passed through, but this does not prove enterprise policy fetching/enforcement. We retain `enableManagedSettings` and `enforceManagedModelDefaults`, check published model policy in both catalogs, and fail if the runtime rejects the session. We do not extract tokens or disable policy to bypass a failure. Enterprise-policy support is not claimed.

## Accounting and retention

Own source: `%LOCALAPPDATA%/copilot-usage-insights/usage`, with `~/.local/share/copilot-usage-insights/usage` fallback. `USAGE_INSIGHTS_DATA_DIR` overrides the parent directory. This override affects review receipts, not existing dashboard preferences. Project label: **Usage Insights**. Every review gets a unique timestamped session within that project, and UUIDs remain aligned between SDK, directory, header, and accounting identities. The parser aliases the earlier **Usage Insights AI Review** export label when its session header has no working directory, matching the writer's format. Old files and session IDs are preserved; copied journals still deduplicate. Session names retain their AI Review description. This rename does not repair legacy duplicated charges or change any calculation.

The writer is prepared before inference. Live `assistant.usage` and stopped-helper `session.usage_record` receipts pass through the same projection. Copilot charges use recorded `totalNanoAiu`; missing, partial, zero and external/BYOK attribution remain distinct. Repeated refreshes, copied journals, and live/durable copies do not double-count. Checkpoint aggregates are not additional requests. Successful and cancelled work retain any reported accounting. No human prompt events are fabricated.

Starting in 0.1.67, opaque accounting IDs up to 8 KiB are accepted and hashed with SHA-256 when they do not fit the short identifier format. This preserves equality between live and durable copies without retaining the opaque provider value. Production metadata showed call IDs around 500 characters, some with base64 padding; 0.1.66 discarded those identities and could count both copies. Historical receipts with lost identities are not merged by matching timestamps or amounts: separate calls can legitimately share those values.

Finishing a `review.run` invalidates the server's cached history, even on cancellation or failure. The panel immediately requests an incremental refresh using the current filters. No additional inference occurs, and unchanged source files reuse their parsed records. A different project, session, model, or date filter can still exclude the review. Retained accounting is independent of the temporary helper home and survives its cleanup.

Cleanup order is stop helper → reconcile journal → flush receipts → remove temporary home. Accounting or stop failures preserve remaining recovery data and report a safe failure; no automatic retry follows. A crashed process or failed cleanup can leave `usage-insights-review-*` directories under the OS temporary directory containing transcripts. Abrupt crashes before billing receipts arrive can leave accounting gaps. Local receipts are not an account-wide billing ledger.

Permanent accounting has no automatic expiry. It excludes prompts, responses, credentials, account names, file contents, and endpoint URLs. To clear it deliberately, close Usage Insights canvases and remove only its `usage` directory. Deleting receipts does not reverse GitHub billing. The source can instead be disabled in dashboard Settings. Enhance Prompt discovery remains enabled and separate.

## Validation

`npm run build` and `npm test` cover model/account/provider guards, permissions/isolation configuration, cancellation before setup and during inference, bounded storage failures, safe diagnostics, per-canvas lifecycle, receipt privacy/deduplication, discovery and disabled sources, saved model settings, explicit send, response escaping, and existing dashboard behavior.

Additional local SDK fixtures (set `COPILOT_SDK_DIR` and `COPILOT_CLI_PATH` to the installed pair):

```sh
node scripts/check-review-host.mjs
node scripts/check-review-sdk.mjs
```

The host check uses synthetic account/catalog data and tests both bootstrap forms. Use the desktop's `copilot.exe` launcher for the host-bootstrap check. The SDK check uses a loopback model with authentication disabled, plants private project/instruction markers, tests long opaque call IDs with both live and durable delivery, suppresses live usage in one run to verify durable recovery, and checks response, cancellation, cleanup, and accounting. Its test-only overrides cannot be selected by the production UI. Neither fixture uses paid inference, an existing user session, or desktop/browser automation.

Manual validation: update the plugin, reopen its canvas, refresh models in Settings, select and save a model, reconnect, then prepare and send one review. Confirm the response, cancellation, narrow-panel layout, and new project without pressing Refresh (clear filters if needed). Real account access, charges/reporting delay, desktop-only authentication and enterprise policy remain user/environment checks.
