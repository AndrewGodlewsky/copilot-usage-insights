# AI review desktop animation

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

Approved: the user chose and approved the miniature desktop prototype, then requested more variations and implementation. The paper reviewer and abstract pattern finder alternatives were not selected.

Keep the prototype's monitor, folder, blue cursor, quiet desk details and short movements separated by pauses. Replace the three-dot illustration inside Your AI review with this compact scene. Extend it into four nine-second sequences: inspect text, compare bars, trace a trend, and compare two records. This creates a 36-second cycle; the cursor and content vary together, and each sequence resets while the record is closed. These are illustrations, not live progress or invented findings.

Use existing surfaces, light/dark colors, status phrases, cancellation and real result rendering. The desktop is decorative; an accessible status already communicates preparation, analysis and cancellation. Add a small Pause animation control, pause when the panel/document is hidden, stop on cancellation or completion, and show a still scene for reduced motion. Switching tabs, refreshing and moving from preparation into analysis must not reset the current sequence. A new review starts at the first scene.

No dependencies, network assets, extra model calls, log scans, per-frame JavaScript or paid inference. CSS animates the scene; a single animation-iteration handler switches variants. Keep review calculations, evidence, account verification and model settings unchanged. Follow the normal version/build/test/main workflow; no installed-copy edits or browser automation. Final motion and narrow-layout checks are manual.
