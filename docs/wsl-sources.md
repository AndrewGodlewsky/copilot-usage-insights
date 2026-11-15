# Windows and WSL usage sources

## What this release adds

Windows and each WSL distribution have separate Copilot homes. Previously the dashboard automatically read the Windows home and plugin-owned receipt directories; a WSL home had to be added manually. That can explain missing sessions, tokens, and credits, but it does not prove that every difference from an account-wide total comes from WSL.

On Windows, **Include WSL Copilot CLI usage** is enabled by default. Initial loading and refresh enumerate registered/running distributions with `wsl.exe --list --quiet` and `--list --running --quiet`. For running distributions, discovery checks `.copilot` under `/home/*` and `/root`, then feeds readable homes into the existing scanner. No package is installed in Linux, no account credentials are read, and nothing is uploaded. Docker Desktop's internal distributions are skipped.

The scanner continues to read `session-state/<session-id>/events.jsonl` and its existing database fallback. Recorded Copilot provider attribution, token validation, and `totalNanoAiu / 1e9` credit accounting are unchanged. Identical receipt identities in copied journals count once. Distinct sessions remain distinct, and every existing date/project/session/model rule still applies. WSL path identity treats `wsl$` and `wsl.localhost` as aliases while preserving case below the distribution name.

Microsoft documents [WSL list commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands) and [Windows access to WSL files](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop). This integration uses that local filesystem bridge; it is not remote-machine synchronization.

## Limits and controls

- **Stopped distributions:** automatic discovery does not deliberately start them. Local data sources says their history is excluded. Start the distribution yourself and refresh. If it stops later, its totals are excluded on the next scan; this version does not persist a copied historical snapshot. A distribution can stop between enumeration and access; Windows controls mounting of the UNC path.
- **Custom homes:** add a Windows UNC path such as `\\wsl.localhost\Ubuntu\home\alice\custom-copilot` to **Additional Copilot homes**. Automatic discovery does not inspect shell startup files or guess custom `COPILOT_HOME` values. Nonstandard Linux home directories need the same manual setup.
- **Disable one home:** copy its displayed path into **Disabled Copilot homes**. A disabled explicit home is skipped before filesystem access. Disable the checkbox to stop automatic WSL discovery; explicitly configured homes are still read.
- **Unavailable sources:** unreadable homes or failed WSL discovery produce source warnings without discarding other readable histories. Linux `/root` is usually inaccessible to a non-root user; automatic discovery silently skips that permission denial. A root-only Copilot home can be added explicitly if appropriate and readable.
- **Performance:** two bounded list commands run only when history is scanned. Each has a three-second timeout. Metadata discovery has a three-second budget per distribution, four distributions at a time, with limits of 16 distributions and 64 home directories per distribution. Hitting a limit is reported. Discovery runs in a temporary process that exits after returning its result and is forcibly stopped after 17 seconds if necessary; timed-out UNC metadata reads cannot occupy the dashboard's filesystem worker pool. The helper uses Copilot's existing runtime, without requiring a separate Node installation. Actual journal parsing then uses the existing incremental reader; large WSL histories and slow filesystem access can still take longer than native disk, particularly if a distribution stops during a scan. Filters and expansions reuse history. There is no additional refresh timer.
- **Paths in skill records:** Linux skill paths are retained as recorded. Windows folder opening/version inspection does not translate those paths in this release; Linux-only installed versions can be unavailable. Request-log reads use the accessible discovered journal path.
- **Coverage:** absent/deleted logs and sessions that saved only summary totals cannot be reconstructed. The dashboard is not an account billing export.

## VS Code Chat: separate importer needed

Native VS Code Copilot Chat is **not imported by this release**, whether it runs locally or connects to WSL. A Copilot CLI session launched from VS Code can still be included when it produces the supported CLI history. Do not point Additional Copilot homes at a VS Code debug-log folder and expect it to work.

The [current Microsoft logger](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/chat/vscode-node/chatDebugFileLoggerService.ts) writes `debug-logs/<session>/main.jsonl` and separate child-session JSONL files under extension workspace storage, with a global-storage fallback. Its `llm_request` entries can include input/output counts, cached input, a response ID, and `copilotUsageNanoAiu`. Logging is configurable and retention is limited. Older logs need not contain all those fields.

A separate importer must establish:

1. Actual storage locations on the affected machine: VS Code's Windows client storage and WSL remote extension-host storage can differ. Inspect metadata and field names first, without collecting prompt text.
2. Copilot versus BYOK/custom-provider attribution for each request. A model name alone is insufficient evidence.
3. Identity overlap between VS Code debug spans and CLI receipts. The upstream logger also handles CLI sessions; importing both blindly risks double-counting.
4. Per-call versus cumulative charges, child sessions, request continuation links, unknown cache splits, and partial/rotated logs. Missing charges stay unavailable; never estimate them from a model price list.
5. Synthetic fixtures for each verified schema and overlap case before enabling automatic intake. No need to enable verbose logging or persist raw prompt-bearing logs merely to ship WSL discovery.

## Verify on the affected PC

1. Update the plugin and restart Copilot so its extension is current.
2. Start the WSL distributions containing CLI history and open the dashboard. Check **Local data sources** for `\\wsl.localhost\…\.copilot`, request/log counts, and warnings.
3. Compare an individual known CLI session in Breakdown with its originating environment. Check a fixed date range before and after disabling WSL discovery; the difference should correspond to those WSL receipts.
4. If a home is missing, run `wsl --list --verbose` yourself and check the CLI's actual Copilot-home path, then add its UNC equivalent. Do not share whole session logs; exported diagnostics and source states are the first useful evidence.

Local development validation used synthetic CLI histories and mocked WSL discovery. This development PC has only a stopped Docker Desktop distribution, so live cross-filesystem scanning and other-computer totals still require user verification.
