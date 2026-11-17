# Context Growth review and proposed direction

Reviewed 2026-11-16 against v0.1.109 (`009946d`). This is an investigation and proposal, not an approved implementation design. No personal histories, paid inference or browser automation were used. Product code is unchanged.

## What exists today

The [Context Growth renderer](../../src/panel/token-topics.mjs) displays one session/model, two numbers (median input of the first and last three measured calls), and a coverage note. It shows only the largest absolute increase qualifying under the [efficiency accumulator](../../src/core/efficiency.mjs). Qualification requires:

- Same project, session, model display name and initiator; only user-started or agent-continuation calls.
- At least six input measurements and 80% input coverage.
- Strictly separated early/late sample timestamps.
- Later median at least twice the early median and at least 10,000 tokens larger; early median above zero.

The [report](../../src/core/copilot-report.mjs) applies date/model/project/session/environment filters before feeding the accumulator. These are comparisons inside the selected window, not necessarily the beginning and end of the conversation. Input includes cache even when the dashboard's Include cache tokens option is off. The accumulator keeps only three early and three late samples per comparison group; the panel has no full trajectory or general session distribution. The same single growth result reaches the [AI reviewer](../../src/node/review-evidence.mjs).

The existing medians, coverage rules and separation of initiators are useful. They limit noisy comparisons. The problem is using a narrow alert rule as the entire dashboard. No qualifying alert does not mean small, stable or well-measured input. The panel also omits the initiator label that the Findings explanation does display.

## Verified blind spots

Synthetic calls through the production accumulator produced:

| Input sequence | Current result | Implication |
| --- | --- | --- |
| Twelve calls at 100k input each | No growth finding | Consistently large input has no useful view here. |
| Three calls at 10k, then three at 19k | No growth finding | A 90% rise is hidden by the alert thresholds. |
| Three calls at 10k, one at 200k, three at 10k | No growth finding | First/last medians hide a middle spike and subsequent reduction. |
| Three calls at 10k using raw model ID A, then three at 40k using ID B, all sharing one display name | A 4× growth finding | Model display names are not a sufficient grouping identity. |

The last case establishes a code-level risk, not that a particular user's history contains that collision. Compaction accounting also enters the general record collection; a redesigned normal-call trajectory should explicitly exclude `origin: compaction` rather than rely on its initiator being absent. There is currently no explicit exclusion in the growth accumulator.

## Proposed focused views

1. **Input size — How much input does each call carry?** Show median input per eligible main-conversation call, a distribution and a secondary 90th percentile. Explain the difference between one call's input and the cumulative amount processed across calls. Always disclose eligible/observed coverage. Consistently large input should remain visible without labeling it waste.
2. **Change over time — How does input change within a conversation?** Let the user inspect a bounded observed trajectory, with early/late medians, peak and absolute change. Show increases, decreases and no material change, plus explicit insufficient-data states. First observed input means first within the window, not a fresh session. Preserve actual peaks when downsampling; do not connect unknown or incompatible stretches into a misleading line. Keep the existing alert threshold as a review cue rather than a gate to all content.
3. **Cache reuse — Is the larger input being reused?** Put cache-read, cache-write and other input beside the same measured calls. Pair the sample denominators. Do not call uncached input “new content”: an old prefix may be reprocessed. This view explains reuse alongside size; it does not duplicate the standalone Cache Reuse dashboard or turn token proportions into credit savings.
4. **Explore conversations — Where is it useful to look next?** Offer several bounded examples, with small trajectories and sortable size, change, calls, cache coverage and recorded-credit context. Default to a diverse selection (sustained size, rise, spike, reduction), not only the largest increase. Make selection/omission rules visible. Open the existing filtered session breakdown for details. These are examples to inspect, not an inefficiency ranking.

The first three can share the focused question/measurement/chart pattern from Conversation Habits. Explore is the drill-down view. Keep coverage and measurement definitions expandable. The exact layouts and names remain to be chosen through mockups after metric approval.

## Available evidence and boundaries

Already retained per call: timestamp, session/project/environment, exact raw model ID alongside display label, initiator, input total, validated input/cache split, output/reasoning, recorded charges/status, duration and tool-definition counts where present. Calls can be linked to human interactions through the existing prompt metadata, but shared/ambiguous groups must remain unresolved. Main-agent continuation data can illuminate growth inside a run versus between human submissions when links are reliable; this belongs in expanded detail, not a compulsory headline measure.

Recorded model/effort changes can annotate a timeline where available. They are not causal proof. Use exact raw identities and reliable root-agent lineage; keep different initiators distinguishable, exclude subagents/compaction from a normal conversation stream, and break comparisons across incompatible or ambiguous segments. Do not silently join samples before and after an intervening model change. Missing raw identity can remain visible as unattributed measurements, without claiming a comparable-model trend.

Historical tool-result sizes, file relevance, retained-history composition and historical context-window occupancy are not established by the retained accounting. `toolTokenCount` measures advertised tool definitions, not returned results. Compaction receipts describe work spent compacting, not necessarily before/after context size. A drop in input alone does not prove compaction. Detailed compaction assessment belongs in the separate Context Reduction section.

The [context inspector](../../src/node/context.mjs) can explicitly obtain current context categories and a limit from the hosting conversation. That snapshot cannot explain a different historical session. Do not fetch it automatically or label a historical input/modern catalog-limit ratio as measured context-window fullness.

Recorded credits may be displayed next to measured calls, with their own coverage. They cannot isolate the cost caused by context growth, establish waste, or promise savings from resetting a chat. No prompt-length-to-input ratio should be labeled context overhead: character counts are not prompt tokens and do not include attachments/injected content.

## Interpretation and practical guidance

GitHub describes prompt input as the new message plus relevant history, files and tool results. It recommends continuing related work and starting a new conversation when moving to a different problem. That supports a controlled task-boundary handoff experiment, not an automatic reset recommendation whenever input grows. [GitHub: conversation context](https://docs.github.com/en/copilot/tutorials/optimize-chat-usage).

GitHub also describes compaction, selective tools and cached context reuse as distinct mechanisms. Consequently, size and cache reuse should be shown together, while tool/file causes require additional attribution. We should avoid importing generic price discounts or expiry assumptions into historical accounting. [GitHub: usage efficiency](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage).

Suggested interpretation examples:

- Large input with substantial cache reuse: substantial context is being reused; relevance and task success remain unknown.
- Large input with little recorded reuse: inspect an observed session and its settings/timing; do not diagnose chat switching from a cache ratio.
- Growth across several task phases: if the user confirms the phases are unrelated, try a concise handoff on comparable work and check retained context and results.
- A spike then reduction: reveal the trajectory; only name a recorded event when reliable metadata exists.

## Performance, reviewer integration and next step

Reuse the scan and in-memory record snapshot. Build bounded summaries once per snapshot/filter and bounded detail on demand, with no journal rereads, added catalog calls or inference on navigation. Avoid storing every session timeline in the initial report; preserve important extrema in any chart sampling and label aggregation. Benchmark new history-sized work with a 100,000+ synthetic record case before shipping.

Export aggregate distributions, matched cache samples, multiple carefully bounded comparisons and coverage to the reviewer. Keep names, session IDs, paths and local detail timelines outside the exported evidence. Distinguish measured change from hypothesized cause; broaden guide instructions beyond the one current growth trigger.

Validation during this investigation: 17 existing efficiency/topic tests passed; four synthetic accumulator cases above were inspected. No UI rendering or live-host check was performed. Next: agree on the useful measurements, create comparable mockups, then implement the chosen layout and regression coverage.
