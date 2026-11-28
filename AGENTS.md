# Versioning and release notes

Because GitHub Copilot desktop installs marketplace plugins directly from `main` and relies on the plugin version to detect updates, **every push or merge to `main` that ships user-facing features, fixes, or behavior changes MUST bump the plugin version** using 3-part semantic versioning (`MAJOR.MINOR.PATCH`; skip a bump only for docs-only or internal-only changes that do not affect the shipped plugin).

For every version bump or published release:

1. Bump the exact 3-part `MAJOR.MINOR.PATCH` version and keep it synchronized in `package.json`, `plugin.json`, `.github/plugin/marketplace.json`, and `com.github.copilot/extensions/usage-insights/package.json`.
2. Add an entry at the top of [release-notes.json](release-notes.json) with that exact `version` and a `summary`. Retain all older entries in newest-first order.
3. Write the summary for users: one or two short, plain-language sentences explaining the visible change or fix and why it helps. Keep it a single paragraph of at most 400 characters. Describe changes actually included in that release; omit implementation details, commit hashes, and screenshots.
4. Update the README's installation-update paragraph, run `npm run build` and `npm test`, and include the regenerated `panel/index.html` in the release commit. The release is ready only when these checks pass and its summary appears in the bundled release history.

The footer release browser reads the notes embedded by the build. Writing a changelog elsewhere alone does not update that panel. `scripts/build.mjs` validates manifest sync, release-note formatting, README version parity, and bundle syntax; keep those checks enabled.

---

# Repository architecture

The codebase is split into three strict layers:

- **`src/core/`** — Pure, deterministic analytics, report aggregation, query filtering, formatting, and schema helpers shared by both Node and the browser panel. **Must stay free of Node built-in imports** (`node:*`, `fs`, `path`, etc.).
- **`src/node/`** — Host-side filesystem discovery, isolated SQLite child-process readers, WSL/VS Code log scanners, Copilot SDK helpers, and the localhost HTTP canvas server (`canvas-server.mjs`).
- **`src/panel/`** — Self-contained HTML, CSS, and ES modules rendered into a single offline document (`panel/index.html`) by `scripts/build.mjs`. Zero runtime network or external CDN dependencies.

---

# Hard invariants

- **HTML escaping & privacy**: Pass all untrusted names, model IDs, skill/tool names, session titles, and AI review prose through `esc()`. Never expose raw prompt text, file paths, or secrets in `buildEfficiencyReview` or cached summaries.
- **Single-scope panel bundle**: `scripts/build.mjs` strips `import`/`export` lines from `PANEL_MODULES` and concatenates them into one IIFE. Avoid generic top-level helper names (`fmt`, `rows`, `value`, etc.) in `src/panel/*.mjs` so modules never collide in the flattened bundle.
- **AI review guidance budget**: The combined text of `src/review-guides/v1/core.md` plus all topic files under `src/review-guides/v1/topics/` must stay **at or below 8,192 bytes** (enforced by `tests/review-insights.test.mjs`).
- **Opt-in live actions**: Never auto-invoke `efficiency.context` (live conversation inspection) or `review.analyze` (AI review inference) on dashboard load or refresh. Both must remain explicitly user-triggered.
- **Zero-complexity data rule**: Prefer deriving new Efficiency insights from fields already collected in `report` rather than adding new background scans or host dependencies unless explicitly requested.

---

# UI and CSS conventions

- **Theme tokens & parity**: Use existing CSS custom properties (`--bg`, `--card`, `--muted`, `--border`, `--fg`, `--muted-fg`, `--review-accent`, `--text-scale`) and verify both dark default and `html.light` overrides.
- **Typography & numbers**: Use `font-variant-numeric: tabular-nums` on figures and tables, round display percentages to at most 1 decimal place where appropriate, and keep small labels in sentence case.
- **Controls & status indicators**: Prefer quiet semantic badges/dots and crisp inline SVGs over raw OS emojis for status or action controls. Respect `@media (prefers-reduced-motion: reduce)`.

---

# Git and GitHub conventions

- **Remotes**: `origin` is `AndrewGodlewsky/copilot-usage-insights` (the active plugin repo) and `upstream` is `Etherll/orca-usage-insights`. Always pass `--repo AndrewGodlewsky/copilot-usage-insights` to `gh` commands so issues/PRs never target `upstream`.
- **Verification before pushing**: Always run `npm run build`, `npm run validate:security`, `npm run validate:benchmarks`, and `npm test`, and ensure `panel/index.html` is clean and up to date (`git diff --exit-code panel/index.html` after build).
