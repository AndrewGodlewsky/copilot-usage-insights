# Copilot Usage Insights

A local usage dashboard for the **GitHub Copilot desktop app**. Open it as a canvas to explore token usage, recorded AI credits, activity, models, projects, and sessions.

## Install in GitHub Copilot desktop

Use the GitHub Copilot desktop app with canvas support, signed in to your GitHub account. The app installs the plugin from this repository; you do not need to clone it or run npm commands.

### 1. Add the marketplace

1. Open **Customize** in the Copilot app sidebar.
2. Select the **marketplace settings control** next to the marketplace dropdown.
3. Follow the prompts to add a GitHub repository or Git URL. Paste this repository URL:

   ```text
   https://github.com/AndrewGodlewsky/copilot-usage-insights
   ```

4. Complete the add-marketplace prompts. If asked for a branch, use **`main`**.

The marketplace name is **`copilot-usage-insights`**. This repository hosts its catalog at [.github/plugin/marketplace.json](.github/plugin/marketplace.json); the URL to enter in the app is the repository URL above.

### 2. Install and enable the plugin

1. Return to **Customize → Browse**.
2. Select the **copilot-usage-insights** marketplace.
3. Search for **`copilot-usage-insights`** and click **Install**.
4. Open **Customize → Installed** and make sure the plugin's toggle is **on**.

Adding the marketplace makes the plugin available to browse. Installing and enabling the plugin makes its canvas available to sessions. The marketplace and plugin both use the name `copilot-usage-insights`.

### 3. Open the dashboard

Start a **new session** in Copilot desktop and send:

> Open Usage Insights.

Copilot can call the plugin's `open_usage_insights` tool to open the dashboard in the right side panel. It reads local Copilot usage automatically. Use **Refresh** to reread the records or **Settings** to add other Copilot home folders.

### If it does not appear

- **Marketplace added, plugin missing:** check that the URL is the repository URL above and that the marketplace is included in the Browse filter. Adding the marketplace does not install the plugin automatically.
- **Plugin installed, canvas unavailable:** check the toggle under **Customize → Installed**, then start a new session. Restart Copilot if it has not picked up the installation.
- **Dashboard opens but is empty:** make a request in Copilot, then click **Refresh**. Expand **Local data sources** to check which folders were read. Only available local usage records are counted.
- **Previously used the personal installer:** move its `usage-insights` folder out of `~/.copilot/extensions` before enabling the marketplace copy. On Windows, the default folder is `%USERPROFILE%\.copilot\extensions\usage-insights`. Keep one installed copy so the same tool is not registered twice. If you set `COPILOT_HOME`, use that folder instead of `~/.copilot`.

These steps follow GitHub's [plugin and marketplace setup instructions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#adding-a-plugin-marketplace). Desktop installation and rendering still need an in-app smoke test; automated checks cover the package entry and dashboard backend.

## Local development (optional)

Use this path to test changes from a local checkout. It requires Node.js 24 or later in addition to the Copilot desktop app. There are no npm dependencies to install.

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
