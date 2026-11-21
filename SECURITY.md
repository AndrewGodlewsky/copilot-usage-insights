# Security, privacy, and stopping the plugin

Usage Insights runs local Node.js code with the permissions of the Copilot process. It is not a sandbox. Install it only from a maintainer/source you trust. The [dated security and performance review](docs/security-performance-review-2026-11-17.md) describes the reviewed boundaries, tests, and remaining limitations.

## What is installed

The plugin contains its JavaScript modules, a self-contained HTML dashboard, local AI review instructions, bundled model benchmark facts, and license notices. There is no npm dependency installation or install-time script that downloads executables. One third-party parser, **js-yaml 5.5.0**, is vendored; its reviewed hash and license are recorded in [security-dependencies.json](security-dependencies.json).

Copilot supplies the SDK, CLI helper, and Node runtime. Node includes SQLite. Optional system tools are GitHub CLI for account verification, `wsl.exe` for running WSL distributions, and their existing Python SQLite module for the WSL database fallback. The plugin does not install these tools. These host/system components need their own updates; `npm audit` does not cover them or vendored code.

Keep the operating system, WSL distributions, Python/SQLite, and GitHub CLI updated through their trusted installers or package managers as well. The plugin cannot patch those components for the user.

Marketplace installation may retain the repository checkout, including tests and documentation. The local installer copies only runtime directories and notices; it omits duplicate dashboard sources and guide examples. Neither method downloads benchmark data at runtime.

## Pause, disable, or update

1. Open **Settings → Plugin activity → Pause Usage Insights**. This setting persists. It blocks new history, inventory, context, model-catalog, and AI-review requests; Settings and Show logs remain available. Resume starts a fresh history read.
2. Pause cancels cancellable work owned by that dashboard and discards late results. Other open dashboards observe the setting on their next request. Local usage-database reads run in a disposable child that can be terminated; OS reads already running or bounded host operations may finish first. Pause does not erase source histories, recorded AI charges, diagnostics, or all SDK objects.
3. **For a suspected vulnerability, disable/remove the plugin through Copilot and fully restart Copilot.** That stops its processes; the in-plugin pause switch is an operational control, not a security boundary against already-compromised code. Do not edit or delete your Copilot usage history to stop the plugin.
4. Update Copilot for its SDK/runtime fixes and update the plugin from its trusted repository. Reopen it in a new Copilot session after updating. Settings shows a dated Node baseline check; meeting it is not a guarantee that no newer advisory exists.

The 2026-11-17 review used the [Node November 2026 security release](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases/): reviewed supported baselines are Node 24.22.3 and 26.13.1. Other branches are reported as unverified. This is an offline, dated comparison; it does not contact an advisory service. An older runtime is an update requirement, not proof that every listed upstream vulnerability is exploitable through this plugin.

## Data access and network boundaries

- Reads configured Copilot session journals/databases and supported VS Code logs; optionally discovers running WSL sources. Explicit extra source folders can be mounted/network locations. Only configure sources you trust. Original prompt text is read on demand for prompt details or an explicitly started AI review's targeted excerpts. Tool-call arguments are read only to count calls identical to an earlier one in the same conversation: a one-way keyed fingerprint (HMAC-SHA-256, a random key per journal parser, held in memory only) is compared and is gone when the dashboard process ends; no argument text or fingerprint is stored, logged or shown.
- Reads bounded skill headers for installed version labels. Explicit Context inspection and integration/model controls use the attached Copilot host. Merely refreshing usage does not launch AI inference.
- Serves the dashboard on `127.0.0.1` with an unpredictable per-server URL token, exact Host/Origin checks and a restrictive content policy. This protects against unrelated web origins, not another program running as the same user. Do not share the dashboard URL or endpoint metadata.
- Writes preferences, endpoint metadata, bounded structured diagnostics, and accounting for its own AI reviews. AI helper sessions use a separate usage/project identity. Temporary helper transcripts are normally cleaned after accounting; failed cleanup/accounting can leave them behind and is reported. See [AI review documentation](docs/ai-review.md).
- A user-started AI review sends the prepared statistics and selected bundled reference facts through Copilot. With targeted excerpts enabled (the default), a bounded follow-up may include private prompt text. Disable **Allow targeted prompt excerpts** for a statistics-only review. Aliasing statistics is not a guarantee that excerpts contain no secrets. The helper's tools, file access, skills, extensions, memory and MCP setup are disabled through SDK configuration; this isolation is not an OS sandbox.
- No telemetry upload or benchmark/pricing-site fetch is added. GitHub sign-in, catalog and inference use existing Copilot/GitHub connections. Repository/help/source links are ordinary user-activated external links.

