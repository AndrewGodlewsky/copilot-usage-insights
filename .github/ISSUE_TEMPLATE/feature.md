---
name: Feature request
about: Propose a new insight, metric, or workflow improvement
labels: enhancement
---

## Affected view
- [ ] Usage
- [ ] Breakdown
- [ ] Efficiency → Where did the tokens go?
- [ ] Efficiency → Worth a closer look
- [ ] Efficiency → AI review
- [ ] Settings / Diagnostics / Other

## Problem & Goal
Describe what insight or workflow is currently missing and how this helps the user.

## Data constraints
- [ ] Uses only data already present in `report` (no new background scans or host dependencies)
- [ ] Requires new data or host integration (explain why)

## Acceptance criteria
- [ ] Clear, plain-language presentation in both dark and light themes
- [ ] Untrusted names/labels escaped with `esc()`, no raw prompt/path leaks
- [ ] Unit and panel tests added/updated
- [ ] Version bumped per `AGENTS.md` and `panel/index.html` rebuilt
