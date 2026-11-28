# Development and distribution

[Documentation index](../README.md) · [Project overview](../../README.md)

Build and release workflow, followed by possible future capabilities. Start with the [reviewer’s guide](../reviewing.md) for the source map and verification commands.

## On this page

- [Development and distribution](#development-and-distribution)
- [Test scope and performance](#test-scope-and-performance)
- [Possible next additions](#possible-next-additions)

## Development and distribution

```sh
npm run build  # regenerate the committed panel/index.html
npm test
```

Release summaries are maintained in [release-notes.json](../../release-notes.json), newest first. Follow the mandatory [agent release instructions](../../AGENTS.md) for every version bump or publication: write the short summary, synchronize versions, rebuild the canvas, and run the tests. The build rejects a missing current-version note, duplicate versions, or empty summaries. Families are derived automatically from each version's first two numbers. Historical notes describe changes at that release; later releases may supersede them.

The root `plugin.json` and `.github/plugin/marketplace.json` package this repository for distribution. The desktop extension entry is `com.github.copilot/extensions/usage-insights/extension.mjs`; the Copilot app provides `@github/copilot-sdk/extension` at runtime. Do not run that entry as a standalone Node process.

Local installation does not publish anything. The marketplace uses the files on the repository's default branch; the personal installer supports local development without a push.

See GitHub's [canvas documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions) and [plugin reference](https://docs.github.com/en/copilot/reference/plugin-and-marketplace-reference).
## Test scope and performance

`npm test` checks accounting, privacy, API contracts, and panel interactions. The shared panel fixture validates outgoing requests and serializes responses as JSON. A local HTTP smoke test connects the bundled panel to the real API; the remaining panel tests use a simulated DOM, so visual layout and host integration still need the manual checks in the [reviewer's guide](../reviewing.md).

The scale tests compare a large synthetic history against independently counted totals, check incremental scan reuse, and bound retained memory. Each test can run on its own, for example:

```sh
node --test --test-name-pattern="a history built up from appends" tests/scale.test.mjs
```

Run timing measurements separately from correctness tests:

```sh
node --expose-gc scripts/benchmark-performance.mjs --scale --records=30000
```

This benchmark measures cold scans, unchanged scans, appends, report building, and refreshes. Compare results on the same machine; the test suite does not enforce timing ratios that vary with machine load.

## Possible next additions

These are supported by Copilot event metadata but are **not implemented in this release**:

| Capability | What could be shown |
| --- | --- |
| Tool timing | Elapsed time when start and completion events can be paired |
| Subagents | Agent names, selected models, durations, and reported tool counts |
| Response performance | Recorded request duration and time to first token where available |

GitHub documents [skill, tool, and subagent events](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/streaming-events). Historical coverage depends on which events the app persisted. A configured MCP server is not evidence it was used. Session token totals cannot reliably be assigned to an individual skill or MCP call without explicit accounting links. Any further activity view should retain names and counts, without retaining tool arguments or output.
