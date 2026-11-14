# Copilot Usage Insights

A local usage dashboard for the **GitHub Copilot desktop app**. Open it as a canvas to explore token usage, recorded AI credits, activity, models, projects, and sessions.

## Install from GitHub

1. In Copilot desktop, open **Customize** and select the marketplace settings control next to the marketplace dropdown.
2. Add `https://github.com/AndrewGodlewsky/copilot-usage-insights` as a marketplace.
3. Find **copilot-usage-insights** on the Browse page and click **Install**.
4. Start a new session and ask **Open Usage Insights**.

This repository contains both the marketplace catalog and the plugin. Use the default `main` branch. If you previously used the personal installer below, move or remove `~/.copilot/extensions/usage-insights` before enabling the marketplace copy, so only one copy is loaded.

## Test it locally

Requires the GitHub Copilot desktop app with canvas support and Node.js 24 or later. There are no npm dependencies to install.

From this repository:

```sh
npm test
npm run install:local
```

Then start a **new session** in the Copilot desktop app and ask:

> Open Usage Insights.

The extension exposes `open_usage_insights`, which opens the dashboard in the right side panel. If a session predates installation, start a new one; if the app has not discovered the extension yet, restart the app. You can also look under **Customize → Installed** for the canvas.

The installer copies the extension into `~/.copilot/extensions/usage-insights` (or `$COPILOT_HOME/extensions/usage-insights`). Rerun `npm run install:local` after making changes, then use a new session. It replaces only a previous installation carrying this installer's marker. Settings are stored separately and survive upgrades.

To remove the local installation, close its sessions and delete that `usage-insights` directory. Do not install both the personal extension and its marketplace package at the same time.

## Browser preview

```sh
npm run preview:demo  # synthetic data
npm run preview       # your local Copilot usage
```

Open the printed localhost URL in your browser. Stop with Ctrl+C. A browser preview exercises the dashboard; the desktop app supplies the SDK for the actual canvas integration.

## What is counted

- Only requests attributed to GitHub Copilot in local records. Models used **through Copilot** appear regardless of their model vendor. Custom-provider and bring-your-own-key requests are excluded.
- Both desktop and CLI usage can appear when they share the same Copilot home. This is local recorded activity, not an account-wide billing report.
- Durable `session.usage_record` receipts from `session-state/*/events.jsonl` take precedence. The read-only `session-store.db` usage table is a fallback for sessions with no receipts. Checkpoints and session summary totals are not added again.
- Copilot input totals already include cache tokens. The dashboard separates cache reads and writes without counting them twice. Reasoning tokens are part of output and are not added again.
- **AI credits** use Copilot's recorded `totalNanoAiu` divided by one billion. No model-price estimates, dollar totals, remaining balances, or subscription limits are inferred. Missing charges show as unavailable; partial amounts and incomplete totals are marked.
- Date ranges use local calendar days. Activity and streak show filtered history; the daily chart and breakdown use the selected dates. Excluding cache changes token totals, not credit charges.

Use **Settings** to add mounted/copied Copilot homes or disable a home. Sources are scanned incrementally while the canvas is visible. **Refresh** forces a complete reread. Source diagnostics explain missing homes, unsupported schemas, and skipped records. Copilot's local event format and canvas APIs are experimental; app updates can require a reader update.

Settings live in `%LOCALAPPDATA%/copilot-usage-insights/settings.json` on Windows, `~/Library/Application Support/copilot-usage-insights/settings.json` on macOS, or `$XDG_CONFIG_HOME/copilot-usage-insights/settings.json` on Linux (default `~/.config`).

## Privacy and runtime

The extension reads local usage metadata and never modifies Copilot's records. Conversation text is discarded while parsing and is not retained in the in-memory usage index or sent to the dashboard. Nothing is uploaded. The canvas uses a random-token URL on `127.0.0.1`, validates request origins, and shuts down its server when the last canvas closes. Treat its URL as private while it is open.

## Development and distribution

```sh
npm run build  # regenerate the committed panel/index.html
npm test
```

The root `plugin.json` and `.github/plugin/marketplace.json` package this repository for distribution. The desktop extension entry is `com.github.copilot/extensions/usage-insights/extension.mjs`; the Copilot app provides `@github/copilot-sdk/extension` at runtime. Do not run that entry as a standalone Node process.

Local installation does not publish anything. The marketplace uses the files on the repository's default branch; the personal installer supports local development without a push.

See GitHub's [canvas documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions) and [plugin reference](https://docs.github.com/en/copilot/reference/plugin-and-marketplace-reference). Licensed under [MIT](LICENSE), with original copyright retained.
