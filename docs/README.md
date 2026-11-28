# Documentation

Start with the [reviewer’s guide](reviewing.md) to understand the repository, try a synthetic demo, trace the code, and identify decisions needing feedback. The [root README](../README.md) is the short installation and project overview.

## User guides

| Guide | Contents |
| --- | --- |
| [Installation and local development](guide/installation.md) | Marketplace installation, troubleshooting, local installer, browser previews, WSL and VS Code setup |
| [Usage and accounting](guide/usage.md) | Tokens, credits, filters, request details, prompt grouping, and activity |
| [Efficiency views](guide/efficiency.md) | Cache, context growth, conversation habits, model/effort changes, and interpretation limits |
| [Using and improving AI review](guide/ai-review.md) | Prepared evidence, model selection, excerpts, cards, and guidance authoring |
| [Skills, MCP servers, and plugins](guide/integrations.md) | Historical activity, live inventory, coverage rules, and optional MCP test server |
| [Loading, diagnostics, and privacy](guide/diagnostics.md) | Refresh behavior, diagnostic logs, and local data handling |
| [Development and distribution](guide/development.md) | Build/release workflow and possible future capabilities |

## Current technical references

| Reference | Contents |
| --- | --- |
| [Security and updates](../SECURITY.md) | Permissions, installed components, data/network boundaries, pause, disable, and update guidance |
| [Decision backlog](audit-followups.md) | Measured trade-offs, implemented decisions, and acceptance criteria for further work |
| [AI Review integration](ai-review.md) | SDK compatibility, helper isolation, account checks, accounting, and fixtures |
| [Journal integrity](journal-integrity.md) | Decision to retain full prefix verification, diagnostics, and regression coverage |
| [Context growth](context-growth.md) | Grouping, measurements, coverage, and validation |
| [Conversation habits](conversation-habits.md) | Prompt-delivery patterns and limits of interpretation |
| [Token explorer insights](token-explorer-insights.md) | Topic measurements and evidence rules |
| [Model reference](model-reference.md) | Live model metadata, privacy, and prepared-review freshness |
| [Bundled model benchmarks](model-benchmarks.md) | Dataset provenance, limits, schema, and maintenance |
| [VS Code sources](vscode-sources.md) | Logging setup, source discovery, and billing coverage |
| [WSL sources](wsl-sources.md) | Discovery, locked database fallback, and limitations |
| [Credit undercount](credit-undercount.md) | Source coverage diagnosis and accounting corrections |
| [Dashboard recovery](dashboard-recovery.md) | Connection recovery contract and regression coverage |
| [Refresh troubleshooting](refresh-troubleshooting.md) | Incident evidence and steps for collecting useful diagnostics |
| [Release instructions](../AGENTS.md) | Required version synchronization, summaries, and release checks |

## Dated reviews and measurements

These documents preserve evidence at the version and date they name. Their test counts and benchmark results are historical, not assertions about the latest checkout. Current boundaries are described above; the decision backlog carries forward the outstanding choices.

| Review | Scope |
| --- | --- |
| [Security and performance, 2026-11-17](archive/audits/security-performance-review-2026-11-17.md) | Audit overview, architecture, fixes shipped in v0.1.111, and remaining limits |
| [Source audit, 2026-11-17](archive/audits/source-audit-2026-11-17.md) | Readers, schema safety, caching, and synthetic harnesses |
| [Report scale audit, 2026-11-17](archive/audits/report-scale-audit-2026-11-17.md) | Accounting/report construction, memory, and response size |
| [Panel audit, 2026-11-17](archive/audits/panel-audit-2026-11-17.md) | Rendering work, simulated DOM measurements, and limits |
| [Opening performance, 2026-11-15](archive/audits/performance-review-2026-11-15.md) | Startup, WSL/VS Code timing, recent-first loading, and reproduction commands |
| [Efficiency pipeline review](efficiency-review.md) | Earlier v0.1.70 baseline, end-to-end measurements, and optimizations |
| [Recent-first loading record](recent-first-loading-plan.md) | Implemented loading contract and v0.1.101 validation |
| [Feedback implementation, 2026-11-16](archive/audits/feedback-2026-11-16.md) | Historical feedback decisions and delivery corrections |

## Research and historical plans

- [Research index](research/README.md): dated evidence, proposals, and source inventories. Check each document's version before using a statement about what was implemented.
- [Development archive](archive/README.md): original plans and specifications, clearly marked as historical. Old instructions and approvals are not current authorization.
