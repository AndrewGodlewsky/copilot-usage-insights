# Efficiency statistics and optional AI analysis

Proposal researched November 14, 2026 against Usage Insights 0.1.29, commit `dbfa45b`. This records the user's direction and a recommended approach for discussion. It is not an approved implementation specification or a shipped feature. Related: [data inventory](2026-11-14-copilot-data-inventory.md), [SDK audit](2026-11-14-copilot-sdk-surfaces.md), [inference rules](2026-11-14-efficiency-inference.md).

## Recommended approach

Use two complementary layers: fast, locally calculated statistics and an explicitly requested **Analyze My Usage** review. The statistics establish what happened; a model can help explain combinations of observations and propose useful experiments. Giving a model insufficient data does not make an otherwise unsupported diagnosis reliable.

The user's priorities are actionable signals about context overhead, unused or broadly loaded resources, unreliable MCP integrations, and input that accumulates without being obvious. Keep those practical concerns central rather than turning the tab into a general AI-adoption score.

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| Local statistics and rule-based directions | Fast, repeatable, no additional model call; counts can be checked | Cannot assess prompt quality, task relevance or semantic usefulness from counts alone |
| Local statistics plus a report the user can review in Copilot chat | Smallest AI-assisted option; user controls the conversation | Extra handoff; analysis/results are outside the dashboard; chat may have additional context/tools |
| Local statistics plus a dedicated analysis agent | Convenient in-dashboard review of a defined report | Requires verified agent isolation, result collection, cancellation, cost disclosure and compatible host APIs |

Recommend the third as the intended experience, built after the local statistics. Keep the second as a simple fallback if the installed host cannot support a suitably constrained agent. A copyable report is useful independently; do not silently replace an isolated analysis with an unrestricted agent or automatically send it into an active conversation.

There is also an existing alternative: Copilot's app command reference lists `/chronicle cost-tips`, `/chronicle tips`, and `/context`. Chronicle provides broader session-history analysis; our proposed feature would explain an explicit dashboard snapshot and its measured evidence. No supported contract was found for embedding Chronicle's results or guaranteeing that it uses the dashboard's exact filters. Do not invoke reindexing or content search merely to populate this tab. [App commands](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/slash-commands), [Chronicle usage](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/chronicle)

## Statistics worth adding

Keep **selected-range history** and **current hosting-session context** visibly separate. A 30-day filter cannot turn a live snapshot into 30 days of attribution. Some data below is already retained; other fields were observed or declared and require implementation and validation.

| User question | Proposed measurement | Data and limitation |
| --- | --- | --- |
| What input am I sending repeatedly? | Average/median input per model request, input-growth comparisons, valid cache split | Input totals already retained. This includes history and other context, not just the user's newly typed prompt. High input is not automatically waste |
| How much space do tool descriptions take? | Average definition tokens per measured request; share of input on the same measured requests | Observed `toolTokenCount`, currently discarded. Definitions are distinct from returned results; high footprint does not prove the tools were unnecessary |
| What occupies context right now? | System instructions, custom instructions, tool definitions, MCP definitions and conversation; expandable skill/plugin/tool contributors | Declared `metadata.getContextAttribution`, pending live verification. Tokenization is model-dependent; nested parents/children overlap |
| Are my instructions or skills getting large? | Current attributed size/share, with a source to inspect where identity is reliable | Can identify a contribution worth reviewing, not whether it is relevant. No reliable historical per-source average or growth trend yet |
| Which MCP integrations are giving me trouble? | Calls, known failures, unknown outcomes, success percentage, repeated-failure periods, measured durations | Existing start/complete events support much of this. Add safe error categories only where present. Tool failures are not necessarily connection failures or server faults |
| Is an MCP server connected? | Current status, authentication/configuration error category and tools-loaded state | Current inventory exists. Historical uptime/reconnect failure rates are not reconstructable from today's status |
| Are calls stopping or taking unusually long? | Recorded duration distribution; known output-limit stops; optional first-token timings | Additional fields need retention and coverage checks. Safety stops, tool-call stops, cancellation and normal completion differ |
| Does the same work keep becoming more expensive? | Comparable interaction/task trends and outliers within project/model/effort groups | Requires reliable joins; a session or request is not automatically a whole task. Quality and changing workload remain unknown |

