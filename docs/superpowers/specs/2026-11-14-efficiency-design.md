# Efficiency tab

The user requested a third main tab that turns recorded model resource use into specific directions, without treating token volume as task value. Implement within the existing dashboard and publish to main under the standing workflow.

## Approach

Use deterministic, explained measurements from the existing filtered accounting records. An overall efficiency score would imply knowledge of results; an AI-written analysis would add cost, latency, and prompt access. Neither is needed. Reuse the current styling, filters, tables, footer, and request drill-down.

## First version

- Four summary measures: average input, average output, weighted cache reuse, and average credits per request. Each has its own coverage count. Input includes cached context; reasoning remains part of output. Cache toggling does not redefine these physical input/output measurements.
- A model comparison with those measures and request counts. No best/worst model ranking: workloads differ. Rows sort by request count and open the existing usage breakdown.
- Up to three evidence-led directions: larger later input in a session; low cache reuse; concentrated model credit spend. Each includes observed figures, a concrete experiment, and Inspect usage with the relevant model/project/session filters.
- Rules are review triggers, not optimal targets: cache reuse below 50% over at least 5 known requests and 50k input tokens, with at least 80% cache coverage; growth at least 2x and 10k tokens between first/last three input measurements in a same-project/session/model/initiator group (6 requests, 80% input coverage, strictly separated timestamps, only known user/agent initiators); one model consuming at least 60% of complete charges, with 80% charge coverage overall and at least two models having 5 complete charges each.
- Credit averages exclude missing and partial charges. Zero charges remain valid. Every ratio uses numerator and denominator from the same eligible requests. No savings estimates, model price lists, task-value claims, prompt reads, new files of user data, or database.
- Missing data displays Unavailable; no requests and no triggered directions have distinct empty states. Names wrap and are escaped; keyboard navigation and text sizing use existing patterns.

## Boundaries and performance

Accumulate during the report's existing filtered-record loop. Keep only the first and last three input samples per eligible group; no full request arrays in the API response. Finish at most one direction per category. UI reads the report, and clicking Inspect usage reuses the existing cached reporting path. Existing Usage and Breakdown semantics stay unchanged. Automated tests replace desktop UI testing at the user's request.

## Guidance sources

- https://docs.github.com/en/copilot/tutorials/optimize-ai-usage
- https://docs.github.com/en/copilot/tutorials/optimize-chat-usage

Advice is conditional on the observed pattern. Lower token or credit use is not proof of better work; starting fresh can reduce irrelevant context but also loses reuse, so it applies to unrelated work.
