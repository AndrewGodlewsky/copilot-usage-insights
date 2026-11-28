# Core report scale audit — 2026-11-17

The review found and removed repeated work in prompt attribution, conflicting-event deduplication, model filtering, delegated-work validation, and review preparation. All changes preserve recorded charges, exclusion rules, provider boundaries, filters, and retained records. At 10,000 records, the largest measured improvement was copied-journal grouping: 10.35 seconds to 221 milliseconds. A synthetic history containing 200,000 prompts completed with the same accounting invariants.

The baseline was commit `93117a6`, version `0.1.110`. Measurements used Node `v24.22.1` on Windows x64. Each timed process used synthetic in-memory records; no personal journals, browser, account, SDK generation, or network service was accessed. CPU-heavy measurements were scheduled separately from the other review agents' benchmarks. These are local measurements, not latency guarantees.

**Measured changes.** Cold report times below are medians of three builds with a fresh attribution cache. Warm times are one additional build with the same cache. Garbage collection ran before each cold measurement. Parsing, disk access, fixture generation, and JSON serialization are outside the reported build time.

| Synthetic case | Records or variants | Baseline cold | Updated cold | Baseline warm | Updated warm |
| --- | ---: | ---: | ---: | ---: | ---: |
| Many steering submissions sharing one billing group | 10,000 | 1,342.1 ms | 102.1 ms | 1,343.3 ms | 13.7 ms |
| Shared billing group with one distinct model label per call | 2,000 | 193.4 ms | 32.4 ms | 191.9 ms | 19.3 ms |
| Independent pairs of journals sharing a receipt | 10,000 | 10,349.5 ms | 220.8 ms | 91.7 ms | 72.1 ms |
| One chain of journals sharing adjacent receipts | 10,000 | 1,667.4 ms | 278.7 ms | 95.9 ms | 87.7 ms |
| Conflicting metadata under one event ID | 10,000 | 702.5 ms | 12.7 ms | — | — |
| One delegated tool with 9,998 child calls plus two root calls | 10,000 | 1,647.2 ms | 168.6 ms | 9.7 ms | 8.1 ms |
| Long session, 3,001 selected model names | 100,000 | 2,112.9 ms | 1,271.5 ms | 876.4 ms | 72.0 ms |

The conflict case measures `createPromptEventSet().add`, not a full report. All variants remain retained; equal replays still return the original event. The model selection contains one present model and 3,000 absent names, which fit within the server's 64 KiB request limit. It exposes the previous repeated linear search without relying on malformed requests.

The smaller inputs confirm that the original cost increased faster than input size:

| Case | Baseline at 2,000 | Baseline at 4,000 | Updated at 2,000 | Updated at 4,000 |
| --- | ---: | ---: | ---: | ---: |
| Shared billing group | 94.6 ms | 310.4 ms | 18.7 ms | 37.9 ms |
| Independent copied-journal pairs | 347.9 ms | 1,257.0 ms | 47.5 ms | 101.0 ms |
| Receipt-link chain | 91.0 ms | 288.1 ms | 60.0 ms | 111.7 ms |
| Same-ID conflicts | 29.2 ms | 112.6 ms | 2.6 ms | 5.0 ms |

**Stress beyond 100,000 records.** These are updated-code measurements. The two 200,000-record report rows and the 100,000-distinct-session row are final confirmation runs with one cold sample each; the other cold figures are medians of three. Retained memory is the garbage-collected heap increase after fixture creation, with the report and attribution cache retained. It excludes the input fixture and is not peak process memory.

| Case | Records or variants | Cold | Warm | Additional retained heap | Serialized report bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| One long session, independent prompts | 100,000 | 1,355.5 ms | 102.8 ms | 37.6 MiB | 125,689 |
| One long session, independent prompts | 200,000 | 3,604.9 ms | 202.2 ms | 75.9 MiB | 125,756 |
| One shared billing group | 100,000 | 1,132.3 ms | 95.4 ms | 33.1 MiB | 125,085 |
| One shared billing group | 200,000 | 2,614.7 ms | 193.1 ms | 66.6 MiB | 125,151 |
| Same-ID conflicts | 100,000 | 118.9 ms | — | Not measured | — |
| Same-ID conflicts | 200,000 | 232.6 ms | — | Not measured | — |
| One distinct session per request | 100,000 | 2,425.5 ms | 1,014.8 ms | 207.9 MiB | 76,064,478 |

The last case exposes a remaining cost: full session rows and filter options grow with session count. The plain response contains about 72.5 MiB of JSON in this extreme fixture. The opt-in compact protocol described below reduces those transferred bytes without removing rows. Paging or loading those lists on demand could preserve access to every session, but would require further coordinated server and panel changes. This audit did not implement or measure pagination or cap the lists.

