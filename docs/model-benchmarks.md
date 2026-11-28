# Bundled model benchmark evidence

Benchmark evidence is a reviewed local data extract, not a leaderboard connection. The installed plugin never downloads it. Source URLs are inert provenance inside the prepared prompt; there are no remote assets, link previews, API keys, update jobs, or benchmark network permissions. SDK catalog reads and explicit Copilot inference remain separate features.

## Initial evidence and its limits

Dataset **2026-11-16.1**, reviewed **2026-11-16**, contains these published [Aider polyglot results](https://github.com/Aider-AI/aider/blob/cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a/aider/website/_data/polyglot_leaderboard.yml):

| Evaluated model/configuration | Passing within two attempts | Evaluation date | Public Copilot mapping |
| --- | --- | --- | --- |
| GPT-4.1 | 52.4% (118/225) | 2025-04-14 | Exact public alias `gpt-4.1`; dated backend unknown |
| Sonnet 4, no thinking (`claude-sonnet-4-20250514`) | 56.4% (127/225) | 2025-05-24 | Unknown; not joined to Copilot's undated alias |
| GPT-5, high | 88.0% (198/225) | 2025-08-23 | Explicit provider-qualified `openai/gpt-5` to public alias `gpt-5`; dated backend unknown |
| GPT-5, medium | 86.7% (195/225) | 2025-08-25 | Same public alias, separate reasoning evaluation |

These are sourced measurements, not our reruns. The metric is cumulative test success after at most two attempts with failed-test feedback, not pass@1 or an independent-sample pass@2 estimate. Aider evaluates selected coding exercises in six languages, not general work or the user's projects. Scores are kept at published precision. No confidence intervals were published; uncertainty is null with an explanation.

Only GPT-5 medium/high share the same clean Aider revision. The two different mapped models have a common benchmark protocol but **not a controlled identical agent environment**. No fully comparable two-model pair was verified in the licensed source. Dirty revisions, unreported suite/budget/settings and different agents prevent stronger claims. The GPT-5 settings pair is a better-matched scaffold comparison, but does not establish a statistically reliable difference or equivalence in Copilot.

The historical public aliases are not account availability claims. **All currently bundled models (`gpt-4.1`, `gpt-5`, and `claude-sonnet-4-20250514`) are retired historical models**, so current models such as Claude Sonnet 5.5, Opus 4.x, or GPT-5.x have no covered benchmark result and always report unknown coverage until reviewed offline extracts are added; no family matching, suffix removal, successor inheritance or interpolation is performed. Sonnet's dated result is retained in the dataset for provenance and future mapping work but is not exported as a matching candidate. Older or different-version evidence cannot support an affirmative equivalent-performance comparison. Any transfer to Copilot is a hypothesis to test on comparable work, with outcome checks, retry costs and human verification time.

Detailed source verification, publication commits, identity sources, rights and rejected alternatives are in [the research record](research/2026-11-16-model-benchmark-sources.md). The extract is attributed to Aider and its contributors under Apache-2.0. The full [license and transformation notice](../licenses/aider-Apache-2.0.txt) ships in installations and the standalone panel. No benchmark tasks, traces, graphics or generated code are copied.

## Files and schema

- [data/model-benchmarks.json](../data/model-benchmarks.json): editable structured facts, schema version, dataset revision and review date. Each model has its exact evaluated identity and an explicit sourced public alias mapping or null. Each result has a stable evidence ID, benchmark/subset/measurement, agent revision, reasoning configuration, score/counts/unit/direction, dates, source revision, evaluator, license and limitations. Unreported fields are null with reasons in `unknowns`.
- [src/core/benchmark-schema.mjs](../src/core/benchmark-schema.mjs): strict offline allowlist validator and safe module generation. Bounds: 64 model identities, 128 evaluations, eight notes/limitations, bounded strings/URLs, finite 0–100 percentages with count consistency. Duplicate identities/evaluations, inconsistent mappings/dates, unknown fields and non-HTTPS source schemes fail. Public mappings also require the fixed registry in `src/core/public-models.mjs`.
- [src/generated/model-benchmarks.mjs](../src/generated/model-benchmarks.mjs): generated and committed literal, rebuilt from validated source. `<`, U+2028 and U+2029 are escaped before embedding in HTML. Never edit this file directly.
- [src/core/benchmark-reference.mjs](../src/core/benchmark-reference.mjs): one validated index per module/artifact, bounded pure selection, configuration comparisons and reviewer instructions. It has no network or filesystem lookup operations.
- [src/core/model-reference.mjs](../src/core/model-reference.mjs): combines the independent SDK `catalog` and bundled `benchmarks` sections, validates caller projections and enforces the whole-review UTF-8 budget.

The shared envelope remains `modelReference: { schemaVersion: 1, catalog: null, benchmarks: null }`. Existing three-argument `buildEfficiencyReview` calls work and now select local evidence automatically. An explicit `benchmarks: null` disables that section. A supplied benchmark projection can select canonical evidence IDs from the bundled revision; its scores, descriptions and sources are never trusted or copied. Unknown revisions/IDs fail closed to null. This prevents arbitrary caller metadata from masquerading as curated evidence.

A benchmark projection contains `datasetRevision`, `reviewedAt`, `sources`, `notes`, `entries`, `coverage`, `omitted` and `availability`. Entries retain the original evaluation/source metadata plus historical/alternative role, availability, configuration-match state and transfer limitation. Original publication/evaluation dates remain distinct from verification. A date of review is not a claim that old evaluations are current.

## Selection and review flow

The existing report's unanimous raw model IDs are used; display names are never a join key for identity. The `Model N` alias remains alongside a nullable public `modelId`, verified by the catalog or a bundled mapping. Mixed/missing raw IDs and private aliases stay unknown. Existing effort aggregates supply a reasoning constraint only when the whole display group has one known effort. Unknown/mixed effort stays unknown. Even matching effort does not establish a matching Copilot harness or backend.

Selection inspects at most 20 model groups (six in card review), then looks up their indexed evidence. With matching history it considers up to three additional mapped identities, sorted by ID, and includes at most eight evaluations. It never ranks by cheapest/best score. With no matching history, the review contains coverage metadata and no unrelated scores. Unmapped, unrelated, selection-omitted and budget-omitted counts are visible. Different benchmark versions, environments and reasoning settings remain separate rows; no combined quality score is computed.

Without a catalog, candidate availability is **unknown**. With a valid fresh catalog, alternatives must be available under its provider/policy rules. Stale catalog availability is explicitly stale and supplies no affirmative alternative candidates. Unavailable historical models can retain historical evidence. Unknown/unavailable never means low quality. Catalog metadata for selected benchmark alternatives is prioritized within the SDK's existing four-alternative limit.

Explicit preparation freezes the report/filter/context and optional SDK catalog, selects bundled evidence, and creates the complete first-pass prompt. The preview, copy and first-pass send contain that exact text. No evidence is appended at send time, fetched during refresh, or reread from journals. Cancellation, late responses, one-use snapshots, expected-model checks, account verification and helper isolation are unchanged. The reviewer has no tools, files, user skills, memory or automatic model/setup changes.

Both instruction layers require evidence IDs and evaluator/source names in model comparisons, task-appropriate limits and a small user-evaluated experiment. A card stays anchored to a measured usage evidence ID; benchmark citations belong in its explanation rather than being invented local statistics. Reference strings are untrusted data, not instructions. Responses remain escaped plain text. Prompt samples follow the existing separate, disclosed optional second-pass policy; the reference itself exports no prompt text, account/project/session names, paths or MCP identifiers.

The existing serializer removes complete entries deterministically when necessary, updates omissions and removes unsupported public identities. If a catalog entry is removed, a benchmark's affirmative availability becomes unknown. The full first-pass prompt and schema remain within 46 KiB UTF-8, leaving the existing 48 KiB guard for system instructions too. JSON is never sliced. A missing SDK catalog or absent matching evidence leaves statistics-only analysis usable; visible coverage text explains the missing reference.

## Offline maintenance

1. Research primary results during development. Pin source revisions and keep an audit note. Verify the metric, sample denominator, suite/version, agent revision, effort, retry/run budget, dates and evaluator. Record unreported values as null with reasons; never infer them from a model family.
2. Verify redistribution rights for the actual result collection. A harness license does not automatically license a separate leaderboard. Retain license/attribution/transformation notices. Add no unattended fetching job.
3. Verify exact public Copilot IDs independently. Record explicit source-backed mappings. Public alias identity still does not establish dated backend equivalence. If that link is not established, leave the mapping unknown. Update `public-models.mjs` only with sourced public identities.
4. Edit `data/model-benchmarks.json`; increment its dataset revision and review date for reviewed corrections/additions. Preserve stable result IDs where identity/configuration is unchanged. Treat reasoning configurations and different environments as separate evaluations. Retain the evaluated and publication dates rather than replacing them with today's date.
5. Run `npm run validate:benchmarks`, `npm run build`, `npm test`, and `git diff --check`. Review the generated module and `panel/index.html` diff. Tests trap HTTP, HTTPS, fetch, DNS and socket calls during validation/build, temporary installation, lookup and real review preparation with mocked inference. A temporary install imports the shipped module and checks its license; it does not alter the user's setup.
6. Manually review the selected evidence and its limitations. If a release is requested, follow `AGENTS.md` for version manifests, release notes, README and generated assets. Updates reach users only in ordinary plugin releases. There is no runtime freshness fetch or automatic URL following.

## Measured overhead and checks

On Windows / Node v24.22.1, 501 warmed runs measured median validation/index construction at **0.047 ms** and complete reference selection at **0.017 ms** using existing aggregates from **100,000 synthetic receipts**. No additional receipt-sized pass was introduced; selection reuses model/effort aggregates. This measures local JavaScript work, not full dashboard loading, paint or Copilot latency. Synthetic accounting remained 10,000,000 input tokens, 2,000,000 output tokens and 1,000 recorded credits.

The generated data module is 10,475 bytes. The built panel grew from 371,102 bytes in base commit a69e627 to 410,440 bytes (**39,338 bytes**, including validator/lookup code and the full upstream license). This compares the prior committed artifact with the generated Windows working-tree artifact; checkout line endings can affect exact bytes. Tests cover schema/provenance, identity/configuration gaps, disabled/stale catalog states, hostile strings, Unicode/budget omissions, preview/copy/send equality, cancellation/settings races, privacy sentinels and offline installation/preparation. No live leaderboard query, paid inference or personal conversation was used for validation. A live Copilot response and the visual reference notice still require the user's manual check.
