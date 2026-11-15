# VS Code usage and environment filtering

**Goal:** Include attributable recorded VS Code Copilot Chat usage and add an All environments selector immediately after AI credits.

**Architecture:** Read VS Code's version-1 debug JSONL through the existing incremental journal reader, retaining accounting metadata only. Discover standard Windows VS Code/Insiders User storage and accessible WSL VS Code Server User storage; allow custom User storage roots. Tag source environments and filter the in-memory snapshot before aggregation. CLI receipts take precedence over overlapping VS Code debug sessions.

**Scope:** The user requested implementation, including Windows VS Code and filtering between environments. Ordinary saved chat text is not a billing receipt. Debug logging may be disabled or old logs absent. Never enable prompt-bearing logging automatically, estimate credits, identify Copilot solely by model name, or infer human prompts from ambiguous debug events. Use explicit recorded copilotUsageNanoAiu as attribution evidence; unknown cache subdivisions and reasoning remain unavailable. Live host inventory/context is not historical remote inventory.

## Tasks

- [x] Add synthetic parser and scanner fixtures for complete/zero charges, unclassified/BYOK entries, malformed/partial records, replay/conflicts, copied logs and CLI overlap. Reuse incremental reading; test append, replacement, deletion and source controls.
- [x] Discover standard VS Code storage, profile storage, workspace metadata and remote WSL authorities without reading prompts or repository contents. Integrate optional source diagnostics and custom roots; retain WSL isolation and bounds.
- [x] Add environment metadata, query validation, snapshot filtering and option lists. Cover all aggregate and drill-down endpoints, prompts/activity, default All, reset, refresh and no rescans on selection.
- [x] Add the accessible top-level selector and source settings. Document retained-log coverage, exact recorded charging, source precedence and how to enable VS Code logging manually if desired.
- [x] Prepare v0.1.78 with synchronized manifests, README, notes and generated panel. Run build/full tests and review before main integration under existing authorization. No desktop/browser control or plugin installation.

## Evidence

- Microsoft's current logger writes per-workspace/global `github.copilot-chat/debug-logs/<session>/*.jsonl`; llm_request entries contain model, input/output, cached input and optional copilotUsageNanoAiu. Its serialized format currently omits cache-write/reasoning subdivisions and provider identity. Charges are copied from per-response copilot_usage.total_nano_aiu in chatMLFetcher.
- Debug session identifiers can also represent Copilot CLI sessions. Exclude overlapping CLI sessions, including their debug child files, before merging snapshots.
- This PC has VS Code User storage but no retained debug histories and no chat accounting records. Synthetic fixtures are necessary; real VS Code/WSL accounting needs user validation on the affected PC.

Sources: [logger](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/chat/vscode-node/chatDebugFileLoggerService.ts), [schema](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/platform/chat/common/chatDebugFileLoggerService.ts), [charging](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/prompt/node/chatMLFetcher.ts), [logging setting](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/platform/configuration/common/configurationService.ts).

## Verification

- `npm run build` passed with the v0.1.78 summary bundled.
- `npm test` passed: 333 tests, no failures or skips. Includes environment-scoped prompt continuations, skills/tool failures, custom profile logs, per-root disabling, copied-event identity and no-rescan filter behavior.
- Independent review found WSL file-URI decoding and rejected duplicate-receipt issues; both were fixed and verified with regression fixtures. Follow-up review found no remaining release blockers.
- Read-only native VS Code discovery on this PC: 53 ms cold, 7 ms warm; unchanged snapshot reused, no retained accounting logs. These timings do not benchmark large histories.
- Manual verification still required on the affected PC for real VS Code/WSL receipts and narrow-width dropdown layout. No plugin installation or UI control performed.
