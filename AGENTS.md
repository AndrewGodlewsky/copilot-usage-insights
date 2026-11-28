# Versioning and release notes

Because GitHub Copilot desktop installs marketplace plugins directly from `main` and relies on the plugin version to detect updates, **every push or merge to `main` that ships user-facing features, fixes, or behavior changes MUST bump the plugin version** using 3-part semantic versioning (`MAJOR.MINOR.PATCH`; skip a bump only for docs-only or internal-only changes that do not affect the shipped plugin).

For every version bump or published release:

1. Bump the exact 3-part `MAJOR.MINOR.PATCH` version and keep it synchronized in `package.json`, `plugin.json`, `.github/plugin/marketplace.json`, and `com.github.copilot/extensions/usage-insights/package.json`.
2. Add an entry at the top of [release-notes.json](release-notes.json) with that exact `version` and a `summary`. Retain all older entries in newest-first order.
3. Write the summary for users: one or two short, plain-language sentences explaining the visible change or fix and why it helps. Keep it a single paragraph of at most 400 characters. Describe changes actually included in that release; omit implementation details, commit hashes, and screenshots.
4. Update the README's installation-update paragraph, run `npm run build` and `npm test`, and include the regenerated `panel/index.html` in the release commit. The release is ready only when these checks pass and its summary appears in the bundled release history.

The footer release browser reads the notes embedded by the build. Writing a changelog elsewhere alone does not update that panel. The build requires a current-version note; keep that check enabled.
