# Copilot data inventory for efficiency research

Audited November 14, 2026 against Usage Insights **0.1.29**, product commit `519ff23`. This is a research inventory, not a promise that these fields are available in every Copilot version or already displayed by the plugin. Start with the [research index](README.md) for priorities and the [SDK surface audit](2026-11-14-copilot-sdk-surfaces.md) for host APIs.

## Scope and method

The audit covers the plugin's complete ingestion path, the observed metadata in local session journals, the schemas of four local Copilot databases, the installed SDK's declarations, and relevant official cloud reporting interfaces. It distinguishes **implemented**, **observed but unused**, **declared but untested**, and **not established**. An exhaustive promise about all internal Copilot data, remote hosts, accounts, or future versions would be misleading.

The local journal probe examined field names and types in five development session logs containing 27 usage receipts. It did not analyze prompt, reasoning, skill-content, tool-argument, or tool-result text. Database inspection used read-only connections, `query_only`, schema enumeration, and `PRAGMA table_info`; no database rows or credentials were exported. The sample is evidence of field presence, not a population benchmark. It changed during this active session, so counts differ from the earlier four-log investigation.

Paths below are relative to a configured Copilot home, normally `~/.copilot` or `COPILOT_HOME`. No personal paths, session identifiers, transcripts, configuration values, or copied databases belong in this research directory.

## Source map

| Surface | Time meaning and coverage | What we use now | What it could add |
| --- | --- | --- | --- |
| `session-state/<session>/events.jsonl` | Durable events that survived locally; fields vary by producer/version | Request accounting, skill uses, tool executions, session/project context | Request diagnostics, interaction joins, routing, compaction, instruction discovery, agent lineage |
| `session-state/<session>/workspace.yaml` | Current workspace metadata | Bounded session-name fallback | No efficiency diagnosis by itself |
| `session-store.db` | Existing Copilot index; may overlap journal history | Accounting fallback and session summaries | Additional latency, effort, turn and agent identifiers; limited file-access metadata |
| `data.db` | Desktop state, a mixture of current snapshots and persisted history | Current session titles only | Context samples, current component totals, explicit session/fork relationships; semantics need verification |
| Joined session SDK | Current host session and supported RPC/event capabilities | Plugin inventory and MCP configuration/live state | Current context attribution and richer live diagnostics, subject to capability checks |
| Installed skill files | Files as they exist now | Installed skill version and folder resolution | Explicitly requested repository/skill configuration review |
| GitHub cloud usage/billing APIs | Account/organization reporting; separate permissions and coverage | Nothing | Optional aggregate reconciliation, not a replacement for local request history |

Implementation: [scanner](../../src/node/copilot-source.mjs), [database reader](../../src/node/copilot-db.mjs), [receipt parser](../../src/core/copilot.mjs), [canvas/session integration](../../src/node/canvas.mjs), [inventory reader](../../src/node/integrations.mjs).

## Request accounting: retained versus available

The parser admits Copilot-attributed usage and excludes explicitly different providers/BYOK. Unclassified records remain unclassified. Model brand alone is insufficient: a Claude model served by Copilot is Copilot usage; an independently billed Claude session is outside this plugin's scope.

### Retained today

| Group | Normalized fields | Interpretation |
| --- | --- | --- |
| Identity | `key`, `ts`, `ms`, `sessionId`, `source`, `logFile`, `project`, `cwd`; scanner adds `sessionName` | Source and recorded context, with a current human-readable name |
| Model/call | `model`, `modelId`, `responseModel`, `apiCallId`, `initiator`, `isAuto`, `duration` | Display identity and some call provenance; initiator is not skill trigger |
| Tokens | `inputTotal`, `input`, `cacheRead`, `cacheWrite`, `output`, `reasoning`, `total` | `total = inputTotal + output`; uncached input subtracts valid cache categories; reasoning is not an additional term to add to output |
| Credits | `nanoAiu`, `creditStatus` | Reported charges with complete/partial/unavailable state; not the account balance or a dollar estimate |

Counters are validated as nonnegative safe integers. Unknown stays `null`. Cache components are accepted only when both exist and fit within input. The current implementation does **not** retain/check the explicit `cacheDetailsReported` flag; respecting false/unsupported reporting is a recommended data-quality improvement, not a shipped behavior.

### Complete top-level field inventory from the observed receipts

