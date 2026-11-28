# Installation and local development

[Documentation index](../README.md) · [Project overview](../../README.md)

Detailed setup, source coverage, troubleshooting, and local installation instructions. For the latest release and update steps, see [the README](../../README.md#update-an-existing-installation).

## On this page

- [Install in GitHub Copilot desktop](#install-in-github-copilot-desktop)
- [Local development (optional)](#local-development-optional)
- [Browser preview](#browser-preview)

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

The marketplace name is **`copilot-usage-insights`**. This repository hosts its catalog at [.github/plugin/marketplace.json](../../.github/plugin/marketplace.json); the URL to enter in the app is the repository URL above.

### 2. Install and enable the plugin

1. Open **Customize → Installed** and click **Add plugin**.
2. In the **Install plugin** dialog, paste this exact value into **Name**:

   ```text
   copilot-usage-insights@copilot-usage-insights
   ```

3. Click **Install**.
4. Make sure the plugin's toggle under **Customize → Installed** is **on**.

The Name field uses `plugin@marketplace`: the first part identifies the plugin and the second identifies the marketplace you added in step 1. You can also install it from **Customize → Browse** by selecting the **copilot-usage-insights** marketplace and searching for the plugin.

Adding the marketplace makes the plugin available to browse. Installing and enabling the plugin makes its canvas available to sessions. The marketplace and plugin both use the name `copilot-usage-insights`.

### 3. Open the dashboard

Start a **new session** in Copilot desktop and send:

> Open Usage Insights.

Copilot can call the plugin's `open_usage_insights` tool to open the dashboard in the right side panel. It reads local Copilot usage automatically. **Refresh** and **Settings** sit together at the right of the top toolbar and wrap together when space is limited. Use **Refresh** to reread the records or **Settings** to add other Copilot home folders.

The canvas tab is labeled **Usage Insights**. Copilot controls the tab width, icon spacing, and overflow fade; its plugin API does not expose settings for these. The title may fade near the close button when the host leaves too little room.
### WSL histories on Windows

**Include WSL usage sources (Windows)** is on by default in Settings. Running distributions are checked for standard `.copilot` homes and VS Code Server User storage. Receipts are combined with Windows usage using duplicate detection. Start any stopped distributions and click **Refresh**; **Local data sources** lists discovered homes and explains skipped or unreadable sources. Filters reuse the loaded history.

**Read locked usage databases inside WSL** is also on by default. If Windows gets a SQLite lock error, the plugin checks that the distribution is running, then uses its existing `/usr/bin/python3` and `sqlite3` module to read usage and session metadata in a read-only transaction. It installs nothing and makes no database copies. Missing Python, permissions, timeouts, or unsupported schemas leave a source warning while readable journals still count. Turn this setting off to disable the native fallback. Database rows remain a fallback only for sessions without journal receipts; this does not guarantee reconciliation with account billing.

For custom homes, use **Additional Copilot homes**, for example `\\wsl.localhost\Ubuntu\home\alice\.copilot`. Automatic discovery skips Docker Desktop and does not deliberately start stopped distributions. History from stopped distributions is not retained after a scan; custom paths remain explicit reads even if the automatic checkbox is off. See [WSL source coverage](../wsl-sources.md) for limitations, diagnostics, and verification steps.

### VS Code and environment filtering

**Include VS Code Copilot Chat** is on by default. The importer checks standard VS Code and Insiders User storage on Windows, macOS and Linux, plus accessible WSL VS Code Server storage. It includes calls with recorded Copilot charges, including zero-credit calls, and uses recorded input/output totals. Ordinary saved chats alone do not provide reliable billing history. Logging may need enabling in VS Code; older or deleted records cannot be recovered. [VS Code setup and coverage](../vscode-sources.md) explains the setting and custom User folders.

The menu immediately after **AI credits** starts at **All environments**. Select **Windows** or a discovered **WSL · distribution** to filter historical usage throughout the dashboard, including request expansions and activity. Changing environments clears model/project/session selections; date and cache preferences remain. Refresh preserves the selected environment, and **Reset filters** returns to All. Remote workspace metadata can identify WSL even when its logs are stored on Windows. A locally copied history without environment metadata is assigned to its storage host; it is not evidence of its original computer.

Source availability and skipped-record diagnostics describe all enabled sources. Installed plugins, live MCP connection status and explicit context inspection still describe the session hosting the dashboard; the environment filter does not remotely inspect another installation.

### If it does not appear

- **Marketplace added, plugin missing:** check that the URL is the repository URL above and that the marketplace is included in the Browse filter. Adding the marketplace does not install the plugin automatically.
- **Plugin installed, canvas unavailable:** check the toggle under **Customize → Installed**, then start a new session. Restart Copilot if it has not picked up the installation.
- **Dashboard opens but is empty:** make a request in Copilot, then click **Refresh**. Expand **Local data sources** to check which folders were read. Only available local usage records are counted.
- **Previously used the personal installer:** move its `usage-insights` folder out of `~/.copilot/extensions` before enabling the marketplace copy. On Windows, the default folder is `%USERPROFILE%\.copilot\extensions\usage-insights`. Keep one installed copy so the same tool is not registered twice. If you set `COPILOT_HOME`, use that folder instead of `~/.copilot`.

These steps follow GitHub's [plugin and marketplace setup instructions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app#adding-a-plugin-marketplace). Desktop installation and rendering still need an in-app smoke test; automated checks cover the package entry and dashboard backend.

## Local development (optional)

Use this path to test changes from a local checkout. It requires Node.js 24 or later in addition to the Copilot desktop app. There are no npm dependencies to install; the YAML parser is bundled with its license under `src/vendor/js-yaml`.

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
