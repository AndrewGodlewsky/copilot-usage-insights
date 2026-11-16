# SDK model reference implementation

Base: clean `origin/main` at 7579014 (v0.1.107), branch `codex/sdk-model-reference`. No other local edits included. No version bump, publication, installation, personal-log reads or paid inference.

1. Verify the installed joined-session RPC and public SDK declarations. Record where pricing units and cache/tier semantics cannot be established.
2. Add bounded, allowlisted public model/catalog normalization. Retain distinct missing, malformed, unsupported and zero pricing. Keep benchmark data independently validated.
3. Track exact raw model identity during the existing aggregation pass; never derive identity from a display label.
4. Reuse explicit catalog reads with account-scoped caching and coalescing. Keep live send checks authoritative and reject stale prepared references.
5. Freeze the complete first-pass prompt during preparation, including guidance, sampling policy and reference metadata. Preserve cancellation, expected-model checks and statistics-only fallback.
6. Exercise synthetic contracts, privacy, byte budgets, account/policy races, builder compatibility and 100,000-record overhead. Build the flattened panel, run all tests and diff checks. Document remaining live-host verification.

No hypothetical cost estimate will be produced without verified pricing units, cache-write billing semantics and compatible per-request tier measurements. Current prices never change recorded charges.

Completed: both builders and the actual prepare/copy/send path are integrated. Build and diff checks passed; 506 tests passed and one existing platform-specific test was skipped. The 100,000-record accumulator benchmark added about 2.58 ms on this machine. SDK calls were fixtures only; live-host and manual UI verification remain explicitly unperformed. Contract and limits are recorded in `docs/model-reference.md`.
