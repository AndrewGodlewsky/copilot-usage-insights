# Prompt delivery: steering, queueing, and interruptions

Research date: November 15, 2026. Repository baseline: `6db9bb454ac3c0c292f762792c5f78a3f6ca4c81`. Public Copilot SDK source revision: `cf045793958ce674259c557f7769788f94ee20c9`. This is a feasibility audit, not shipped functionality.

**Copilot session events can distinguish delivered steering and queued prompts when the optional delivery field is present. Interruptions are separate events.** Older or incomplete records need an unknown category; timestamps alone cannot recover the distinction reliably.

## Public contract

The declared `user.message.data.delivery` values are:

| Value | Meaning |
| --- | --- |
| `idle` | The message started a run while the loop was idle. |
| `steering` | The message entered an already running loop. |
| `queued` | The message waited behind running work, then started its own run. |

This describes delivery, independently of origin. `source`, `agentMode`, and `isAutopilotContinuation` describe other dimensions. `messageId` matches the send acknowledgement, `clientTurnId` echoes an optional caller identifier, and `turnId` identifies the consuming loop iteration. These fields are optional. The event envelope also carries agent identity and persistence/checkpoint information. [Delivery enum and message schema](https://github.com/github/copilot-sdk/blob/cf045793958ce674259c557f7769788f94ee20c9/nodejs/src/generated/session-events.ts#L943).

`abort.data.reason` has four declared values: `user_initiated`, `remote_command`, `user_abort` (MCP notification), and `autopilot_credit_limit`. Its payload does not identify a replacement prompt or consuming turn. An abort therefore supports a separate interruption count, not proof that the next prompt caused it. [Abort schema and reason codes](https://github.com/github/copilot-sdk/blob/cf045793958ce674259c557f7769788f94ee20c9/nodejs/src/generated/session-events.ts#L1152).

## Requested, delivered, and completed are different

`send({mode:"immediate"})` requests steering; `send({mode:"enqueue"})` requests queueing. Both start work immediately when fully idle. Explicit enqueue can additionally wait for background agents after foreground work ends. A successful `send` returns acceptance and a message identifier; it does not establish consumption or an answer. [Official steering and queueing guide](https://github.com/github/copilot-sdk/blob/cf045793958ce674259c557f7769788f94ee20c9/docs/features/steering-and-queueing.md).

Late steering can become a follow-up run while preserving the original run's `originatingMessageId`. A loop `turnId` is not a whole-run identifier. Neither a delivery label nor an assistant event by itself proves successful task completion. [SDK response-correlation documentation](https://github.com/github/copilot-sdk/blob/cf045793958ce674259c557f7769788f94ee20c9/nodejs/README.md#structured-output-preview).

Experimental `session.rpc.queue.pendingItems()` exposes current queued entries and steering text, plus optional `inFlightSteeringCount` and `withdrawableTurnMessageId`. It is a live snapshot, not a complete submission history. A prompt can leave the queue before its `user.message` is recorded; withdrawal may remove a prompt without normal completion. Queue source tags are explicitly not authenticated human authorship. Avoid collecting the snapshot's prompt text merely to count modes. [Queue snapshot contract](https://github.com/github/copilot-sdk/blob/cf045793958ce674259c557f7769788f94ee20c9/nodejs/src/generated/rpc.ts#L35052), [withdrawal result](https://github.com/github/copilot-sdk/blob/cf045793958ce674259c557f7769788f94ee20c9/nodejs/src/generated/rpc.ts#L35275).

## Current local coverage and product gap

The accompanying local audit inspected host build `1.0.106-8.unstable.r43566476370.g869eef3`. Its installed declarations include the delivery enum. A metadata-only journal check observed retained `delivery:"idle"` events, but did not establish human authorship for those examples or validate retained steering/queued coverage. No prompt text or personal counts are recorded here.

At the repository baseline, [promptEvent in the Copilot parser](../../src/core/prompt-credits.mjs) does not preserve `delivery`. It retains only a cancellation boolean for `user_initiated` aborts. [The VS Code reader](../../src/core/vscode.mjs) supplies no prompt-event/interactions dataset. Therefore the dashboard does not currently expose these distinctions, and this research does not establish equivalent historical coverage across VS Code sources.

Proposed implementation boundary: preserve recognized delivery values and an explicit unknown state in existing metadata extraction; retain abort reasons separately; keep human-origin classification independent; report field coverage. Controlled fixtures and runtime verification of steering, queued consumption, cancellation, and missing fields would be required before shipping. No production code, release files, runtime actions, or recorder was added by this audit.
