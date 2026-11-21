---
title: Split server.ts into concern modules that hold their own state and routes
priority: p2
section: Refactor
---

# TPP: Split server.ts

## Summary

`startServer` (server.ts at `d905dec`) is one 2,345-line closure holding every
route, the save queue, comment sessions, summaries, verdicts, the WebSocket and
shutdown. To follow one concern, a reader has to collect its state and routes from places
spread across the closure. This plan moves each concern whose boundary is small (few inputs
and outputs, nothing reaching back into the closure) into one module that holds both its
state and its routes, as conversation.ts holds `Conversation` and
`registerConversationRoutes`: summaries, verdicts, comments, files, editor, inbox and
static. The entangled core stays in server.ts: startup and listen, `/api/diff`, revisions,
named reviews, review ops, the save queue, the live socket and shutdown. Features touch
three shared places (a constant near the top of the closure, an import, a field in the
`GET /api/diff` response), but the conflict replay below shows the split will not
remove many merge conflicts. `server.test.ts` splits to follow. Part of
`p1-20261114-refactor-arc.md`.

## Current phase

Next: after `p1-20261114-delete-dead-code.md`, `p1-20261114-remove-backward-compat.md` and
`p1-20261114-shared-test-helpers.md` task 3 land, step 1 below. The compat plan deletes
`/api/ship-it` and the legacy `comments` body; do not move them first.

- [x] Map and conflict analysis (below)
- [x] Design settled (below)
- [ ] Deletions and duplicate removal in place (step 1)
- [ ] Extractions, one commit each (steps 2-6)
- [ ] `server.test.ts` split (with each step, then step 7)
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- `p3-20261114-server-modules.md` tasks 5 and 6: the `digest` and line-validation
  helpers there overlap the comment-payload and hash items below; do whichever lands
  first and update the other plan
- `src/server/server.ts` in full
- `registerConversationRoutes` in `src/server/conversation.ts` (the pattern to follow)

## Where conflicts come from

Touches, last 60 commits on server.ts, each hunk mapped to the route or function above it:

| Region                                                                                                                        | Commits of 60 |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Imports and `ServerOptions`                                                                                                   | 33            |
| Comment helpers and routes                                                                                                    | 30            |
| Startup state inside the closure (`app` through `initialNamedReview`; `invalidateCache` through the initial comment sessions) | 27            |
| `GET /api/diff`                                                                                                               | 20            |
| Lifecycle, listen, WebSocket                                                                                                  | 18            |
| Approval and verdict                                                                                                          | 13            |

Since 2026-08-01 (51 commits, `git log -L` per range at `d905dec`): verdicts 7 + 12 + 11
(state, checks, routes), summaries 10 + 9, startup block (`invalidateCache` through the
initial comment sessions) 14, comment payload 8,
comment sessions 7, lifecycle 10, live socket 6, `/api/diff` 15; diff cache 0, selection
helpers 0-1, access token 2, update check 1, editor 2 + 5, files 1 + 3, revisions 2,
review-ops routes 2, inbox 2, static 1, port fallback 2.

Example of the three-place pattern: cb50156 (`updateCheckDisabledBy`), 0ab8188
(`title`), a96706d (`stdinDiffDigest`), 6277fd8 (`reviewContext`), 344ee6c
(`autoViewedPatterns`), ab253fc (`parseNamedDiff`).

Touches are not conflicts. Replaying each pair of consecutive server.ts commits since
2026-08-01 as parallel branches (B's change applied to A's parent with a 3-way
`git merge-file`) gave 13 conflicting pairs out of 50. Imports conflicted in 1 pair
(f2699ad/ab253fc, which also both edited the blob route), the `/api/diff` response in 0,
and the startup block in 1. Most were two features in one concern: comments
(498a059/effa73e, e56fe35/713efd4), conversation (713efd4/2dc37f5), `/api/diff`
(b62abb2/c5cee66), the live socket (a4699a2/33d9982), summaries (4cb19d2/bc5978f,
f591096/0d52609). Two came from different concerns that this split separates: the
`approvals` and `summaries` maps declared next to each other (6f09ae5/02e8d77) and summary
state (`resolvedWorkingTreeSelections`, `workingTreeTracking`) next to `launch`
(903707b/4cb19d2). Expect the split to
make server.ts easier to read, not to remove many conflicts.

## Lore

