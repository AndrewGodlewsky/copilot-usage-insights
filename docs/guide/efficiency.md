# Efficiency views

[Documentation index](../README.md) · [Project overview](../../README.md)

How to interpret the efficiency views and their coverage limits. These views describe recorded patterns; they do not establish causes or guaranteed savings.

## On this page

- [Efficiency](#efficiency)
- [Overview and recovery](#overview-and-recovery)
- [Navigating the explorers](#navigating-the-explorers)
- [Context reduction, model comparisons, and repetition](#context-reduction-model-comparisons-and-repetition)
- [Measurements and context inspection](#measurements-and-context-inspection)
- [Conversation habits](#conversation-habits)
- [Context growth and findings](#context-growth-and-findings)
- [Model pricing and current context](#model-pricing-and-current-context)
- [Model and effort changes](#model-and-effort-changes)

## Efficiency

The **Efficiency** tab explains where tokens go and turns measured patterns into experiments you can try. It cannot judge the quality or value of your work. There is no efficiency score, projected savings, or assumption that large context is waste.

Use the three buttons at the top: **Where did the tokens go?** (default), **Worth a closer look**, and **AI review**. Only the selected dashboard is shown. Switching sections makes no API requests, and the selected section stays open across refreshes and main-tab changes.

## Overview and recovery

The **Overview** section in **Where did the tokens go?** shows the input/output split using requests with both counts recorded. The large percentage is the share of measured token volume that was input, including cached input; it is not a share of credits. Select **Cache reuse** for the cache explanation or **Always-loaded context** for the current inspector. Recorded tool outcomes are under **Worth a closer look > Calls and recovery**.

**Calls and recovery** shows recorded tool failures and what followed them: failed calls as a share of calls with a known outcome, how often the next call of the same operation in the same conversation succeeded, the longest run of failures in a row, and the time recorded in failed calls. It lists the operations with the most failures, failure rates for operations with at least five known outcomes, and runs of failures with what came next, then separates MCP tools from other recorded tools using only known outcomes. Root-session error events are separate incidents; they are not failed-model-request counts. Model-call failures and retries are not reliably retained. No wasted-call or wasted-token total is inferred: a failed tool can produce a useful recovery, and the next call can be a different request rather than a repeat.

| Measure | Calculation |
| --- | --- |
| Input / request | Inclusive input divided by requests with an input count |
| Output / request | Output divided by requests with an output count; reasoning remains part of output |
| Tool definitions / request | Recorded `toolTokenCount` divided by requests with valid tool-definition and input counts; definitions must not exceed input |
| Cache reuse | Cache-read tokens divided by inclusive input from the same requests with a valid, complete cache split |
| Credits / request | Complete recorded charges divided by requests with complete charges; includes zero charges and excludes partial/missing charges |

Coverage is visible under summary values and in model-value tooltips. Missing data shows **Unavailable**, not zero. Explicit `cacheDetailsReported: false` is treated as missing cache detail even if placeholder zero counts exist. Older records may lack tool-definition counts. Definitions describe available tools; they are already part of input and do not measure tool-result size or per-skill cost.

## Navigating the explorers

**Where did the tokens go?** has a compact horizontal token explorer, starting with **Overview**. Drag the blue inspection lens between sections, click a topic icon, or use the **Previous / Next** arrows. With the lens focused, use arrow keys to move one section or **Home / End** to jump to either end. All ten stops fit the panel without horizontal scrolling. Hover over an icon for its full name; the buttons also have full names for screen readers. The lens changes its symbol with the selected topic, and the full selected title remains visible below the track. All sections are available immediately, and only one is shown at a time. Short sections reserve the remaining viewport space during navigation so the page does not pull the slider away from your pointer; changing content is excluded from browser scroll anchoring. Navigation does not fetch data or inspect context.

The section order is **Overview**, then **Always-loaded context**, **Tool and MCP footprint**, **Files, searches, and tool results**, **Cache reuse**, and **Skills and instruction footprint** under Context; **Work behind each prompt**, **Delegated work**, and **Reasoning and generated output** under Agent work; and **Biggest spend drivers** under Spending. The selected section's group and position appear above its title.

**Worth a closer look** uses the same compact draggable explorer, starting with **Findings**. Its eight section icons appear on both the track and the blue lens, with the full selected name below. Drag, direct clicks, keyboard controls and Previous / Next work just as in the token explorer. Choose **Conversation habits**, **Context growth**, **Context reduction**, **Calls and recovery**, **Model and effort changes**, **Repeated exploration**, or **Model comparisons**. Findings retains measured observations, practical experiments, comparison guidance, and positive cache-reuse findings.

## Context reduction, model comparisons, and repetition

**Context reduction** counts recorded compactions with their outcome and the reason Copilot recorded for each one. It shows Copilot's own estimate of context size before and after, the usage of the calls that wrote the summaries, the last model call before a compaction beside the first one after (input and cache-read share), how soon input grew back, and the conversations compacted most. Only counts, the outcome and the trigger are kept from a compaction event; its summary text, instructions, error text and checkpoint path are never read. A smaller context does not show what information was kept, and token reductions are not credits returned.

**Model comparisons** sets each model's share of calls beside its share of recorded credits, then compares credits, input and output per call as multiples of the lowest-credit model with at least 20 calls. Further columns show cache-read share, reasoning share of output, average call duration and output per second, each on the calls that record it, and who started each model's calls: the main conversation, subagents, or not recorded. Models were given different work, so this is not a like-for-like benchmark; multiples describe size, not value. The existing per-model table stays below.

**Repeated exploration** counts tool calls that repeat an identical earlier call in the same conversation: how many, as a share of the calls that could be compared; which operations repeat most, with reading and searching kept apart from everything else; how soon the same call came back; how many repeats followed a recorded compaction of that conversation; and the conversations with the most repeats. Only the same tool name with exactly the same arguments counts, so reading a file with a different line range is not a repeat. Calls are compared while your history is read and their arguments are never stored or shown. A call is left uncompared, not counted as zero, when it was made inside a subagent, records no arguments, or its journal line is longer than 4,096 characters. Re-running a command after a change is normal, a repeat can be needed, and no tokens or credits are attributed to repeats.

Both selections survive refreshes, filter changes, settings changes, and tab changes within the open dashboard. Switching sections makes no requests, scans no logs, and invokes no AI. Reopening starts at Overview and Findings. **AI review** stays separate: neither dashboard appears inside it, and inference requires the explicit Create action.

## Measurements and context inspection

Each token explorer section now provides measurements, an observation, an experiment to try, and what to compare afterward:

| Section | What you can explore |
| --- | --- |
| Overview | Matched input/output balance and request averages; the token mix (uncached input, cache read, cache write, output); the largest model, project and conversations by token share; input and credits per call over time; and an index of the other sections with each one's headline figure |
| Always-loaded context | The current conversation's room left against its allowance, what fills it, setup beside conversation, the largest sources you can change grouped by kind, and the snapshot beside your selected history |
| Tool and MCP footprint | Definition tokens and available tools per call, input share and how both change over time; the footprint grouped by how many tools were available; the projects and models with the largest footprint per call; and tools available on a typical call beside the different tools actually executed |
| Files, searches, and tool results | Executed tool calls grouped by kind (reading, searching, commands, editing, MCP, other) with how long they took; an estimate of the input added between consecutive model calls, grouped by how many tool calls ran in between; and the current conversation's tool-attributed context alongside the most-used tools and their recorded outcomes |
| Cache reuse | Matched uncached input, cache reads/writes, and weighted reuse by model; reuse by time since the previous call, on a conversation's first call in range, and after a model change; reuse over time; and the conversations with the most input not read from cache |
| Skills and instruction footprint | Recorded skill uses split by how each was loaded (preloaded at start, invoked by the agent, invoked by you), per-skill conversations, projects, last use and failed loads, alongside current instruction tokens and skill and plugin sources |
| Work behind each prompt | Typical and average model calls, tokens and AI credits per eligible prompt; prompts grouped by how many calls they needed; the share of credits held by the heaviest tenth; calls started by the message, agent continuations and subagent calls; and the five heaviest prompts, each opening its conversation in Breakdown |
| Delegated work | Main-conversation, subagent, and unrecorded shares of calls, tokens, and credits; a per-call comparison of subagent and main-conversation calls; the models each side ran on; and the conversations that delegated most |
| Reasoning and generated output | Output volume and the reasoning/other-output split on calls with both measurements; output per call and reasoning share over time; how output is spread between short and long calls; effort levels compared within one model; and output speed and call duration by model |
| Biggest spend drivers | How many session groups make up half and 80% of recorded credits; the five largest with their calls and credits per call against a typical group, each opening in Breakdown; and the projects, models, and days holding the most credits |

Historical measurements reuse the existing filtered report. **Work behind each prompt** reuses complete prompt accounting: groups are formed before filtering and dated by the user's submission, including reliably linked continuations and delegated work. Its token average includes only eligible prompts with input and output recorded for every included call; cached input is counted once. Model filters explicitly show selected-model contributions. These prompt-date totals can differ from request-date totals elsewhere. **Delegated work** instead groups request-date usage by the recorded initiator; unknown initiators remain unknown, and this does not establish parent links.

Context is fetched only when you select **Inspect context**. The same snapshot is reused in the context, tool, result, and skill views until you inspect again. It describes the conversation hosting this dashboard, independently of history filters. Conversation context includes user, assistant, and tool messages together. Attributed MCP entries can include both definitions and messages, and parent/child sources can overlap. Skill use counts retain the existing model-filter exception shown in Breakdown. Neither installed skills nor invocation counts establish historical token cost or unused context.

Lists show at most five contributors. Missing measurements remain **Unavailable**, recorded zeros remain zero, and partial charges retain their markers. Each comparison keeps its measured denominator visible. These views overlap; their token counts are not added together. The [measurement contract](../token-explorer-insights.md) records the data and attribution limits. The [original section roadmap](../research/2026-11-14-token-sections.md) records where these sections started.

## Conversation habits

**Conversation habits** uses four focused views: **Your interactions**, **Agent activity**, **Guidance & stops**, and **Returning to chats**. Each shows one question, a typical measurement, a distribution and expandable explanations. Charts cover confirmed user-prompt counts, complete linked model calls per prompt, idle/steering/queued/unknown delivery, steering concentration, explicit user stops, and dates with activity. Counts describe the selected window, not lifetime depth or task duration. No view assigns an efficiency rating. Below the four views, a measured section relates your own patterns to the work that followed: conversations grouped by prompt count with each group's share of recorded credits; typical and average calls, credits and tokens by a prompt's position in its conversation, with the number of conversations where later prompts averaged more credits than the first; the same figures by the pause since your previous prompt and by prompt length in characters. Only prompts with complete work figures contribute, and the count is shown. Later prompts are often harder tasks, so position is not a cause, and prompt text is never read or kept.

Confirmed steering and queued messages count toward conversation depth even when they share billing with an earlier message. This does not make their costs independently attributable: financial eligibility and totals are unchanged. Agent activity includes initial calls, continuations and reliably linked subagents, grouped before date filtering. Prompt-level coverage differs from the expandable joint conversation/work chart, which requires every observed prompt in a session to have complete, finished accounting. Unknown human identity, missing delivery and incomplete work remain explicit.

Comparable preceding periods appear only with adequate samples and similar observed coverage. Both denominators stay visible; missing logs or different work can still explain changes. **Explore conversations** opens up to eight anonymous examples with up to sixteen recorded events each, drawn from metadata already in memory. These are a bounded selection, not a representative sample; no prompt text is read. Navigation preserves selection and keyboard focus across refreshes and makes no data or AI requests. Date, project, session and environment filters apply; model filters hide these session-wide measures.

The AI reviewer receives the aggregate distributions, coverage and eligible comparisons, never these local example timelines. Current instruction inspection remains in **Skills and instruction footprint** and the explicit context inspector. Prompt length remains an expandable detail and measures displayed-text characters, not completeness or quality. [Conversation Habits measurements and limits](../conversation-habits.md) documents the denominators, comparison rules, privacy and performance check.

## Context growth and findings

**Context growth** opens with a summary across all conversations: typical input at prompts 1, 5, 10 and 20 beside each conversation's own change since its first prompt; how many conversations reached two and five times their starting input; the share of main-conversation input and of complete recorded credits that came after a conversation had doubled its start, with the cache-read share of those later calls; and how many conversations have a recorded compaction. A long conversation can need its history, so none of this is a savings estimate. Below the summary, the view groups sessions into input shapes with median lines and shaded middle-50% ranges. This reduces overlapping lines without distorting token counts with a logarithmic scale. Select a shape, switch between input size and change, or inspect a bounded session example. Project/model selectors mirror dashboard filters. Measurements use the first reliably linked main-agent call per confirmed user prompt, including cache once; incomplete or changing-model histories remain unclassified. AI review receives aggregate patterns and coverage, without local names or trajectories. See [Context Growth measurements and limits](../context-growth.md).

Each qualifying observation pairs evidence with an alternative explanation, one experiment, and a follow-up comparison. At most one finding of each kind is shown. The first five rows are the original findings; the rest draw on the other Efficiency views, appear under **From the other views** with a button that opens the view holding the detail, are ordered by how far past its own threshold each measure is, and are capped at five with a line saying how many more qualified. When nothing crosses a threshold, Findings names what was checked, and lists checks with too little data separately:

| Pattern | Review threshold | Experiment |
| --- | --- | --- |
| Growing input | Same project, session, model and initiator; 6 measurements, 80% coverage; last-three median at least 2× and 10k above first-three median | For a new phase, try a fresh conversation with a concise handoff; verify retained context |
| Tool-definition overhead | A model has 5 matched samples, 80% coverage, at least 1k definition tokens per request and 10% definition share of input | Inspect context; remove an unrelated integration for a focused task and compare |
| Low cache reuse | 5 complete samples, 80% coverage, 50k input tokens and less than 50% reused | Keep related follow-ups together and avoid unnecessary model switches; cold starts and expiry can also explain low reuse |
| Concentrated credits | Two models have 5 complete charges each; 80% overall charge coverage; one model has at least 60% of complete charges | Try a lighter model on comparable routine work, checking results and retries |
| Repeated MCP failures | At least 3 failed tool calls for a server | Reproduce one operation and check status, authentication, permissions and arguments before retrying a larger task |
| Cache reuse after pauses | 10+ calls with a complete cache split after a pause under 5 minutes and after one over an hour; reuse at least 20 points lower after the long pause | Send one short follow-up after a long break and compare its cache share with calls after short pauses |
| Heaviest prompts | 20+ prompts with complete charges, charges final; the heaviest tenth holds at least 50% of credits | Send the next task of that size in two or three smaller steps and compare the total |
| Failed calls in a row | 10+ calls with a known outcome; 3 or more failed calls in a row for one operation | Reproduce that operation by hand and check status, permissions and arguments |
| Repeated compaction | 3+ compacted conversations; at least 2 compacted more than once, and at least 25% of them | Start a fresh conversation with a short handoff at a natural break and compare |
| Input after doubling | 20+ calls with known input in 3+ conversations; at least 50% of input came after a conversation had doubled its first call | Hand off to a new conversation at the next change of phase and compare input per call |
| Cache after a model change | 5+ model changes with a complete cache split; median reuse at least 20 points lower on the first call after; unavailable under a model filter | Keep one model for a whole task and compare cache share |
| Repeated reading and searching | 20+ compared reading/searching calls; at least 5 repeats and at least 15% repeated | Keep short notes of read files and re-read only after changes |
| Later prompts costing more than the first | 5+ paired conversations with complete work figures for first and later prompts; later prompts averaged more credits in at least 70% | Start a fresh conversation with a short handoff at a natural phase change |
| Credits across effort levels on one model | 2+ effort levels with 10+ complete-charge calls on the same model; higher effort averages at least 1.5× the credits per call | Run one routine task at the lower effort with the same acceptance checks and check for rework |

Growth comparisons exclude subagents, unknown initiators, and overlapping sample timestamps. MCP failure percentages use known successful/failed outcomes only and display unknown counts separately; a failed tool call does not establish a connectivity problem. These thresholds select places to investigate, not ideal targets. **Inspect usage** opens the filtered model breakdown (also selecting the session/project for a growth finding). **Inspect MCP activity** opens the MCP panel with the current filters. Positive cache-reuse observations appear for up to three models with at least 5 samples, 80% coverage, 50k measured input, and at least 80% reuse; this does not establish task quality or savings.

## Model pricing and current context

**Current model pricing:** the model table links to [GitHub's current Copilot prices](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing). We store no price table and do not reprice historical usage at current rates. GitHub [documents runtime pricing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing#per-model-ai-credit-pricing), but the installed joined-session extension API does not expose the server-level pricing-unit lookup needed for a reliable catalog reader. A dynamic pricing integration is deferred; recorded average credits already reflect actual reported charges.

**Always-loaded context** is an explicit, on-demand inspection of the Copilot conversation hosting the dashboard. It calls the host's `metadata.getContextAttribution` capability and shows estimated tokens for system instructions, custom instructions, built-in tool definitions, MCP tool definitions, and conversation/tool-result messages. Expand **Largest attributed sources** for up to 100 sources, including skills/plugins when the host attributes them. Parent and child entries can overlap: they are never added together. A parent may be outside the displayed top 100. Installed or rarely invoked skills are not proof of wasted context.

This snapshot is separate from history filters, carries its own timestamp and tokenization model label (when supplied), and updates only on **Inspect context / Inspect again**. It is an estimate of current context, not a bill or a historical average of instruction/skill overhead. Unsupported, uninitialized, or timed-out hosts show a useful fallback to Copilot's `/context`. No extra history scan is performed; calls are single-flight and the UI has a bounded wait. The installed SDK contract is covered by tests; live availability depends on the Copilot build/session.
## Model and effort changes

In **Efficiency → Worth a closer look → Model and effort changes**, the view lists recorded model and effort changes as from-to pairs, how each change was recorded (model picker, SDK client or agent), calls where Copilot picked the model, the conversations with the most changes, and the last main-conversation call before a model change beside the first call after it (input and cache-read share). The effort table uses each call's recorded `usage.reasoningEffort` and compares levels inside one model only: a level needs at least 10 calls and a model needs two such levels, with credits averaged over complete recorded charges (including zero). Effort is never filled from a session default. Unknown or unsupported levels stay unknown; reasoning, output and speed by level are under **Reasoning and generated output**. Lower cache reads after a change are consistent with a cache that does not carry across models, but the cause is not recorded.

Switch counts use deduplicated `session.model_change` events with known, unequal old/new values. One event may change both dimensions. `model_picker` is manual; SDK, agent and startup sources are automatic; absent sources stay unknown. Child and ephemeral events are ignored. Date/project/session/environment filters apply; model filters include changes touching the selected model. Mixed/unattributed provider sessions are omitted with a count. Consecutive requests do not establish a switch because subagents and automatic routing can overlap. This first view does not claim that changing a setting improved results or reduced cost.

Bundled coding-evaluation facts live in [`data/model-benchmarks.json`](../../data/model-benchmarks.json). They are validated and embedded during the build, then selected locally for the exact prepared AI review. Nothing is downloaded at runtime. See [benchmark sources, limits and maintenance](../model-benchmarks.md) to update evidence, verify mappings, and run the offline validator; benchmark scores never establish Copilot availability, equivalent results or savings.
