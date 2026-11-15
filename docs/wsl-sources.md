# Windows and WSL usage sources

## What this release adds

Windows and each WSL distribution have separate Copilot homes. Previously the dashboard automatically read the Windows home and plugin-owned receipt directories; a WSL home had to be added manually. That can explain missing sessions, tokens, and credits, but it does not prove that every difference from an account-wide total comes from WSL.

On Windows, **Include WSL usage sources (Windows)** is enabled by default. Initial loading and refresh enumerate registered/running distributions with `wsl.exe --list --quiet` and `--list --running --quiet`. For running distributions, discovery checks `.copilot`, `.vscode-server/data/User` and `.vscode-server-insiders/data/User` under `/home/*` and `/root`, then feeds readable homes into the existing scanner. VS Code storage can be discovered without a CLI home. No package is installed in Linux, no account credentials are read, and nothing is uploaded. Docker Desktop's internal distributions are skipped.

The scanner continues to read `session-state/<session-id>/events.jsonl` and its existing database fallback. Recorded Copilot provider attribution, token validation, and `totalNanoAiu / 1e9` credit accounting are unchanged. Identical receipt identities in copied journals count once. Distinct sessions remain distinct, and every existing date/project/session/model rule still applies. WSL path identity treats `wsl$` and `wsl.localhost` as aliases while preserving case below the distribution name.

Microsoft documents [WSL list commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands) and [Windows access to WSL files](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop). This integration uses that local filesystem bridge; it is not remote-machine synchronization.

## Limits and controls

- **Stopped distributions:** automatic discovery does not deliberately start them. Local data sources says their history is excluded. Start the distribution yourself and refresh. If it stops later, its totals are excluded on the next scan; this version does not persist a copied historical snapshot. A distribution can stop between enumeration and access; Windows controls mounting of the UNC path.
- **Custom homes:** add a Windows UNC path such as `\\wsl.localhost\Ubuntu\home\alice\custom-copilot` to **Additional Copilot homes**. Automatic discovery does not inspect shell startup files or guess custom `COPILOT_HOME` values. Nonstandard Linux home directories need the same manual setup.
- **Disable one home:** copy its displayed path into **Disabled source folders**. A disabled explicit home is skipped before filesystem access. Disable the checkbox to stop automatic WSL discovery; explicitly configured homes are still read.
- **Unavailable sources:** unreadable homes or failed WSL discovery produce source warnings without discarding other readable histories. Linux `/root` is usually inaccessible to a non-root user; automatic discovery silently skips that permission denial. A root-only Copilot home can be added explicitly if appropriate and readable.
- **Performance:** two bounded list commands run only when history is scanned. Each has a three-second timeout. Metadata discovery has a three-second budget per distribution, four distributions at a time, with limits of 16 distributions and 64 home directories per distribution. Hitting a limit is reported. Discovery runs in a temporary process that exits after returning its result and is forcibly stopped after 17 seconds if necessary; timed-out UNC metadata reads cannot occupy the dashboard's filesystem worker pool. The helper uses Copilot's existing runtime, without requiring a separate Node installation. Actual journal parsing then uses the existing incremental reader; large WSL histories and slow filesystem access can still take longer than native disk, particularly if a distribution stops during a scan. Filters and expansions reuse history. There is no additional refresh timer.
- **Paths in skill records:** Linux skill paths are retained as recorded. Windows folder opening/version inspection does not translate those paths in this release; Linux-only installed versions can be unavailable. Request-log reads use the accessible discovered journal path.
- **Coverage:** absent/deleted logs and sessions that saved only summary totals cannot be reconstructed. The dashboard is not an account billing export.

## VS Code Copilot Chat

Version 0.1.78 also imports attributable recorded VS Code debug receipts from standard Windows and accessible WSL User storage. Ordinary saved chats do not provide complete accounting, and debug logging may need enabling. Read [VS Code setup and coverage](vscode-sources.md) for supported paths, the logging setting, duplicate precedence and unavailable metrics.

The **All environments** menu beside AI credits filters historical usage by Windows or a discovered WSL distribution. Both CLI and VS Code sources in that environment are included. Current host inventory and context inspection remain separate from historical usage filtering.

## Verify on the affected PC

1. Update the plugin and restart Copilot so its extension is current.
2. Start the WSL distributions containing CLI history and open the dashboard. Check **Local data sources** for `\\wsl.localhost\…\.copilot`, request/log counts, and warnings.
3. Compare an individual known CLI session in Breakdown with its originating environment. Check a fixed date range before and after disabling WSL discovery; the difference should correspond to those WSL receipts.
4. If a home is missing, run `wsl --list --verbose` yourself and check the CLI's actual Copilot-home path, then add its UNC equivalent. Do not share whole session logs; exported diagnostics and source states are the first useful evidence.

Local development validation used synthetic CLI histories and mocked WSL discovery. This development PC has only a stopped Docker Desktop distribution, so live cross-filesystem scanning and other-computer totals still require user verification.
