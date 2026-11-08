---
title: Keep review state on the server, with a browser outbox for unconfirmed changes
section: Review server
---

# Server-only review state

Not started, apart from deleting the dead `useLocalComments` hook. Follows the
saved-reviews change (`_done/2026-11-07-saved-reviews-under-git-dir.md`).

## Decisions (2026-11-07)

Matthew's own decisions:

- Review state lives on the server; presentation settings (fonts, colors,
  approval celebrations, panel layout) live in the browser.
- The browser keeps no copy of sent comments. The one defensible browser copy is a
  backup for changes the server has not confirmed, such as a comment made while
  the server is down: an outbox in `localStorage`.
- Unsent drafts move from `sessionStorage` to `localStorage`, keyed by repository
  and review, and drafts untouched for 7 days are deleted (A2-20). Two tabs on the
  same review share one draft per comment form; each picks up the other's changes
  on load or through the browser's `storage` event.

Accepted as recommended:

- Viewed-file marks and agent-reply read marks move to the server too, saved in
  the review record and sent through the outbox (A2-17).
- Dead `src/client/hooks/useLocalComments.ts` and its test are deleted in their
  own commit (A2-16); done.

## What the browser stores today

- `localStorage` `gavel-storage-v1/<repo>/<base-target>` (`StorageService`,
  `useDiffComments`): sent threads, undo copies of deleted comments, viewed files,
  applied comment-import IDs.
- `localStorage` `gavel-viewed-index-v1/<repo>`: viewed-file hash index.
- `localStorage` agent-reply read marks (`useAgentUpdates`).
- `sessionStorage` unsent drafts (`useCommentDrafts`).
- Presentation, which stays: `ReviewSummaryPanel` expanded flag (`localStorage`),
  user settings cookie (`userSettings`).

## Problems this fixes

- On every load the browser merges its `localStorage` threads into the server's
  with a union merge (`mergeCommentThreads`, `App.tsx` bootstrap) and posts the
  result back, so a stale browser copy brings back threads deleted on another
  browser or device.
- A failed comment post only logs to the console (`App.tsx`,
  `syncThreadsToServer` caller), so the page looks saved when it is not.

## Direction

- Outbox of operations, not snapshots: add message, edit message, delete message
  or thread, resolve or reopen, mark viewed, mark read. Replaying whole thread
  lists through the union merge would bring back deletions made while the server
  was down. The server applies operations; the full-list `POST /api/comments`
  merge stays only for imports and old clients, or goes.
- Each operation enters the outbox before it is sent and leaves when the server
  confirms it. While the server is unreachable the header says so, with the count
  of waiting changes; on reconnect the page replays the outbox in order, then
  reloads the review from the server.
- Where the server saves nothing (`--no-conversation`, unnamed stdin patches,
  outside Git), comments live in server memory only, and the header says a
  restart loses them.
- Undo of a delete keeps its copy in page memory.
