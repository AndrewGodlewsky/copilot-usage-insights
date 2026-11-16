# Conversation depth

The user approved adding the proposed conversation-depth distribution and richer session insights to Efficiency → Worth a closer look → Conversation habits, and exposing the same measurements to AI review.

Use two complementary graphics: horizontal bars for sessions with 1, 2–5, 6–15 and 16+ confirmed user prompts; a three-by-three table shaded by session count, crossing prompts/session (1, 2–5, 6+) with average model calls/prompt (1, >1–5, >5). Include median and average prompt count, multi-day sessions and sessions with earlier recorded prompts. These are descriptive categories, not quality scores. Calls do not measure elapsed time, tasks, intent or outcomes.

Alternatives: one average hides the distribution; a per-session scatter plot exposes more data and is harder to read on narrow panels. The chosen aggregate bars and matrix reveal both human interaction and autonomous activity without new dependencies or identifiers in the review payload. Use the existing blue/teal theme accents, neutral surfaces, readable counts and semantic labels; stack the two graphics on narrow panels. No color-only encoding, animation or interaction required.

Reuse the existing deduplicated prompt attribution graph and in-memory snapshot. Count known human submissions independently of billing eligibility. Exclude sessions with ambiguous prompt identities from the distribution; show sessions with no confirmed prompts separately, not as zeros. Session identity is the session ID even if a project changes. Scope date/project/session/environment filters consistently; keep conversation-wide metrics unavailable under a model filter. Date windows count submissions in that window, not lifetime depth. Earlier activity is only recorded activity, never proof of the creation date.

The work grid requires every counted prompt in that session to have complete, finished accounting, including reliably linked child work. Group work before filtering dates, as existing prompt-cost accounting does. Show separate work-grid coverage. No additional scans, prompt reads or AI submissions. Supply bounded aggregate evidence using existing comparison/statistic/share card templates, and update the prompts/sessions review guide with interpretation limits. Keep optional excerpts, privacy and token budgets unchanged.

Follow the existing release workflow and version rules. No browser control, installed-copy edits or paid inference. Visual checks remain manual.
