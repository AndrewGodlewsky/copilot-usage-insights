# Copilot Usage Insights implementation plan

**Goal:** Install and test a Copilot-only usage canvas in the user's GitHub Copilot desktop app.
**Architecture:** Pure receipt normalization and reporting; incremental local reader with read-only SQLite fallback; authenticated loopback canvas server; existing SVG chart rendering.
**Tech stack:** Node 24, native modules, HTML/CSS/JavaScript, desktop-provided Copilot SDK.
**Spec:** [Approved design](../specs/2026-11-13-copilot-migration-design.md).

## Constraints

Only Copilot-attributed usage. Report actual AI credits, never estimated dollars. Exclude standalone coding-agent data sources. No runtime downloads or dependencies. Keep the original license. Local testing was authorized first; the subsequent user request authorizes committing and pushing the migration to `main` for marketplace installation.

## Tasks

1. [x] Add receipt normalization, deduplication, incremental discovery, SQLite fallback, and credit-aware reports. Tests cover cache-inclusive tokens, unavailable charges, BYOK exclusion, source precedence, rewritten/partial logs, and date filters. Preserve reusable query/chart tests; remove tests specific to deleted providers.
2. [x] Add validated settings, loopback server, and canvas lifecycle. Test authentication, origins, malformed requests, concurrent opens, cleanup, and settings persistence. Rebuild the dashboard with existing visual components, Copilot-only filters, credits, and source diagnostics.
3. [x] Add manifests, safe repeatable local installer, demo preview, README, and updated CI. Remove obsolete source/media/scripts. Install locally. Browser and desktop verification remain unverified because Computer Use stopped on browser URL identification; the user will test the marketplace install.

## Review focus

- Replayed receipts and SQLite fallback must not double-count.
- Unknown/partial billing must not be presented as zero or complete.
- Missing source and unsupported schemas must be visible.
- Requests from other websites must not read usage or change settings.
- Install upgrades must not overwrite unrelated user extensions or settings.

## Execution record

- Existing linked worktree verified. Baseline legacy tests have known Windows shell/symlink/host-fixture failures; relevant tests will be replaced alongside obsolete integrations.
- Ruling: omit the optional worktree-only filter from this first release; project/session filters provide reliable scope without guessing a desktop workspace inventory.
- Review fixes: preserve unknown/partial charges in daily tooltips; use consistent known token subtotals and per-category availability; detect rewritten log prefixes with full consumed-content digests, retaining no raw conversation suffix.
- Ruling: derived usage indexes stay in memory for the lifetime of the canvas server; no persistent cache or runtime downloads are needed.
- The user requested publication to `main` after the local setup, superseding the earlier uncommitted-only scope.
