# Sources for bundled model benchmark evidence

Verified from public primary sources on **2026-11-16**. No model inference, private usage history, account endpoint, or browser UI was used. This is source verification, not an independent rerun of the benchmark. The verification date must not replace the older evaluation dates.

## Recommendation

Bundle a small, attributed extract of Aider's polyglot results, pinned to repository commit `cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a`. Three useful historical Copilot identities are `gpt-4.1`, `claude-sonnet-4`, and `gpt-5`. They have a common benchmark definition, sample count, metric, and diff edit format. Their Aider versions, harness revisions, reasoning settings, and evaluation dates differ. Treat them as **limited comparisons within one benchmark protocol**, not controlled comparisons in identical environments. The evaluated API identities must remain separate from Copilot identities.

These older models are useful evidence for historical usage, not current availability recommendations. The original registry's newer models have no matching result in this source. Do not map GPT-5 results to GPT-5.3-Codex or newer GPT families, or Sonnet 4 results to Sonnet 4.5/4.6/5. Missing coverage is unknown, not a zero score.

## Selected results and exact provenance

The authoritative extract is [Aider's pinned raw YAML](https://raw.githubusercontent.com/Aider-AI/aider/cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a/aider/website/_data/polyglot_leaderboard.yml); the [rendered leaderboard](https://aider.chat/docs/leaderboards/) is a convenient human view. The source's most recent change to this file was committed on 2025-10-04 at 09:14:08 UTC; that is neither a new evaluation date nor proof of continuous updates.

| Field | GPT-4.1 | Claude Sonnet 4 | GPT-5, high |
|---|---|---|---|
| Public Copilot ID | `gpt-4.1` | `claude-sonnet-4` | `gpt-5` |
| Evaluated identifier | `gpt-4.1` | `claude-sonnet-4-20250514` | `openai/gpt-5` |
| Source display model | `gpt-4.1` | `claude-sonnet-4-20250514 (no thinking)` | `gpt-5 (high)` |
| `pass_rate_2`, percent | 52.4 | 56.4 | 88.0 |
| `pass_num_2` / `test_cases` | 118 / 225 | 127 / 225 | 198 / 225 |
| `pass_rate_1`, percent | 20.0 | 20.4 | 52.0 |
| Evaluation date (`date`) | 2025-04-14 | 2025-05-24 | 2025-08-23 |
| Aider version (`versions`) | `0.81.4.dev` | `0.83.3.dev` | `0.86.2.dev` |
| Reported harness revision | `7a87db5-dirty` | `ef3f8bb-dirty` | `32faf82` |
| Edit format | `diff` | `diff` | `diff` |
| Reasoning | Not reported | No thinking, explicit in source label | `reasoning_effort: high` |
| Command | `aider --model gpt-4.1` | `aider --model claude-sonnet-4-20250514` | `aider --model openai/gpt-5` |

The source row keys are `2025-04-14-21-05-54--gpt41-diff-exuser`, `2025-05-24-21-17-54--sonnet4-diff-exuser`, and `2025-08-23-15-47-21--gpt-5-high`. They distinguish the selected rows from other thinking levels, two-model architect runs, and reruns. Preserve the published one-decimal percentages; the counts explain their rounding.

Public introduction commits establish **publication evidence**, separately from each row's evaluation date:

| Row | Publication commit | Commit timestamp, UTC |
|---|---|---|
| GPT-4.1 | [`8cf18744534385e8033a6ae3850467884babbfa1`](https://github.com/Aider-AI/aider/commit/8cf18744534385e8033a6ae3850467884babbfa1) | 2025-04-14T22:52:06Z |
| Sonnet 4 | [`79edb0e1e04a66fa831f5a03bc8dc50ddff1b6ab`](https://github.com/Aider-AI/aider/commit/79edb0e1e04a66fa831f5a03bc8dc50ddff1b6ab) | 2025-05-25T21:57:49Z |
| GPT-5 high | [`bfef1906bb036f7db0d618e789e299dffdc493ca`](https://github.com/Aider-AI/aider/commit/bfef1906bb036f7db0d618e789e299dffdc493ca) | 2025-08-23T17:11:56Z |

These timestamps are repository commit metadata, not a claim about the exact time the public website deployed. The GPT-5 introduction originally named the model `openai/gpt-5`; the pinned later YAML retains that exact API identifier in its command while using `gpt-5 (high)` for display.

## What the metric and environment establish

Aider polyglot contains 225 difficult Exercism exercises across C++, Go, Java, JavaScript, Python, and Rust. Its task is to edit provided source files so that the exercise tests pass. The suite was selected from 697 exercises using results from seven earlier models, so this is a particular, selected exercise distribution, not a random sample of workplace tasks. See the [pinned benchmark introduction](https://github.com/Aider-AI/aider/blob/cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a/aider/website/_posts/2024-12-21-polyglot.md).

`pass_rate_2` reports the cumulative proportion passing by the second attempt. A failed attempt supplies test output before the next attempt. It is not first-attempt success and not the usual independent-sample pass@2 estimator. The [pinned harness README](https://github.com/Aider-AI/aider/blob/cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a/benchmark/README.md) describes the pass-rate fields and development/dirty revision notation. The [GPT-5 run's exact public harness](https://github.com/Aider-AI/aider/blob/32faf82b31c54d6f19c5c3d63bc294f748bd3e72/benchmark/benchmark.py) confirms the cumulative calculation, default two tries, stopping after success, and feedback loop.

For that GPT-5 harness, Aider edits are followed by local unit tests; shell-command suggestions are disabled, additional file mentions cannot load files, streaming and Git are disabled, and prompt caching is enabled. The test-process timeout is 180 seconds. This describes the published scaffold, not an externally verified complete execution environment. Aider can make formatting-repair requests inside a task attempt, so two test attempts does not imply exactly two API requests. The [benchmark notes](https://aider.chat/docs/leaderboards/notes.html) explicitly describe edit-repair feedback.

| Configuration or budget fact | Evidence status |
|---|---|
| Benchmark family, 225 completed cases, diff edit format, pass rate after two attempts | Reported for all selected rows |
| Number of independent repeated runs / random seeds | Not reported; do not invent confidence intervals or replication counts |
| Exact exercise-repository commit and container-image digest | Not reported in the selected rows |
| Provider/backend snapshot for `gpt-4.1` and `openai/gpt-5` aliases | Not reported; do not append a date to either evaluated ID |
| Sonnet evaluated provider snapshot | Explicit `claude-sonnet-4-20250514`; Copilot snapshot equivalence remains unknown |
| Full system prompt, temperature, maximum output tokens, and total token/dollar/turn cap for each actual run | Not established by these rows; store unknown |
| GPT-5 reasoning effort | Explicit high; numeric thinking-token budget not reported |
| Sonnet reasoning | Explicit no-thinking label; do not infer current Copilot defaults |
| GPT-4.1 reasoning configuration | Not reported; do not rewrite absence as disabled |
| Aggregate recorded run costs and seconds per case | Published, but historical outcomes rather than imposed budgets or Copilot prices; omit from initial capability extract |

The Sonnet baseline revision resolves to [`ef3f8bb3010023747e12403576f528529eb0f61f`](https://github.com/Aider-AI/aider/commit/ef3f8bb3010023747e12403576f528529eb0f61f), but the row's dirty suffix means uncommitted modifications are missing. GPT-4.1's reported `7a87db5` did not resolve through GitHub's commit API (422) or raw-file route (404) during verification. Preserve its source-reported revision and mark reproduction incomplete. GPT-5's reported revision resolves to [`32faf82b31c54d6f19c5c3d63bc294f748bd3e72`](https://github.com/Aider-AI/aider/commit/32faf82b31c54d6f19c5c3d63bc294f748bd3e72).

Do not claim identical harnesses, identical inference budgets, a statistically established ordering, or expected success rates for the user's tasks. These results can motivate a bounded trial only when a matching model is actually available and task outcomes are measured.

An inspection of every repeated `commit_hash` group in the pinned YAML found no pair of distinct, verified Copilot model identities sharing a clean harness revision and edit format. Sonnet 4 and Opus 4 share Aider `0.83.3.dev`, but the commits differ and Sonnet's is dirty. GPT-4.1 and GPT-4.1 mini also share an Aider version but have different dirty commits; a public Copilot `gpt-4.1-mini` identity was not established. Do not claim a controlled two-model comparison from these near-matches.

A narrower settings comparison is available within one public model: GPT-5 high, medium, and low all report clean harness `32faf82`, Aider `0.86.2.dev`, diff format, 225 cases, and `openai/gpt-5`. The same [pinned YAML](https://github.com/Aider-AI/aider/blob/cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a/aider/website/_data/polyglot_leaderboard.yml) reports medium at 86.7% (195/225) and low at 81.3% (183/225), both evaluated 2025-08-25, versus high at 88.0% (198/225) on 2025-08-23. This offers a better-matched scaffold comparison of reasoning settings, while backend snapshots, unreported run settings, and replication remain unknown. It is not evidence about two different model identities.

For bundling the medium variant, its exact row key is `2025-08-25-13-23-27--gpt-5-medium`, display model `gpt-5 (medium)`, command `aider --model openai/gpt-5`, and explicit `reasoning_effort: medium`. Its first-attempt result is 49.8% (112/225). The medium and low rows were first added in [commit `54b266f2895c5023470d712ad7d51df1b545560c`](https://github.com/Aider-AI/aider/commit/54b266f2895c5023470d712ad7d51df1b545560c), timestamp 2025-08-25T14:52:12Z. Evaluation date remains 2025-08-25, and research verification date remains 2026-11-16. This medium row can supplement the three identities above without suggesting that its setting is a different model.

## Public Copilot identity mapping

A GitHub Copilot CLI contributor's [2025-12-30 explanation of CLI 0.0.373](https://github.com/github/copilot-cli/issues/400#issuecomment-3700514846) publishes the CLI help/configuration list containing the literal identifiers `gpt-4.1`, `claude-sonnet-4`, and `gpt-5`. The comment is authored by `andyfeller`, GitHub API association `CONTRIBUTOR`, created at 2025-12-30T20:33:58Z and last edited at 20:36:39Z. This is evidence of public historical Copilot ID spelling, not current per-account availability. A second first-party example is the SDK's [pinned changelog](https://github.com/github/copilot-sdk/blob/c07cf0ec4066d6a247ae091c798fa0626edf311f/CHANGELOG.md), which documents `session.setModel("gpt-4.1")`.

GitHub's [model support and retirement reference](https://docs.github.com/en/copilot/reference/ai-models/supported-models#model-retirement-history), read on 2026-11-16, records GPT-5 retirement on 2026-02-17, Sonnet 4 on 2026-05-01, and GPT-4.1 on 2026-06-01. Do not silently substitute the recommended successor or use these records to populate a current model catalog.

The allowed join is an exact public Copilot ID to a **manually reviewed related evaluation**, with all three mappings explicitly marked `backend snapshot unverified` and `Copilot harness/configuration unverified`. Matching names do not establish backend revision, prompts, context limits, tools, or reasoning settings. The Sonnet mapping is related by named model generation; it does not prove that Copilot's `claude-sonnet-4` selected Anthropic's exact `20250514` snapshot in any user's session. The same spelling of the GPT aliases likewise does not prove backend identity.

Anthropic's [model deprecation reference](https://platform.claude.com/docs/en/about-claude/model-deprecations) explicitly identifies Claude Sonnet 4 with `claude-sonnet-4-20250514`. That establishes the provider's model name and dated API identity, not GitHub's backend resolution. No inspected GitHub source established Copilot alias to dated-snapshot equivalence. A strict implementation should leave Sonnet's matching model ID null, retaining `claude-sonnet-4` only as a separately labelled related public alias. GPT-4.1 and GPT-5 may retain exact alias-level matches, with snapshot and performance transfer still unverified.

Do not suffix-strip user histories, infer identity from display labels, map a private alias, or treat a benchmark-only identity as account availability. The IDs above can be added explicitly to the public allowlist, and the integration may identify unanimous raw historical IDs from the reviewed public-alias mapping without a catalog; availability must then remain unknown. The implemented Sonnet mapping stays null because dated backend equivalence was not established.

## Redistribution evidence and packaging requirements

The source repository's [pinned LICENSE.txt](https://github.com/Aider-AI/aider/blob/cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a/LICENSE.txt) is Apache-2.0, confirmed by the [GitHub license API at the same revision](https://api.github.com/repos/Aider-AI/aider/license?ref=cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a). Its license blob is `d645695673349e3947e8e5ae42332d0ac3164cd7`. The pinned repository tree contains no separate leaderboard-data license or NOTICE file. Its [project metadata](https://github.com/Aider-AI/aider/blob/cb6a152e5ee27fbc77ac499d5e628ccd74a5fa2a/pyproject.toml) also declares the Apache Software License classifier.

This is a usable redistribution basis for a small transformed data extract. Ship the full Apache-2.0 license text with the plugin distribution, credit Aider and its contributors, retain source URLs/revision, and prominently state that the plugin selected and transformed the rows. Preserve applicable upstream notices if future source revisions add them. Do not present the plugin's extract as an Aider endorsement. No exercise source code, generated patches, traces, logos, or website graphics need be bundled.

The full retrieved license, preceded by an attribution and transformation notice, is saved in [licenses/aider-Apache-2.0.txt](../../licenses/aider-Apache-2.0.txt). Its upstream license text was checked as an exact suffix of the written file. Ensure packaging includes this file; placing it only in a development checkout does not satisfy distribution needs.

## Alternative reviewed but not selected

The [SWE-bench official leaderboard](https://www.swebench.com/) has a 500-instance Verified/Bash Only view with mini-SWE-agent environments and potentially useful newer models. Its website repository uses [CC BY-NC 4.0](https://github.com/SWE-bench/swe-bench.github.io/blob/a0a7d29ec767639126ad4dc5b80397638854a705/LICENSE), not a generally unrestricted commercial redistribution license. The [experiments repository at `40f164d5b8f1d249bf95a6df8b74b577fd8e519d`](https://github.com/SWE-bench/experiments/tree/40f164d5b8f1d249bf95a6df8b74b577fd8e519d) has no top-level license in the inspected root; public visibility alone is not a redistribution grant. The MIT license of mini-SWE-agent's software would not by itself license the separate result collection. Do not infer result-data rights from the benchmark harness's code license.

For this initial bundle, Aider has clearer reusable source licensing. A future SWE-bench contribution needs independently established result-data permissions, exact model/configuration provenance, and a compatible comparison group before scores enter the runtime bundle.

## Runtime boundary

All network access in this research was development-time source verification. The shipped feature should use only the pinned, validated local extract and packaged provenance. No runtime URL fetch, leaderboard scrape, provider call, model inference, or personal-history inspection is needed to load it. Explicitly report missing/retired/unmatched coverage and old evaluation dates. Benchmark evidence is independent of SDK availability, but it must not imply that a historical benchmarked model is currently selectable.
