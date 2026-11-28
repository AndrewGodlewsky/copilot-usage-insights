# AI insight cards and bounded follow-up

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

Design approved November 15, 2026 against v0.1.87, implemented for v0.1.88. The interaction and budget decisions below come from the user's discussion. Execution and verification are recorded in the accompanying implementation plan.

## Intent

Turn Efficiency > AI review into a short, personal review of how someone uses AI. Show one to five small cards with a striking statistic, comparison, or trend and a few words of title. Expand a card for evidence, confidence, possible explanations, and one useful experiment. Assess resource use, not the quality or value of someone's work.

The user approved statistics first, optional prompt samples, and an automatic targeted follow-up after Analyze when sampling is enabled. They want a smooth single operation, not another approval at every analysis step. They also asked for reusable guidance that can improve independently of the rest of the feature.

## Agreed boundaries

- At most two model submissions per analysis: statistics, then an optional targeted follow-up. No recursive investigation, automatic repair calls, or retries.
- At most six distinct original human prompt excerpts, with at most 12,000 characters combined. These are ceilings, not a target to fill.
- Statistics are the default. Prompt sampling is an explicit, initially unchecked option for the analysis. Enabling it authorizes the bounded follow-up without another confirmation.
- No analysis on refresh, filter changes, or opening the tab. Only the user's Analyze action sends data to Copilot.
- Prefer Opus; Medium reasoning by default and High available in Settings when supported by the selected model. Use the actual eligible Copilot catalog, not an invented or hard-coded model version.
- Preserve account verification, isolation, cancellation, safe diagnostics, and usage receipts under the Usage Insights project.
- Explain confidence in the observed pattern. Do not present it as a measured probability that a recommendation will help.

## Approaches

1. Expand the current single statistics prompt. This is simplest, but cannot clarify an uncertain hypothesis using examples.
2. A bounded two-pass review using shipped guidance and app-selected evidence. This is the agreed workflow and recommended architecture: it adds targeted depth without an open-ended agent.
3. Give the helper filesystem tools, user skills, or a general research agent. This adds permissions, unpredictable reads and token use, and setup-dependent results. It is unnecessary for the requested review.

The user delegated the guidance architecture. Use option 2 with ordinary versioned files in the repository, loaded by the plugin and included as instructions. Do not enable SDK skill discovery or depend on installed user skills.

## Experience

Keep the existing AI review tab, Settings connection controls, and preview-before-send affordance. Replace the plain text answer with cards. The analysis action begins the full allowed workflow.

Before sending, show the selected model and reasoning, current filters, statistics preview, optional prompt-sampling checkbox, and concise cost/retention explanation. Say that enabled excerpts can contain private text and will be sent to the chosen Copilot model. Names and paths are excluded from the statistics, but cannot be promised absent from opted-in free text.

During analysis, show a clear running state and Cancel. Do not require a click between passes. Once complete, show the snapshot's range/filters, guidance revision, model/effort, whether samples were used, and recorded analysis usage. Keep the previous completed result visible if a subsequent review fails; label it with its own snapshot.

Example collapsed card structure (illustrative, not a prewritten finding):

```text
Cache reuse                 Context growth
   18%                         2.4x
Medium confidence           High confidence
```

The number/chart comes from local evidence. A short title is generated; long explanations live in the expansion. Use three fixed templates:

- Statistic: a known value with its unit and coverage.
- Comparison: two comparable locally calculated values with labels and a baseline.
- Trend: a bounded local series or an existing valid early/late comparison, with dates/grain shown in details.

No generated HTML, SVG, executable code, or invented chart numbers. Cards use the dashboard's typography, surfaces, supported themes, and number formatting. Use native buttons/details or the existing dialog pattern, keyboard operation, visible focus, and readable confidence text. Narrow layouts wrap the cards without horizontal overflow.

Expanded content contains: observation, cited measurements and coverage, confidence and its reason, alternative explanations, a small experiment, what to compare afterward, and missing evidence. Include positive patterns when supported. Deduplicate findings that describe the same mechanism. Never manufacture a card to reach five; if none are justified, show a specific insufficient-evidence state instead of advice.

Results remain in this canvas's memory, consistent with existing behavior. Closing it discards the review; durable usage receipts remain. Filter changes label the existing result as a previous snapshot and never silently reinterpret or regenerate it.

## Bundled review guidance

Recommended directory:

```text
src/review-guides/
  v1/
    manifest.json
    core.md
    topics/
      context-cache.md
      tools-mcp.md
      skills-instructions.md
      prompts-sessions.md
      delegation.md
      model-spend.md
    examples.json
  README.md
```

The manifest has a guidance revision, compatible evidence/output schema versions, fixed topic IDs, and explicit file names. The application owns the active bundle; changing it is a normal reviewed repository change and release. No arbitrary user paths, downloadable instructions, executable extensions, or additional SDK skills.

