# Efficiency research

This directory is the persistent research base for Usage Insights. The original research was reviewed **November 14, 2026**, against product **0.1.29**. Newer implementation notes identify their own versions; see the root README for shipped behavior.

## Start here

| Document | What it answers |
| --- | --- |
| [Prompt delivery modes](2026-11-15-prompt-delivery-modes.md) | Declared steering/queued delivery metadata, separate interruption events, current parser gaps, and historical coverage limits |
| [Token-efficiency section roadmap](2026-11-14-token-sections.md) | Approved section placement, navigation and measurements in 0.1.53, and the remaining work for each dashboard |
| [Statistics and Analyze My Usage proposal](2026-11-14-efficiency-analysis-proposal.md) | A practical tab direction: context overhead, MCP reliability, and optional bounded AI interpretation; SDK feasibility and remaining checks |
| [Techniques by difficulty](2026-11-14-efficiency-techniques.md) | 24 simple, intermediate and advanced practices, their anti-patterns, counterexamples, evidence strength, required data and experiments |
| [Copilot data inventory](2026-11-14-copilot-data-inventory.md) | What the plugin reads today, extra observed receipt/event fields, existing database schemas, cloud reporting, privacy and performance limits |
| [SDK and live-session surfaces](2026-11-14-copilot-sdk-surfaces.md) | Current context attribution, skills/plugins/MCP, agents, memory, compaction, permissions and the distinction between passive reads and actions |
| [From patterns to directions](2026-11-14-efficiency-inference.md) | How to identify opportunities, avoid false inverse conclusions, design skill-use denominators and validate recommendation cards |
| [38-scenario catalogue](2026-11-14-efficiency-scenarios.md) | Earlier broad map of cache, context, tool, model, repository and memory signals |
| [Repository, prompting and memory evidence](2026-11-14-context-memory-efficiency.md) | Detailed context practices, mixed empirical instruction-file results, and limits of automatic inference |

The newer data inventory and SDK audit refine the earlier capability summaries. In particular, current per-source context token attribution is available in the inspected SDK declarations, pending live verification. This is different from historical tokens billed for executing a skill. The existing context-history table is also a new candidate, with sampling and retention still unverified.

## Findings to carry forward

- Low cache reuse does not prove excessive chat switching. High tool use does not prove poor prompting. High skill use does not prove efficiency, and low skill use does not prove a missed opportunity.
- Identify relevant repeated work before recommending a reusable skill. Measure availability, selection and benefit separately; calls or tokens are not a sound denominator for skill adoption.
- The strongest next additions explain actual resource mechanisms: definition-token footprint, known failure clusters, context growth and current source attribution.
- Repository navigation, complete prompts and useful memory need evidence beyond accounting. Keep a deeper project review optional and bounded.
- Current inventory, historical activity, live context occupancy and billed accounting have different meanings. Do not combine their totals or imply their time ranges match.
- No new database, recorder, background service, prompt analysis, cloud connector or runtime feature was added by this research.

## How to build on this

1. Keep a dated note for new research and link it here. State the product commit, host/SDK build and source revision where available.
2. Mark each claim as implemented behavior, observed local data, declared capability, external evidence, or a proposed hypothesis. Preserve uncertainty and counterexamples.
3. Cite the primary source beside the claim. Pin research paper/source-code revisions where possible; record dates for living documentation.
4. For a new insight, specify opportunity, units, denominator, joins, coverage, confounders and a user-controlled experiment before choosing a threshold.
5. Add synthetic fixtures and controlled runtime verification during implementation. Update the root README only when a feature actually ships.
6. Never commit personal logs, raw prompts/results, credentials, session identifiers or copied databases. A schema description and sanitized aggregate observation are sufficient for research provenance.

For current product behavior, use the root [Efficiency documentation](../../README.md#efficiency). For proposed implementation order, use the [inference design](2026-11-14-efficiency-inference.md#implementation-order).

## Implementation follow-up: 0.1.30

The [Efficiency redesign](../superpowers/plans/2026-11-14-efficiency-redesign.md) implements tool-definition measurements, MCP failure findings, on-demand current-context inspection, and a previewable, aliased report for manual AI review. The research documents retain their original 0.1.29 baseline. Live context capability remains host-dependent; isolated automatic analysis-agent execution is still deferred. No claim about per-skill historical billing or task effectiveness has been added.
