# Token type order and percentage callouts

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

Use Uncached input → Cache read → Cache write → Output in the Usage token-type bar and its legend. Place input with an unknown cache split before Output when present. Keep reasoning within Output to avoid counting it twice. This is an input-to-output reading order, not an execution timeline.

Add alternating top/bottom percentage labels with brackets and leaders to their segments. Space labels independently of the minimum-width segments so clustered tiny shares do not collide, and clamp them within the chart at all three text sizes. Compute shares from recorded token counts, never from visual widths; show `<0.1%` for tiny positive shares. Keep the existing counts and hover details. Include type/share information in the chart's accessible label.

Reuse the selected-day and current-filter scope, existing SVG builder, colors, and text sizing. Keep other charts and accounting unchanged. Verify order, selected-day/cache filtering, incomplete split handling, percentage math, empty/zero data, and narrow/large-text layouts with focused tests; then build, review, update README/version, and publish to main.
