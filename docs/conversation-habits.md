# Conversation Habits

Efficiency → Worth a closer look → Conversation habits uses the approved focused layout: one question at a time, with a large measure beside a distribution. Narrow panels stack the two. The four topic buttons support clicks, Left/Right and Home/End; topic choice, focus and open explanations survive report refreshes.

## Measurements

| View | Main measurement | Sample and limits |
| --- | --- | --- |
| Your interactions | Median confirmed human prompts per conversation; 1, 2–5, 6–15 and 16+ prompt buckets | Selected dates only. Sessions with uncertain human identity or no confirmed prompts are excluded and disclosed. Median is the typical value; average remains secondary. |
| Agent activity | Median model calls per completely attributed prompt; 1, 2–5, 6–15 and 16+ call buckets | Requires complete, finished, reliably linked work. Includes initial calls, continuations and linked subagents across date boundaries. The expandable joint chart requires every observed prompt in a session to qualify, so its sample differs. |
| Guidance & stops | Recorded steering concentrated in the three most-steered conversations; idle, steering, queued and unknown shares | Confirmed human delivery has separate coverage from charges and depth. Unknown delivery stays visible. Explicit local-user stops are separate events, not prompts or failures. |
| Returning to chats | Share used on multiple selected dates; 1, 2–3 and 4+ active-date buckets | Counts local dates with human messages, not continuous duration. Earlier recorded activity is secondary context; its absence does not prove a new conversation. |

Confirmed human messages can contribute to depth without independently attributable charges. In particular, steering/queued messages sharing a run count as separate human submissions, but do not become separately cost-eligible. Existing recorded token/credit totals and billing eligibility are unchanged. Automated/agent messages and ambiguous identities remain excluded using the existing attribution evidence. A short chat, many calls or repeated steering does not by itself establish inefficiency, poor prompts or task success.

Date, project, session and environment filters apply. A model filter disables these session-wide measurements: one conversation can span models. Sources without message metadata remain outside the measured sample. No missing measurement is converted to a known zero.

## Period comparisons

A bounded date range compares against the immediately preceding, equal-length calendar period using the same filters and definitions. All-time has no preceding period. Comparisons are withheld while broader history is loading, when either value is unknown, or when either period falls below these minimums:

- Interaction depth and returning: five counted conversations in each period.
- Agent activity: ten complete, finished prompts in each period.
- Guidance: ten prompts with known delivery in each period. The displayed rate uses all confirmed delivery prompts, including unknown labels, with coverage disclosed.

Both periods must have observed coverage within ten percentage points. For depth/returning, coverage is counted/observed sessions; for work it is complete/observed submissions; for guidance it is known-delivery/observed submissions. This is a comparability check, not proof of complete logs or identical tasks. The current day may be partial. Both denominators are retained in the UI and reviewer evidence; the review confidence cap uses the weaker period.

## Local examples and privacy

Explore conversations shows up to eight recent anonymous conversations, with at most sixteen observed prompt/stop events each. Events are sorted for display; their visual spacing does not represent elapsed time. Selection is bounded and not representative. Omitted counts are shown, and a chart bucket may have no matching retained example. The snapshot collects the first sixteen encountered events per conversation, not a complete transcript; stop and prompt processing order can affect which events are retained.

Only timestamps, delivery types, confirmed counts and eligible linked-call counts are retained for these examples. No prompt text, paths, names or raw session IDs are added. Missing/shared work is shown as unresolved. Linked work can extend beyond the selected dates. The examples never enter either AI-review export; the reviewer receives allowlisted aggregate measurements and comparison coverage only. Versioned guidance lives in `src/review-guides/v1/topics/prompts-sessions.md` (guide revision 1.1.3).

## Implementation and cost

`src/core/conversations.mjs` consumes the existing attributed prompt stream for both periods. `src/core/conversation-summary.mjs` shares comparison rules between dashboard and reviewer. `src/panel/conversations.mjs` renders only the selected view. Navigation and examples use the loaded report and never scan files, inspect context, fetch data or call AI.

A local synthetic check with 100,000 confirmed prompts, 10,000 sessions and two 30-day periods measured a median **24.7 ms** for the accumulator (five measured runs after warm-up, Node 24.22.1). Its serialized output was 8,966 bytes, including eight bounded examples. This measures in-memory aggregation only, not file scanning, full report generation or browser paint; it is not a guarantee for other machines. Synthetic regression tests cover attribution, coverage, filters, bounds, keyboard/focus behavior and reviewer privacy. Visual checks of narrow panels and both themes remain manual.
