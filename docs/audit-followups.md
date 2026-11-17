# Audit follow-up decisions

These are decision and investigation handoffs, not approval to remove features. The user authorized the behavior-preserving audit fixes and asked for GitHub issues covering changes to functionality. Keep existing behavior until the maintainer chooses an option after seeing measurements and its consequences.

| Decision | GitHub issue |
| --- | --- |
| Bounded-memory history storage | [#3](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/3) |
| Older history loaded on demand | [#4](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/4) |
| Optional prompt/tool timeline retention | [#5](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/5) |
| Unused-event JSON validation | [#6](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/6) |
| Historical journal integrity policy — retain full verification; identity fix and diagnostics completed | [#7](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/7), [decision and measurements](journal-integrity.md) |
| Large-list pagination and search | [#8](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/8) |

## Starting point for every issue

The 2026-11-17 audit started at `93117a6991b6346599955787d900ca1995e9dc90` (v0.1.110). Its implementation and measurements are on the local `audit/security-performance` branch. At issue creation that branch had not been pushed or released. Read applicable `AGENTS.md`, inspect status, fetch main, and establish which audit changes are present before editing. Preserve other agents' work. If the audit scripts/documents are absent, use an available audit checkout or recreate the described synthetic fixture; do not claim to have run a missing harness.

Read `docs/security-performance-review-2026-11-17.md` and the linked source, report and panel audits when available. All measurements below are synthetic, from Windows/Node v24.22.1, and are not guarantees for another machine. Source URLs, private histories and paid AI calls are unnecessary for these investigations. No browser or desktop automation is authorized; request manual UI checks when needed.

Preserve recorded `totalNanoAiu` charges, exact zero versus missing values, provider/environment attribution, copied-log deduplication, and whole-prompt grouping across date/model boundaries. The user explicitly rejected displaying stale saved reports as fresh data. Use structured diagnostics without prompts, paths, project/session/account names or credentials. Run `npm run build`, `npm test`, offline validators and `git diff --check` after an approved implementation. Publishing, installing, version changes and feature reductions need separate authorization; follow repository release rules when requested.

## 1. Design bounded-memory history storage without stale reports

**Decision:** choose whether to introduce a validated local index, compact in-memory storage, or an explicit retention limit. Prefer approaches that preserve complete history access; do not silently discard older records.

**Evidence:** a realistic 100,000-record fixture occupied about 3.54 GiB of journals, retained approximately 418 MiB of parsed metadata and took about 7.3 seconds to scan cold. At 50,000 records retention was approximately 210 MiB. Separately, 100,000 distinct session rows added about 208 MiB during report construction. These are different fixtures: do not add their memory numbers or infer a production ceiling. The audit's report-cache budget does not bound canonical history, response allocations or browser memory.

**Inspect:** `src/node/copilot-source.mjs`, `copilot-db.mjs`, `wsl-db.mjs`, `canvas-server.mjs`; `src/core/copilot-report.mjs`, `prompt-credits.mjs`, `context-growth.mjs`, `report-wire.mjs`. Audit harnesses: `scripts/benchmark-performance.mjs`, `synthetic-history.mjs`, `benchmark-report-scale.mjs`; tests: `scale`, `recent-loading`, `report-scale`, `report-wire`.

**Work:**

1. Profile retained heap, peak RSS, temporary allocations and event-loop stalls at 50k, 100k and 200k records, separately for many short sessions and long linked sessions. Identify actual owners before selecting a design.
2. Compare compact retained metadata against a local index with bounded pages. Quantify cold, warm, append, historical edit, 90-day/all-time, filter and drilldown costs. Existing synthetic command: `node --expose-gc scripts/benchmark-performance.mjs --scale --records=100000 --days=180 --empty=2000 --payload=realistic --seed=7`.
3. For a persistent index, specify storage contents/location/permissions, schema migration, transactional writes, crash recovery, source fingerprints, replacement/deletion/disabled-source handling, WAL/WSL uncertainty and repair/rebuild. Cache no prompt text, credentials or prepared AI review output. Validate source freshness before presenting totals as current.
4. Preserve connected prompt/subagent/billing groups even when they cross storage pages or date windows. A recent-only retention option must explicitly describe the loss of immediate older drilldowns and reload behavior.

**Acceptance:** present measured alternatives, a memory target and a migration/rollback plan for maintainer approval before changing storage/defaults. An approved implementation must match fresh scans on independent synthetic accounting oracles, including replay, copies, missing charges, edits, corrupt/interrupted indexes and source removal. Report index disk footprint and data-retention/privacy changes. No unmeasured savings percentage or arbitrary record cutoff.

## 2. Decide whether older history should load only on demand

**Decision:** keep automatic background completion, add an optional demand-loaded archive mode, or change the default. This changes when history becomes available even if all records remain accessible.

**Current behavior:** first load prioritizes the actual last 30 days, then continues older histories and databases. Selected ranges outside available coverage display a loading state. The default Rolling 30 means month-to-date; it is not the same boundary as the scan's last-30-day priority. Do not conflate them. Filters reuse the current in-memory snapshot rather than independently rescanning.

**Evidence:** in the realistic 100k fixture, the complete 7-day load changed from 9.78 to 9.34 seconds after the audit. That is not a measurement of first provisional paint or of a demand-loading implementation. No claimed savings exist yet for stopping the background archive.

**Inspect:** `src/node/canvas-server.mjs` (`readHistory`, `withinRecentRange`), `copilot-source.mjs`; `src/core/query.mjs`, `prompt-credits.mjs`; `src/panel/panel.js` loading, range selection, refresh and visibility handling. Read `tests/recent-loading.test.mjs`, `scale.test.mjs`, `panel.test.mjs`.

**Work:** benchmark time to first correct recent response and full completion, bytes read, CPU, heap and repeated wide-range navigation. Sketch an explicit Load older history interaction, cancellation, retry, background status and Refresh semantics. Determine whether 90-day/all-time, Activity history, cross-period comparisons, AI review and filters require additional data. Recent calls can link to older initiating prompts or delegated work: pending accounting must remain provisional until relevant groups are complete.

**Acceptance:** document which sections would wait, how users retrieve every older record, and how scope/coverage is displayed. Tests must cover Today, 7 days, month-to-date, 30/90 days, custom/all-time, midnight/month boundaries, widening then narrowing during load, cancellation/pause, failures and retry, source changes, and cross-date parent/child/steering groups. Loaded totals must equal a complete fresh scan. No stale stored report, fabricated zero, hidden exclusion or background inference. Obtain approval of default/interaction changes before implementation; coordinate with issue 1 without assuming a persistent index is required.

## 3. Measure optional retention of prompt and tool timelines

**Decision:** determine whether a configurable lightweight mode is worthwhile, which insights it would limit, and whether details can instead be loaded on demand. Keep full-fidelity behavior by default until approved.

**Evidence:** retained history is substantial (about 418 MiB for the audit's realistic 100k fixture), but the portion attributable exclusively to optional timeline details has not been isolated. Do not attribute that entire amount to timelines or promise a percentage reduction. Prompt text is already read on demand; removing it from the statistics snapshot is not a new optimization.

**Inspect:** `src/core/copilot.mjs`, `prompt-credits.mjs`, `conversations.mjs`, `context-growth.mjs`, `model-settings.mjs`, `coverage.mjs`; `src/node/copilot-source.mjs`, `review-evidence.mjs`; panel conversation/context/topic renderers and AI review evidence builders.

**Work:** inventory each retained event/field and its consumers. Separate metadata essential to billing, human-prompt counts, successful/failed skill loads, tool outcomes, provider evidence, deduplication and cross-session ownership from presentation-only examples. Measure retained/peak memory and recalculation latency while excluding one optional class at a time in synthetic experiments. Trace consequences for steering/interruptions, conversation habits, context trajectories, model/effort switches, delegated work, coverage review and AI recommendations. Compare lossless compact storage or lazy reconstruction before a data-dropping mode.

**Acceptance:** produce a feature-by-feature loss matrix, measured memory savings, reload/IO costs and a clear recommendation for maintainer review. If a reduced mode is approved, tests must prove unchanged recorded totals and valid attribution, explicit unavailable/pending states rather than false zeroes, consistent filters, reversible mode changes, and honest AI-review evidence. No sampling financial records, inferring missing completions, or counting agent calls as human prompts. If no meaningful savings remain after essential metadata is retained, close with measurements instead of introducing a low-value setting. Coordinate with issues 1 and 2; no independent deletion of personal source files.

## 4. Decide whether faster parsing can omit unused-event JSON validation

**Decision:** retain complete validation (audit recommendation) or approve an explicit fast mode whose reduced malformed-record coverage is visible. This is a diagnostic capability trade-off, not a free optimization.

**Evidence:** the existing experimental `--skip-unused` benchmark reduced one realistic 50k cold scan from 3,751.1 to 3,214.4 ms (14.3%) and complete initial HTTP loading from 5,101.2 to 4,292.1 ms. Retained heap stayed 209.9 MiB. It can miss malformed JSON in unused event types whose prefix resembles a valid envelope. Production still parses those lines fully. No drastic speedup is established.

**Inspect:** `src/core/copilot.mjs`, `src/node/copilot-source.mjs`, `src/node/vscode-sources.mjs`, coverage and diagnostics; `scripts/benchmark-performance.mjs`, `tests/fast-paths.test.mjs`, `copilot.test.mjs`, `scale.test.mjs`. Locate the actual experimental path before editing rather than assuming its API.

**Reproduce:** compare sequential runs of `node --expose-gc scripts/benchmark-performance.mjs --scale --records=50000 --payload=realistic --seed=7 --empty=2000` with the same command plus `--skip-unused`. Repeat at 100k with multiple event mixes and report medians, variance and exact fixture sizes. Use the existing malformed-unused-event regression as the known coverage-loss case.

**Acceptance:** quantify skipped validation and determine how coverage UI/export would communicate it. Verify byte-identical totals for valid fixtures, escaped/reordered/duplicate JSON keys, nested text that resembles an event type, unknown future events, UTF-8 and chunk boundaries, partial final lines, oversized lines, copied/replayed events, skill/tool failures, prompt links and compaction. Test whether a prefix shortcut can accidentally drop relevant data, not only whether nominal fixtures pass. Preserve full validation as the fallback and ensure a manual recheck can restore diagnostics if a fast mode is approved. No silent default flip; maintainer may explicitly choose to retain full validation and close the issue.

## 5. Decide the integrity policy for appended historical journals

**Resolved:** retain complete verification, add file identity to cache checks, and report prefix-check timing/counts. See [the implemented decision and regression results](journal-integrity.md). The investigation below remains as the original handoff; no weaker validation mode was enabled.

**Decision:** retain full consumed-prefix verification (audit recommendation), or explicitly accept weaker historical-edit detection for faster append processing. Prefer a proven feature-preserving method if one exists; filesystem modification time alone is insufficient evidence.

**Evidence:** adding approximately 226 bytes to a 256 MiB journal required roughly 130–137 ms to hash the already-consumed prefix; an unchanged scan took about 0.9 ms. That checks for edits to old content before applying the appended records. Reading only the tail or a few samples can miss changed earlier charges and leave totals wrong. The audit deliberately retained complete verification.

**Inspect:** append/fingerprint logic in `src/node/copilot-source.mjs`, streaming readers, source identity normalization, deduplication/coverage; `tests/scale.test.mjs`, `copilot.test.mjs`, `fast-paths.test.mjs`; `scripts/benchmark-sources.mjs`.

**Work:** reproduce with `node --expose-gc scripts/benchmark-sources.mjs` and isolate this result from its separate database timings. Compare 32/256 MiB and larger synthetic journals on local storage and, only when authorized, representative WSL/network mounts. Evaluate whether content/block fingerprints or a validated index can genuinely avoid rereading while still detecting arbitrary old edits; do not describe sampled hashes as equivalent integrity. Document assumptions for append-only trust, file identity, timestamps, replacement, truncate/regrow, same-size rewrites and partially written lines.

**Acceptance:** show the measured cost per changed file and frequency, the exact failure cases of every shortcut, and a maintainer decision. For any approved weaker mode, expose its limitation and a full revalidation operation; force refresh must rebuild from original sources. Test an old usage charge changed before an append, same-size earlier edits, preserved timestamps where supported, file replacement/truncation, duplicate copies, concurrent writes and cancellation. Full mode must equal an independent fresh scan. Do not change recorded historical totals from estimates, silently ignore edits, or justify weakening correctness with a general load-time claim. This issue can be resolved by documenting a decision to retain the current policy.

## 6. Design pagination and search for very large session and group lists

**Decision:** choose accessible paging, search or windowed rendering for session selectors and large top-level Breakdown groups. Preserve access to every item; this changes navigation and therefore needs a reviewed interaction design.

**Evidence:** a 100k-distinct-session fixture produced 76.1 MB of plain JSON. The audit's lossless protocol reduced transfer to 17.7 MB, but the panel still reconstructs all session objects. Opening a filter with more than 1,000 sessions mounts all native options; the audit only defers that work while closed. Nested drilldowns already page, while top-level model/project/skill lists may still be large. Actual browser DOM/paint cost has not been measured; VM timings must not be called frame-rate measurements.

**Inspect:** `src/core/copilot-report.mjs`, `report-wire.mjs`; `src/node/canvas-server.mjs` report/query endpoints and snapshot caching; `src/panel/panel.js` options, filtering, `renderBreakdown`, drilldown paging and focus restoration; `panel.html`, `panel.css`; tests `panel`, `report-wire`, `report-wire-api`, `report-scale`.

**Work:** separately measure network bytes, parse/decode cost, retained client/server memory, option/table DOM counts and authorized manual interaction at 1k/10k/100k sessions and many projects/skills. Prototype pagination/search without a hard top-N loss. Specify deterministic sort/tie handling, filtered total counts, selected values outside the current page, programmatic Efficiency navigation, keyboard/screen-reader behavior, and refresh/filter cancellation. Consider server-side query pages if client windowing alone does not address retained report memory; reusing the same snapshot must not cause a source scan per page or keystroke.

**Acceptance:** maintainer approves the interaction before replacement of native controls. Synthetic tests preserve all-item reachability, full-set sorting before paging, project/session/model/environment scope, aligned nested columns, selected item/focus across refresh, late-response rejection, empty/error states and exact totals. Keep chart selections and Efficiency inspector links working. Record measured before/after bytes, memory and operation counts. No arbitrary item cap, hidden source exclusions, new external search service, or dependency without justification. Coordinate with issue 1; pagination can be independent of archive retention.
