# AI efficiency techniques: practices, counterexamples, and measurable experiments

Research checked **2026-11-14** for the GitHub Copilot desktop Usage Insights plugin. This is a product research proposal, not a claim that these detectors ship or that the user's sessions exhibit these problems.

**Recommend a better workflow only after identifying the work it should improve.** High AI usage with few recorded skill loads is a reason to inspect recurring tasks, skill availability, and event coverage. It is not evidence of low skill adoption, weak prompting, or wasted credits. The useful target is accepted work with less total effort, including failed attempts, review, and rework.

This note extends the existing [detectable scenarios](2026-11-14-efficiency-scenarios.md) and [context and memory research](2026-11-14-context-memory-efficiency.md). Those notes describe mechanisms and data limitations. This one organizes **24 interventions by difficulty**, supplies counterexamples to their apparent opposites, and designs an opportunity-based measurement for skills.

## Read the evidence labels before using a recommendation

- **G — official guidance or specification:** establishes documented behavior or a recommended practice; does not establish a measured productivity effect.
- **E — empirical study:** reports measured results in a named environment; transfer to Copilot desktop remains untested.
- **V — vendor experiment or operational case study:** useful mechanism evidence, with limited independent replication or causal control.
- **H — our hypothesis:** every proposed detector, threshold, telemetry design, and local experiment below. A citation motivates an experiment; it does not validate the detector.

Applicability is separate: **Copilot** means relevant GitHub guidance; **general** means a transferable working method; **harness** means behavior an agent/tool developer would have to implement. Claude API features, CLI slash commands, and CI workflows are not automatically Copilot desktop controls. The app documents instructions, skills, MCP servers, agents, and plugins; that does not establish the configuration or context of a historical request. [App customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)

The data grades match the companion notes:

| Grade | Evidence available to an implementation |
| --- | --- |
| **A** | Current retained accounting/activity metadata: requests, session/project/model, initiator, durations, recorded tokens/credits, tool names/outcomes, skill identity/trigger. Availability still varies by source. |
| **B** | Additional event/configuration metadata and reliable joins; some candidates exist in receipts or SDK definitions, but retention and coverage need validation. |
| **C** | Bounded inspection of selected repository files or configuration, including historical versions when required. |
| **D** | Task labels, acceptance results, or explicitly authorized content review. Ordinary accounting cannot supply these. |

The current [parser](../../src/core/copilot.mjs), [activity aggregation](../../src/core/copilot-report.mjs), and [separate prompt lookup](../../src/node/request-prompts.mjs) are the implementation baseline. Tool success is not task success; a skill load is not proof that its procedure was followed. A model request, user interaction, agent execution, session, and completed task are different units.

The newer [data inventory](2026-11-14-copilot-data-inventory.md) and [SDK surface audit](2026-11-14-copilot-sdk-surfaces.md) add an important distinction: the installed SDK declares current context attribution by skill, plugin, tool, and MCP server. Subject to host capability verification, this can show **current context occupancy** using one model's tokenization basis. It is not invoiced usage, cumulative execution cost, or evidence of benefit. Nested entries can overlap; summing snapshots would repeatedly count retained context. Historical skill cost and task outcomes still require different evidence.

## What new empirical evidence changes

