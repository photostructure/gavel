---
title: Save review state under .git/difit so a restarted server keeps it
section: Review server
---

# Saved reviews under `.git/difit`

Complete.

## Outcome

A server with conversation APIs saves each review's threads, progress, approval
and summary under `<git-common-dir>/difit/` after every change, and restores them
when a later server opens the same review: a named review with the same name and
current patch (with its capture history), or any other review that resolves to
the same commits. Unnamed stdin patches and `--no-conversation` servers save
nothing.

- `reviews/<hash>.json`: one record per review. `captures/<hash>.json`: each
  patch once per worktree, base commit and digest.
- `locks/<hash>.json`: the running server that saves a review, created with a
  hard link; a stale lock is reclaimed under a `<lock>.reclaim` guard. A server
  never restores or saves a review another running server holds, and the
  snapshot's `store.error` names such reviews.
- `servers/<serverId>.json`: heartbeat, rewritten every 60 s and on each save. A
  holder counts as running while its pid is alive and its heartbeat is under 3
  minutes old.
- Saves run once per synchronous mutation, so a summary edit and the approval it
  revokes are saved together. A failed or contended save stays queued and shows
  in the snapshot's `store: { directory, error? }`.
- Startup cleanup acts only on names difit writes: reviews untouched for 7 days,
  patches unused and 7 days old (none while a review is unreadable), locks and
  this host's heartbeats once their server stopped.
- `--clean` clears only the launched review's saved comments.
- `difit approval status <commit>` lists saved reviews of a commit with no
  server: reviews that targeted it, and named reviews of exactly
  `git diff --full-index <commit>^ <commit>`, the skills' stacking recipe.

Docs: `docs/agent-conversations.md` "Saved reviews".

## Follow-ups

- `_todo/2026-11-07-server-only-review-state.md`: drop the browser's copy of sent
  comments, add an outbox for unconfirmed changes, and move Viewed and read marks
  to the server.
- `_todo/2026-11-07-approval-verdict-field.md`: one verdict field instead of
  separate approval flags.
- The two-process lock race check ran against `dist` only and is not checked in:
  the repo has no TypeScript loader for child processes.

## Decisions

- Cleanup deletes only files whose names difit generates (A2-14, accepted as
  recommended).
- The verdict flags stay as they are in this change; one field is a separate
  refactor (A2-13, accepted as recommended).
