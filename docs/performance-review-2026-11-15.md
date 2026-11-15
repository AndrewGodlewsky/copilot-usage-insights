# Dashboard opening performance review

The dashboard waited for live plugin/MCP inventory before displaying usage, even though the usage report did not depend on it. Version 0.1.70 separates those operations. It also reuses number formatters and avoids generating hidden Overview/Cache detail views.

The latest Efficiency content added measurable rendering work, but local measurements did not reproduce a multi-second regression from that change alone. The inventory dependency and repeated formatter construction existed before 0.1.69. Actual Copilot canvas startup and browser paint were not measured; no browser or desktop automation was used.

## Evidence

Measured on the development Windows machine. These are controlled comparisons, not promises for another machine or a complete end-to-end Copilot opening time.

| Check | Before | After / comparison | Meaning |
| --- | ---: | ---: | --- |
| Usage API readiness with an injected 1,000 ms inventory delay | 1,020 ms (0.1.68) | 17 ms (0.1.70) | Slow inventory no longer blocks the usage response. |
| 20,000 number/credit formats | 274 ms (0.1.68) | 19 ms (0.1.70) | Reusing locale formatters avoids repeated construction. Output precision is unchanged. |
| Panel JavaScript, median of 10 Usage/Efficiency switches with 583 fixture records | 5.7 ms (0.1.68), 7.2 ms (0.1.69) | 2.2 ms (0.1.70) | One-off VM harness runs the bundled panel against a simulated DOM; excludes layout and paint. |
| Real local report, 35 usage records across 10 logs | 2.8 ms (0.1.68) | 3.0 ms (0.1.69) | Recent content did not materially increase report calculation time for this history. |
| Real local initial / unchanged file scan | 237 / 176 ms (0.1.68) | 248 / 181 ms (0.1.69) | Scanner code was unchanged; these small differences can be filesystem/CPU noise. |
| Synthetic whole-history report calculation | About 30 ms at 1,000 records; 120–170 ms at 5,000; 310–375 ms at 10,000 | No report-algorithm change in this release | Whole-history attribution and grouping remain a scaling cost. Runs vary with warm-up and GC. |

A later configured-source run measured 187 ms initial scan, 120 ms unchanged scan, 2.4 ms installed-skill version reads, and 1–2 ms report calculations. These values illustrate variability, not an improvement to scanner code.

## Changes and safeguards

- `usage.report` returns usage and historical MCP calls without waiting for live inventory. `usage.inventory` reads passive host metadata separately; it makes no model request.
- Pending inventory cannot hide usage or keep Refresh disabled. Loading and unavailable states are scoped to inventory. Explicit/automatic refresh requests queue one follow-up inventory read if needed; filter changes do not add host reads.
- Late inventory results merge into the latest filtered history. They do not overwrite current filters or add duplicate MCP call counts. Open details and keyboard focus survive updates; a removed server returns focus to MCP sorting.
- Locale formatter instances are cached by options, with a maximum of 32 entries. Small nonzero credit precision and full/simplified formatting retain their existing behavior.
- Dedicated token Overview/Cache detail markup is generated when that section is selected, then refreshed when visible. Section selection and explicit context inspection behavior remain unchanged.
- No database, additional log source, paid AI call, or persistent usage cache was introduced. Accounting and attribution calculations are unchanged.

## Wider sweep and remaining costs

| Area | Finding / next step if measured slow |
| --- | --- |
| First history scan | Reads all enabled logs before filtering. A safe date index would need to handle copied logs, corrections, spanning sessions, and incomplete prompt chains. Keep correctness; use `history.scan` timing to justify a separate indexing change. |
| Incremental scans | Reuse parsed records for unchanged logs. Appended-file prefix validation still reads previous bytes to detect rewrites. Removing that validation could silently miscount corrected history. |
| Prompt attribution and report grouping | A synthetic CPU profile identified prompt-credit grouping as a leading cost. It intentionally groups before date/model filters. A future snapshot-level attribution cache must invalidate on every relevant event change, including completions and parent links. |
| Session names / source settings | Read current metadata so renames and enabled-home changes take effect. Do not indefinitely cache these for a small speed gain. |
| Installed skill versions | Bounded reads of current skill files, serially per unique path, still block the report. Local time was 2.4 ms. Many skills or remote paths may cost more; inspect `skills.versions` before introducing concurrency or caching. |
| Other hidden UI | Some top-level panels still render on report changes. Formatter reuse reduces this cost; broader lazy rendering would require focus/refresh coverage across all tabs. Only the newly duplicated token details were changed here. |
| Prompt details | Local prompt text is read only when a user expands a request. It is not part of opening the dashboard. |
| AI Review / context inspection | AI runtime, authentication/catalog work, and model calls remain explicit actions. Context inspection is also explicit. Neither runs automatically on dashboard startup. |
| Refresh | Automatic refresh stays at 60 seconds while visible, plus returning to the page. Explicit Refresh intentionally forces a reread. |
| Host and paint | Copilot canvas startup, SDK host latency, browser layout, and paint need an actual manual run. Server/VM timing does not capture them. |

## Reproducing measurements

From the repository root, using its supported Node version:

```text
node scripts/benchmark-performance.mjs
node scripts/benchmark-performance.mjs --startup
node scripts/benchmark-performance.mjs --format
node scripts/benchmark-performance.mjs --local
```

The default synthetic fixture uses real parser/report code at 1,000, 5,000, and 10,000 records, with all-history, Today, 7-day, and model-filtered reports. Each prompt has one complete charged model call; this is a repeatable comparison, not a simulation of every real history shape. `--startup` injects a one-second inventory delay into the real local HTTP server. `--format` renders 20,000 numeric values. Add `--repo=<absolute checkout path>` to compare another compatible checkout using the same script.

Only `--local` reads personal usage sources. It respects enabled/disabled homes and optional SDK receipt directories, and prints counts/timings without names, paths, IDs, or prompt content. Run repeated samples and compare the same history and machine; filesystem cache, warm-up, and other workloads affect results.

Regression coverage includes slow inventory, filter changes during a pending read, coalesced refreshes, inventory failure, focus restoration, deferred token details, formatter reuse, and existing accounting tests. Release validation requires `npm run build` and `npm test`.

If opening still feels slow, manually reopen the updated plugin and copy **Show logs** while it is still open. Compare `history.scan`, `report.build`, `skills.versions`, `inventory.read`, `api.request`, and `ui.render`. A slow inventory should now affect only live inventory availability. A delay before `ui.started` cannot be diagnosed from the dashboard's own timestamps.
