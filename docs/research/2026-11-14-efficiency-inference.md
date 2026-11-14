# From resource patterns to useful efficiency directions

Design proposal, November 14, 2026. Companion documents: [techniques and experiments](2026-11-14-efficiency-techniques.md), [stored-data inventory](2026-11-14-copilot-data-inventory.md), [SDK capabilities](2026-11-14-copilot-sdk-surfaces.md). The rules and examples here are proposed product logic, not validated detectors or observations about a particular user.

## A pattern's opposite is not automatically an anti-pattern

The user's proposed approach is valuable when it starts an investigation: identify a useful practice, look for observable evidence, and offer an experiment when there may be an opportunity. It becomes unreliable when a proxy is treated as the practice itself.

For example, useful skills may reduce repeated setup work. That does not mean low skill counts prove repeated setup work, or that high counts prove a useful skill was followed. A skill can stay loaded across many requests; a user can solve novel tasks without skills; event coverage can be incomplete. Conversely, repeatedly loading irrelevant skills can increase cost. The same ambiguity applies to cache reuse, tool counts, conversation length and model choice.

Use four questions in order:

1. **Was there an opportunity?** Was this repeated, comparable work for which the technique could help?
2. **Was the technique available and used?** Can we establish availability at the time, exposure, and observed use with adequate coverage?
3. **What mechanism changed?** Did relevant input, tool overhead, failures, repeated setup, latency, or charges change?
4. **Was the result still acceptable?** Check completion, correctness and human review/rework separately. The plugin's accounting does not answer this automatically.

Only the first two can identify a missed-adoption opportunity. Only the latter two can support a claim that a change improved efficiency. A before/after correlation without comparable work is still a hypothesis.

| Opportunity evidence | Adoption evidence | Appropriate interpretation |
| --- | --- | --- |
| Present | Present | The practice was observed where it might help. Evaluate benefit; don't award an efficiency score |
| Present | Reliably absent | Candidate experiment: try the practice on this task family |
| Absent | Present | No conclusion yet; investigate unnecessary overhead only with relevance evidence |
| Unknown | Absent or unknown | Insufficient evidence. Offer optional learning material rather than a warning |

## Skills: use the right denominator

Keep descriptive counts available: uses, sessions with a recorded use, user-invoked/agent-invoked/context-loaded/unknown triggers, plugin provenance, and installed version. They tell users what was recorded.

Do not use `skill uses / model requests` or `skill uses / tokens` as a quality metric. One activation may support a hundred agent requests. A large-token workload can be a single legitimate task. Conversely, many tiny explicit test invocations can produce a high ratio without saving any work.

A future **eligible-workflow adoption** measure could be:

`reviewed eligible workflow instances with relevant skill evidence / all reviewed eligible workflow instances with adequate event coverage`

Eligibility must come from a user label, a known workflow identifier, or a separately validated classifier—not merely matching a project name. Record what established eligibility, whether the skill was available then, and whether it was already loaded. Evaluate automatic discovery separately from explicit user invocation. Do not present this measure until those inputs exist.

Illustrative example only: a user identifies 12 comparable release-note tasks, a compatible skill was available for all 12, and retained events cover all of them. Two tasks show relevant skill loading and ten do not. This supports offering a trial on the next release-note task. It does not show that ten tasks wasted tokens. Compare total resources and accepted results for matched trials before claiming a benefit.

With today's metadata alone, a safe card would say: “Few skill uses were recorded in this range. If you repeat a workflow, try a relevant skill on one example and compare the result.” This should be an optional exploration prompt, not a prioritized inefficiency finding. The [technique catalogue](2026-11-14-efficiency-techniques.md) gives the fuller availability/discovery/adoption/benefit model.

## Candidate signals and honest recommendation wording

All examples below are proposed. Some measurements require additional retained fields or a live snapshot.

