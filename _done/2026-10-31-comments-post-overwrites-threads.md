---
title: Preserve comment threads when baseVersion is missing or invalid
section: Comment API
---

# POST /api/comments without a valid baseVersion replaces every thread

Fixed. A present-but-invalid `baseVersion`, or a body with neither `threads` nor `comments`, returns 400. An absent `baseVersion` merges and returns `merged: true`. Every posted anchor is checked before a merge can fold threads together. Accepted as recommended on 2026-11-08 (5D-1 A). Letting agents create review-scope threads moved to `2026-11-07-server-only-review-state.md`, which adds `scope: "review"` to comment imports before removing this endpoint.

- [x] Red, then green: `pnpm vitest run src/server/server.test.ts -t "Comments API"` and `pnpm vitest run src/server/named-reviews.integration.test.ts -t "rejects unretained per-thread anchors|does not look up a capture"`
- [x] Reviewed with `coding:second-opinion`: LAND from Codex and Claude on base `f3e74c3`, 3 passes.

## Problem

`POST /api/comments` (`src/server/server.ts`) replaces the session's whole
thread list with the posted threads whenever `baseVersion` is absent or
invalid. `parseBaseVersion()` maps a negative, non-integer, or missing value to
`undefined`, and `isStale` is then false, so the handler skips
`mergeCommentThreads()` and stores only what the caller sent.

Seen on 2026-10-31: an agent posted one new review-scope thread to a running
review with a negative `baseVersion`. The post deleted the reviewer's existing
thread and its reply. The agent had to restore them by hand, and their
timestamps changed.

## To decide

- Reject a present-but-invalid `baseVersion` with 400 instead of treating it as
  absent.
- Whether an absent `baseVersion` (kept for older clients, per the comment on
  `parseBaseVersion()`) should still overwrite, or should merge.
- Whether agents should create review-scope threads through this endpoint.
  No CLI command currently creates those threads: `comment reply` needs an
  existing thread, and `comment add` requires a file location. Moving creation
  to the CLI would first require review-scope support in comment imports.

## Done when

A test posts one thread with a negative `baseVersion` to a session holding
another thread, and the earlier thread survives (or the request fails with 400).
