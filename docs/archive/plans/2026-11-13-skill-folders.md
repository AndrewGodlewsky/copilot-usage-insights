# Skill Folders Implementation Plan

> Historical development record. Instructions, approvals, versions, and task status below describe the original work, not current authorization or a current backlog. See the [archive index](../README.md) and [current reviewer’s guide](../../reviewing.md).

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Explain plugin provenance and open recorded skill folders from the Breakdown table.

**Architecture:** Retain recorded paths in the parser; use path-aware report groups and stable row IDs. Validate requested IDs against a fresh source scan, then call a small OS folder-opening module. Render escaped path text and accessible buttons with inline feedback.

**Tech Stack:** Node.js 24 filesystem/child-process APIs, existing HTML/CSS/JavaScript; no dependencies.

- [x] Add failing coverage for retained paths, separate locations, stable IDs, folder validation, and API authorization.
- [x] Implement path metadata, the folder opener and API, then clickable names and clearer labels.
- [x] Update README/privacy/version, rebuild, and run automated plus Brave checks.
- [x] Obtain focused review and prepare the verified update for main.

Validation: build and all 48 tests pass. Brave checks covered real Windows Explorer opening, mouse and keyboard activation, missing-path rendering, missing-folder feedback, escaped metadata, dark/light layouts, and narrow viewport overflow. Explorer's actual folder location was verified. macOS/Linux command construction and launcher failure handling were tested on Windows; their native file managers were not exercised. Review found no remaining material issues after fixing non-Windows launcher exit handling.