The dashboard should show coverage beside measurements, disclose unsupported sources, and prioritize a few actionable findings. More statistics are useful only when their definitions and implications remain clear.

### Define “average hidden tokens” carefully

The user's underlying question is valuable: how much input comes from the setup and accumulated context, beyond the message they just typed? Use **Context overhead** as a plain-language area, with individually defined measures rather than a single invented total.

- **Average tool-definition tokens/request** = sum of valid definition-token counts divided by the number of requests with that measurement.
- **Definition share of input** = sum of definition tokens divided by sum of input tokens for that same eligible set. Require valid units/counts and exclude inconsistent measurements. Do not average unrelated percentages.
- **Current instruction/skill contribution** = runtime-attributed tokens in the current window, labeled with observation time and tokenization model. Do not describe this as an average or a bill.
- **Starting input size** may be a future descriptive measure only when the true initial call is known. The first request visible after a date filter is not necessarily a fresh session, and its input includes the initial user task.

These do not measure what the user noticed. They also do not measure unique newly added tokens: the same context can be processed on many calls, caches can reuse it, and compaction can remove it. Do not calculate overhead by subtracting prompt character counts from request tokens, assume all input is user prompting, or add overlapping attribution rows. A historical average for instruction/skill contributions would need historical source attribution that the audited records do not currently establish. A new recorder is not necessary for the first version and is not proposed here.

### Loaded, installed and unused are different