The 100,000-session response consists almost entirely of two fields:

| Field | Serialized bytes | Share of full response |
| --- | ---: | ---: |
| `sessions` | 68,249,171 | 89.7% |
| `options.sessions` | 7,688,891 | 10.1% |
| Everything else, including JSON field names | 126,416 | 0.2% |

Two initial lossless encoding experiments were performed in the synthetic harness. Each was decoded and deep-compared with all original session rows, including missing-value counters. These experiments informed the implemented codec below.

| Experimental session-table representation | Table bytes | Reduction from original table | Approximate full response, retaining all other fields |
| --- | ---: | ---: | ---: |
| Column names once, row values in arrays, nested missing counters in fixed columns | 18,949,694 | 72.2% | 26,765,001 bytes |
| Same columns, with values identical across every row stored once | 11,049,777 | 83.8% | 18,865,084 bytes |

**Implemented compact wire format.** [report-wire.mjs](../../../src/core/report-wire.mjs) implements a versioned codec for `sessions` and `options.sessions`. Columns occur once; values shared by every row occur in a defaults object. Sparse omission metadata distinguishes absent fields from explicit nulls. All other report fields pass through. Every session and option remains available. The server retains its plain response default; the updated panel opts in with `compact: true`.

| Actual full report, 100,000 distinct sessions | Measured value |
| --- | ---: |
| Plain JSON | 76,064,478 bytes |
| Compact JSON | 17,665,153 bytes |
| Byte reduction | 76.78% |
| Conservative decoded-size estimate for cache accounting | 77,865,153 bytes |
| Plain stringify / parse | 227.2 ms / 141.3 ms |
| Compact encode / stringify | 205.5 ms / 74.8 ms |
| Compact parse / decode | 43.2 ms / 127.1 ms |

These are one isolated timing sample of the final codec, not timing guarantees. Server encoding plus serialization took 280.2 ms versus 227.2 ms for plain serialization; client parsing plus reconstruction took 170.3 ms versus 141.3 ms for plain parsing. The initial decoder took 210.6 ms in a separate isolated sample; prevalidating defaults once, copying their scalar values together, and cloning only nested counters reduced the final sample to 127.1 ms. The measured benefit is 58,399,325 fewer transferred bytes while preserving complete output. Decoded browser object memory remains, and peak codec memory and savings on real histories were not measured. This is a lossless representation change, not a feature-removal tradeoff.

[report-wire.test.mjs](../../../tests/report-wire.test.mjs) verifies a full 100,000-session JSON-equivalent round trip and byte reduction, unchanged inputs, independent nested counter objects, optional fields, Unicode, nulls, zeroes, deterministic columns, legacy passthrough, repeated decoding, and malformed schemas. The decoder reconstructs keys only from fixed allowlists and rejects prototype-related names, duplicates, invalid dimensions, bad omission indexes, and unknown versions. An encoder encountering a future unrecognized field returns the whole plain report rather than dropping that field. Cache accounting adds repeated key/default costs to compact bytes so it does not mistake transfer savings for decoded-object savings.

The codec is integrated with the server's opt-in report/refresh endpoints and the panel's request/response path. [report-wire-api.test.mjs](../../../tests/report-wire-api.test.mjs) passes the plain/compact equivalence, filter, boolean-option validation, and format-specific revision-hint checks. All seven codec tests and both API tests passed after the decoder optimization. Panel and bundled-build validation are recorded in the main audit.

The implemented session-table encoding is expanded immediately by the panel; the pure report builder keeps its existing return shape. A shared session catalog could also remove repeated IDs/names from session rows while retaining `options.sessions`, but that additional saving was not measured.

Paging has a broader dependency set. [panel.js](../../../src/panel/panel.js) currently filters and sorts `state.report.sessions` for project expansion and validates expanded selections against those rows. [token-insights.mjs](../../../src/panel/token-insights.mjs) uses the complete list to derive session-spend concentration. The session selector uses all `options.sessions`. Preserving those features would require a project-session page endpoint, equivalent aggregate spend evidence, and a searchable/paged selector that can still resolve the selected session. Existing model-session and request endpoints already page 25 rows. None of these consumers can simply lose the full list without a replacement.

**What changed and what proves it.** Source references point to the responsible functions; line numbers can change with later edits.

