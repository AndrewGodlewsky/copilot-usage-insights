# Daily selection and skill activity

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

The user requested selectable daily bars in the token overview and skill information under Breakdown. Reuse the current dashboard layout and local event scanner.

Daily selection updates the large token total, input/output/cache statistics, and token-type bar to that day. Keep the daily chart and secondary tiles on the full filtered range. Highlight the selected day, label the scope, support keyboard activation, and let a second activation or Show all days restore the overall summary. Clear selection when filters change; retain it across refreshes if the day remains present. Zero-usage days in the chart remain selectable.

Add a Skills card directly below the existing Breakdown table, rather than hiding it in another grouping option. Show skill name, recorded plugin/version, activation count, distinct sessions/projects, and latest activation. Date, project, and session filters apply to invocation metadata. Explicitly state that the model filter applies to token accounting only: skill events do not consistently identify the model.

Parse only persisted `skill.invoked` events, retaining event identity, time, session/project, name, and plugin/version. Discard content, arguments, definitions, paths, and tool payloads. Deduplicate event IDs within their session across replay and copied homes. Do not infer invocation from installed skills or file reads. Do not allocate token charges to skills.

Skill provider attribution is conservative: include sessions with Copilot-attributed request metadata, and omit sessions containing excluded/unclassified/invalid usage receipts. Count omitted skill events visibly. This can omit genuine Copilot activations in mixed-provider sessions, but avoids presenting custom-provider activity as Copilot usage. Skill-only sessions lacking attribution remain omitted until a Copilot receipt or supported database record is available. Empty UI says no recorded activations, not never used.

Alternatives considered: a separate skills screen adds navigation for a small table; inferring skills from tool arguments is less reliable and retains unnecessary payloads. Use the existing report API, pure SVG builders, native event delegation, and existing color/type scale without new dependencies.
