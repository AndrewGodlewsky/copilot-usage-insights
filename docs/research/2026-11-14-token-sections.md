# Token-efficiency section roadmap

Version 0.1.53 separates the approved topics between **Where did the tokens go?** (consumption measurements) and **Worth a closer look** (workflow patterns and experiments). Each dashboard has an independent section picker and shows one panel at a time. Overview and Findings are the defaults. Navigation is local and does not inspect context, read logs, or invoke AI. AI review remains a separate existing manual workflow; generated insights are not developed in this change.

| Section | Dashboard | Current measurements | Further work to evaluate |
| --- | --- | --- | --- |
| Context growth | Worth a closer look | Existing largest qualifying rise with early/late median input and coverage | Broader session comparisons and input timelines |
| Always-loaded context | Where did the tokens go? | Existing explicit current-context inspector | Focused instruction/background contributors; historical attribution remains separate |
| Tool and MCP footprint | Where did the tokens go? | Definition tokens per call and share of paired input | Per-server definition attribution where reported |
| Files, searches, and tool results | Where did the tokens go? | Explanation and link to the current-context inspector | Reliable separation of result/file content from conversation context |
| Cache reuse | Where did the tokens go? | Existing weighted reuse and coverage | Cache trends and fresh-input breakdowns without guessing causes |
| Work behind each prompt | Where did the tokens go? | Complete eligible prompt charges and average; model contributions labeled | Per-prompt initial/follow-up call and token breakdowns |
| Delegated work | Where did the tokens go? | Explicitly not measured yet | Reliable parent-linked subagent contributions and unknown attribution |
| Reasoning and generated output | Where did the tokens go? | Recorded output and reasoning totals with separate coverage | Matched-sample split; avoid subtracting totals with different coverage |
| Calls and recovery | Worth a closer look | Existing explicit tool outcomes and repeated failures | Retry relationships and recovery cost only with supporting links |
| Biggest spend drivers | Where did the tokens go? | Top five recorded session/project credit totals, retaining incomplete flags | Whole-prompt outliers and concentration analysis |
| Prompt size versus processing | Worth a closer look > Conversation habits | Separate prompt-character and input-per-call averages | Matched prompt/call analysis; characters are not tokens |
| Context reduction | Worth a closer look | Explicitly not measured yet | Validated compaction events and comparable before/after samples |
| Model changes and fresh starts | Worth a closer look | Explicitly not measured yet | Distinguish user model changes, automatic routing, resumes, and subagents |
| Repeated exploration | Worth a closer look | Explicitly not measured yet | Evidence of equivalent reads/searches and intervening changes; tool names alone are insufficient |
| Skills and instruction footprint | Where did the tokens go? | Explanation and link to current source attribution | Attributed source comparisons; installed/invoked does not mean costly or unused context |

Findings retains the existing evidence, experiments, and positive observations. Model comparisons retains the former Model averages table. Conversation habits combines prompt measurements with message and turn counts, without inferring prompt quality. Unknown or unsupported measurements remain unavailable.

## Boundaries

- These are overlapping views, not additive token buckets.
- History views follow the report filters. Current context is a separate explicit snapshot.
- The first increment changes no collection or accounting rules, and adds no stored text, scans, dependencies, or background work.
- Prompt costs reuse whole-prompt eligibility and submission-date semantics. Model-filtered values represent a selected-model contribution.
- Unknown measurements remain unavailable. Counts do not prove waste, prompt quality, task effectiveness, or failure causes.
- Session charges can be incomplete and a session spanning projects may appear more than once; preserve those labels.

Related research: [data inventory](2026-11-14-copilot-data-inventory.md), [scenarios](2026-11-14-efficiency-scenarios.md), and [analysis proposal](2026-11-14-efficiency-analysis-proposal.md).