An installed skill is not necessarily fully loaded. Discovery metadata, preloaded skill content, selectively loaded references and actual invocation events have different meanings. A skill loaded once can guide many later requests without another invocation. Conversely, a loaded skill can be irrelevant. Tool definitions can also be deferred. See the [technique catalogue](2026-11-14-efficiency-techniques.md#intermediate-improve-reusable-context-and-workflow-setup).

Useful wording is **“Large context contributors to review”** or **“This resource is currently loaded.”** A row may combine current size with recorded activity, but should not label it “unused” or “pollution” merely because there was no recent invocation. An AI review of metadata alone has the same limitation. Determining relevance requires a task description or a separately requested, bounded content review.

For MCP reliability, use `known successes / (known successes + known failures)` and display unknown outcomes separately. Separate “server currently needs authentication” from “calls to this server failed.” A repeated tool error can originate in arguments, permissions, invalid test cases, downstream data or transient conditions. Duration can include permission waits and overlapping operations; do not report summed durations as user time lost.

## Analyze My Usage: proposed flow

1. The user selects a range/project/model. Beside **Analyze My Usage**, show what will be included, an optional **View data** link, and a notice that analysis uses AI and may consume Copilot credits. Clicking Analyze starts the requested review; no repeated confirmation is proposed. Previewing/copying the report requires no inference.
2. Freeze the report at that point. Include aggregate measurements, coverage, comparable groups and a small bounded set of evidence records. If current-session context is included, place it in a separate section with its session scope and observation time.
3. Send the user-requested summary to a dedicated analysis agent. Prefer one short review with no tools, no filesystem/network access, no automatic delegation, and no preloaded skills. Do not send raw event logs, prompt/reasoning text, tool arguments/results, credentials or arbitrary error messages by default. Project/source labels may also be sensitive; use aliases or visibly selectable labels.
4. Return three to five evidence-linked findings, each explaining the observation, a possible cause, uncertainty and one practical next action. The agent should be allowed to say that the report does not justify a recommendation.
5. Retain the result in the current dashboard view with an analyzed-at time and filter summary. Mark it stale when inputs change. Provide explicit rerun/cancel controls; ordinary refreshes and filter changes must not start another analysis.

Example output shapes, **illustrative rather than user measurements**:

- “Tool descriptions account for a large share of measured input. Review the tools needed for this workflow and compare a narrower set on the next similar task.”
- “Several completed calls to this MCP server failed. Inspect the repeated error category before retrying.”
- “This skill contributes substantially to the current context. Check whether its references need to load for this task.”

Numbers and evidence IDs should come from the deterministic report. Validate any structured response, reject unknown evidence references, and render output safely. Treat names and other supplied strings as data, not instructions. The analyst must not invent missing outcomes, memory quality, per-skill bills, wasted credits or guaranteed savings. An instruction saying “do not use tools” is not a replacement for an enforced tool restriction.

A small, versioned set of guidance from this research can inform the analyst. Do not attach the entire research library or every user's log: that would make a resource-efficiency review unnecessarily expensive. Cap report size, summarize large groups and disclose sampling. Compute statistics during the existing ingestion/reporting work; don't repeatedly scan message bodies to feed the model.

The analysis's own usage belongs in normal usage totals. Where reliable agent/accounting identifiers are available, label it as analysis work and avoid using it as evidence for the behavior it is evaluating. Freezing the input snapshot before dispatch prevents the running review from continually analyzing its own new activity. Do not promise an exact credit cap or cancellation refund without a supporting runtime contract.

## What the installed SDK supports, and what remains untested

Static inspection of the same build recorded in the [SDK audit](2026-11-14-copilot-sdk-surfaces.md) found:

- `extension.d.ts:6,59`: `joinSession` accepts configuration derived from `ResumeSessionConfig` and returns the hosting `CopilotSession`.
- `types.d.ts:1742,2597,2891`: custom-agent definitions can be supplied through the shared session configuration. They expose prompt, tool list, `infer`, optional preloaded skills, model and reasoning settings. Omitted/null tools mean all tools; that is unsuitable for this analysis proposal.
- `generated/rpc.d.ts:33646,40056`: `tasks.startAgent` declares agent type, prompt, name, description and optional model. It does not expose a per-call tool allowlist, a no-history flag or a numeric credit budget. A dedicated agent definition and actual host behavior must establish restrictions.
- `generated/rpc.d.ts:32932,33021,33356,40098,40134`: task metadata has ID/status/result text; progress and cancellation methods exist. `tasks.readOutput` is for detached shell output, not a generic analysis-agent result reader. Match the returned task/agent identity and collect only that task's result.

Official [custom-agent guidance](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents) describes scoped tools, isolated subagent contexts and explicit-only inference settings. That supports the architecture, but does not prove that an extension registering an agent gets no inherited parent content. No host method was invoked here, and current online `session.startSubagent` examples must not be copied into a bundle whose local session declaration lacks that method.

Before implementation is considered complete, verify extension agent registration/merging, empty-tool-list behavior, inherited instructions/history, explicit-only dispatch, model resolution, final-result correlation, failure/cancel behavior, and whether completion schedules a parent turn. A parent follow-up could change context or cost beyond the intended review. Verify that concurrent user work is unaffected. If a narrow execution contract cannot be established, ship the preview/copy handoff rather than implying isolation.

This is a capability investigation, not a live integration test. No analysis agent was started, no private report was transmitted, and no configuration was changed.

## Suggested delivery order

1. Add measured context/definition statistics and useful MCP reliability summaries with coverage. Validate live attribution separately from filtered history.
2. Add a previewable, copyable analysis report and its evidence schema. It remains useful without model integration.
3. Verify the dedicated-agent path, then connect the optional analysis button. Keep it an explicit action with bounded input and graceful failure.
4. Consider a separately requested project/prompt review only if users need diagnoses that metadata cannot support. Avoid broad background content analysis.

The first release can therefore provide useful efficiency information without a recorder or continuous AI cost. Optional analysis adds interpretation; it should preserve the same evidence boundaries as the statistics it receives.
