# AI review copy and excerpt settings

The user requested removing the three red-marked blocks: introductory instructions, prompt-sampling explanation, and routine completion/result metadata. Move the prompt-excerpt choice into Settings, enabled by default and persisted; explain the reasons to disable it (sensitive prompt content and additional review cost/latency).

Keep model/scope context and the main review action. Preserve detailed metadata inside the existing collapsed snapshot disclosure. Show exceptions (failed/cancelled work, interrupted enrichment, stale date scope) when relevant. Do not remove accounting or change card generation.

Add the validated boolean `reviewAllowSamples` setting. Preparation freezes the saved choice; analysis only allows samples when the request, prepared setting, and current saved setting all permit them. This respects an opt-out saved after preparation and never enables sampling retroactively for an already-prepared statistics-only review. No extra setting fetch is needed before review, and unsaved checkbox edits do not affect a run.

The existing limits remain: statistics first, at most one targeted follow-up, six excerpts, 2,000 characters per excerpt, 12,000 total. Default-on is explicitly authorized by the user. The settings explanation discloses that selected text goes to Copilot and may contain private information. No real model calls or browser automation for validation.
