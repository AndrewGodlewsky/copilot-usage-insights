## Summary
- Closes #

## Release & quality checklist
- [ ] If shipping user-facing changes, bumped exact 3-part `MAJOR.MINOR.PATCH` version across all 4 manifests (`package.json`, `plugin.json`, `.github/plugin/marketplace.json`, `com.github.copilot/extensions/usage-insights/package.json`), prepended a `<= 400`-char user summary to `release-notes.json`, and updated `README.md` (see `AGENTS.md`)
- [ ] Ran `npm run build` and committed regenerated `panel/index.html`
- [ ] Ran `npm run validate:security`, `npm run validate:benchmarks`, and `npm test`
- [ ] Checked HTML escaping (`esc()`), privacy boundaries, and dark/light CSS parity
