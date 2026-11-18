---
title: Split server.ts into concern modules that hold their own state and routes
priority: p2
section: Refactor
---

# TPP: Split server.ts

## Summary

`startServer` (server.ts:228-2573 at `d905dec`) is one 2,345-line closure holding every
route, the save queue, comment sessions, summaries, verdicts, the WebSocket and
shutdown. To follow one concern, a reader has to collect its state and routes from places
spread across the closure. This plan moves each concern whose boundary is small (few inputs
and outputs, nothing reaching back into the closure) into one module that holds both its
state and its routes, as conversation.ts holds `Conversation` and
`registerConversationRoutes`: summaries, verdicts, comments, files, editor, inbox and
static. The entangled core stays in server.ts: startup and listen, `/api/diff`, revisions,
named reviews, review ops, the save queue, the live socket and shutdown. Features touch
three shared places (a constant near the top of the closure, an import, a field in the
`/api/diff` response at 1084-1105), but the conflict replay below shows the split will not
remove many merge conflicts. `server.test.ts` (4,461 lines) splits to follow. Part of
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
- `src/server/conversation.ts:555-722` (`registerConversationRoutes`, the pattern to
  follow)

## Where conflicts come from

Touches, last 60 commits on server.ts, each hunk mapped to the route or function above it:

| Region                                              | Commits of 60 |
| --------------------------------------------------- | ------------- |
| Imports and `ServerOptions` (1-139)                 | 33            |
| Comment helpers and routes                          | 30            |
| Startup state inside the closure (239-313, 616-730) | 27            |
| `GET /api/diff`                                     | 20            |
| Lifecycle, listen, WebSocket                        | 18            |
| Approval and verdict                                | 13            |

Since 2026-08-01 (51 commits, `git log -L` per range at `d905dec`): verdicts 7 + 12 + 11
(state, checks, routes), summaries 10 + 9, startup block 616-730 14, comment payload 8,
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
`approvals` and `summaries` maps declared next to each other at 512-513 (6f09ae5/02e8d77)
and summary state at 631-632 next to `launch` at 634 (903707b/4cb19d2). Expect the split to
make server.ts easier to read, not to remove many conflicts.

## Lore

- Middleware order must not change: the token check (553) first; the 16 MiB JSON parsers
  for `/api/reviews` and `/api/review-ops` (560-571) before the default `express.json()`
  (572), or large bodies get the 100 KB limit (pinned by
  named-reviews.integration.test.ts:858, 894 and review-ops.integration.test.ts:1066);
  the `?review=` validation (758) before every route that reads `?review=`. Call each
  `register*Routes` where its routes are registered today.
- A module cannot share a closure `let`. The view-state `let`s (`currentSelection`,
  `currentCommentSelection`, `launch`, `commentImportSelection`) stay in server.ts with
  their writers (`/api/diff`, named-review capture, rename and delete). Moved modules read
  them only through functions passed in: `selectionFromQuery` (today's
  `getCommentSelectionFromQuery`) and, for `files.ts`, `currentTarget: () =>
  currentSelection.targetCommitish`. A copied value would be wrong: generated-status (1126)
  would keep answering for the launch target after `/api/diff` reassigns
  `currentSelection` (1049). If a later change moves a writer out, add a view-state object
  then.
- `retargetNamedReview` (871-882) stays in server.ts with the named-review routes; the part
  that re-keys `commentSessions` (878-881) becomes a function `comments.ts` exports.
- server.test.ts mocks `./git-diff.js` with a factory that returns only
  `{ GitDiffParser }` (123-185, no `importOriginal`). A moved helper imported from
  `git-diff.js` makes Vitest throw `No "<name>" export is defined on the mock`, so new
  helpers go in their own modules.