| Observation to establish | Possible explanation, not diagnosis | Direction to offer | Evidence needed before a stronger claim |
| --- | --- | --- | --- |
| High definition-token share across comparable calls | Broad tool exposure may occupy context | Review which tools this workflow needs; trial a narrower set | Actual definitions exposed, task needs, preserved completion; installed counts alone are insufficient |
| Low cache reuse on repeated calls within the same agent/model context | Expiry, prefix changes or limited cache eligibility | Inspect timing and known context changes before changing conversation habits | Reporting support, call order, cache state, continuity; no universal hit-rate target |
| Large context late in a long interaction | Accumulated history or necessary evidence | Try a verified handoff at the next task boundary | Relatedness, compaction history, rework after handoff; context size does not measure irrelevance |
| Repeated known failures in one tool family | An environment/configuration or input problem | Investigate the recorded failure category and repair one cause | Stable categories, same operation/state and retry reason; a failure count cannot identify the fix |
| High credits for a recurring, accepted routine task | Another model/effort setting might meet the same bar | Run a small matched comparison with an escalation path | Task equivalence, quality, all attempts, review time, full charges |
| Large skill/plugin share of **current** context | A loaded resource may be larger than this task needs | Inspect the relevant source and trial selective loading | Live model/token basis, hierarchy, relevance; footprint is not historical skill cost |
| Repeated setup/navigation on a known workflow | Missing verified entry points or reusable steps | Try a short project map or a tested skill | Read targets, revision changes, verified setup relevance; generic search counts are insufficient |
| Repeated rediscovery after a handoff | A useful fact may be missing, stale or undiscoverable | Trial a compact verified checkpoint | What was known, stored, retrieved and needed; memory enablement alone cannot establish this |

## Card contract

Every direction should have a short visible observation and an expandable explanation containing:

- **Scope and grain:** time range, project/session/model, historical request versus current snapshot.
- **Evidence:** measured numerator/denominator, eligible sample size, coverage, and comparison baseline.
- **Mechanism:** what resource pattern occurred; distinguish measurement confidence from confidence in the explanation.
- **Alternative explanations:** one or two realistic confounders, chosen for this signal.
- **Experiment:** one controllable change and a concrete acceptance check, with failure/rework costs included.
- **Limits:** what is unknown; no estimated savings or claim of poor skill without outcome evidence.
- **Provenance:** detector revision, data/source version, and research reference, available in details rather than filling the main card.

Prefer “Review tool definitions for this workflow” over “You use too many tools.” Prefer “Context grew during this interaction” over “Your prompts are incomplete.” If coverage is too low, show the measurement gap instead of manufacturing a behavioral conclusion.

## Ranking and thresholds

Rank by a combination of repeated evidence, meaningful resource magnitude, data quality, and whether the user can act. Avoid a fixed ranking by token volume alone. A costly, necessary task is not necessarily an opportunity, and several correlated symptoms should not produce several accusatory cards.

Initial thresholds are product hypotheses requiring calibration. The earlier scenario note's minimum-call/session/coverage examples are screening ideas, not research-established norms. For rare but explicit operational failures, an individual event may justify inspection; it still does not justify a broad claim about the user's workflow.

Compare similar work within a project, task family, model/effort setting and agent role. Track medians/tails and total attempt resources rather than only average cost per request. Reducing the number of requests can raise average request cost while lowering total cost. Changing task mix, model routing, available tools or completion rate can reverse an apparent improvement.

## Implementation order

1. **Improve evidence quality in the existing scan.** Retain explicit cache-reporting support, tool-definition footprint, effort/limits, response stop reason and the identifiers needed for validated interaction joins. Add focused fixtures for missing fields, mixed providers, duplicate receipts and parallel agents.
2. **Offer a separate current-context explanation.** Capability-test `getContextAttribution` through the joined session. Show occupied categories and nested source entries with their model basis and observation time. Keep this independent of date-filtered history; never sum parent and child rollups.
3. **Develop a small set of historical review signals.** Definition overhead, known failure clusters, context growth and comparable interaction resource trends are the best initial candidates. Explain the observed mechanism before offering an experiment.
4. **Make workflow experiments optional.** Add user-defined task/opportunity labels only if useful; this unlocks meaningful skill adoption comparisons without inspecting every prompt.
5. **Keep deeper review separate.** Agent-friendly repository checks, instruction quality and memory quality require chosen files or explicit task review. Do not add a daemon, SQLite recorder, background prompt classifier or cloud integration merely to make these recommendations possible.

The first two steps can improve explanations without pretending to know task value. They are proposals for a subsequent implementation, not changes included in this research commit.

## Validation before a recommendation ships

Use synthetic fixtures to prove arithmetic, deduplication, missingness and joins. Then use controlled sessions to verify actual field meaning. Finally review matched tasks with and without the technique, including unsuccessful attempts, to measure recommendation usefulness and false positives. Reserve some tasks for evaluation rather than tuning thresholds on every example.

For each candidate, record whether a knowledgeable user found the observation correct, the cause plausible, and the experiment useful. Check for harm: missed requirements, extra review, unnecessary skill/tool activation, weakened verification, or advice users cannot control. Dismissing a card does not itself prove a detector false; accepting advice does not prove savings.

No causal productivity claim should be made from resource telemetry alone. The deliverable is an evidence-backed direction a user can test, with enough context to decide whether it applies.