On Windows, preferences, pause state, structured diagnostic files, and `canvas-endpoints` normally live under `%LOCALAPPDATA%\copilot-usage-insights`. Endpoint files contain the private loopback capability token and must not be shared. On macOS preferences use `~/Library/Application Support/copilot-usage-insights`; on Linux they use `$XDG_CONFIG_HOME/copilot-usage-insights` or `~/.config/copilot-usage-insights`.

Preferences use `settings.json`; explicit pause/resume choices use a separate atomic `pause.json` containing a JSON boolean. This prevents an older settings save in another dashboard from undoing a pause. An unreadable or malformed pause file blocks new source and AI activity instead of assuming the plugin is enabled. Disable the plugin and repair that local file if necessary; do not delete source histories. Separate processes observe changes on their next request, not through a cross-process cancellation signal.

Review accounting normally lives under `%LOCALAPPDATA%\copilot-usage-insights\usage` on Windows, or `~/.local/share/copilot-usage-insights/usage` when `LOCALAPPDATA` is absent. `USAGE_INSIGHTS_DATA_DIR` can override that base. Temporary review homes use the operating system's temp directory with a `usage-insights-review-` prefix. These are separate from the user's original Copilot histories; the scanner reads those histories without deleting or rewriting them.

## Reporting a vulnerability

Contact the repository maintainer privately for suspected security vulnerabilities. Use GitHub private vulnerability reporting if it is enabled on the repository. Do not post credentials, dashboard URL tokens, private prompts, full databases, or exploit-bearing personal logs in public issues. A minimal synthetic reproduction, plugin version, host/Node versions, expected boundary and observed behavior are useful. Structured Show logs exports are designed to omit raw prompt/path/account/error text, but review any attachment before sharing it.

## Maintainer routine

**Weekly and before each release:** review [Node security releases](https://nodejs.org/en/blog/vulnerability/), [Copilot SDK security information](https://github.com/github/copilot-sdk/security), [js-yaml advisories](https://github.com/nodeca/js-yaml/security/advisories), and GitHub Actions dependency updates. Dependabot proposes action updates; it does not audit vendored JavaScript, the host SDK, or Node. Check the oldest supported host runtime, not just your development Node.

**For a dependency update:** verify the primary source and license, compare the shipped artifact to the official distribution, review changes and advisories, update the version/hash/date in `security-dependencies.json`, and retain license notices. A hash is an integrity tripwire, not a malware or vulnerability detector. Review any new dependency or network permission explicitly. Update the dated baseline and its tests when security releases require it.

**Before merging/releasing:** run `npm run validate:security`, `npm run validate:benchmarks`, `npm run build`, `npm test`, and `git diff --check`. The build checks vendored integrity and pinned CI actions offline. Run the synthetic scale scripts after parser, attribution, cache, or report changes; retain before/after measurements and accounting invariants. Follow `AGENTS.md` for version manifests, release notes and the generated panel. Never test paid inference or personal histories as part of CI.

**On a credible advisory:** establish whether the affected path is reachable, provide pause/disable guidance while investigating, fix or remove the affected component, and release a plain-language notice stating affected versions and limitations. Keep the last known affected/fixed versions explicit. No automatic remote kill switch or unattended updater is implemented.
