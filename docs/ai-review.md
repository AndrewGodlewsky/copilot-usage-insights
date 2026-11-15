# AI Review integration

The integration was added in 0.1.66. AI review now prepares a server-owned, filtered statistics snapshot and returns up to five expandable insight cards. Analyze is the only action that sends a model prompt. Cards show local statistics, comparisons or trends, plus the model's explanation, qualitative evidence confidence, alternative explanations and a small experiment. Sparse data may produce no findings.

## Bounded analysis

Statistics are the default. **Allow targeted prompt excerpts** starts unchecked for every preparation. Enabling it permits one automatic follow-up if the first pass identifies a hypothesis worth checking. There are at most two submissions, six distinct reliably attributed human prompts, 2,000 characters per excerpt and 12,000 combined. Selection is from at most 24 candidates spanning observed prompt lengths; this is targeted evidence, not a representative sample. Missing/unreadable excerpts skip enrichment. Failed, cancelled or timed-out follow-ups preserve valid initial findings and label the interruption, including when a local read stalls. There is no retry/repair loop.

The server reuses already-loaded history; preparation does not scan logs. It excludes known own-review sources before building the report. New receipts carry a source marker that survives copying; older copied receipts without a marker may be unrecognized. Existing project/session/date/environment rules apply. Skill statistics still ignore the model filter, session-wide interaction measures are unavailable under it, and model-filtered prompt costs remain explicitly labelled contributions. A prepared snapshot is consumed once. Changing the saved model or effort requires preparing again; refresh/filter changes neither run inference nor change completed cards.

The application sends aliases and allowlisted numeric evidence, not paths or session titles. Readable filter names stay locally with the preview/results so an older review remains identifiable. Opted-in prompt excerpts can contain private text; this is disclosed before Analyze. The application alone chooses validated source records and reads them in batches with the existing file/line limits. Excerpts, raw errors and generated prose never enter structured diagnostics or permanent usage receipts. Current context remains an explicit separate inspection; preparing a review does not invoke it. Long-range trends use daily averages within each plotted period, so unequal bucket lengths do not invent changes in usage.

The selected model receives a JSON schema. Local validation checks card counts, field lengths, confidence, candidate IDs and evidence references; numbers and charts are resolved from local evidence. AI prose is escaped, not interpreted as markup. Confidence is capped for sparse/incomplete evidence; it is not a calibrated success probability. Semantic accuracy of prose still requires judgment. Results stay in canvas memory, while usage receipts persist.

Model and reasoning are saved in Settings. Opus is recommended from the eligible catalog for new choices; existing saved models remain selected. Medium is recommended when advertised; High and model default are available as supported. A saved unsupported effort fails before inference. No silent model/effort fallback occurs.

The whole SDK operation retains its three-minute deadline. Guidance is at most 8 KiB; each submission including system instructions/schema is at most 48 KiB; returned content is validated at 64 KiB. These are application limits, not an exact credit or hidden-reasoning token cap. Per-review recorded usage distinguishes complete, partial and unavailable charges, including valid zero charges. Each submitted pass and observed assistant call must match a receipt before its usage is described as complete; unverified identities or missing receipts leave known amounts partial. Identity hashes used for this check stay in memory. Input already includes cache, so usage totals add input and output once. The two submissions share one helper/session and recorder.

Review knowledge ships in [src/review-guides](../src/review-guides/README.md): versioned core instructions, six topic guides and synthetic counterexamples. Only relevant guides are included. Changing guidance is a normal tested release, not a downloaded skill or filesystem permission. Each result identifies its guidance revision.

## Implementation

- `src/node/ai-review.mjs`: desktop SDK discovery, catalog filtering, same-account verification, isolated helper, cancellation, deadlines, and safe errors.
- `src/node/review-usage.mjs`: allowlisted accounting, atomic writes, live/durable receipt deduplication, and stopped-journal reconciliation.
- `src/node/canvas-server.mjs`: same-origin, per-canvas secret URL endpoints for catalog, reconnect, prepare, analyze, legacy run, and cancel. Request ownership starts before asynchronous settings reads. A disconnected request cannot start a later review or cancel another request.
- `src/node/canvas.mjs`: separate server and cancellation ownership for each canvas instance. Closing one does not stop another canvas's work.
- `src/node/settings.mjs`: saved model/reasoning preference and optional usage-source path. No credentials are stored.
- `src/node/review-evidence.mjs`: frozen numeric evidence, local label mapping and bounded sampling candidates.
- `src/node/review-insights.mjs`: guidance loading, schema validation and two-pass orchestration.
- `src/panel/review-cards.mjs`: escaped, accessible disclosure cards with fixed numeric templates.

The service uses the attached session only for identity/catalog checks. It never changes its model, sends it a prompt, or stops it. A fresh helper uses the verified desktop executable, `mode: empty`, an empty workspace, separate temporary home, restricted environment, replacement system instructions, disabled discovery/skills/hooks/memory, no tools/plugins/MCP, and denied permissions. Tool metadata, canonical workspace, account, eligible model, and actual selected model are checked before inference. The account is checked again before each analysis submission. No provider fallback or automatic retry occurs; only the explicitly enabled bounded enrichment can add a submission.

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

Finishing a `review.analyze` or legacy `review.run` invalidates the server's cached history, even on cancellation or failure. The panel immediately requests an incremental refresh using the current filters. No additional inference occurs, and unchanged source files reuse their parsed records. A different project, session, model, or date filter can still exclude the review. Retained accounting is independent of the temporary helper home and survives its cleanup.

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