- `static.ts` must not compute its own asset path: server.ts resolves
  `join(__dirname, '..', 'client')` (2313), which from a module in another folder (such as
  `dist/server/routes/static.js`) would not be Vite's `dist/client`. Pass `distPath` in
  from server.ts. The only production-branch test (2189, "serves static files in
  production mode") accepts 200 or 404, so it would not notice.
- `inbox` is assigned after listen (2347) but read by the inbox routes (2290, 2298).
  `registerInboxRoutes` takes `getInbox: () => inbox`.
- `/api/conversation/events` is a long poll, not SSE.
- knip fails on an export left unused after a move.

## Design

Settled 2026-11-17 (question DF-19, accepted as recommended): `register*Routes(app, deps)`.

- **Routes register as `register*Routes(app, deps)`**, following
  `registerConversationRoutes` (conversation.ts:555). Alternative: `express.Router`
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

Line ranges at `d905dec`; sizes approximate.

Helper moves that remove a duplicate:

| Target                        | Takes                                                                                                                 | About |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----- |
| `utils/fileUtils.ts` (exists) | MIME table 1281-1298 as `contentTypeFor(path)`; `client/utils/imageUtils.ts:7-23` derives its extension lists from it | +25   |

Concern modules (state and routes together):

| Module                                      | Takes                                                                                                                                                                                                                                                                          | About |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `review-summary.ts` (exists)                | `summaries`, `resolvedWorkingTreeSelections` and `workingTreeTracking` (631-632), 1568-1661, `normalizeCommitMessage`, `EMPTY_DIFF_DIGEST`, launch seeding 650-667, summary routes 1663-1728                                                                                   | 200   |
| new `verdicts.ts`                           | `approvals`, `VERDICT_LOG_NAMES`, `VerdictRefusal`, `reportVerdict`, `checkVerdict`, `clearVerdict` 2115-2219, one `getApproval(selection)` replacing the three copies at 2197, 2211, 2226, approval routes 2221-2243 (ship-it goes in the compat plan)                        | 140   |
| new `comments.ts`                           | `CommentSessionState`, 701-730, 968-984, 1459-1531 except `outputFinalComments`, payload parsing 1311-1457 (its one caller is 1739), comment routes 1730-1788, 1903-2008, the session re-key from `retargetNamedReview` (878-881)                                              | 380   |
| new `files.ts`                              | generated-status, line-count, blob 1108-1151, 1197-1309; `parseRepositoryRelativePath` 672-699 with `repositoryPath` as a parameter, exported for `editor.ts`; takes `generatedStatusCache` from server.ts (the diff route and `invalidateCache` clear it) and `currentTarget` | 190   |
| new `editor.ts`                             | Editor configuration 330-371 as `resolveServerEditor(env, {stdinDiff})` (server.ts reads its `available` for `/api/diff`, 1087); the open-in-editor route 2026-2105                                                                                                            | 130   |
| `registerInboxRoutes` in `session-inbox.ts` | 2278-2306 (inbox attach, inbox list, presence), with `getInbox`                                                                                                                                                                                                                | 30    |
| new `static.ts`                             | 2307-2333, with `distPath` passed in (see Lore)                                                                                                                                                                                                                                | 27    |

Stays in server.ts: startup (239-313, 616-730 except the parts above), middleware and
listen, the diff cache, `/api/diff`, `/api/revisions`, `parseNamedDiff`, named reviews
(775-966, with `retargetNamedReview`), the auto-viewed patterns route (2010-2025), review
ops (1790-1901), the save queue and `storeStatus`, the live socket, `outputFinalComments`
and shutdown, the update check and the port fallback.

## Tasks

One commit each. Move each `server.test.ts` describe block in the same commit as its
code. Acceptance for every step: `pnpm test` passes with the listed tests unchanged in
their assertions; `pnpm build`, `pnpm check` (oxlint) and `pnpm knip` pass. Pins name
the describe or `it` at `d905dec`, because the prerequisite plans renumber
server.test.ts.

1. Deletions and duplicate removal in place, in their own commits (list below), before any
   move. This includes one `selectionFromQuery` in server.ts replacing the duplicate at
   738-754 and 988-1007. Pins: the `it`s from "GET /api/diff returns diff data" through
   "GET /api/diff omits comment import payload after revision changes".
2. The MIME-table move, its own commit. Pins: the blob content-type `it`s (2374, 2397).
   (`hasAccessToken` stays in server.ts: the `/api` middleware and the WebSocket upgrade
   already call the one function, so moving it removes no duplicate.)
3. Leaf modules, one commit each: static (describe "Static file serving"; first add a test
   that a built `dist/client` is served with 200 at `/`, or run `node dist/cli/index.js`
   and load the page); inbox and presence (session-inbox.integration.test.ts, keep-alive);
   editor (the open-in-editor `it`s in "API endpoints", 1129-1225); files (describes "Line
   count API" and "Blob API endpoints"; the `GET /api/generated-status/*` `it`s including
   "…returns 400 for stdin diff"; the "rejects paths outside repository" / "rejects parent
   traversal paths" `it`s; named-reviews frozen-capture checks).
4. `review-summary.ts` with the summary routes. Pins: "Review summary API" 3900-4132,
   committed-summary.integration, live-approval.integration.
5. `verdicts.ts` with the approval routes (needs 4: `checkVerdict` reads the summary).
   Pins: live-approval.integration, "approval requests and notifications" 2467-2534,
   named-reviews approval tests, conversation-approval.test.ts.
6. `comments.ts`: sessions, payload parsing, comment routes. Pins: describe "Comments API"
   and "preserves supported excerpts…" (add unit tests for the payload parsing only where
   no route test reaches it); the `it`s from "POST /api/comments accepts comment data"
   through "DELETE /api/comments/:threadId returns 404 for unknown thread"; "isolates
   comment sessions between different diff selections"; review-ops.integration;
   named-reviews.integration rename and delete.
7. Leftover `server.test.ts` blocks: "Conversation API" (3055-3899) exercises
   conversation.ts:555-721, whose routes stay in conversation.ts, and moves to
   `conversation.api.test.ts` beside the other `conversation.*.test.ts` files; "keeps
   serialized server event fields aligned with the schema command" (3136-3450) arguably
   belongs in `src/cli/schema.test.ts`.

### Deletions and duplication to remove first (step 1: in place, own commits, before any move)

A move then carries less code and reads as a move.

- `getCommentSelectionFromQuery(req.query as Record<string, unknown>)` 12 times (1664,
  1737, 1823, 1905, 1948, 1968, 1988, 1998, 2223, 2235, 2242, 2252).
- `req.is('application/json')` + 415, 6 times with different messages (1672, 1732, 1795,
  1928, 2231, 2248): one `requireJson` middleware.
- `res.status(400).json({ error: filepathResult.error })` at 1121, 1210, 1253, 2046 and
  a variant at 1219.
- The `NamedReviewError` response at 765-769 and in `reviewError` (782-787).
- `conversation?.snapshot().reviews.find(...diffSelectionsEqual...)` at 645-647 and
  776-778 deep-clones every review to find one id; `storeStatus` (1549) also builds a
  full snapshot to read selections. Add a non-creating lookup to `Conversation` next to
  `getReviewId` (conversation.ts:168).
- `{...snapshot(), presence, store}` at conversation.ts:563-569 and server.ts:2349-2356.
- `conversation?.withProgress(selection, session.threads) ?? session.threads` at 1782,
  1893, 1993.
- `fileWatcher.broadcast({type, timestamp: new Date().toISOString()})` 10 times (826,
  854, 859, 905, 958, 1495, 1721, 1722, 2127, 2360): a method on `FileWatcherService`.
- New-summary-with-incremented-version at 659-664, 1585-1591, 1712-1717. In conversation
  mode `summaries.set` writes a map that `getReviewSummary` (1570) never reads.
- The `Comment capture is unavailable` check (1478-1481, 1756-1760); the thread-id hash
  fallback (1338-1341, 1389-1392); the comment-import id hash (377, 1908-1910);
  `?version=` parsing (791, 1265); the `'stdin'` fallback (190-193, 1062-1071); the
  frozen-capture refusal (1109-1112, 1199-1202).
- `isProduction` (2310-2311) is `NODE_ENV === 'production' || NODE_ENV !== 'development'`,
  which equals `NODE_ENV !== 'development'`.
- The stdin refusal answers 400 at 1113, 1164, 2027 and 404 at 1203, 1272 for the same
  condition. Unifying the status is a behavior change: separate commit, ask first.
- The idle-exit sequence (2458-2466) duplicated the ship-it one (2265-2273), which the
  compat plan removes, so after that it has one caller; leave it where it is.

### Not in scope (noted for a later decision)

- Fallbacks that hide errors: line-count turns a Git error into `0` (1228-1239); blob
  turns any error into 404 "File not found" (1305-1307); `|| 'HEAD'` at 1126, 1276.
  `||` where `??` is meant at 1126, 1276, 2343 (changing these changes behavior); at
  372, 527 and 1298 `??` gives the same result for the types involved, so those can
  change in any commit.
- Request bodies are checked by hand with `typeof` per route (804, 838, 886, 1932,
  2032). See the arc's "Rejected for now" on a validator library.