- Middleware order must not change: the token check (the `/api` middleware that calls
  `hasAccessToken`) first; the 16 MiB JSON parsers for `/api/reviews` and
  `/api/review-ops` (with `handleJsonBodyLimit`) before the default `express.json()`, or
  large bodies get the 100 KB limit (pinned by named-reviews.integration.test.ts's "accepts
  named JSON bodies above the ordinary default budget" and "returns JSON for oversized
  create and update bodies without changing a review", and review-ops.integration.test.ts's
  "answers a body over 16 MiB with a JSON 413"); the `?review=` validation middleware before
  every route that reads `?review=`. Call each
  `register*Routes` where its routes are registered today.
- A module cannot share a closure `let`. The view-state `let`s (`currentSelection`,
  `currentCommentSelection`, `launch`, `commentImportSelection`) stay in server.ts with
  their writers (`/api/diff`, named-review capture, rename and delete). Moved modules read
  them only through functions passed in: `selectionFromQuery` (today's
  `getCommentSelectionFromQuery`) and, for `files.ts`, `currentTarget: () =>
  currentSelection.targetCommitish`. A copied value would be wrong: generated-status (its
  default `ref`) would keep answering for the launch target after `/api/diff` reassigns
  `currentSelection`. If a later change moves a writer out, add a view-state object
  then.
- `retargetNamedReview` stays in server.ts with the named-review routes; the part that
  re-keys `commentSessions` becomes a function `comments.ts` exports.
- server.test.ts mocks `./git-diff.js` with a factory that returns only
  `{ GitDiffParser }` (no `importOriginal`). A moved helper imported from
  `git-diff.js` makes Vitest throw `No "<name>" export is defined on the mock`, so new
  helpers go in their own modules.