This table accounts for every top-level `data.usage` key seen in the probe. “Unused” means not kept in the plugin's ordinary request record; it does not mean universally supported or semantically stable.

| Observed field group | Fields | Status and useful boundary |
| --- | --- | --- |
| Provider and model | `provider`, `isByok`, `model`, `modelDisplayName`, `responseModel`, `isAuto` | Attribution/filtering and normalized model fields used; raw provider object discarded |
| Accounting identity | `accounting`, `apiCallId`, `providerCallId`, `serviceRequestId` | `accounting.usageId` and `sourceSessionId` drive deduplication; `apiCallId` retained; other diagnostic IDs unused |
| Token/charge totals | `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `copilotUsage`, `aiCreditsStatus`, `cost` | Token totals and `copilotUsage.totalNanoAiu` used; generic `cost` and itemized token details unused |
| Cache state | `cacheDetailsReported`, `cacheExpiresAt`, `cacheTtlSeconds`, `cachePolicyTtlSeconds` | Unused; reporting quality and expiry context. A policy value does not prove that a cache entry exists or will hit |
| Call classification | `initiator`, `interactionType`, `frontierSource`, `rte` | Initiator used; remaining classifications unused. Avoid interpreting opaque/internal fields without producer semantics |
| Limits/settings | `reasoningEffort`, `reasoningSummary`, `maxPromptTokens`, `maxOutputTokens` | Unused; settings/limits can help make comparisons fair. Do not assume a field called `reasoningSummary` is reasoning text or a performance score |
| Latency | `duration`, `timeToFirstTokenMs`, `outputTtftMs`, `interTokenLatencyMs` | Duration retained; other timing components unused. Streaming/provider support differs; timing components may overlap |
| Tool footprint/activity | `availableToolCount`, `toolTokenCount`, `numToolCalls`, `toolCounts`, `customToolCallCount`, `unmatchedToolResultCount`, `orphanToolCallCount` | Unused; distinguish definitions, requested calls, execution outcomes, and malformed history |
| Response termination | `finishReason`, `contentFilterTriggered` | Unused; a tool-call stop is not truncation, and a safety stop is not evidence of poor prompting |
| Transport | `transport`, `inferenceGateway`, `apiEndpoint`, `requestBodyBytes`, `requestBodyWireBytes`, `requestBodyEncoding` | Unused; bytes/compression describe transmission, not token savings |

Observed nested shapes: `accounting` has `sequence`, `sourceSessionId`, `usageId`; `copilotUsage` has `totalNanoAiu` and `tokenDetails`. Each observed token-detail entry has `batchSize`, `costPerBatch`, `model`, `tokenCount`, `tokenType`. Do not derive a new bill from these until units, category relationships, rounding, and reconciliation are verified.

The public generated SDK source describes `toolTokenCount` as definition tokens and marks it internal. It likewise marks several cache/tool diagnostics internal. Usage checkpoints carry cumulative accounting and internal cache restoration state, including `promptCacheBreakState`; that opaque state is **not** a stable explanation API. Checkpoint totals subsume earlier receipts and must never simply be added to them. These findings are based on [the generated event source at the audited revision](https://raw.githubusercontent.com/github/copilot-sdk/cf045793958ce674259c557f7769788f94ee20c9/nodejs/src/generated/session-events.ts), not an assumption that all fields are part of the installed public SDK.

## Event inventory beyond accounting

The observed envelope contained `id`, `parentId`, `timestamp`, `type`, and `data`. Other producers may supply agent/checkpoint/ephemeral metadata; see the SDK audit. Event-chain `parentId` is ordering metadata, not proof that one tool call or skill caused the next request.

| Event family observed locally | Additional metadata available | Current handling and potential use |
| --- | --- | --- |
| `session.start`, `session.resume` | Producer/version, selected model, limits, context, start/resume information | Parser uses session/repository/cwd from start. Could stratify coverage by producer and distinguish genuine starts from a filter's first visible request |
| `session.model_change`, `session.auto_mode_resolved` | Previous/new model and settings, change source; routing method, chosen model, fallback and latency | Ignored. Can distinguish some automatic routing from explicit changes; don't blame users for every model change |
| `assistant.turn_start`, `assistant.turn_end` | `turnId`; start also `interactionId`, `agentMode` | Ignored. Potential interaction boundaries, not guaranteed whole-task boundaries |
| `assistant.message`, `user.message`, `system.message` | Message/turn/interaction/API-call links; message bodies also exist | Bodies excluded from ordinary analytics. Preserve identifiers only for future joins |
| `tool.execution_start`, `tool.execution_complete` | Call/turn identity, model, MCP server/tool/source/transport, read-only flag, success, error and telemetry; arguments/results also exist | Keeps name, server, tool, start/completion and success. Could add categorized failures/duration and interaction joins without payload text |
| `external_tool.requested`, `external_tool.completed` | Request/call identity | Ignored. May describe the same execution as tool events; never count blindly as extra calls |
| `skill.invoked`, `skill.invoked_ref` | Skill name/path/source/trigger, invoking turn, description and loading metadata; optional plugin fields; ref content ID/length | Keeps identity, trigger, plugin/version and time. Source, invoking turn and safe size metadata could improve opportunity analysis |
| `hook.start`, `hook.end` | Hook type/identity and success; input/output payloads also exist | Ignored. Can investigate hook overhead/failures separately; hook success does not measure skill success |
| `session.permissions_changed` | Permission-policy changes | Ignored. A policy state is not evidence of denied operations; never recommend weaker permissions merely to lower cost |
| `session.usage_checkpoint`, `session.shutdown` | Cumulative accounting; shutdown also model/context/agent/code-change summaries | Currently marks aggregate-only histories. Could support separately labeled totals, not invented dated requests |
| `session.info`, `session.warning` | Typed category and free-text message | Ignored. Prefer allowlisted category codes; free text can contain private material |
| `session.canvas.recorded`, `session.canvas.removed` | Canvas/extension identity and lifecycle | Ignored. Opening a canvas does not establish plugin effectiveness or tokens attributable to it |

Compaction, instruction, subagent, task-completion, and model-failure events are declared in other audited surfaces but were not seen in this sample. Absence here is not proof of absence in Copilot. Nor does a completion event necessarily establish that the user's acceptance criteria were met.

### Skills, plugins, and MCP: three different measurements

- **Historical skill use:** a recorded invocation/loading event, with its recorded trigger and optional plugin metadata. It is neither a self-contained execution span nor a success/failure record. An installed skill version read today cannot reconstruct the version used months ago.
- **Current availability:** today's installed/enabled plugins or configured MCP servers in the joined session. Inventory does not prove historical availability, model exposure, or use. The current inventory reader already returns partial/unsupported states and applies a timeout.
- **Current context footprint:** the SDK audit identifies per-source attribution. This could explain which loaded skills/tools occupy context now. It must not be relabeled “tokens consumed by running this skill,” and must be scoped separately from a 30-day usage chart.

The plugin's current MCP success percentage concerns known completed **tool calls**. It does not measure connection uptime, authentication reliability over time, server correctness, or task success. Current connection status and historical call outcomes need separate denominators and timestamps.

## Existing SQLite databases

These are Copilot-owned databases; the plugin does not install or create them. Schema presence alone establishes neither populated rows nor reliable retention semantics. Query only an allowlist of needed columns, feature-detect schemas, and keep errors optional.

### `session-store.db` — 16 observed tables

| Tables | Metadata and possible value | Limits |
| --- | --- | --- |
| `assistant_usage_events` | Existing fallback uses ID/session/model/time, token counters and nano-AI units. Also present: `turn_index`, `agent_id`, `parent_tool_call_id`, `copilot_usage_model`, `request_multiplier`, `duration_ms`, `time_to_first_token_ms`, `output_ttft_ms`, `inter_token_latency_ms`, `initiator`, `api_endpoint`, `reasoning_effort`, `finish_reason`, `content_filter_triggered`, `token_details_json` | Additional columns are currently ignored. Account for duplicate receipts, nullable fields and provider attribution before expanding fallback |
| `sessions` | `cwd`, `repository`, `host_type`, `branch`, `summary`, created/updated timestamps | Summary/name is not task classification; `host_type` may help coverage investigation after semantics are verified |
| `turns` | Session, turn index and timestamp alongside user/assistant content | IDs could join accounting without retrieving content. The plugin does not query these rows today |
| `session_files`, `session_refs` | File/reference, tool, turn index and first-seen/created timestamp | Potential navigation evidence. First-seen entries are not necessarily an exhaustive repeated-read log; filenames don't establish relevance |
| `checkpoints` | Checkpoint number/time and structured narrative fields | Contains conversation summaries; no background content mining recommended |
| `dynamic_context_items` | Repository/branch/source/name plus `read_count`, `count`, description/content | Candidate context/memory-related index, but semantics unverified. Cannot treat counts as memory hits or misses |
| `forge_skill_proposals`, `forge_trajectory_events` | Skill proposal status and trajectory metadata, plus substantial content | Proposal/command outcomes are not outcomes of arbitrary skills. Not part of recommended first implementation |
| `schema_version`, `search_index` and its five FTS backing tables | Index/schema infrastructure | No independent efficiency evidence; do not count indexed copies as separate events |

### `data.db` — 106 observed tables

The only current product query reads `sessions.id/title` so manual renames appear. Other potentially useful metadata includes:

| Surface | Useful fields/family | Meaning to verify before use |
| --- | --- | --- |
| `sessions` | Current model/effort/mode, timestamps, interruption state, `forked_from_session_id`, token/credit totals, context-current/limit/system/conversation/tool-definition/MCP/buffer fields | Current configuration and totals cannot be assigned to every historical request; aggregated child charges may overlap other totals |
| `session_context_usage` | `id`, `session_id`, `ts_ms`, `current_tokens`, `token_limit` | Potential existing context-size timeline. Sampling cadence, retention, reset/compaction behavior and coverage were not verified; this is not a confirmed complete request series |
| `session_checkpoints` | Session/event/commit/time | Could locate repository checkpoints; commits alone do not prove task success |
| `projects`, `workspaces`, `worktrees` | Project/workspace/session links, branch/source and configuration, setup/run scripts, aggregate token/change fields | Useful identity/configuration context; presence of setup instructions does not establish correctness or that they were executed |
| `chat_parent_links`, `session_side_chats`, workspace relationship tables | Explicit parent/child/coordinator links | Safer candidate lineage than nearest-timestamp joins; distinguish forks, collaborators and runtime subagents |
| `session_sources`, `session_mcp_event_sources`, `session_managed_mcp_event_display_names` | Attached-source and MCP event attribution | Does not itself provide content-token sizes, availability history or connection-attempt outcomes |
| `workflows`, `workflow_runs`, session automation and scheduled-task tables | Run status, start/end, blocked-action count and session link | Could identify repeatable workflows and operational failures. Workflow success is narrower than end-user quality; prompts/errors require redaction |
| Persistent-project memory owner/binding tables | Enablement and ownership relationships | Configuration metadata only; not evidence of useful retrieval, factual accuracy or savings |

The remaining schema families cover accounts/model-provider settings, project trust and remote hosts, caches, coordination/delivery bookkeeping, software-factory jobs/evidence/evaluations, review threads, draft files/diffs, archive recovery, UI state and migrations. They were inventoried at schema level and offer no established direct efficiency metric. In particular, account/provider/settings tables may contain credentials: **do not read their values for analytics**. Status/evaluation fields in internal factory tables are not a general quality score for chats.

### Other local stores

`platform-cache.db` had 46 tables for GitHub entities, synchronization, access/authority state and projections. `repo-metadata-cache.db` had 11 tables for repository/organization metadata caching. Neither is used by Usage Insights. They are not model-accounting ledgers; joining their PR/cache state to local calls would require a separately verified identity/coverage model.

Other known folders/configuration files include chats, logs, installed/local plugins and MCP configuration. We did not mine them for content or secrets. Prefer supported SDK inventory over parsing arbitrary configuration or scanning diagnostic text. Repository instruction files and memory content require an explicit, bounded review rather than a routine usage refresh.

Schema provenance: SHA-256 of table SQL ordered by table name, excluding `sqlite_%`, joined with newline: `data.db` = `44e719630f69446610065510b5bb1784e4206a2f18d0b4c33b281bd3db39879b`; `session-store.db` = `0496377dc500c793be6b905f89080ffac88eadffa01dd81f8248ffa90a84d15a`. These identify inspected schema shapes, not database contents or supported API versions.

## Cloud reporting is another source, not automatically available here

Official usage reporting includes daily app session/request/prompt/token aggregates and customization arrays for skills, agents, MCP, commands and plugins. Plugin interactions are a subset of skill invocations. MCP interactions count connection/reconnection attempts, not tool calls. Capped named arrays can hide entries in `other`; absence is not zero. These are organization/enterprise reporting surfaces with policy, permission and client requirements, not a universal personal-history API. [Field definitions](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics)

Client and server reporting cover different activity. Detailed telemetry can be unavailable because of client versions/settings; server request totals and prompt counts are not interchangeable. [Coverage requirements](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/usage-metrics-coverage) Reports may lag by two full UTC days after a day closes, and organization attribution can overlap. Do not merge totals with local receipts without a reconciliation design. [Reconciliation guidance](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/reconciling-usage-metrics)

Billing reports separately expose aggregate AI credit usage. Personal billing endpoints apply to personally purchased plans; organization-managed usage belongs at its billing scope and needs corresponding access. This does not provide a skill execution bill. No authentication or cloud connector was added in this research. [Billing API](https://docs.github.com/en/rest/billing/usage?apiVersion=2026-03-10)

## Measurement and join rules for future work

1. **Preserve source grain.** Request charge, skill load, tool execution, current context snapshot and account-day total are different things. A larger sum is not automatically a more complete sum.
2. **Use explicit IDs.** Deduplicate receipts by accounting identity. Join requests to assistant-message `apiCallId`, then verified interaction/turn identity; scope by session/source and agent. Keep conflicting or missing joins unknown. Do not assign neighboring requests to a skill by time proximity.
3. **Retain coverage.** Each metric needs eligible, measured, missing, unsupported and excluded counts. Source selection, unreadable/deleted files, schema versions and mixed-provider exclusions affect conclusions.
4. **Respect intervals.** A date filter can cut off the beginning or end of a session/interaction. Mark incomplete windows; never call the first in-range request a cold session start automatically. Current inventory should not change when the user asks for historical dates.
5. **Keep semantics separate.** Reasoning is not extra output; definition tokens are not tool-result tokens; tool success is not task success; current footprint is not accumulated processing; bytes are not tokens; recorded credits are not dollars.
6. **Treat checkpoints carefully.** Cumulative snapshots overlap receipts. Use watermarks and provenance before considering reconciliation. Never fill an arbitrary historical day with a current session total.
7. **Separate resource use from outcome.** No audited accounting field tells us whether a prompt was complete, a repository was navigable, memory was useful, or the user got a valuable result.

## Performance and implementation implications

The existing scanner reads historical journals initially and retains normalized metadata in memory. On unchanged files it can reuse parsed results; changed files can require verification of the consumed prefix before parsing appended lines. A changed file is therefore not guaranteed to cost only the appended bytes. SQLite fallback also reads its usage rows. Date filters operate after ingestion; choosing Today does not automatically avoid the first historical scan. [Scanner implementation](../../src/node/copilot-source.mjs)

The inexpensive next step is to retain a small allowlist of extra numbers/identifiers during the scan already happening, then aggregate them in the filtered pass. Use bounded summaries, avoid nested per-request scans, and measure retained-memory growth. Any interaction index should store IDs and counts rather than message bodies. Current SDK context attribution should be an on-demand, timeout-protected view, not a query against every historical session on every refresh.

Prompt bodies are excluded from ordinary reports. The separate [request prompt reader](../../src/node/request-prompts.mjs) performs bounded, explicit inspection when requested; it must not be repurposed into a background classifier. No new database, history recorder, daemon, content analysis, or runtime dependency was added by this audit.

## Open verification items

- Capability-test current context attribution in the actual joined extension session; handle unsupported/null responses and validate category overlap before summing.
- Establish `session_context_usage` population/cadence and resets with a controlled session before proposing a historical chart.
- Validate extra receipt fields against more producers/versions; test explicit false cache reporting, absent/null fields and mixed-provider histories.
- Prove request-to-interaction and child-agent joins with synthetic fixtures and controlled events; distinguish one user turn from one completed task.
- Verify actual SDK error categories and stop reasons before producing labels; no free-text error mining.
- Obtain task/opportunity labels through a lightweight user experiment before calling low skill use a missed opportunity.

These are research-to-implementation checkpoints, not completed features. The [technique catalogue](2026-11-14-efficiency-techniques.md) and [inference design](2026-11-14-efficiency-inference.md) explain which recommendations those measurements could responsibly support.
