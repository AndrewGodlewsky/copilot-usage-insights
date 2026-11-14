# Copilot token overview

The user wants the prominent token summary from the supplied screenshot, scoped to GitHub Copilot. Reuse the existing report and chart components: a large total with request/session counts, six input/output/cache statistics, the daily chart alongside, and a horizontal token-type bar underneath. Retain the current system font, dark/light themes, and blue input (#3987e5), orange output (#d95926), green cache-read (#199e70), and gold cache-write (#c98500) colors. Stack the summary and chart on narrow screens.

Use the existing daily stacked chart because it exposes the same token categories as the summary. An additional provider comparison would add no information for this Copilot-only dashboard. Consolidate the old total tiles and token-mix card into this overview instead of repeating them.

Input including cache is distinct from uncached input. Cache reads and writes are subsets of inclusive input, not additional charges. Keep the cache filter, mark partial counts, and show unavailable rather than zero for missing data. Do not estimate dollar savings. Add availability tracking for inclusive input so this newly visible number follows the existing missing-data rules.

Research skill and MCP capabilities separately; this release adds the requested token overview. Document feasible activity features and their limits without claiming they are implemented. The installed SDK declares `skill.invoked`, tool execution metadata with MCP server/tool names, and subagent events. The current local history contains no skill/tool events to validate an activity screen against.