| Location | Previous work | Change and regression evidence |
| --- | --- | --- |
| [prompt-credits.mjs](../../../src/core/prompt-credits.mjs), `createPromptEventSet` | Each same-ID conflict compared itself with all earlier variants. | Index conflicting variants by a canonical signature, then retain the existing equality check. A deterministic test observed 98,432 timestamp reads for 256 variants before the fix; the fixed test requires fewer than 7,680. Environment provenance remains excluded from equality. |
| [prompt-credits.mjs](../../../src/core/prompt-credits.mjs), `intern` | The global string cache bounded entry count but not character storage, retaining large metadata strings after their source records disappeared. | Keep the existing 16,384-entry limit, add a 4 MiB UTF-16 character budget, and bypass caching for values longer than 8,192 characters. Returned strings are unchanged; no identifier or metadata is truncated. A deterministic 513-string regression previously retained 12,574,518 character bytes and now stays within 4 MiB. This counts character storage, not measured heap or backing-store allocation. |
| [prompt-credits.mjs](../../../src/core/prompt-credits.mjs), `attributePrompts` | Each connected journal group filtered the complete history; session union paths were not compressed. | Partition the history once and compress union paths. Original input order is retained for equal timestamp/ID ties. The 128-pair test fell below its 23,040-read budget after previously reading 103,680 timestamps. |
| [prompt-credits.mjs](../../../src/core/prompt-credits.mjs), `summarizePromptCredits` | Every steering submission rebuilt the same charge-model projection and updated every model counter. | Reuse the projection and batch counter increments across consecutive prompts sharing a charge array. The 256-prompt test previously projected 65,536 models and now requires fewer than 1,024. With 256 distinct model labels, the separate regression previously made 65,792 counter lookups and now requires fewer than 2,560. |
| [prompt-credits.mjs](../../../src/core/prompt-credits.mjs), delegated tool completion | Every spawned agent searched every sibling and completion. | Index each agent's latest child work and latest completion. The 256-child test previously made 65,536 sibling-membership checks; the budget is now 5,160. Existing tests still reject missing child receipts, missing completion, and completion before work. |
| [copilot-report.mjs](../../../src/core/copilot-report.mjs), [context-growth.mjs](../../../src/core/context-growth.mjs), [coverage.mjs](../../../src/core/coverage.mjs), [model-settings.mjs](../../../src/core/model-settings.mjs), prompt filters | Repeated array membership searches multiplied history size by selection size. | Build sets once per calculation. A 513-name selection previously required 131,328 indexed reads for 128 prompts; the regression budget is 5,130. No model-selection limit was introduced. |
| [review-evidence.mjs](../../../src/node/review-evidence.mjs), `prepareInsightReview` | Cloned every candidate's complete record before selecting at most 24. | Clone after selection. A test records exactly 24 copies from 128 eligible candidates, verifies selected records remain isolated from later input mutation, and checks that private record fields remain absent from exported evidence. |

[report-scale.test.mjs](../../../tests/report-scale.test.mjs) contains nine regression tests. The operation-count and retained-character tests failed against the original implementation before fixes were applied. They avoid elapsed-time assertions that fluctuate with machine load. [benchmark-report-scale.mjs](../../../scripts/benchmark-report-scale.mjs) adds 147 complete-report deep-equality comparisons against the baseline: seven history shapes, three ordering/conflict variants, and seven filter configurations. These compare the entire report, not only totals.

The stress harness asserts exact aggregate credits using a `BigInt` oracle; complete zero charges remain valid. Ordinary and copied histories retain every eligible prompt. Shared steering groups remain excluded from per-prompt costs while retaining confirmed submission counts. Delegated histories retain all child charges in the parent prompt. Repeated reports with cached attribution must equal the initial result. Existing attribution, conversation, context-growth, environment, tool, model-change, coverage, and review-evidence tests were also run during the changes. The repository-wide build and test result is recorded in the main audit.

**Reproduction.** From the repository root, create a detached baseline checkout and run the current harness against both code versions. The directory below is a dedicated sibling checkout; choose another unused directory if it already exists.

```powershell
git worktree add --detach ../usage-audit-baseline-93117a6 93117a6
node --test tests/report-scale.test.mjs
node --test tests/report-wire.test.mjs
node scripts/benchmark-report-scale.mjs --compare=../usage-audit-baseline-93117a6

$baselineRepo = '../usage-audit-baseline-93117a6'
foreach ($case in @('shared', 'coupled', 'chain', 'conflicts', 'delegated')) {
  node --expose-gc scripts/benchmark-report-scale.mjs "--repo=$baselineRepo" "--case=$case" --n=10000 --repeat=3
  node --expose-gc scripts/benchmark-report-scale.mjs "--case=$case" --n=10000 --repeat=3
}

node --expose-gc scripts/benchmark-report-scale.mjs "--repo=$baselineRepo" --case=long --n=100000 --models=3000 --repeat=3
node --expose-gc scripts/benchmark-report-scale.mjs --case=long --n=100000 --models=3000 --repeat=3
node --expose-gc scripts/benchmark-report-scale.mjs "--repo=$baselineRepo" --case=shared-models --n=2000 --repeat=3
node --expose-gc scripts/benchmark-report-scale.mjs --case=shared-models --n=2000 --repeat=3

foreach ($case in @('long', 'shared', 'conflicts')) {
  foreach ($count in @(100000, 200000)) {
    node --expose-gc scripts/benchmark-report-scale.mjs "--case=$case" "--n=$count" --repeat=3
  }
}
node --expose-gc scripts/benchmark-report-scale.mjs --case=normal --n=100000 --repeat=1 --sizes
node --expose-gc scripts/benchmark-report-scale.mjs --case=normal --n=100000 --repeat=1 --wire
```

