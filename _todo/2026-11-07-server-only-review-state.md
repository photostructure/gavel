---
title: Keep review state on the server, with a browser queue for unconfirmed changes
section: Review server
---

# Server-only review state

Comments and verdicts are done: the page sends them as review ops through a queue
in `localStorage` and keeps no copy of sent threads. Viewed-file marks, agent-reply
read marks, and the header note for servers that save nothing remain. Follows the
saved-reviews change (`_done/2026-11-07-saved-reviews-under-git-dir.md`).

## Decisions

Matthew's own decisions (2026-11-07):

- Review state lives on the server; presentation settings (fonts, colors,
  approval celebrations, panel layout) live in the browser.
- The browser keeps no copy of sent comments. The one defensible browser copy is a
  backup for changes the server has not confirmed, such as a comment made while
  the server is down.
- Unsent drafts move from `sessionStorage` to `localStorage`, keyed by repository
  and review, and drafts untouched for 7 days are deleted (A2-20). Two tabs on the
  same review share one draft per comment form; each picks up the other's changes
  on load or through the browser's `storage` event. Done.

Matthew's own decision (2026-11-11): use the standard pattern for a server-backed
page that must not lose edits, a client mutation queue with idempotency keys. Each
comment change and each verdict change is an op with a client-generated ID. Ops
wait, in order, in a queue persisted in `localStorage`, and leave it only when the
server answers them. The server is the source of truth and applies each op ID once.
The page shows the server's state with queued ops applied on top.

Accepted as recommended:

- Viewed-file marks and agent-reply read marks move to the server too, saved in
  the review record and sent as review ops (A2-17). Not started.
- Dead `src/client/hooks/useLocalComments.ts` and its test are deleted in their
  own commit (A2-16). Done.

## Dropped: a whole-list outbox

On 2026-11-11 a "one-item outbox" was built and dropped. It kept the page's whole
thread list as the one unconfirmed item and posted it with `POST /api/comments`.
Syncing whole lists let a late answer, or a retry of a list that predated a newer
comment, overwrite the newer comments. Ops name one change each, so an answer can
remove only the ops it confirms.

## Done (2026-11-11)

- `POST /api/review-ops` (`src/utils/reviewOps.ts`, `src/types/reviewOps.ts`)
  applies `thread.add`, `message.add`, `message.edit`, `message.delete`,
  `thread.delete`, `thread.resolve` and `verdict.set`, one request at a time. It
  records each applied op ID in a ledger. For a review the server saves, the ledger
  is saved with the review in the same save as the op's change, keeps every ID for
  the saved review's lifetime (`--clean` included), and the endpoint answers HTTP
  503 when a saved review's change did not reach disk. A review kept only in
  memory (no store, an unnamed stdin patch, or one another running server saves)
  answers HTTP 200 and loses its comments and ledger when the server exits. `verdict.set` goes through the same functions as
  `PUT` and `DELETE /api/approval`; a stale binding is `rejected` with the
  endpoint's error.
- `useReviewOps` (`src/client/hooks/useReviewOps.ts`) keeps each queued op under
  its own key, `gavel:review-ops:<repository and selection>:<queuedAt>-<id>`, so
  two tabs never overwrite each other's ops, and a moved commit keeps the queue.
  It sends the whole queue in order, one request at a time, and removes only the
  op IDs the answer lists (`applied`, `duplicate`, or `rejected`). On a network
  error or a non-2xx answer the ops stay, and the header shows a `role="alert"`
  line; the queue is sent again with the next change, when the review loads, and
  when the live connection reopens. Both endpoints' answers carry a `cursor`,
  `<server instance>:<sequence>`, from the conversation stream (or the comment
  version without conversations), which progress changes also advance. A snapshot
  replaces the shown threads unless it comes from the same instance with a lower
  sequence, or the same sequence and a lower comment version (a re-anchor or
  reorder through `POST /api/comments` advances only the version); another
  instance means the server restarted. An op another tab got
  answered settles as `elsewhere`, whichever review this tab shows, and the page
  then reads the verdict from the server. A refusal stays in the header
  until the next change; a failed first comments read is shown there too.
- `useDiffComments` turns each page action into an op; undo copies of deleted
  comments stay in page memory.
- Removed: the page's whole-list `POST /api/comments` sync and its
  `beforeunload` `sendBeacon`, the load-time `mergeCommentThreads` merge, sent
  threads and undo copies in `StorageService` and `useDiffComments`, and the
  page's direct `PUT`/`DELETE /api/approval` calls. `POST /api/comments` stays for
  agents and imports, JSON only; the server no longer parses `text/plain` bodies.
- Migration: on load, threads in an old `gavel-storage-v1/…` record that the
  server lacks become `thread.add` ops once (none when `--clean` emptied that
  review), and the record's `threads` and `deletedComments` are removed from every
  record examined, also one with nothing to send. The undo copies are deleted, not
  migrated. Ops waiting in the queue are sent after a `--clean` launch too.

## What the browser stores now

- `localStorage` `gavel:review-ops:<repository and selection>:<queuedAt>-<id>`: review
  ops the server has not answered, one key each.
- `localStorage` `gavel-storage-v1/<repo>/<base-target>` (`StorageService`): viewed
  files. Records from earlier versions may also hold `appliedCommentImportIds`,
  which nothing reads.
- `localStorage` `gavel-viewed-index-v1/<repo>`: viewed-file hash index.
- `localStorage` agent-reply read marks (`useAgentUpdates`).
- `localStorage` `gavel:comment-drafts:<scope>` unsent drafts (`useCommentDrafts`),
  deleted after 7 days untouched.
- Presentation, which stays: `ReviewSummaryPanel` expanded flag (`localStorage`),
  user settings cookie (`userSettings`).

## Remaining

- Viewed-file marks and agent-reply read marks as review ops saved in the review
  record (A2-17).
- Where the server saves nothing (`--no-conversation`, unnamed stdin patches,
  outside Git), comments live in server memory only, and the header should say a
  restart loses them.