- `static.ts` must not compute its own asset path: server.ts resolves
  `join(__dirname, '..', 'client')`, which from a module in another folder (such as
  `dist/server/routes/static.js`) would not be Vite's `dist/client`. Pass `distPath` in
  from server.ts. The only production-branch test ("serves static files in production
  mode") accepts 200 or 404, so it would not notice.
- `inbox` is assigned after listen (`inbox = new SessionInbox(...)`) but read by the
  `/api/inbox/attach` and `/api/inbox` routes.
  `registerInboxRoutes` takes `getInbox: () => inbox`.
- `/api/conversation/events` is a long poll, not SSE.
- knip fails on an export left unused after a move.

## Design

Settled 2026-11-17 (question DF-19, accepted as recommended): `register*Routes(app, deps)`.

- **Routes register as `register*Routes(app, deps)`**, following
  `registerConversationRoutes` in conversation.ts. Alternative: `express.Router`
  mounted at `/api`; it works as long as the body parsers stay in server.ts in order.
  Preferred because it matches existing code.
- **A concern's state and its routes live in one module**, as in conversation.ts. New
  modules sit in `src/server/` beside it.
- **Each module takes plain values and functions, typed inline in its signature**
  (`registerVerdictRoutes(app, { conversation, fileWatcher, humanLog, selectionFromQuery,
  getReviewSummary })`). No exported `*Deps` types, no shared types file, no shared context
  object, no view-state object.
- Extract a concern when its boundary is small: few inputs and outputs, and nothing in the
  closure reaching back into it. If an extraction needs a long dependency list, a getter or
  setter for state that stays behind, or a shared mutable object, leave that code in
  server.ts.
- A move adds no option, layer or wrapper. Delete and dedupe in place first, in their own
  commits; then move what is left unchanged, so each move reads as a move.
- Move a pure helper only when the move removes a duplicate; other helpers stay where they
  are.

## Target modules

Sizes at `d905dec`, approximate.

Helper moves that remove a duplicate:

| Target                        | Takes                                                                                                                                                                           | About |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `utils/fileUtils.ts` (exists) | the blob route's `contentTypes` MIME table as `contentTypeFor(path)`; `client/utils/imageUtils.ts` derives its extension lists (`IMAGE_EXTENSIONS`, `VIDEO_EXTENSIONS`) from it | +25   |

Concern modules (state and routes together):

| Module                                      | Takes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | About |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `review-summary.ts` (exists)                | `summaries`, `resolvedWorkingTreeSelections` and `workingTreeTracking`, `getReviewSummary` through `getCurrentDiffDigest`, `normalizeCommitMessage`, `EMPTY_DIFF_DIGEST`, launch seeding (the `restoredSummary` block), summary routes (`GET /api/review-summary`, `POST /api/conversation/summary`)                                                                                                                                                                                                               | 200   |
| new `verdicts.ts`                           | `approvals`, `VERDICT_LOG_NAMES`, `VerdictRefusal`, `reportVerdict`, `checkVerdict`, `clearVerdict`, one `getApproval(selection)` replacing the three copies (in `checkVerdict`, `clearVerdict` and `GET /api/approval`), approval routes (`/api/approval`) (ship-it goes in the compat plan)                                                                                                                                                                                                                      | 140   |
| new `comments.ts`                           | `CommentSessionState`, `commentSessions` and the initial comment threads (`restoredCommentThreads`, `initialCommentThreads`), `getOrCreateCommentSession`, `resolveThreadCapture` through `updateCommentSession` except `outputFinalComments`, payload parsing `normalizeLineValue` through `parseCommentsPayload` (its one caller is `POST /api/comments`), comment routes `POST /api/comments` and `POST /api/comment-imports` through `GET /api/comments-output`, the session re-key from `retargetNamedReview` | 380   |
| new `files.ts`                              | generated-status, line-count, blob; `parseRepositoryRelativePath` with `repositoryPath` as a parameter, exported for `editor.ts`; takes `generatedStatusCache` from server.ts (the diff route and `invalidateCache` clear it) and `currentTarget`                                                                                                                                                                                                                                                                  | 190   |
| new `editor.ts`                             | Editor configuration (`editorSelection` through `editorAvailable`) as `resolveServerEditor(env, {stdinDiff})` (server.ts reads its `available` for `/api/diff`); the open-in-editor route                                                                                                                                                                                                                                                                                                                          | 130   |
| `registerInboxRoutes` in `session-inbox.ts` | the `/api/inbox/attach`, `/api/inbox` and `/api/presence` routes, with `getInbox`                                                                                                                                                                                                                                                                                                                                                                                                                                  | 30    |
| new `static.ts`                             | `isProduction`, `express.static(distPath)` and the dev-mode `/` route, with `distPath` passed in (see Lore)                                                                                                                                                                                                                                                                                                                                                                                                        | 27    |

Stays in server.ts: startup (except the parts above), middleware and listen, the diff
cache, `/api/diff`, `/api/revisions`, `parseNamedDiff`, named reviews (the `/api/reviews`
routes, with `retargetNamedReview`), the auto-viewed patterns route, review ops
(`applyReviewOps` and `POST /api/review-ops`), the save queue and `storeStatus`, the live
socket, `outputFinalComments` and shutdown, the update check and the port fallback.

## Tasks

One commit each. Move each `server.test.ts` describe block in the same commit as its
code. Acceptance for every step: `pnpm test` passes with the listed tests unchanged in
their assertions; `pnpm build`, `pnpm check` (oxlint) and `pnpm knip` pass. Pins name
the describe or `it` at `d905dec`, because the prerequisite plans renumber
server.test.ts.

1. Deletions and duplicate removal in place, in their own commits (list below), before any
   move. This includes one `selectionFromQuery` in server.ts replacing the duplicate
   selection parsing in `getCommentSelectionFromQuery` and `GET /api/diff`. Pins: the
   `it`s from "GET /api/diff returns diff data" through
   "GET /api/diff omits comment import payload after revision changes".
2. The MIME-table move, its own commit. Pins: the blob content-type `it`s ("sets correct
   content type for different image formats", "sets default content type for unknown
   extensions").
   (`hasAccessToken` stays in server.ts: the `/api` middleware and the WebSocket upgrade
   already call the one function, so moving it removes no duplicate.)
3. Leaf modules, one commit each: static (describe "Static file serving"; first add a test
   that a built `dist/client` is served with 200 at `/`, or run `node dist/cli/index.js`
   and load the page); inbox and presence (session-inbox.integration.test.ts, keep-alive);
   editor (the open-in-editor `it`s in "API endpoints", from "rejects client-selected
   editor commands and arguments" through "disables a custom template that embeds the
   file in evaluated code"); files (describes "Line
   count API" and "Blob API endpoints"; the `GET /api/generated-status/*` `it`s including
   "…returns 400 for stdin diff"; the "rejects paths outside repository" / "rejects parent
   traversal paths" `it`s; named-reviews frozen-capture checks).
4. `review-summary.ts` with the summary routes. Pins: "Review summary API",
   committed-summary.integration, live-approval.integration.
5. `verdicts.ts` with the approval routes (needs 4: `checkVerdict` reads the summary).
   Pins: live-approval.integration, "approval requests and notifications",
   named-reviews approval tests, conversation-approval.test.ts.
6. `comments.ts`: sessions, payload parsing, comment routes. Pins: describe "Comments API"
   and "preserves supported excerpts…" (add unit tests for the payload parsing only where
   no route test reaches it); the `it`s from "POST /api/comments accepts comment data"
   through "DELETE /api/comments/:threadId returns 404 for unknown thread"; "isolates
   comment sessions between different diff selections"; review-ops.integration;
   named-reviews.integration rename and delete.
7. Leftover `server.test.ts` blocks: "Conversation API" exercises
   `registerConversationRoutes`, whose routes stay in conversation.ts, and moves to
   `conversation.api.test.ts` beside the other `conversation.*.test.ts` files; "keeps
   serialized server event fields aligned with the schema command" arguably
   belongs in `src/cli/schema.test.ts`.

### Deletions and duplication to remove first (step 1: in place, own commits, before any move)

A move then carries less code and reads as a move.

- `getCommentSelectionFromQuery(req.query as Record<string, unknown>)` 12 times (in
  `GET /api/review-summary`, `POST /api/comments`, `applyReviewOps`,
  `POST /api/comment-imports`, `POST /api/comments/:threadId/resolution`,
  `DELETE /api/comments/:threadId`, `GET /api/comments-json`, `GET /api/comments-output`,
  `GET`, `PUT` and `DELETE /api/approval`, and `POST /api/ship-it`).
- `req.is('application/json')` + 415, 6 times with different messages (in
  `POST /api/conversation/summary`, `POST /api/comments`, `applyReviewOps`,
  `POST /api/comments/:threadId/resolution`, `PUT /api/approval` and `POST /api/ship-it`):
  one `requireJson` middleware.
- `res.status(400).json({ error: filepathResult.error })` in the generated-status,
  line-count, blob and open-in-editor routes, and a variant for `oldPath` in line-count.
- The `NamedReviewError` response in the `?review=` validation middleware and in
  `reviewError`.
- `conversation?.snapshot().reviews.find(...diffSelectionsEqual...)` in `launchReview`
  and `describeNamedReview` deep-clones every review to find one id; `storeStatus` also
  builds a full snapshot to read selections. Add a non-creating lookup to `Conversation`
  next to `getReviewId` in conversation.ts.
- `{...snapshot(), presence, store}` in conversation.ts's `/api/conversation/snapshot`
  route and in the `snapshot` callback server.ts passes to `new SessionInbox`.
- `conversation?.withProgress(selection, session.threads) ?? session.threads` in
  `POST /api/comments`, `applyReviewOps` and `GET /api/comments-json`.
- `fileWatcher.broadcast({type, timestamp: new Date().toISOString()})` 10 times (in
  `POST /api/reviews`, twice in `POST /api/reviews/:name/capture`, the rename route,
  `DELETE /api/reviews/:name`, `broadcastCommentsChanged`, twice in
  `POST /api/conversation/summary`, `reportVerdict`, and `SessionInbox`'s
  `onDeliveryChange`): a method on `FileWatcherService`.
- New-summary-with-incremented-version in the launch seeding (the `restoredSummary`
  block), `seedSummary` and `POST /api/conversation/summary`. In conversation mode
  `summaries.set` writes a map that `getReviewSummary` never reads.
- The `Comment capture is unavailable` check (`resolveThreadCapture`,
  `POST /api/comments`); the thread-id hash fallback (`normalizeComment`,
  `normalizeThreadPayload`); the comment-import id hash (`commentImportId`,
  `POST /api/comment-imports`); `?version=` parsing (`GET /api/reviews/:name`, the blob
  route); the `'stdin'` fallback (`createResolvedCommentSelection`, the commitish fields
  of the `GET /api/diff` response); the frozen-capture refusal (generated-status,
  line-count).
- `isProduction` is `NODE_ENV === 'production' || NODE_ENV !== 'development'`,
  which equals `NODE_ENV !== 'development'`.
- The stdin refusal answers 400 in generated-status, `/api/revisions` and open-in-editor,
  and 404 in line-count and blob, for the same condition. Unifying the status is a
  behavior change: separate commit, ask first.
- The idle-exit sequence (the reviewer-disconnect timer in `connectLiveTab`'s `close`
  handler) duplicated the ship-it one (the `finish` handler in `POST /api/ship-it`), which
  the compat plan removes, so after that it has one caller; leave it where it is.

### Not in scope (noted for a later decision)

- Fallbacks that hide errors: line-count turns a Git error into `0` (its
  `getLineCount` catches); blob turns any error into 404 "File not found" (its catch);
  `|| 'HEAD'` in the generated-status `ref` and the blob route's `getBlobContent` call.
  `||` where `??` is meant in those two and in the `options.host` default passed to
  `startServerWithFallback` (changing these changes behavior); in `initialCommentImports`,
  `initialIgnoreWhitespace` and the blob route's `contentType` lookup `??` gives the same
  result for the types involved, so those can change in any commit.
- Request bodies are checked by hand with `typeof` per route (`POST /api/reviews`,
  `POST /api/reviews/:name/capture`, the rename route,
  `POST /api/comments/:threadId/resolution`, `POST /api/open-in-editor`). See the arc's
  "Rejected for now" on a validator library.
