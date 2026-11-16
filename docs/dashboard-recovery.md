# Dashboard connection recovery

## November 15, 2026 failure

The reported v0.1.93 dashboard loaded successfully at 8:46:59 PM EST, completed an AI review, and refreshed its usage at 8:47:35 PM. Requests then failed at the fetch stage in a few milliseconds, including repeated manual Refresh attempts. No API error response arrived.

Read-only inspection of the local runtime and host logs narrowed this down further: at 8:50:47 PM, Copilot propagated a plugin-generation change, refreshed the live session's extensions, and opened a replacement Usage Insights server. The original server process was no longer running. There was no recorded plugin exception or canvas-close event for that process. Windows process termination can bypass JavaScript exit handlers; the available evidence does not identify its exact termination mechanism.

The plugin defect was reproducible independently of that mechanism: each replacement extension chose a new random port and URL token. An existing renderer retained its original URL. Refresh only posted to that now-dead URL, so retrying could never reach the replacement.

## Recovery contract

- `src/node/canvas-endpoint.mjs` preserves the loopback port and random URL token for the same session, provider, and canvas instance. A replacement server binds the original address. Different sessions and instances remain isolated.
- The `canvas-endpoints` directory inside the plugin's configuration directory stores small private records: format version, port, and token only. Filenames hash the scoped identity; they do not contain session IDs. Records are published atomically without overwriting a concurrent opener. They are retained across extension disposal, and must not be included in issue reports because they contain access tokens. Explicitly closing the canvas removes its record, even after a failed open; reopening creates a fresh address.
- Startup waits up to five seconds for the previous listener to release the port. It never kills another process or silently switches addresses during an occupied-port handoff. An address still occupied after that window prevents that handoff and is logged as `EADDRINUSE`. Close/reopen resets that record so a different program taking the old port cannot permanently prevent opening the dashboard.
- Missing recovery-storage permissions or damaged metadata do not block a fresh dashboard; that instance falls back to a new private address and logs the recovery-storage failure. Its old renderer cannot be recovered automatically.
- Explicit Refresh retries only transport failures, at 0.5, 1, and 2 seconds. It keeps both refresh controls busy, retains existing matching data, and abandons a retry when filters change. HTTP/application errors are not retried. AI reviews and settings changes are never replayed. Automatic scans still run every 15 minutes while visible; no keepalive polling or changes to automatic scan cadence were introduced.
- Show logs includes the server process ID, endpoint restoration outcome, and client reconnect outcome, without logging ports, tokens, paths, or prompt content. Cached diagnostics remain clearly labeled as cached.

This repairs address changes when Copilot reopens the same canvas in a replacement extension. A web page cannot launch a stopped extension itself. If Copilot does not reopen the provider, or the endpoint cannot be reclaimed, the user still needs to reopen Usage Insights. Tabs created before v0.1.95 need one close/reopen after updating so their address can be registered.

## Verification

The address-replacement regression failed before the fix: the replacement returned a different port and token. It now passes, including a request sent to the original URL. A separate subprocess test forcibly terminates a synthetic server and verifies that a new process restores that URL. Other focused checks cover overlapping restarts, concurrent first opens, isolation, invalid metadata, unavailable storage, origin/token protection, retry limits, filter changes, and avoiding paid-action replay.

No real AI inference or desktop/browser automation is used by these tests. In-app verification still requires opening the updated dashboard, allowing a Copilot plugin reload, and clicking Refresh in the retained tab.
