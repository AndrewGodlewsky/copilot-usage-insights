# Efficiency: detectable patterns and practical experiments

Research date: November 14, 2026. Baseline: Usage Insights 0.1.29, commit `519ff23`. This is a researched proposal, not a description of additional shipped detectors.

The best next step is to explain *where resources went*, show repeated patterns, and offer one specific experiment. The available data cannot measure how much useful work a token produced. It can identify expensive mechanisms and operational friction without assigning blame or a personal efficiency score.

The most promising additions are tool-definition overhead, cache behavior around known events, repeated tool failures, input growth, and resource trends within comparable work. Repository navigation, prompt completeness, and memory quality need additional evidence; accounting totals alone cannot diagnose them.

## What the evidence supports

- **Cache reuse is not a chat-switch counter.** Exact prefix matching, cache eligibility, expiry, and changes to context affect caching. Provider API behavior is useful background, not a guarantee of the Copilot application's cache policy. [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Many tool calls can be normal agent work.** A production Copilot study found substantial autonomous model/tool loops and different cache behavior within and between user turns. It also explicitly lacked task-quality signals. Its population statistics are not personal targets, and its historical cache timings should not become hardcoded current policy. [Liu et al., 2026](https://arxiv.org/html/2608.00101v1)
- **Tool overhead has several parts.** GitHub's workflow investigation distinguishes tool registration overhead, repetitive data collection, and failure loops. It also shows why changing workload mix confounds before/after token comparisons. Its CI findings suggest experiments for desktop users, not guaranteed desktop savings. [GitHub workflow investigation](https://github.blog/ai-and-ml/llms/improving-token-efficiency-in-github-agentic-workflows/)
- **Tool discovery changes the interpretation of installed inventories.** On-demand loading can keep unused definitions out of context. Counting installed plugins or advertised tools cannot establish their actual token footprint. [Anthropic advanced tool use](https://www.anthropic.com/research/advanced-tool-use)
- **Conversation continuity has a tradeoff.** Retain context for related follow-ups; use a fresh conversation when changing problems. Neither maximum cache reuse nor minimum session length is an appropriate universal objective. [GitHub conversation guidance](https://docs.github.com/en/copilot/tutorials/optimize-chat-usage)
- **Recommendations need task context.** GitHub recommends explicit goals, relevant information, stopping conditions, and capability appropriate to the work. Those are useful experiments, not facts inferable from token totals. [GitHub usage guidance](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage)

## Capability audit

### Already retained by the plugin

The [receipt parser](../../src/core/copilot.mjs) retains request timestamp, session/project, model identity, API call ID, initiator, automatic selection flag, API duration, input/output/cache/reasoning counts, and recorded credits. It also retains tool name/server, start/completion timestamps and success status, plus skill identity, trigger and plugin metadata.

The [database fallback](../../src/node/copilot-db.mjs) has a smaller field set. Availability must be measured per metric; receipt fields cannot be assumed for database-only history. [Reporting](../../src/core/copilot-report.mjs) deliberately omits ambiguously attributed skill/tool events. Skill events do not contain a skill bill or a skill-success measurement.

The normal index discards prompt, tool argument, result, and reasoning text. [Prompt retrieval](../../src/node/request-prompts.mjs) is a separate, bounded operation for explicitly inspected requests. Efficiency currently does not use it. [Current Efficiency](../../src/core/efficiency.mjs) computes model summaries and three review patterns.

### Present in sampled desktop receipts, but not retained

A bounded, read-only probe of four local session logs examined field names, types, counts, and numeric ranges. It did not analyze conversation text, write a copy of the logs, or inspect tool arguments/results. This small development sample establishes field presence in this installation, not universal coverage or representative user behavior. No personal usage values or session identifiers are published here.

| Observed fields | Potential addition | Interpretation boundary |
| --- | --- | --- |
| `toolTokenCount`, `availableToolCount` | Tool-definition footprint per model call | Definitions, not tool results; no allocation to individual tools or servers |
| `numToolCalls`, `toolCounts` | Calls requested per model response | Not necessarily completed executions; reconcile with tool events |
| `cacheDetailsReported` | Distinguish reported cache counts from unsupported/missing reporting | Do not interpret an explicit false flag as zero reuse |
| `cacheExpiresAt`, `cacheTtlSeconds`, `cachePolicyTtlSeconds` | Better context for misses after pauses | Reported state/policy, not a guaranteed future hit; policy alone does not establish cache state |
| `reasoningEffort` | Compare within the same effort setting | High effort is not evidence that it was unnecessary |
| `maxPromptTokens` | Per-call input relative to its reported limit | Not an authoritative live context meter |
| `finishReason`, `maxOutputTokens` | Investigate output-limit stops | Stop-reason mapping varies; tool calls are not truncations |
| `timeToFirstTokenMs`, `interTokenLatencyMs` | Separate aspects of waiting | Network, provider load and workload are confounders |
| `requestBodyBytes`, `requestBodyWireBytes` | Diagnostic transport sizes | Bytes are not tokens; compression is not reduced model context |
| `copilotUsage.tokenDetails` | Investigate reported cost composition | Validate units and reconciliation before showing derived charges |
| `turnId`, `interactionId` on other events | Join model/tool activity to a user interaction | Preserve agent identity, ambiguity and missing joins; timestamps alone are insufficient |
| `contentLength` on skill reference events | Skill payload size, if semantics are verified | Length is not a token count or a per-skill charge |

The official generated SDK identifies `toolTokenCount` as definition tokens and marks several useful diagnostic fields internal. It distinguishes cache-policy lifetime from refreshed cache state. These fields need optional parsing, validation, and graceful absence handling, not a hard dependency on this SDK revision. [Generated event definitions](https://raw.githubusercontent.com/github/copilot-sdk/main/nodejs/src/generated/session-events.ts)

The bundled desktop SDK also confirms public fields such as reasoning effort, request size, cache expiration, and prompt limits. Some internal receipt fields are absent from its public declarations. A supported public API and a field observed in a journal are different compatibility promises.

### Documented possibilities needing further verification

The SDK documents durable turn/tool events and compaction results. It labels context-utilization and some interaction events ephemeral; they cannot be assumed recoverable from logs. Compaction was not present in the local sample. Validate saved examples before adding a parser. Preserve only necessary counters and join identifiers, never compaction summaries or reasoning text. [SDK events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events)

The SDK also offers a current context breakdown into system, conversation, and tool-definition tokens. That is a potential current-session inspection, not historical reconstruction or a memory-specific bill. Availability through this desktop extension must be checked. [SDK usage and billing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)

## Scenario catalogue

The following are **our proposed detectors and experiments**, informed by the sources above. They are not externally validated rules. A pattern can justify inspection while its cause remains unknown.

Availability legend:

- **A — existing index:** derivable from current retained records, although most are not implemented.
- **B — add metadata:** additional fields/events were observed locally or are documented; support and coverage still need implementation and tests.
- **C — repository review:** an explicit, bounded check of selected project files/settings.
- **D — content or outcome review:** requires user context, transcript/tool-content inspection, or outcome labels; unsuitable for silent passive diagnosis.

### Cache and conversation habits

| # | Observed pattern | Possible explanation and counterexample | Useful experiment | Data |
| --- | --- | --- | --- | --- |
| 1 | Low weighted cache reads across many measured calls | Could be fresh context, expiry, model changes or unreported caching; not proof of chat switching | First split first calls from continuations and check reporting coverage | A summary; B for reliable classification |
| 2 | Repeated low reuse immediately following confirmed main-agent model changes | A new model cannot use the old model's cache; switching may nevertheless be necessary or automatic | Choose the model before a phase of work; preserve deliberate escalation | B lineage/change events; A only a rough model sequence |
| 3 | Large input is rebuilt after a pause beyond a previously reported expiration | Expired state is plausible; dispatch timing, routing and prefix changes still matter | Resume with a concise handoff or compact stale context when appropriate | B expiry and trustworthy call timing |
| 4 | Many genuinely new, short sessions in the same project | Could be fragmented related work, or entirely independent small tasks | Keep dependent follow-ups together; ask the user whether these sessions belong to one task | A description; B starts; D task relationship |
| 5 | Low reuse during rapid same-model continuations | Possible changing prefix/settings or cache eligibility; could be normal new material | Inspect context/tool changes and cache reporting before changing habits | B lineage/config events; cause may remain unknown |
| 6 | High cache writes with little later reuse | New material might be written but never revisited; one-shot tasks are legitimate | Review repeated starts or unnecessary context loading; do not manufacture extra calls to reuse it | A/B; cross-range censoring matters |
| 7 | High cache reuse and very large absolute input | Good reuse can coexist with an oversized context; cached input still occupies context | Keep the useful stable context, reduce irrelevant material at a task boundary | A; D identifies relevance |
| 8 | Input grows substantially within comparable main-agent activity | Could be accumulating history, files, tool output, or useful progress | Inspect the growth; split unrelated phases and use a concise handoff | A preliminary; B for true sequence boundaries |
| 9 | Large first-call input repeats across sessions | Could be always-loaded instructions/tool definitions, attachments or restored history | Inspect setup context and compare like-for-like fresh starts | B for first-call identity and components; C/D for cause |
| 10 | Frequent compactions followed by large refills | A long task may need this; alternatively large recurring results may refill context | Inspect what is reintroduced; narrow outputs or checkpoint a phase | B, not observed in current sample |

### Tools, MCP, and execution friction

Tool-output design can reduce irrelevant payload through selection and bounded responses. It must still preserve evidence needed for decisions. [Anthropic tool design](https://www.anthropic.com/research/writing-tools-for-agents)

| # | Observed pattern | Possible explanation and counterexample | Useful experiment | Data |
| --- | --- | --- | --- | --- |
| 11 | Tool definitions repeatedly occupy a large absolute and proportional input footprint | A broad exposed toolset may cost context even before execution; it may be cached or needed | Review task-relevant tools before the next session; measure actual footprint afterward | B; strongest newly discovered candidate |
| 12 | Many exposed tools, few distinct tools used in a well-covered session | Potential configuration mismatch; unused capabilities may be necessary later or lazily loaded | Review a smaller task-specific toolset; don't remove tools solely because the selected week has no calls | B; current inventory is not historical exposure |
| 13 | The same tool/server repeatedly reports execution failure | Access, environment, parameters or transient issues; failed tests can be intentional | Inspect recorded failures and the relevant setup; fix a reproducible blocker before retrying | A observation; B error categories; D diagnosis |
| 14 | A failed call is followed by another call to the same tool many times | Possible retry loop; tool name alone cannot establish repeated inputs | Review the sequence; retry only with changed conditions or a reason | A coarse cluster; B lineage; D same-input confirmation |
| 15 | Tool-call count is unusually high relative to this project's comparable history | Broad exploration, a complex task, or an avoidable loop | Supply known entry points and a stopping condition; inspect the actual high-call session | A per session; B per interaction; D relevance |
| 16 | Large tool-return payloads precede sharp input growth | Broad results might be amplifying context; logs may contain full UI output the model did not see | Request relevant fields/ranges or summarize at the tool boundary | B payload metadata plus D/model-facing verification; not available today |
| 17 | Identical reads recur without intervening changes | Possible rediscovery; fresh reads may be needed after edits or external updates | Provide a short project map or reusable artifact; retain necessary revalidation | D arguments/result fingerprints and file-state evidence |
| 18 | Repeated deterministic data collection consumes model steps | Some work may suit a script or batch read; dependencies may require sequential reasoning | Move well-understood repeatable collection into a documented command or skill | B sequence plus D task/dependency review |
| 19 | Few tools account for most observed execution time | Slow dependencies or legitimate long-running builds; summed durations can overlap | Investigate the slow operation, targeted query or safe batching | A intervals; latency issue, not automatically token inefficiency |
| 20 | Permission failures are followed by alternative failed attempts | Environment cannot do the requested job; not poor user prompting | Resolve the specific prerequisite or change scope; never recommend broad permission bypass | B explicit categories/events; D context |

### Models, reasoning, and orchestration

| # | Observed pattern | Possible explanation and counterexample | Useful experiment | Data |
| --- | --- | --- | --- | --- |
| 21 | One model accounts for most credits | High volume or pricing, not proof of unnecessary capability | Try a lighter model on one routine task the user identifies; compare the result | A; no automatic task classification |
| 22 | Reasoning dominates recorded output within one model/effort cohort | Hard work can warrant it; reasoning counts are not consistently exposed by all models | For a known routine task, test a lower supported effort setting | A reasoning coverage; B effort; D task label |
| 23 | Long outputs recur where users want short answers | Could be required generated artifacts rather than prose | Ask for a concise response or write artifacts directly when appropriate | A identifies size only; D distinguishes purpose |
| 24 | Multiple calls end at an output limit | Response may be clipped; a normal stop or tool handoff is different | Split the deliverable or request a bounded format; inspect before changing limits | B finish reasons/limits and follow-up linkage |
| 25 | Subagents account for a high resource share | Useful parallel work, review, or duplicated context | Review overlap and scope; compare narrowly scoped subtasks or a lighter subagent model | A initiator share; B agent hierarchy; D duplication |
| 26 | A user interaction has far more continuation calls than comparable interactions | Autonomous work, difficult debugging, or lack of a clear endpoint | Specify verification and stop conditions; review the outlier | B interaction joins; A initiator totals cannot identify exact turns |
| 27 | Credits rise while same-cohort input/output are stable | Model/effort/pricing/charge-coverage changes may explain it | Inspect recorded cost composition and configuration before changing prompts | A trend; B charge details; no fixed token-to-credit factor |
| 28 | Typical request size falls but requests per interaction rise | Smaller requests may require more steps; a per-request average hides the tradeoff | Compare total resources for complete comparable interactions | B grouping; D work/result comparison |

### Prompt completeness, repository navigation, and memory

These need stronger evidence than accounting. See the [companion research](2026-11-14-context-memory-efficiency.md) for app-specific support, instruction-file research and memory distinctions.

| # | Observed pattern | Possible explanation and counterexample | Useful experiment | Data |
| --- | --- | --- | --- | --- |
| 29 | Repeated clarification/correction about the same goal | Missing initial context is possible; requirements can legitimately evolve | Offer a prompt outline: goal, relevant evidence, scope, constraints, verification and stopping point | D; prompt length/turn count is not completeness |
| 30 | No recognized project instruction entry point is found | Helpful guidance may be elsewhere, personal, managed or unnecessary | Offer a small project map and exact build/test entry points; label the result “not found in checked locations” | C; absence is not poor-quality proof |
| 31 | Instruction links point to missing local files | Broken navigation can cause avoidable exploration; generated files/worktrees may explain it | Repair concrete broken references and annotate when referenced material applies | C; safe path resolution, no command execution |
| 32 | Large broad instructions include many unrelated topics | Some content may belong in scoped instructions or on-demand skills; policies can require it | Review what must always load and what can be referenced conditionally | C structure/size; D relevance and actual loading |
| 33 | Repeated orientation/search before useful actions in one repository | Missing entry points, unfamiliar work or a legitimately large repo | Add a concise directory map and where-to-start guidance; compare subsequent similar tasks | B action order plus C/D interpretation |
| 34 | The same build/test prerequisite causes repeated failures | Setup guidance may be absent or stale; infra may simply be broken | Document a verified command/prerequisite and provide a fast targeted check | A failure observation; C/D command diagnosis |
| 35 | Important facts are repeatedly rediscovered across sessions | A reusable handoff or memory note may help; the facts may have changed | Save concise verified decisions, relevant paths, dates and validation commands | D cross-session content; no memory diagnosis from cache rate |
| 36 | Large memory/instruction material is loaded repeatedly | Might crowd out relevant context, or prevent costly rediscovery | Keep a short index and selectively load topical notes; compare costs on similar work | C inventory; B/D actual retrieval and inclusion |
| 37 | Memory retrieval repeats or returns no useful match | Poor retrieval, irrelevant query, stale facts or expected misses | Review organization and provenance; deduplicate or retire confirmed stale material | D semantics and memory-system-specific telemetry |
| 38 | A recurring workflow has repeated expensive setup | A focused skill/script may make it more consistent; creating one also has maintenance cost | Package a genuinely recurring procedure and verify its outputs | A skill adoption only; D repeated-work recognition |

## How to turn these into useful cards

Show **observation → possible explanation → one experiment → inspect evidence**. Observation confidence and explanation confidence are separate. Never present “high confidence” merely because a field is present: a reliable count does not establish its cause.

An illustrative card, not a statement about this user's usage:

> **Review your tool setup**
>
> Tool definitions occupied a median 28% of input across 32 measured requests in this project.
>
> A broad toolset may be using context that this work does not need. This does not identify tool-result size or uncached charges.
>
> **Try next:** Before your next similar task, review optional tools. Keep required capabilities enabled, then compare the definition footprint and completed work.
>
> **Inspect requests** · **How measured**

A second example:

> **Investigate repeated tool failures**
>
> The same MCP tool reported failure in 6 of 14 completed calls across three sessions.
>
> Check the failing operation before repeating it. Counts alone do not tell us whether the cause is access, parameters, service health or an intentional negative test.

Positive observations also help: “Related follow-ups reused context consistently” or “Comparable interactions now use less input with similar call counts.” Show measurements rather than praise or a quality conclusion. Suppress overlapping cards for the same episode; do not stack a generic cache warning beside a more specific model-change observation.

## Trend and detector design

1. **Keep three separate quantities:** resource footprint (input/output/cache/reasoning), recorded cost (credits), and waiting (model/tool elapsed time). Cache-read tokens remain part of input; reasoning remains part of output. A higher output/input ratio is not proof of better work. Installed tool count is not loaded definition size.
2. **Compare like with like:** project, actual model, reasoning effort when known, main/subagent role, interaction type, and task label when provided. Do not claim the same project guarantees the same difficulty. Prefer medians and percentiles to a single average, plus total cost and sample sizes.
3. **Require exposure and coverage:** distinguish first call in the selected window from a genuine session start. Pair numerator/denominator on the same eligible records. Keep missing, partial, zero, unsupported and invalid distinct. Honor `cacheDetailsReported` where available without declaring all legacy data invalid.
4. **Use event identity:** durable usage IDs deduplicate replay; agent and interaction IDs establish lineage. Do not infer parentage from whichever timestamp is closest. Exclude ambiguous sequences rather than fabricate model switches, user prompts or retry chains.
5. **Validate timing:** receipt event timestamps may describe emission/completion, not dispatch. Expiry comparisons need verified start-time semantics. A policy TTL is not an observed hit guarantee. Do not warn people to rush work or avoid breaks to preserve cache.
6. **Use conservative review triggers:** a draft starting gate for trend cards is 20 eligible requests across at least 3 sessions and 80% field coverage, with a meaningful absolute change as well as a relative change. These are proposed product defaults needing calibration, not scientific thresholds. Incident cards can show fewer events with their exact counts. Avoid multiplying dozens of weak tests into dozens of alerts.
7. **Prefer matched comparisons:** compare complete similar interactions before/after an experiment, while showing request count, effort, cache, total input/output and credits together. Do not infer “saved tokens” from a counterfactual rate. Completion flags or successful tool execution do not prove task correctness; let the user judge results.
8. **Keep analysis cheap:** parse optional scalar metadata during the existing incremental scan; use bounded per-session aggregates, reuse sorted sequences where possible, and return a few cards. Do not run an AI evaluator on each refresh or put transcript analysis on the passive path. Benchmark the eventual implementation on large histories.

## Repository and memory review proposal

A separate **Review project setup** action would answer the user's repository question more honestly than a passive score. It would inspect selected, supported instruction locations, their local references and declared commands; report what was checked; and identify concrete issues such as broken pointers. Bound traversal to the selected repository and approved instruction roots, respect exclusions, and never execute repository instructions as part of scanning.

Possible checks: entry-point presence; reference targets; clear build/test commands; broad versus scoped rules; duplicate blocks; and document size. File bytes are a size signal, not exact billed tokens. File presence does not show that Copilot loaded or obeyed it. Content quality, contradictory rules, whether a prompt supplies sufficient context, and whether a memory is useful require a separate review, not keyword-based grades.

Distinguish prompt cache, current conversation context/compaction, project instructions/skills, project-local memory, and shared Copilot Memory. They have different purposes. A memory directory's size cannot tell us how often its contents were included or whether they prevented work. This plugin currently has no reliable memory-specific cost or benefit measurement.

GitHub explicitly states that memories included in model context contribute to token usage and can affect credits. That establishes a cost mechanism, not the net benefit or a separable memory bill in our local records. [Copilot Memory usage and billing](https://docs.github.com/en/copilot/concepts/prompting-and-context/copilot-memory#usage-and-billing)

The app already documents `/chronicle cost-tips`, `/chronicle tips`, `/chronicle improve`, `/init`, `/context`, and `/compact`, with availability dependent on context. We can offer copyable instructions for a user-initiated deeper review; do not automatically submit a prompt or assume a plugin can invoke these commands programmatically. [App command reference](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/slash-commands)

## Recommended implementation order

1. **Evidence foundation:** retain optional tool-definition counts, cache-reporting state, effort, limits, expiry, and reliable interaction/agent linkage. Add fixtures from supported schemas with missing/invalid/older-field variants. Keep current accounting unchanged.
2. **First useful cards:** definition footprint; confirmed failure clusters; input growth with proper lineage; cache changes around confirmed model changes/expiry; per-interaction resource trends. Show only a few ranked by observed scale and reliability, never hypothetical savings.
3. **Explain tradeoffs:** add reasoning and subagent composition as neutral observations. Replace generic low-cache or concentrated-spend advice when more specific evidence exists. Compare successful user-reviewed experiments rather than rank users/models.
4. **Project setup review:** bounded, explicit repository inspection with concrete findings and links. Consider copyable Chronicle prompts for semantic review before building an expensive analysis engine.
5. **Defer unsupported diagnoses:** prompt-quality scores, memory-efficiency scores, per-skill bills, per-tool token bills inferred from timing, “wasted tokens,” and universal cache targets.

No new recorder or database is needed for the initial metadata-based improvements. Live-only measurements cannot be retroactively recovered; a recorder would be a separate decision, not a hidden requirement of this proposal.

## Verification and limitations

Reviewed current source, official GitHub/Anthropic documentation, primary research and actual local metadata shape. The research probe was not a benchmark, did not test every model/app version, and included a development history that may contain test activity. No recommendation effectiveness experiment, repository content audit, desktop UI test or new product detector was performed. The source links describe their cited product surfaces; cross-product mechanisms are explicitly treated as background. This research changes documentation only.