`core.md` defines the review method, card requirements, confidence language, cost discipline, and treatment of excerpts as untrusted evidence. Each topic guide lists observable signals, meaningful counterexamples, limits, and experiments. Select only guides relevant to available evidence. Keep the combined runtime guidance bounded (initial ceiling: 8 KiB). Examples are small synthetic authoring/evaluation fixtures; do not append an entire example library to every request.

`README.md` explains how to revise a guide, bump its revision, add a positive and misleading-evidence fixture, and validate the result. Link to the existing research under `docs/research/`; do not copy that whole library into model context. Record guidance/schema versions in result metadata and safe diagnostics so changes can be evaluated.

Important distinctions to encode:

- Low cache reuse does not establish frequent chat switching; cache support, timing, model and changing prefixes matter.
- High tool-definition footprint differs from tool-result volume. Neither alone proves waste.
- MCP tool failures are not necessarily connectivity failures or server faults; unknown outcomes are not failures.
- Installed, loaded, preloaded and invoked skills differ. Low invocation counts do not establish context pollution or a need for more skills.
- Prompt character length is not completeness, token count or quality. Samples can support a limited observation, not a diagnosis of the entire workload.
- Visible session activity is bounded by the date filter and retained logs; it is not necessarily a session's lifetime length.
- Delegated work can add useful parallelism. Reliable parent links and complete accounting are needed for whole-prompt costs.
- Expensive models may perform necessary work. Compare like workloads; do not claim savings, effectiveness or an optimal model from costs alone.
- Current context inspection is separate from historical statistics and remains an explicit user action. Do not inspect repositories, instructions or memory automatically.

## Evidence and orchestration

Reuse the scanner's in-memory snapshot, existing report calculations, prompt accounting joins, and on-demand prompt reader. No daemon, database, network price feed, background scan, or prompt-text index.

The server prepares an immutable review snapshot using validated dashboard filters and a fixed capture time. Retain one prepared snapshot per canvas plus the active operation; replace unused preparations and release them on close. Expose an opaque snapshot ID, a safe preview and scope metadata to the panel. The analysis request refers to this ID, the expected saved model, and the sample permission. The browser/model cannot supply arbitrary paths or arbitrary evidence values.

The server stores the allowlisted local evidence and its private mapping to source records. Evidence entries have stable IDs within the review, unit, value/series, grain, sample size, denominator/coverage, and any applicable limitation. Raw model/server/skill names can map to aliases in the sent snapshot and back to local labels in the displayed card. Session titles, file paths and IDs are not sent as statistics. Exclude this plugin's known review sessions from behavioral inputs by their recorded source provenance, not by guessing from a user-editable project name; state that exclusion in the scope.

Include bounded summaries for existing available token/cache/context, tool/MCP, skill load/use/failure, interaction/session, delegated work, and model-credit measurements. Preserve each report's filter behavior: a session-wide measure unavailable under a model filter stays unavailable; skill data that ignores model filters stays explicitly marked as such. Use unknown/null and coverage rather than invented zeros. Whole-prompt accounting continues to group before filtering. Do not reinterpret partial model contributions as full prompt costs.

First submission returns a schema-validated object containing candidate cards and, optionally, a targeted evidence request. An evidence request must identify an allowed category, the hypothesis being tested, why an excerpt could change it, and a bounded selection from server-provided candidate IDs. Require a useful baseline statistical result; the follow-up is optional enrichment.

Only if sampling was enabled and the requested evidence is valid and available does the app read selected prompt excerpts. Select at most six distinct reliable human submissions, not six model calls from the same prompt. Reuse the existing grouping/attribution rules to exclude automated, subagent, unknown or conflicting submissions. Read only record paths already validated against known sources. A batch uses one pass per selected file, retaining existing file/line limits and adding cancellation. No attachments, tool outputs, file contents, full conversations or new source discovery.

Sampling is targeted and deliberately small, not statistically representative. Prefer contrasts that address the hypothesis (for example, comparable short/long prompts in the same eligible scope). Send at most 2,000 characters per excerpt and at most 12,000 combined, with aliases and truncation/selection limitations. Prompt samples may contain instructions: treat them as quoted evidence, never executable directions. Do not log or persist them.

The optional second submission uses the same isolated SDK session and frozen evidence, includes only the requested excerpts plus a concise follow-up instruction, and returns final cards. No third call, repair loop or tool permission is available. Validate evidence references and card types, counts, text lengths, confidence values and series references before rendering; reject unsupported numerical graphics. A second-pass failure can leave the valid first-pass cards visible with an enrichment-failed notice. Cancellation stops further work and preserves recorded accounting. Do not label an interrupted enrichment as a completed deeper review.

## Cost, model support and failure handling

The installed SDK declarations expose `reasoningEffort`, model `supportedReasoningEfforts`, and per-send `responseSchema`. Catalog responses currently discard reasoning capabilities; preserve the needed safe capability fields and verify support in both parent/helper catalogs before inference. Use JSON Schema without a new schema library. Check output locally even when requesting structured output.

