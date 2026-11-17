# Journal integrity and refresh cost

Decision for [issue #7](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/7), 2026-11-17: **keep full consumed-prefix verification**. This follows the maintainer's instruction to preserve current capabilities. A tail-only or sampled check would weaken detection of changed historical charges; no such mode is enabled.

## Refresh behavior

The scanner retains parsed metadata and, for journals that may grow, a SHA-256 digest through the last complete line. An unchanged file reuses its snapshot. If the same file grows, the scanner reads and hashes the entire consumed prefix before parsing its new complete lines. A mismatch discards that parser state and rereads the whole journal. Truncation, a detected same-size rewrite, changed source context, or file replacement also causes a full reread. Partial final lines wait for their newline.

Cache identity now includes the filesystem device and file identifier as well as size, mtime and ctime. A regression reproduced reuse of a replaced journal when its reported size and timestamps matched the cached file; checking identity fixes that case. Workspace-name metadata uses the same identity check. Filesystem metadata is still a freshness mechanism, not a defense against a malicious same-user process that can forge every identity/timestamp. **Refresh** forces original-source rereading rather than trusting cached metadata.

This is not an atomic snapshot of a concurrently edited filesystem. An append arriving after a read starts can appear on the next scan. Tests verify that it remains available and is not double-counted. Cancellation checks occur between read chunks and close the handle. Invalid/missing/unreadable sources continue using the existing coverage and error behavior. No changes were made to charges, provider attribution, date filters, retention or event-validation coverage.

## Show logs

The existing `history.journals` and `history.vscode` diagnostic entries now include:

| Field | Meaning |
| --- | --- |
| `bytesHashed` | Additional bytes read to verify consumed prefixes |
| `prefixChecks` | Attempted full-prefix checks of growing journals |
| `prefixMismatches` | Completed checks that found changed content and required a full reread |
| `prefixCheckMs` | Sum of elapsed check times, including read waits |

These fields survive saved-log import, copying and Markdown download. Their descriptions appear in the load timing summary. Source numbers remain anonymous; the diagnostics do not contain journal paths, prompt text, names or hashes. Counts reset for each measured source/stage. Parallel file checks can overlap, so summed check time is **not** additional wall-clock time to add to the parent stage. An interrupted check may increment attempts without being a completed match or mismatch; consult source/error status as well.

## Measurements

Run from the repository root:

```powershell
node scripts/benchmark-journal-integrity.mjs
# Small fixture for a quick self-check:
node scripts/benchmark-journal-integrity.mjs --mib=1
```

The harness creates only synthetic temporary files, validates expected charges against a forced reread, emits structured measurements and removes its owned directory. It does not scan personal history or use Copilot/network services. Default file sizes are approximately 32, 256 and 1,024 MiB. Each contains one receipt followed by large ignored hook events; three sequential appends add one 232-byte receipt each. A final same-length edit changes the first charge, before the unchanged suffix, then appends another receipt.

Windows, Node v24.22.1, one local run on 2026-11-17:

| Approximate file size | Unchanged scan | Append scan, median of 3 (range) | Prefix check, median | Edited prefix + reread |
| --- | ---: | ---: | ---: | ---: |
| 32 MiB | 0.8 ms | 17.3 ms (16.7–17.3) | 15.6 ms | 45.8 ms |
| 256 MiB | 0.7 ms | 110.5 ms (110.0–111.7) | 109.0 ms | 353.9 ms |
| 1,024 MiB | 0.8 ms | 533.7 ms (519.4–542.4) | 531.9 ms | 1,609.6 ms |

These are file-verification measurements, not dashboard loading or throughput forecasts for a large number of receipts. Warm filesystem caching, disk, antivirus and concurrent work affect results. The earlier audit's 256 MiB measurements were approximately 130–137 ms; the new sample is not evidence of an algorithmic speedup, because full verification remains the same. Remote mounts and real WSL files were not benchmarked. A single large changed file has a measurable cost; unchanged files do not repeatedly pay it.

Tail sampling cannot prove an arbitrary old charge is unchanged. Cached block hashes still require rereading blocks to verify them unless a trusted change journal or equivalent freshness mechanism exists. File timestamps alone do not establish an append-only guarantee. Any future validated index must keep these limits explicit; see the separate [storage investigation](https://github.com/AndrewGodlewsky/copilot-usage-insights/issues/3).

## Regression coverage

`tests/journal-integrity.test.mjs` checks changed charges before a multi-chunk unchanged suffix, replacement with matching timestamps/size, same-size edits with restored mtime, truncation/regrowth, partial lines, copied logs, forced refresh, concurrent append and cancellation. It also checks that counters survive sanitized export without private sentinels. Existing source, VS Code, coverage and scale tests remain authoritative for complete accounting behavior.

The policy is resolved by retaining full verification, strengthening file identity and exposing its cost. No feature was removed and no weaker mode needs user configuration. The other audit decisions remain open.