Run timing commands sequentially while the machine is otherwise idle. The `--compare` command uses small fixtures and checks exact output equality; its run time is not a benchmark. The audit itself used an untouched copy of the baseline core modules in a temporary directory, equivalent to the baseline checkout for these imports.

**Module coverage and remaining limits.** This inventory records source review, not a claim that every possible input or platform was tested.

| Modules read | Checked | Remaining limits |
| --- | --- | --- |
| `prompt-credits.mjs` | ID bounds, replay conflicts, provider evidence, exact charge sums, ownership graph, future events, cache reuse, interruptions, delegated completion, model/date scope. | An altered long session still rebuilds that session's attribution. Coupled sessions are recomputed when the input arrays change. Performance beyond the measured synthetic shapes remains unquantified. |
| `copilot-report.mjs` | Bucket totals, exact credit accumulation, choice-list scope, session labels, tool/skill grouping, request pages, report allocation. | Request pages still scan and sort matching requests. Session lists remain unpaged in full reports; the 100,000-session measurement quantifies this cost. |
| `report-wire.mjs` | Lossless versioned tables, fixed decoder key allowlists, shared defaults, omitted/null distinctions, conservative decoded-size estimate, 100,000-row round trip. | Decoding still reconstructs every session object. Unknown future fields use the larger plain representation until the schema is updated. Peak codec memory was not measured. |
| `conversations.mjs`, `conversation-summary.mjs` | Confirmed-human counts versus financial eligibility, prior-period scope, bounded examples, median calculation, comparison coverage checks. | These are descriptions of recorded activity. Missing journals and changing coverage can still limit interpretation; existing exclusions remain intact. |
| `context-growth.mjs`, `efficiency.mjs` | First linked root-call selection, cache subsets, raw-model consistency, incomplete histories, group medians, bounded output examples, exact charge totals. | Context growth retains its points until summary completion and sorts values for exact medians. No data-loss approximation was introduced. The 200,000-record measurements include this work. |
| `query.mjs`, `environments.mjs` | Local date representation, supported date bounds, day-cache bounds, normalized queries, environment scope and cache keys. | Existing tests cover calendar boundaries; this review did not manually change the operating system's clock or time zone. |
| `coverage.mjs`, `model-settings.mjs`, `integrations.mjs` | Scoped unknown/missing metadata, replay accounting, model-ID/display-name mapping, tool outcome summaries. | Coverage rows can still grow with distinct file/date combinations. No additional limit or row-dropping behavior was added. |
| `model-reference.mjs`, `public-models.mjs` | Public-ID allowlist, provider checks, normalized rate units, duplicate catalogs, revalidation, bounded serialized review evidence. | No live catalog or price RPC was called. Current model availability and rates were not independently verified by this source-code audit. |
| `benchmark-reference.mjs`, `benchmark-schema.mjs` | Strict dataset shape/size/URL validation, bounded result selection, canonical evidence projection, HTML-safe generation. | The historical benchmark claims were not re-researched. Source URLs are data; no remote benchmark content was retrieved. |
| `format.mjs`, `provider-names.mjs`, `diagnostics.mjs` | Bounded formatter cache, own-property provider lookup, allowlisted diagnostic fields, bounded retained log entries. | File-reading limits and HTTP diagnostics authorization belong to the separate runtime/source audit. |
| `node/review-evidence.mjs` | Aggregate-only exports, anonymous model/skill/server labels, own-review exclusion, candidate bounds, sample limits, selected-record isolation. | Review preparation still builds a report and ranks all eligible candidates before choosing 24. This audit did not time a paid review or read sample prompt files. |

No confirmed accounting loss, private-text export, or executable-input path was found in these audited core calculations. Resource exhaustion remained the concrete security concern: a corrupted imported journal could previously trigger the demonstrated quadratic cases. Their fixes preserve conflicting evidence instead of discarding it. That does not bound total memory for an arbitrarily large history.

No feature-removal tradeoff was implemented. Keeping exact medians, all accounting evidence, full filtering, and all session access remains the default. A proposal to discard older records, truncate identifiers, sample charge records, or cap session lists would change results or access; this audit supplies no measured benefit that would justify those losses. Browser rendering, source ingestion, SQLite execution, HTTP authorization, packaging, and live SDK behavior are covered separately in the main review.
