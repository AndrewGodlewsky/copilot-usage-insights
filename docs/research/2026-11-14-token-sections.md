# Token-efficiency section roadmap

The user approved all 15 sections below, with a compact section picker inside **Efficiency > Where did the tokens go?**, and detailed development one section at a time. Version 0.1.51 establishes that navigation and retains Overview as the initial view. Switching sections is local and does not inspect context, read logs, or invoke AI.

| Section | First increment | Further work to evaluate |
| --- | --- | --- |
| Context growth | Existing largest qualifying rise with early/late median input and coverage | Broader session comparisons and input timelines |
| Always-loaded context | Existing explicit current-context inspector | Focused instruction/background contributors; historical attribution remains separate |
| Tool and MCP footprint | Definition tokens per call and share of paired input | Per-server definition attribution where reported |
| Files, searches, and tool results | Explanation and link to the current-context inspector | Reliable separation of result/file content from conversation context |
| Cache reuse | Existing weighted reuse and coverage | Cache trends and fresh-input breakdowns without guessing causes |
| Work behind each prompt | Complete eligible prompt charges and average; model contributions labeled | Per-prompt initial/follow-up call and token breakdowns |
| Delegated work | Explicitly not measured yet | Reliable parent-linked subagent contributions and unknown attribution |
| Reasoning and generated output | Recorded output and reasoning totals with separate coverage | Matched-sample split; avoid subtracting totals with different coverage |
| Calls and recovery | Existing explicit tool outcomes and repeated failures | Retry relationships and recovery cost only with supporting links |
| Biggest spend drivers | Top five recorded session/project credit totals, retaining incomplete flags | Whole-prompt outliers and concentration analysis |
| Prompt size versus processing | Separate prompt-character and input-per-call averages | Matched prompt/call analysis; characters are not tokens |
| Context reduction | Explicitly not measured yet | Validated compaction events and comparable before/after samples |
| Model changes and fresh starts | Explicitly not measured yet | Distinguish user model changes, automatic routing, resumes, and subagents |
| Repeated exploration | Explicitly not measured yet | Evidence of equivalent reads/searches and intervening changes; tool names alone are insufficient |
| Skills and instruction footprint | Explanation and link to current source attribution | Attributed source comparisons; installed/invoked does not mean costly or unused context |

## Boundaries

- These are overlapping views, not additive token buckets.
- History views follow the report filters. Current context is a separate explicit snapshot.
- The first increment changes no collection or accounting rules, and adds no stored text, scans, dependencies, or background work.
- Prompt costs reuse whole-prompt eligibility and submission-date semantics. Model-filtered values represent a selected-model contribution.
- Unknown measurements remain unavailable. Counts do not prove waste, prompt quality, task effectiveness, or failure causes.
- Session charges can be incomplete and a session spanning projects may appear more than once; preserve those labels.

Related research: [data inventory](2026-11-14-copilot-data-inventory.md), [scenarios](2026-11-14-efficiency-scenarios.md), and [analysis proposal](2026-11-14-efficiency-analysis-proposal.md).