| Evidence | Finding and limits | Product implication — H |
| --- | --- | --- |
| **E: SkillsBench v4**, June 2026 | Paired curated-skill/no-skill evaluation over 87 tasks, eight domains, and 18 model–harness configurations reports mean pass rates of 33.9% and 50.5%, a 16.6 percentage-point gain. Effects differ by configuration. Containerized terminal tasks and curated packages limit transfer; the paper notes that extra context and procedural structure are not fully disentangled. Use this revision rather than mixing earlier 86-task/7-configuration figures with the current results. [Paper](https://arxiv.org/html/2602.12670v4) | Test a particular skill with a particular model/harness and task family. Do not turn the aggregate gain into expected user savings. |
| **E: skills under realistic retrieval**, April 2026 | On 84 SkillsBench tasks with three runs per condition, agents faced selection, distractors, and retrieval from about 34,000 skills. Benefits weakened as conditions became more realistic. Higher loading did not always mean better outcomes; query-specific refinement sometimes helped, depending on initial relevance. The tested stacks were Claude Code, Terminus-2, and Qwen-Code. [Paper](https://arxiv.org/html/2604.04323v1) | Separate available, discoverable, selected, and effective. A discovery experiment should measure irrelevant activations as well as missed relevant ones. |
| **E, preliminary: SWE-Skills-Bench**, March 2026 | A single Claude Code/Haiku 4.5 setup over 565 tasks and 49 skills reports 39 skills with no pass-rate improvement, a mean 1.2 percentage-point gain, and 10.5% higher mean token use. Some specialized skills helped; version conflicts harmed others. This is explicitly preliminary, has high baseline pass rates, and describes skill placement differently across sections, weakening reproducibility confidence. [Paper](https://arxiv.org/html/2603.15401v1) | Count benefits in quality, time, and resources separately. Zero pass-rate gain can coexist with useful time savings; a ceiling limits observable quality improvement. |
| **V: programmatic tool calling**, current official documentation | Anthropic reports approximately 38% less billed input with unchanged accuracy on one 75-tool evaluation, but about 8% higher cost with unchanged scores on sequential τ²-bench tasks. This is provider-internal evidence for its API, not a Copilot benchmark. [Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling) | Recommend batching based on dependency structure and result volume; measure its setup overhead. |
| **E: agent-system scaling, v3**, April 2026 | Controlled comparisons across 260 configurations and six benchmarks find substantial differences by task and architecture. Decomposable work can benefit; sequential dependencies can make coordination counterproductive under matched token budgets. These are benchmark architectures, not observations of this plugin. [Paper](https://arxiv.org/html/2512.08296v3) | Agent count and subagent resource share are descriptive. Neither is a universal optimization target. |
| **E: METR follow-up**, February 2026 | METR describes task/developer selection, differences in final work, noncompletion, and concurrent-agent time accounting as obstacles to estimating productivity from its later experiment. It treats those later estimates as weak evidence for the size of change. [Study update](https://metr.org/blog/2026-02-24-uplift-update/) | Record all eligible attempts and distinguish user active time from elapsed agent time. Avoid historical before/after claims without accounting for changed work. |

## Simple: change one task or conversation

### 1. State the result and an acceptance example

- **Practice / anti-pattern:** Provide the intended behavior, relevant constraints, and one observable example. The anti-pattern is an omitted requirement that repeatedly forces correction, not a short prompt. GitHub recommends requirements and examples. **G, Copilot.** [Prompt guidance](https://docs.github.com/en/copilot/concepts/prompting-and-context/prompt-engineering)
- **Signal / counterexample:** Compare correction turns and accepted outcomes within the same task family. More turns can represent productive discovery or changed requirements; fewer can mean abandonment.
- **Data / experiment:** **A** totals; **B** task/interaction joins; **D** correction reason and acceptance. Try a compact brief on matched tasks. Compare the entire attempt, including the time spent preparing the brief.

### 2. Supply a verified starting point

- **Practice / anti-pattern:** Give a relevant entry file, error, reproduction, or example implementation. The anti-pattern is making the agent rediscover information already known and relevant. GitHub recommends relevant context. **G, Copilot.** [Prompt guidance](https://docs.github.com/en/copilot/concepts/prompting-and-context/prompt-engineering)
- **Signal / counterexample:** Measure navigation before the first task-relevant action. Many early reads may be appropriate for an unfamiliar subsystem; a supplied path can be wrong or stale.
- **Data / experiment:** **A** tool sequences are only a lead; **B/C/D** targets, revision, and relevance are required. Compare a verified pointer with the usual prompt, checking whether omitted exploration causes regressions.

### 3. Use a bounded plan for work that needs decisions

- **Practice / anti-pattern:** Resolve consequential unknowns, then specify the next implementation phase and its stopping condition. The anti-pattern is repeated replanning or scope expansion without new evidence. GitHub recommends planning and clear completion criteria. **G, Copilot/general.** [Usage guidance](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage)
- **Signal / counterexample:** Track revised plans, reversed edits, and work after acceptance checks pass. Planning can prevent expensive mistakes; trivial edits may not justify a planning phase.
- **Data / experiment:** **B/D** phase boundaries, plan revisions, acceptance, and reason for reopening work. Trial a short plan on complex tasks only; include planning costs in the comparison.

### 4. Keep related follow-ups together and separate unrelated work

- **Practice / anti-pattern:** Continue when earlier context is needed; start fresh when the problem changes. The anti-pattern is either needless restatement or carrying an unrelated history. **G, Copilot.** [Conversation guidance](https://docs.github.com/en/copilot/tutorials/optimize-chat-usage)
- **Signal / counterexample:** Inspect fresh starts with repeated briefing, or large continuations after a task change. Session count and cache rate cannot establish task relatedness. Separate tasks can legitimately share a project and terminology.
- **Data / experiment:** **A** session/resource trends; **B/D** task boundaries and actual dependencies. Try a fresh task with a small handoff, comparing rebuilding effort and missed facts. Never open extra requests merely to improve cache reuse.

### 5. Specify the useful output, including its destination

- **Practice / anti-pattern:** Ask for the artifact, decision, patch, or concise explanation actually needed, with a concrete example when helpful. The anti-pattern is producing large repeated prose that the user must discard. **G, Copilot; output-contract experiment H.** [Prompt guidance](https://docs.github.com/en/copilot/concepts/prompting-and-context/prompt-engineering)
- **Signal / counterexample:** Measure output size together with follow-up requests for reformatting or shortening. Long output can be the requested deliverable; a terse response can hide missing evidence.
- **Data / experiment:** **A** output totals; **D** deliverable type and revision reasons. Specify format and destination for one recurring report, retaining necessary explanation, and compare acceptance and editing effort.

### 6. Diagnose a failed operation before repeating it

- **Practice / anti-pattern:** Use the error to change the input, environment, or approach. The anti-pattern is an unchanged failed operation with no new reason to expect success. Tool guidance emphasizes actionable errors. **G, general/harness.** [Tool design](https://www.anthropic.com/research/writing-tools-for-agents)
- **Signal / counterexample:** A cluster of failures is a review lead. Transient services, intentional negative tests, and retries after a genuine fix can justify repetition.
- **Data / experiment:** **A** explicit tool failures; **B/D** error category, operation fingerprint, state change, and retry reason. Repair one confirmed failure mechanism and compare complete task outcomes. Do not infer an authentication fix from failure counts alone.

### 7. Choose verification that can decide whether the work is done

- **Practice / anti-pattern:** Use acceptance checks suited to the change and retain relevant regression checks. The anti-pattern is unrelated verification or rerunning an unchanged passing check without a reason. Outcome-based evaluation is official guidance; the targeted-check experiment is ours. **G/H, general.** [Evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
- **Signal / counterexample:** Track checks, intervening changes, defects caught, and later rework. Repeated checks can be required final verification, flaky-test investigation, or validation of external changes.
- **Data / experiment:** **B/C/D** command identity, code/environment revision, result, and requirement coverage. Trial a clear check plan, measuring failures missed as well as time saved.

### 8. Test a less expensive model on a known routine task

- **Practice / anti-pattern:** Choose capability before starting a well-understood task; retain an escalation path. The anti-pattern is an expensive default that repeatedly adds no measured benefit on that task family. **G, Copilot.** [Model-selection guidance](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage)
- **Signal / counterexample:** Compare acceptance, retries, review time, and credits by matched task/model. A large model bill can reflect high value, better reliability, or more work rather than a poor choice.
- **Data / experiment:** **A** model/cost coverage; **B/D** configuration, task class, outcomes, and escalation cost. Run a small paired trial. Use actual recorded charges; token ratios are not price ratios.

## Intermediate: improve reusable context and workflow setup

### 9. Keep durable instructions specific and correctly scoped

- **Practice / anti-pattern:** Preserve verified conventions and commands at the scope where they apply. The anti-pattern is broad, stale, or conflicting guidance that causes unrelated work. GitHub recommends concise, self-contained instructions and avoiding conflicts. **G, Copilot.** [Custom instructions](https://docs.github.com/en/copilot/concepts/prompting-and-context/custom-instructions)
- **Signal / counterexample:** Inspect repeated convention corrections and instruction-linked detours. A long file may encode necessary policy; file absence does not prove missing guidance. Empirical instruction results remain mixed, as documented in the [companion note](2026-11-14-context-memory-efficiency.md).
- **Data / experiment:** **C/D**, plus **B** evidence of actual loads and versions. Change one verified instruction or scope, preserving required controls, and compare corrections and regressions.

### 10. Trial a relevant skill on a recurring workflow

- **Practice / anti-pattern:** Select a compatible workflow package for a task with a repeatable method. The anti-pattern is repeatedly rebuilding that method when a tested package would help, or invoking a package with no relevant work. Skills can bundle instructions, resources, and scripts and are supported in the app. **G, Copilot.** [Agent skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills)
- **Signal / counterexample:** Measure activation on reviewed eligible tasks, then benefit. Low loads may mean no eligible tasks, preloaded context, another adequate workflow, or missing records.
- **Data / experiment:** **A** loads/triggers; **B/C/D** historical availability, task relevance, skill version, and outcomes. Compare explicit invocation with the existing workflow using the opportunity design below.

### 11. Improve skill discovery without maximizing activations

- **Practice / anti-pattern:** Write a description that distinguishes when the skill helps and what it does. The anti-pattern is a vague description that misses relevant work or an overly broad one that activates everywhere. **G, open specification; E, non-Copilot harnesses.** [Skill specification](https://agentskills.io/specification), [retrieval study](https://arxiv.org/html/2604.04323v1)
- **Signal / counterexample:** Measure relevant activations and irrelevant activations separately. A higher activation rate can come entirely from false matches; the desired skill might not have been exposed.
- **Data / experiment:** **B/C/D** candidate inventory at decision time, description version, relevance labels, and observed selection. Test a revised description on both applicable tasks and near-miss tasks, with the procedure unchanged.

### 12. Use progressive disclosure inside a skill

- **Practice / anti-pattern:** Keep the entry procedure focused and load detailed references or resources when needed. The anti-pattern is automatically loading every appendix for every task. The specification separates metadata, instructions, and supporting resources. **G, open specification.** [Skill structure](https://agentskills.io/specification)
- **Signal / counterexample:** Track which resources load and their measured size, alongside success. A large reference can prevent errors; excessive fragmentation can add lookup steps and hide critical constraints.
- **Data / experiment:** **B/C/D** actual loaded resource/version, byte or token units, and task requirements. A supported live attribution snapshot can supplement this with current skill occupancy, not a historical execution bill. Compare one compact entry plus selective references with the existing package. Do not treat a character count as tokens or impose a universal file-length target.

### 13. Leave a compact, verifiable handoff at a phase boundary

- **Practice / anti-pattern:** Record decisions, relevant paths, current revision, checks completed, unresolved issues, and the next step. The anti-pattern is forcing a later session to reconstruct progress or trust an unsupported summary. Anthropic's long-running-agent example uses persistent progress artifacts. **V, general/harness.** [Harness study](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)
- **Signal / counterexample:** Measure rediscovery and reversal after a restart or compaction. Revalidation may be necessary after edits; writing detailed handoffs for tiny tasks can cost more than resuming.
- **Data / experiment:** **B/C/D** phase lineage, handoff version/read evidence, state changes, and correctness. Trial a brief checkpoint on long tasks, counting creation, reading, and recovery effort.

### 14. Filter results before large payloads enter model context

- **Practice / anti-pattern:** Request relevant fields, ranges, and bounded search results with a way to retrieve more. The anti-pattern is repeatedly transmitting large irrelevant payloads. **G, general/tool design.** [Filtering and pagination guidance](https://www.anthropic.com/research/writing-tools-for-agents)
- **Signal / counterexample:** Compare model-visible result size, truncation, follow-up reads, and missed evidence. Smaller pages can increase requests; narrow filters can silently remove the answer.
- **Data / experiment:** **B/D** returned and model-visible size, selection parameters, truncation, and request linkage. Compare a bounded query with the original on the same information need. Total input growth alone cannot identify the responsible tool or prove irrelevance.

### 15. Scope exposed tool definitions to the work

- **Practice / anti-pattern:** Use task-relevant tools or supported on-demand discovery. The anti-pattern is carrying costly, unused definitions that add no needed capability. Anthropic documents deferred discovery for its platform. **G/V, general/harness; feature-specific support required.** [Advanced tool use](https://www.anthropic.com/research/advanced-tool-use)
- **Signal / counterexample:** Measure actual tool-definition footprint and useful selection. Installed-tool count overstates cost when definitions are deferred; removing a rarely used tool can block essential recovery.
- **Data / experiment:** **B** per-request definition tokens, exposed inventory, and configuration/discovery events; **D** capability needs. Trial a smaller task toolset before a new session. Compare discovery calls, completion, credits, and cache effects, not inventory count alone.

### 16. Adjust reasoning effort only where quality holds

- **Practice / anti-pattern:** Test supported effort settings for a known task and keep the level that meets its quality requirement. The anti-pattern is a costly setting with no measured benefit, or an undersized setting that causes rework. Claude's effort affects text and tool calls as well as thinking. **G, provider-specific.** [Effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort)
- **Signal / counterexample:** Compare whole-task resources and outcomes within the same model. High reasoning-token share may be appropriate; missing reasoning counts do not mean no reasoning.
- **Data / experiment:** **A** partial reasoning totals; **B/D** actual effort/configuration, task, and outcomes. Trial one lower setting only on a surface/model that exposes it. No desktop toggle is assumed from API documentation.

## Advanced: change execution, routing, or evaluation

### 17. Move repeated deterministic preparation into a command

- **Practice / anti-pattern:** Reuse a validated command for predictable collection, transformation, or checking. The anti-pattern is asking a model to rediscover the same deterministic procedure each run. GitHub describes pre-agent data fetching in its CI workflows. **V, CI-specific mechanism/general adaptation.** [Workflow case study](https://github.blog/ai-and-ml/llms/improving-token-efficiency-in-github-agentic-workflows/)
- **Signal / counterexample:** Compare repeated operation patterns and their preparation/model costs. Dynamic investigation may genuinely require model decisions; merely wrapping the same loop in a shell tool does not eliminate inference.
- **Data / experiment:** **B/C/D** workflow identity, command version, data freshness, and actual model-boundary changes. Trial a read-only preparation command, preserving provenance and checking that unused prefetching does not exceed the avoided work.

### 18. Keep intermediate transformations outside the model loop

- **Practice / anti-pattern:** Where a supported execution environment permits it, compose known tool operations in code and return the decision-relevant result. The anti-pattern is transporting every intermediate record through model context. **G/V, harness.** [Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp)
- **Signal / counterexample:** Measure model round trips and bytes/tokens that actually reach the model. Code generation, container startup, debugging, and execution cost can outweigh savings on small jobs; some steps require semantic judgment.
- **Data / experiment:** **B/D** execution lineage, model-visible payloads, runtime, errors, and acceptance. Trial one structured-data workflow. Keep operation permissions, per-operation errors, and auditability; fewer visible calls must not hide omitted work.

### 19. Batch independent operations with bounded concurrency

- **Practice / anti-pattern:** Combine independent reads or lookups, inspect every result, and serialize dependent decisions. The anti-pattern is one model round trip per independent item, or unsafe concurrency across dependencies. Programmatic calling supports fan-out but has workload-dependent overhead. **G/V, harness.** [Programmatic calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- **Signal / counterexample:** Compare complete-task latency, aggregate cost, and partial failures. Serial execution is correct when later inputs depend on earlier results. Parallel calls may reduce elapsed time while using the same or more tokens.
- **Data / experiment:** **B/D** dependency graph, batch membership, start/end intervals, rate limits, and result completeness. Trial a bounded independent batch; calculate elapsed time from intervals rather than summing overlapping durations.

### 20. Delegate a bounded subtask when parallelism is useful

- **Practice / anti-pattern:** Give an independent subtask a clear output and only its needed context. The anti-pattern is duplicated investigation, conflicting edits, or coordination that exceeds the work. Empirical benefits vary strongly with decomposability. **E, benchmark/general adaptation.** [Scaling study](https://arxiv.org/html/2512.08296v3)
- **Signal / counterexample:** Compare parent-plus-child cost, elapsed time, duplicated targets, and integration rework. Deliberate independent review may repeat work to catch errors; subagent share alone cannot distinguish that from waste.
- **Data / experiment:** **A** initiator share only; **B/D** full agent lineage, assignments, inherited context, return payloads, and outcomes. Compare one bounded delegation with a single-agent baseline, including synthesis and review costs.

### 21. Preserve stable reusable context without maximizing cache percentage

- **Practice / anti-pattern:** Keep reusable prefixes/configuration stable within a phase; rebuild only necessary context after a change. The anti-pattern is unnecessary prefix churn. Exact matching and configuration affect Anthropic API caching; its lifetime policy is not a Copilot guarantee. **G, provider-specific mechanism.** [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Signal / counterexample:** Inspect fresh input after known configuration changes, reporting coverage, and absolute context size. Legitimate model/tool changes can be worth rebuilding; a high hit rate can coexist with oversized context.
- **Data / experiment:** **A** valid cache splits; **B** prefix/configuration fingerprints, lineage, reported expiry, and cache-reporting flags. Compare phase-stable setup with the original. Never create keepalive requests or delay necessary work merely to improve a rate.

### 22. Retrieve durable knowledge selectively and check its provenance

- **Practice / anti-pattern:** Keep concise references to reusable facts and retrieve detail when needed; distinguish stable requirements from remembered observations. The anti-pattern is repeated rediscovery or unverified stale memory. **G, general/Copilot.** [Context retrieval](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), [Copilot Memory](https://docs.github.com/en/copilot/concepts/prompting-and-context/copilot-memory)
- **Signal / counterexample:** Compare repeated discovery, retrieval volume, freshness checks, and fact-related errors. Retrieval can be slower than supplying known context; repeated reads can validate changes. Memory availability and project preferences differ, as the [companion note](2026-11-14-context-memory-efficiency.md) explains.
- **Data / experiment:** **B/C/D** retrieved item/version, source citation, task relevance, and current-state validation. Trial one reusable project fact or short index; measure both rediscovery avoided and incorrect reuse introduced.

### 23. Escalate capability at a defined decision point

- **Practice / anti-pattern:** Use an evaluated routing rule for routine work, escalating on a meaningful failure or uncertainty condition. The anti-pattern is oscillating models without progress or repeatedly attempting a cheap path that rarely succeeds. RouteLLM studies quality/cost routing; its academic query benchmarks are not desktop coding workflows. **E/H, general/harness.** [RouteLLM v4](https://arxiv.org/html/2406.18665v4)
- **Signal / counterexample:** Compare first-pass acceptance, escalation rate, final success, and the cost of all attempts. Difficult tasks may deserve the stronger model immediately. Automatic routing is not necessarily a user choice; GitHub documents multi-model orchestration. **G, Copilot.** [Usage guidance](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage)
- **Data / experiment:** **B/D** routing owner/reason, task/phase, review result, and configuration. Test a simple preregistered rule before a learned router, including routing, handoff, and cache-rebuild costs.

### 24. Keep only improvements that survive paired outcome evaluation

- **Practice / anti-pattern:** Evaluate the intervention and baseline against the same acceptance standard on held-out tasks. The anti-pattern is declaring success from smaller requests, more skill calls, or a single pleasing run. **G, general; experimental design H.** [Agent evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
- **Signal / counterexample:** Track acceptance, regressions, repair attempts, and distributions of resources/time. A single lower-cost failure is not an improvement; a costly success may be valuable. Best-of-many success hides the cost of unsuccessful tries.
- **Data / experiment:** **B/D** stable task/attempt identities, configuration, evaluators, and outcomes. Trial one change with repeated paired runs and a locked evaluator. Retain failure cases and near-miss tasks; recheck after model, harness, or skill updates.

## Measure skill opportunities before calling anything underused

The following is **our measurement design (H)**. It is not an existing Copilot telemetry contract or a recommendation to install more skills. The empirical results above motivate separating selection from utility.

### Define a task opportunity independently of whether the skill loaded

Use a task or a clearly bounded workflow phase as the unit. One task may contain many user interactions and hundreds of model requests. It can also span sessions and agents. Without a trustworthy task join, present a session-level description and explicitly withhold opportunity rates.

For a task `t`, define an eligible opportunity only when all of these are known:

1. **The record is assessable.** Relevant history and skill-event coverage are present, supported for the source/app version, and attributable. An ambiguous provider attribution or partially observed task remains unknown.
2. **A compatible candidate was available before the decision.** It was enabled, discoverable through the host, permitted, and applicable to the repository/environment version. Today's inventory cannot establish yesterday's availability.
3. **The task matches a predefined use case.** Relevance is labeled from the task requirements and the skill's intended scope, independently of activation and outcome. Keywords alone are candidate generation, not a final label.
4. **There is a plausible opportunity to add value.** The task is recurring or has specialized procedure/resources. Existing instructions, an already loaded procedure, or an adequate deterministic command may cover the same need. Record these alternatives.
5. **The intervention was a real choice.** Separate mandatory skills, automatic context loads, user-directed invocation, and agent selection. Mandatory loading is compliance, not voluntary adoption. A user-declined optional skill is not a missed opportunity.

Availability, relevance, and utility are different facts. A relevant skill that has not been evaluated supports a **candidate opportunity**, not a claim that its absence caused waste. If task meaning changes, split the phase or record the time of the new opportunity. Do not judge an earlier decision using information that arrived later.

### Use a small set of interpretable rates

| Proposed measure | Numerator / denominator | Interpretation and guardrail |
| --- | --- | --- |
| Assessable-task coverage | Tasks with usable lineage, event coverage, and historical configuration / tasks in the requested cohort | Show missing/unknown counts and reasons. If the task inventory itself is incomplete, call this coverage of the observed cohort. |
| Candidate-opportunity prevalence | Reviewed tasks with at least one plausible applicable skill / reviewed assessable tasks | Describes task mix. A low value may be exactly right for miscellaneous or already-automated work. |
| Relevant activation rate | Eligible tasks with a relevant activation at the appropriate phase / eligible tasks with known activation status | Count a task once. This measures selection, not success. Keep inherited/preloaded coverage separate from a new activation. |
| Workflow coverage including existing context | Eligible tasks with a relevant newly loaded or verifiably retained procedure / eligible tasks whose context state is known | A load in another task does not prove continued availability after compaction or a new agent. With unknown retention, withhold this metric. |
| Activation precision | Reviewed activation episodes judged relevant / reviewed activation episodes | Include irrelevant examples in the review sample. A high selection rate with low precision suggests over-triggering, not successful adoption. |
| Opportunity coverage per skill | Eligible tasks where that skill was appropriately selected / eligible tasks for that skill | Use stable identity plus version; show denominator and uncertainty. Do not sum these rates across overlapping candidates. |
| Quality and resource effect | Paired difference in acceptance, rework, credits, tokens, elapsed time, and human active time | This is the benefit question. Report outcomes separately; an observational association does not identify the skill's effect. |

For interchangeable skills, create a single opportunity with an **acceptable set of alternatives**. Selecting any relevant alternative can satisfy that opportunity; not selecting every installed skill is not a failure. For a task requiring distinct procedures, use predeclared requirement slots and measure coverage of each slot. Do not generate all task-by-skill pairs: adding irrelevant installed skills must not lower the user's rate.

Skill-event deduplication and semantic episode grouping are separate. Preserve raw loads for audit, then group repeated loads of the same version within a task/agent context when the evidence supports it. A reload after compaction or in a new child agent may be necessary. Never deduplicate solely by matching a name across an entire session.

### Why loads per model request can reverse the conclusion

An illustrative task loads one skill and completes in 100 model requests: one load per 100 requests. An improved run loads the same skill once and completes in 20 requests: five loads per 100 requests. The apparent fivefold adoption gain occurred with **identical task-level selection**. Conversely, a successful skill can increase model requests by adding valuable validation and make that ratio fall.

Preloaded skills may require no fresh load; event logging may record a context load differently from a user invocation. One long task can dominate request volume. More agents may duplicate load events. Task mix can change while every task-specific selection rate stays constant. For these reasons, requests, tokens, and credits are useful resource denominators, but inappropriate opportunity denominators.

### Turn a low-load observation into a concrete experiment

1. Show the measured observation with its source and coverage, such as: **“Few skill loads were recorded in this period. Task relevance has not been assessed.”** Do not label it inefficient.
2. Review a bounded, stratified sample of recurring task families, including tasks with no skill load. Sampling only activated tasks cannot find missed opportunities. Preserve an unknown label when context is insufficient.
3. Identify one plausible candidate and an acceptable alternative. Verify availability, version compatibility, procedure quality, and whether the procedure already existed in context.
4. Separate **discovery** from **benefit**: compare automatic selection with explicit selection of the same skill to study discovery; compare a fixed explicit skill condition with the existing workflow to study the package's contribution. Otherwise invocation changes and content changes are confounded.
5. Include near-miss tasks to catch over-triggering. Hold the task, model, acceptance criteria, and environment stable. Include setup, loading, child agents, failed attempts, and human review in the cost.
6. Recommend wider use only for the tested task family when quality is maintained or improved at an acceptable cost. Otherwise revise scope, fix the package, or retain the existing approach. Retest new versions.

If an automated relevance classifier is added, record its version, confidence, abstentions, and agreement with a human-reviewed sample. Keep relevance labels independent of the observed load and resource totals to avoid circular scoring. Report sample-specific rates rather than projecting a small convenience sample onto all usage. A confidence interval for sampling variability does not correct biased labels or incomplete logs.

## A measurement contract that can support the techniques

These additions are **proposed fields**, not assertions that the app exposes them. Use the [data inventory](2026-11-14-copilot-data-inventory.md) and [SDK surface audit](2026-11-14-copilot-sdk-surfaces.md) to distinguish retained history, observed receipt fields, and declared current-session possibilities.

| Record | Minimal useful content | Why it matters |
| --- | --- | --- |
| Task and attempt | Task/phase ID, parent task, attempt ID, start/end, completion state, task family, acceptance version | Aggregates complete work and retains failures; separates retries from new work. |
| Provenance and coverage | Source, app/harness version, logging support, first/last retained event, attribution status, missing-field reasons | Unknown must not become zero. Supports honest historical comparisons. |
| Execution lineage | Session, interaction/turn, model request, parent/child agent, tool call, batch/execution ID | Prevents timestamp-only joins and attributing all nearby cost to a skill. |
| Configuration snapshot | Model/effort, selection owner, relevant instruction/skill versions, enabled/discoverable tool/skill inventory, change time | Availability and setup must describe the actual attempt, not the current installation. |
| Context metadata | Actual loaded-resource identity/version and measured units, definition tokens, result sizes, compaction/reload boundary, reporting support; live attribution observation time, model basis, and parent/child entries | Separates definitions from results, presence from loading, and bytes from tokens. Current attributed occupancy is not cumulative usage; nested entries must not be double-counted. |
| Operation metadata | Optional local fingerprint of normalized operation and target, result/error category, dependency/state-change marker | Enables review of repeated work without treating equal tool names as equal operations. Hashes can still reveal sensitive membership; do not treat them as anonymous. |
| Outcome | Acceptance check version/result, reviewer result, corrections, defects/rework, abandonment, human active time when supplied | Makes efficiency about useful work. Missing outcome stays unknown. |
| Intervention | Experiment ID, assignment, intended change, baseline, eligibility label, candidate alternatives, reason for exclusion | Separates an observed correlation from a designed comparison. |

Prefer metadata where it answers the question. A content-dependent diagnosis should require a bounded review, not silent collection of every prompt, tool argument, result, memory, or reasoning trace. Metadata does not establish semantic relevance merely because a classifier can consume it.

## How to evaluate without creating a misleading score

Choose one intervention and one recurring task family. Define the acceptance standard and evaluation set before comparing results. Fix or record repository revision, environment, app/harness, model/effort, tool access, skill version, and cache-start conditions. Randomize or counterbalance paired run order, isolate persistent state between conditions, and repeat enough tasks and runs to report uncertainty. A warm run following a cold run can look efficient for reasons unrelated to the intervention.

Report **acceptance and regressions first**, then whole-attempt credits, input/output/cache/reasoning coverage, tool failures, agent elapsed time, and human active/review time. Do not sum overlapping durations into user waiting time. Report all assigned attempts, including timeouts and abandonments, with missingness. Conditioning only on successful runs can make an unreliable workflow look cheap.

For a fixed task set, a useful operational summary is total resources across all attempts divided by accepted completions, shown beside acceptance rate and task mix. It is undefined when there are no accepted completions and is unsuitable for comparing unlike work. Keep quality/time/resource tradeoffs visible rather than collapsing them into a personal efficiency score. Estimate uncertainty across tasks, not across correlated model requests from one task.

A low-cost pilot may identify a promising mechanism without proving general benefit. When evidence is sparse, recommend **“try this on the next comparable task”**, not **“this will save credits.”** Use a held-out set before broad rollout and monitor after changes to model, skill, repository, and harness. Graders should assess requirements and regressions, not reward the presence of a preferred skill or a particular trace shape.

## Practical product priorities

1. **Explain observed resource mechanisms now:** recorded failures, input growth, cache coverage, model mix, and skill trigger mix. Show evidence and uncertainty without assigning a cause.
2. **Add lineage and coverage before adoption scoring:** task/phase joins, historical configuration, and source-specific event support make the later metrics interpretable.
3. **Pilot opportunity review for one recurring workflow:** show relevant activation, false activations, outcomes, and the tested comparison. High total usage alone should not trigger a skill-installation recommendation.
4. **Expose targeted experiments:** clearer brief, verified handoff, measured tool scoping, bounded result filtering, selective effort, or deterministic preparation. Match the recommendation to evidence the user can inspect.
5. **Preserve useful counterexamples:** a high-cost successful investigation, a deliberate redundant review, a legitimate cache rebuild, and a no-skill task can all be good work. The product should be able to say that explicitly.
