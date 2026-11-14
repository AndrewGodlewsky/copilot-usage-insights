# MCP servers and plugin inventory implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Tool activity with MCP Servers, add a current Plugins inventory, and install a harmless local MCP test server.

**Architecture:** Keep existing local usage parsing and attribution. Aggregate recorded MCP calls by server. Read current MCP configuration/status and plugin inventory through the already joined Copilot session's passive SDK methods. Merge only display metadata into the report; unsupported or failing inventory reads cannot hide usage.

**Tech Stack:** Existing Node 24 ESM, native HTTP, plain HTML/CSS/JavaScript, node:test. No new dependency or history database.

**Spec:** User approved the MCP recommendation in the conversation: Server, Current status, Calls, Failures, Success rate, Last used; expandable source/plugin and error details. Plugins show name, installed version, enabled state, marketplace, and managed state. Both inventories reflect the current session/account, not a historical snapshot.

## Global constraints

- Date/project/session/model filters continue to apply to recorded calls; live state and installed plugins are independent of those filters.
- Only passive `session.rpc.mcp.listConfigured()` and `session.rpc.plugins.list()` inventory reads. Never start/restart/authenticate servers to populate the dashboard.
- Missing outcomes stay unknown; success rate excludes them. No uptime, connection-failure-rate, or historical plugin-version claims.
- Preserve privacy, request accounting, skill statistics, folder actions, proportional text sizing, wrapping, dotted dividers, and canvas disposal.
- User tests the desktop UI; no computer-use testing. Push the finished release to main and update README.
- Test server is optional/local, never automatically installed for plugin consumers. Its greeting and deliberate failure have no filesystem/network side effects.

## Review focus

- Unsupported/rejected/slow SDK methods must not stall or fail the dashboard.
- Same-name MCP history without current configuration must never imply a live connection.
- Disabled/managed/not-installed plugin records must be represented truthfully.
- Untrusted names, errors, and metadata must be escaped, bounded, and wrap.
- The test setup must preserve existing Copilot configuration and create real calls rather than invented usage receipts.

## Tasks

- [x] Add regression tests for MCP-only aggregation, filters, unknown outcomes, inventory failure isolation, and plugin normalization.
- [x] Implement the shared MCP report and bounded passive inventory reader; wire it through the existing canvas/server.
- [x] Replace the table, add Plugins, preserve accessible details and layout, and verify rendered output with the existing panel harness.
- [x] Add and protocol-test a dependency-free stdio MCP test server; install its local configuration and exercise real Copilot calls if the local runtime permits.
- [x] Update README, bump manifests, build, run the complete suite, and resolve focused independent review findings before committing and pushing main.

## Verification notes

- Build and all 81 tests passed. MCP and Plugins rendering tests failed before implementation and passed afterward; optional test server negotiation failed before the server existed and passed afterward.
- Independent review found a connection-error credential-redaction gap. A regression reproduced the leak before the fix and now verifies quoted credential fields, command arguments, and authentication headers are redacted while ordinary errors remain readable. No other Critical or Important findings were reported.
- Compared the report against the previous release with local data across one-day, seven-day, and all-time filters: existing token, skill, and session results are unchanged.
- Installed the optional server locally through Copilot's supported MCP command. Copilot produced three real calls: two successes and one intentional failure, parsed as 66.7% success. No synthetic receipts were written.
- Actual bundled SDK returned the test server as connected with tools loaded, and returned real installed plugin versions/enabled states. No desktop UI automation was used.
