# Review guidance

These are plugin-owned instructions, not automatically discovered SDK skills. The helper's tools, skill discovery and filesystem access stay disabled. The app reads only the active manifest's fixed local files and sends core guidance plus the topics present in the frozen evidence (maximum 8 KiB). Examples are authoring fixtures, not appended to requests.

To improve a review, edit the relevant topic, explain an observable signal, alternatives and a reversible experiment. Add a positive example and a misleading-counterexample case in `examples.json`. Never turn a correlation into a diagnosis or invent measurement coverage. The [research](../../docs/research/2026-11-14-efficiency-inference.md) explains these boundaries.

Bump `manifest.json`'s guidance version whenever model-facing instructions change. Keep evidence and response schema names compatible with `src/node/review-insights.mjs`; a different bundle/schema requires an explicit application change and tests. No downloaded or user-provided file paths are accepted.

Run `node --test tests/review-insights.test.mjs tests/review-evidence.test.mjs tests/review-samples.test.mjs`, then the build/full suite. For model-quality evaluation, use synthetic examples and record whether the output distinguishes measurements, hypotheses and alternatives. Passing structural tests does not prove recommendation quality. Real model evaluation consumes credits and must be intentionally run. Guidance revision appears with each result to support comparison across releases.
