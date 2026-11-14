# Efficiency mini dashboards

The user requested three Efficiency subviews using the existing segmented buttons. Implement directly in the existing dashboard; no extra framework, recorder, database, background inference, or pricing scraper.

- **Where did the tokens go?** (default): matched input/output, cached input, tool-definition overhead, current context inspection, and filtered tool outcomes. Distinguish built-in and MCP tools; session errors are recorded incidents, not failed model-call counts. No inferred wasted-token total.
- **Worth a closer look**: existing evidence/experiment cards, positive cache-reuse evidence, recorded user-message length and messages/session, root agent turns/session, current instruction-presence indication, and the existing model averages table, always visible. Length is not prompt quality. Session activity comes from durable journal metadata and follows date/project/session filters. Hide session-wide message measures under a model filter because messages cannot reliably be assigned to a model.
- **AI review**: explain the existing explicit preview/copy handoff, retain the bounded statistics snapshot and privacy defaults, and add interaction and tool outcome summaries. Do not classify work from raw prompts or automatically launch an agent.

## Data and limits

Count `user.message` only for root-agent user-origin messages, excluding injected sources, autopilot continuations, subagent messages, and replay checkpoints. Retain character counts (UTF-16 units), stable deduplication keys, timestamps, session/project context only. Count root `assistant.turn_start` by turn identity and root `session.error` by event identity. No prompt/error text, attachments, or transformed content leaves the parser. Reuse the existing incremental scanner. Averages use sessions with observed relevant events, not all sessions or an assumed complete transcript. A session may span outside the selected date range.

Pricing research: GitHub documents runtime catalog prices, but the installed extension joins a session whose supported API does not expose the server-level `models.listTokenPriceUnits`. Session `model.list` contains untyped mixed-provider entries; units must not be guessed. Link to [current Copilot pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing), retain measured credit averages, and defer a dynamic catalog until a supported unit-aware reader is available. No price values are stored.

The installed event contract defines `parentAgentTaskId` as telemetry correlation; it also occurs on ordinary root user messages and must not exclude those messages. Subagent filtering uses `agentId` and `parentToolCallId` instead.

## Validation and delivery

1. Add metadata extraction/filtering/privacy tests and implement scanner/report integration.
2. Reorganize HTML, add subview controls, outcome and session summaries, and update the review payload and README.
3. Exercise navigation without requests, refresh persistence, settings, empty/model-filtered data, escaping, and review privacy through the existing panel harness. Build and run the full suite.
4. Bump the release and push main under the user's continuing authorization. In-app visual testing remains with the user.

## Execution notes

Implemented the three local subviews and the metadata-only counters using the existing incremental scanner. A read-only local smoke check confirmed that ordinary user messages are represented without retaining their bodies. Independent review identified future-receipt attribution, explicit empty model-filter handling, and hidden exclusion coverage in the empty state; regression tests reproduce all three and the implementation now handles them.

Release validation: `npm run build`, all 127 tests in `npm test`, and `git diff --check` passed. No in-app visual testing was performed, as requested.
