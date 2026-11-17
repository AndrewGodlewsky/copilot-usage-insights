# Conversation Habits focused view implementation plan

> Execute inline using the approved focused mockup (option B). Preserve the existing startup and reviewer-settings work on `fix/canvas-startup`.

**Goal:** Replace the crowded Conversation Habits panel with four focused questions, real distributions, coverage-aware comparisons, and bounded conversation examples.

**Architecture:** Extend the existing in-memory conversation accumulator, keeping financial attribution unchanged. Render one question at a time in the existing panel with delegated events; selection never scans files or calls AI. Explicit review preparation receives allowlisted aggregate evidence, never the local example timelines.

**Approved design:** Option B from `conversation-habits-options-83c7.html`: Your interactions, Agent activity, Guidance & stops, Returning to chats. Large measure and chart side by side; comparison and expandable explanations below. Responsive single column on narrow panels, blue dark-theme / teal light-theme accent, keyboard-accessible controls. The user approved implementation on November 16.

**Constraints:** No browser automation, installation, publication, dependencies, or version bump. Example data from the mockup must never enter the product. No inference that short sessions, steering, stops, or many calls imply poor results. Dates count submissions within the selected window, not lifetime task duration. Keep current model-filter behavior.

## Tasks

- [x] Extend `src/core/conversations.mjs` and tests: confirmed human delivery can establish depth independently of separate billing links; distributions of complete prompt work, days used, steering concentration; preceding equal-length calendar period; bounded anonymous examples from metadata. Keep incomplete work out of call averages, and preserve provider/project/session/environment scope and deduplication. Add stop timestamps in `prompt-credits.mjs` for local timelines only.
- [x] Replace `src/panel/conversations.mjs`, its CSS, and the habits markup with the focused view. Keep topic buttons outside the changing content; retain topic, focus, and expanded details through refresh. Remove the old redundant metric strip and historical/current instruction mix. Reuse the existing skills/context inspector route.
- [x] Add aggregate review evidence and guide/documentation updates. No example names, timestamps, messages, or paths in the review export. Comparisons require adequate samples and similar observed coverage, and remain unavailable while history loads.
- [x] Add focused synthetic data and panel tests, measure a 100,000-prompt accumulator case, run `npm run build`, `npm test`, and `git diff --check`; review the change without browser control.

## Review focus

- Shared billing groups must increase confirmed message depth without becoming separately cost-eligible.
- Unknown delivery and incomplete billing must remain unknown, not zero or a failure.
- All-time/empty/sparse/partial-history views must not manufacture a comparison.
- Topic navigation, keyboard focus and disclosures must survive refresh and filtering without new requests.
- Example output must be bounded, safely rendered, and excluded from AI evidence.

## Verification record

Implemented and independently reviewed. npm run build passed; npm test: 540 passed, 1 skipped (541 total); git diff --check passed. Focused coverage includes shared-run depth without billing changes, complete work and coverage denominators, both-period confidence limits, bounded/private examples, local navigation, arrow navigation from focused buttons, refresh focus restoration and filter persistence. A 100,000-prompt accumulator check measured median 24.7 ms after warm-up; this excludes scans and browser paint.

Existing startup/default-model edits were preserved. No plugin version bump, installation, publication, paid inference, personal-log access or browser automation. Native visual checks in light/dark themes and narrow panels remain for the user.

## Publication follow-up

After reviewing the focused view, the user authorized publication. Release 0.1.109 combines this feature with the pending canvas startup improvements and Sonnet 5.5/high reviewer defaults. Its synchronized manifests, bundled release notes, build, 540 passing tests (one skipped), and whitespace checks were verified before publishing to the marketplace's main branch. No local plugin installation is part of publication.