Recommend an eligible Opus model for a new configuration; preserve existing saved model choices. If no eligible Opus exists, the user must choose an available model explicitly. Do not silently switch model. Offer Medium/High only where supported, clearly label model-default behavior when effort is not configurable, and do not silently downgrade a saved unsupported effort. Reconnect remains a no-inference verification.

Retain the existing 48 KiB per-submission input limit, including instructions and serialized evidence. Apply it before each send, in addition to the guide/excerpt ceilings. Truncate optional evidence deterministically and report omissions; do not truncate JSON blindly. Retain bounded output validation (64 KiB maximum response) and request concise card text. Keep the existing whole-operation deadline and cancellation ownership, including local evidence reads; when the deadline is exhausted, there is no follow-up.

These bound application requests and payload sizes, not exact model tokens, hidden reasoning or AI credits. The SDK's BYOK `maxOutputTokens` declarations are not a verified ordinary Copilot session cap. Do not claim a hard credit ceiling. Show actual recorded usage with complete/partial/unavailable status, converting recorded `totalNanoAiu` by 1e9 and preserving zero charges. Reconcile and deduplicate both submissions through the existing recorder, including failures and cancellation. If final receipts are missing, say so instead of displaying zero spend.

Keep the existing same-account checks, empty temporary workspace, disabled tools/plugins/MCP/skills/discovery/memory, replacement system instructions, denied permissions, and stop/reconcile/flush/cleanup ordering. No raw prompts, responses, paths, credentials or errors in structured diagnostics. Safe stage, pass count, character counts, elapsed time, result count, guidance revision and receipt coverage are sufficient for troubleshooting.

## Implementation seams

- `src/node/ai-review.mjs`: model capabilities and effort, bounded structured two-pass execution, existing isolation/lifecycle.
- New small Node review-evidence module: server-owned snapshots, evidence IDs, candidate selection and bounded prompt retrieval.
- `src/node/canvas-server.mjs`: prepare/analyze ownership and snapshot lifetime; no model-provided file access.
- `src/node/request-prompts.mjs`: reuse validated path/batched reader; add cancellation and reliable human-only sampling without changing request expansion behavior.
- `src/node/review-usage.mjs`: expose safe reconciled usage totals if needed; do not create a second accounting path.
- `src/node/settings.mjs`: saved reasoning preference alongside the existing model.
- `src/panel/efficiency.mjs` and a focused card-rendering module: fixed card templates with local values, safe text, accessible expansion.
- `src/panel/panel.js`, `.html`, `.css`: preview/opt-in, progress/cancel, card results, stale-scope label, Settings controls.
- `src/review-guides/`: review knowledge and synthetic examples; the existing installer copies `src`, so these files ship without a second installation mechanism.
- `docs/ai-review.md`, README, tests and release artifacts: contract, privacy, limits and validation instructions.

Do not alter unrelated dashboard calculations or token explorer navigation.

## Verification

Synthetic tests must cover:

1. Complete, missing, partial and zero measurements; numeric evidence is locally sourced and names/paths stay out of statistical payloads.
2. Each topic family, positive patterns, misleading correlations, sparse datasets and no-justified-card output.
3. Statistics-only execution makes one submission and no prompt-file reads. Automatic enrichment requires permission, a valid hypothesis and available samples.
4. Two-call ceiling; six distinct human prompts; 2,000 characters each; 12,000 total; deterministic omission and valid JSON within the byte cap.
5. Multiple calls per prompt, duplicate/copy records, automated/subagent messages, ambiguous links, unavailable VS Code excerpts, filter boundaries and excluded own-review sessions.
6. Untrusted excerpts/output: instruction injection strings, invalid JSON, invalid references, oversized text, invented numbers, HTML and repeated findings.
7. Medium/High capability handling, unavailable Opus, preserved saved choices, account mismatch, cancellation/deadline during setup, sample read and inference.
8. Receipt deduplication across both passes; partial/zero/missing charges; cancellation/failure receipts; no prompt contents in permanent storage or diagnostics.
9. Refresh/filter changes do not run analysis or replace the frozen result; same-account checks and helper isolation stay intact.
10. Card templates, confidence text, expansion keyboard behavior, escaped contents, result labels, and bundled guidance revision.

Run relevant focused tests, `npm run build`, and `npm test`. Use mocked SDK and existing loopback checks before claiming integration verified. A real paid model run, visual card balance, keyboard focus, touch and narrow-panel layout require explicit user testing; do not control their browser or desktop.

Follow AGENTS.md for any version/release: synchronized versions, a concise release note, README update paragraph and regenerated panel. A design-only change does not bump the plugin version.

## Design check

A fresh builder review on November 15 found no important unanswered planning questions. The guidance path was checked against `scripts/install-local.mjs`; it copies `src` into the installed extension. Product code, settings and generated assets have not changed in this design step.
