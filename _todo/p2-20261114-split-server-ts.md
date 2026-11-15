---
title: Split server.ts into route modules and per-concern state objects
priority: p2
section: Refactor
---

# TPP: Split server.ts

## Summary

`startServer` (server.ts:228-2573 at `d905dec`) is one 2,345-line closure holding every
route, the save queue, comment sessions, summaries, verdicts, the WebSocket and
shutdown. Each feature that tells the page something adds a constant near the top of the
closure, an import, and a field in the `/api/diff` response (1084-1105), so features
collide in those three places. This plan moves routes into `register*Routes` modules and
shared state into small objects, leaving `server.ts` as the place that builds them,
installs middleware in order, and listens. `server.test.ts` (4,461 lines) splits to
follow. Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: after `p1-20261114-delete-dead-code.md`, `p1-20261114-remove-backward-compat.md` and
`p1-20261114-shared-test-helpers.md` tasks 1 and 3 land, step 1 below. The compat plan
deletes `/api/ship-it` and the legacy `comments` body; do not move them first.

- [x] Map and conflict analysis (below)
- [ ] Design settled (proposed below)
- [ ] Extractions, one commit each
- [ ] `server.test.ts` split
- [ ] `docs/structure.md` and `docs/test.md` updated
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `docs/structure.md`, `docs/test.md`, `p1-20261114-refactor-arc.md`
- `p3-20261114-server-modules.md` tasks 5 and 6: the `digest` and line-validation
  helpers there overlap the comment-payload and hash items below; do whichever lands
  first and update the other plan
- `src/server/server.ts` in full
- `src/server/conversation.ts:555-722` (`registerConversationRoutes`, the pattern to
  follow)

## Where conflicts come from

Last 60 commits on server.ts, each hunk mapped to the route or function above it:

| Region                                              | Commits of 60 |
| --------------------------------------------------- | ------------- |
| Imports and `ServerOptions` (1-139)                 | 33            |
| Comment helpers and routes                          | 30            |
| Startup state inside the closure (239-313, 616-730) | 27            |
| `GET /api/diff`                                     | 20            |
| Lifecycle, listen, WebSocket                        | 18            |
| Approval and verdict                                | 13            |

Example of the three-place pattern: cb50156 (`updateCheckDisabledBy`), 0ab8188
(`title`), a96706d (`stdinDiffDigest`), 6277fd8 (`reviewContext`), 344ee6c
(`autoViewedPatterns`), ab253fc (`parseNamedDiff`).

## Lore

- Middleware order must not change: the token check (553) first; the 16 MiB JSON parsers
  for `/api/reviews` and `/api/review-ops` (560-571) before the default `express.json()`
  (572), or large bodies get the 100 KB limit (pinned by
  named-reviews.integration.test.ts:858, 894 and review-ops.integration.test.ts:1066);
  the `?review=` validation (758) before every route that reads `?review=`.
- The main obstacle is mutable `let` bindings shared across routes: `currentSelection`,
  `currentCommentSelection`, `launch`, `commentImportSelection` (written by capture,
  rename, delete and `/api/diff`; read by `/api/diff`, generated-status, revisions,
  `getCommentSelectionFromQuery`, `outputFinalComments`). A module cannot share a `let`
  with the closure; turn them into fields of one small view-state object (step 4).
  Until then, a module that reads one takes a getter (`getCurrentSelection: () =>
  currentSelection`), never the value: generated-status (1126) would otherwise keep
  answering for the launch target after `/api/diff` reassigns `currentSelection` (1049).
- `closing` and `reviewerDisconnectTimer` cross the live-socket / lifecycle boundary.
  `closing` is written by `shutdown` (2487) and the close handler (2516) and read by the
  live-socket close handler (2452); the timer is set by the live socket (2458) and
  cleared by `connectLiveTab` (2421), `shutdown` (2488) and the close handler (2517).
  Give both modules one shared object (or getters plus a `cancelIdleExit()`). If
  `live-socket.ts` copied `closing` by value, `shutdown()` terminating the sockets
  (2494) would schedule the idle exit and call `process.exit(0)` mid-shutdown; the
  `process.exit` stub in server.test.ts would hide it.
- `cleanKey` is assigned at 637, after `loadSavedReview` (280-288) has already run for
  the initial named review (311). `ReviewPersistence` needs a setter for it.
- server.test.ts mocks `./git-diff.js` with a factory that returns only
  `{ GitDiffParser }` (123-185, no `importOriginal`). A moved helper imported from
  `git-diff.js` makes Vitest throw `No "<name>" export is defined on the mock`, so new helpers go in their own modules.
- `static.ts` must not compute its own asset path: server.ts resolves
  `join(__dirname, '..', 'client')` (2313), which from `dist/server/routes/static.js`
  would be `dist/server/client`, not Vite's `dist/client`. Pass `distPath` in from
  server.ts. The only production-branch test (2189, "serves static files in production
  mode") accepts 200 or 404, so it would not notice.
- `inbox` is assigned after listen (2347) but read by routes (824, 2290, 2298) and the
  idle exit (2461). Pass it as a getter.
- `Conversation` is constructed with a callback that calls `scheduleSave` (407-418), and
  the save queue reads the conversation. The persistence object must take
  `getConversation: () => Conversation | undefined`, or receive `exportReview` later.
- `review-store.ts` is the file layer and stays separate; the new persistence module
  holds per-server ownership and the save queue.
- `/api/conversation/events` is a long poll, not SSE.
- knip fails on an export left unused after a move.

## Design (proposed, confirm before step 3)

- **Routes register as `register*Routes(app, deps)`**, following
  `registerConversationRoutes` (conversation.ts:555). Alternative: `express.Router`
  mounted at `/api`; it works as long as the body parsers stay in server.ts in order.
  Preferred because it matches existing code.
- **Each route module takes a narrow dependency type** listing what it uses.
  Alternative: one shared context object. Rejected because it turns the closure into a
  god object with a different name and hides each module's real dependencies.

## Target modules

Pure moves (no closure state):

| Target                            | Takes                                                                                                                                                         | About |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `server-port.ts` (exists)         | `startServerWithFallback` 2575-2611                                                                                                                           | +37   |
| new `diff-cache.ts`               | 141-176 and `invalidateCache` 616-621                                                                                                                         | 50    |
| new `comment-payload.ts`          | `normalizeLineValue`, `normalizeComment`, `normalizeThreadPayload`, `parseCommentsPayload` 1311-1457 (shrinks if the legacy `comments` body is removed first) | 147   |
| `utils/diffSelection.ts` (exists) | `createResolvedCommentSelection` 185-202; a `selectionFromQuery(query, fallback)` replacing the duplicate at 738-754 and 988-1007                             | +40   |
| new `repository-path.ts`          | `parseRepositoryRelativePath` 672-699 with `repositoryPath` as a parameter                                                                                    | 30    |
| `utils/editorOptions.ts` (exists) | Editor configuration 330-371 as `resolveServerEditor(env, {stdinDiff})`                                                                                       | +45   |
| `utils/fileUtils.ts` (exists)     | MIME table 1281-1298 as `contentTypeFor(path)`; `client/utils/imageUtils.ts:7-23` derives its extension lists from it                                         | +25   |
| `user-config.ts` (exists)         | `updateCheckDisabledBy` 326-329                                                                                                                               | +8    |
| `access-token.ts` (exists)        | `hasAccessToken` 314-322 and the `/api` middleware 553-559; the WebSocket upgrade (2382) uses the same check                                                  | +20   |

State objects:

| Target                       | Takes                                                                                                                                                                                                                                                                              | About |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| new `review-persistence.ts`  | 256-310, save queue 419-510, `storeStatus` 1546-1566, the persistence lines of the delete route (944, 947, 953-956), release on close 2513-2515; a `cleanKey` setter                                                                                                               | 170   |
| new `comment-sessions.ts`    | `CommentSessionState`, 701-730, 968-984, 1459-1531                                                                                                                                                                                                                                 | 120   |
| `review-summary.ts` (exists) | A `ReviewSummaries` class: `summaries`, `resolvedWorkingTreeSelections` and `workingTreeTracking` (631-632), 1568-1661, `normalizeCommitMessage`, `EMPTY_DIFF_DIGEST`, launch seeding 650-667                                                                                      | 130   |
| new `verdicts.ts`            | `approvals`, `VERDICT_LOG_NAMES`, `VerdictRefusal`, `reportVerdict`, `checkVerdict`, `clearVerdict` 2115-2219, and `getApproval(selection)` replacing the three copies at 2197, 2211, 2226                                                                                         | 110   |
| new `server-context.ts`      | View state `{currentSelection, currentCommentSelection, launch, commentImportSelection}` and `retargetNamedReview` 871-882 (it re-keys `commentSessions` at 878-881: take the raw Map at step 4, and move that part into `CommentSessions` at step 6); the narrow dependency types | 40    |

Route modules (new `src/server/routes/*.ts` unless noted):

| Module                                      | Takes                                                                                | About |
| ------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| `named-reviews.ts`                          | 775-966                                                                              | 200   |
| `diff.ts`                                   | `/api/diff`, `/api/revisions` 986-1106, 1154-1195; `parseNamedDiff` 584-597          | 180   |
| `files.ts`                                  | generated-status, line-count, blob 1108-1151, 1197-1309                              | 160   |
| `comments.ts`                               | 1730-1788, 1903-2008                                                                 | 165   |
| `review-ops.ts`                             | 1790-1901                                                                            | 112   |
| `summary.ts`                                | 1663-1728                                                                            | 66    |
| `approval.ts`                               | 2221-2243 (ship-it goes in `p1-20261114-remove-backward-compat.md`)                  | 30    |
| `editor.ts`                                 | 2010-2105                                                                            | 96    |
| `static.ts`                                 | 2307-2333, with `distPath` passed in (see Lore)                                      | 27    |
| `registerInboxRoutes` in `session-inbox.ts` | 2278-2306                                                                            | 30    |
| new `live-socket.ts`                        | 2367-2469, with `onLastReviewerGone()` passed in                                     | 105   |
| new `lifecycle.ts`                          | `outputFinalComments`, `outputShutdown`, `shutdown`, `whyNotDone`, the close handler | 60    |

## Tasks

One commit each. Move each `server.test.ts` describe block in the same commit as its
code. Acceptance for every step: `pnpm test` passes with the listed tests unchanged in
their assertions; `pnpm build`, `pnpm check` (oxlint) and `pnpm knip` pass. Pins name
the describe or `it` at `d905dec`, because the prerequisite plans renumber
server.test.ts.

1. Pure helper moves, one commit each. Pins (server.test.ts at `d905dec`): diff cache
   "GET /api/diff caches results per revision pair…" and "…evicts least recently used
   cached diff responses"; comment payload: describe "Comments API" and "preserves
   supported excerpts…" (add unit tests in the new module); `parseRepositoryRelativePath`:
   the "rejects paths outside repository" / "rejects parent traversal paths" `it`s of
   generated-status, line-count and blob; editor: the open-in-editor `it`s in "API
   endpoints" (1129-1225); update-check: describe at 4133; MIME: the blob content-type
   `it`s (2374, 2397); port fallback: the "Server startup" busy-port and fallback `it`s
   (670, 1019) and server-port.test.ts; selection helpers: the `it`s from "GET /api/diff
   returns diff data" through "GET /api/diff omits comment import payload after revision
   changes".
2. Access-token module. Pins: in "API endpoints", "puts the access token in the launch
   link fragment", "serves the app shell without a token and refuses a large body before
   parsing it", "accepts the token in the header or, for media sources, the query"; in
   "Live connection", the `it`s from "accepts a reconnect to the same server and refuses
   one meant for another" through "answers an upgrade with an unparseable URL with 400
   and keeps serving".
3. Leaf route modules: static (describe "Static file serving"; first add a test that a
   built `dist/client` is served with 200 at `/`, or run `node dist/cli/index.js` and
   load the page), inbox and presence (session-inbox.integration.test.ts, keep-alive),
   editor and settings (open-in-editor `it`s; describe "auto-viewed patterns API"),
   files (describes "Line count API" and "Blob API endpoints"; the `GET /api/generated-status/*`
   `it`s including "…returns 400 for stdin diff"; named-reviews frozen-capture checks).
   `files.ts` reads `currentSelection` through a getter (see Lore).
4. View-state object. The riskiest mechanical step. Pins: the `GET /api/diff` group;
   891 ("pins readiness to the launch review…"); "Revision options API" 2222-2262;
   named-reviews.integration rename and delete.
5. `ReviewPersistence`. Pins: review-store.integration.test.ts; the 503 and lock cases in
   review-ops.integration.test.ts; named-reviews rename and delete.
6. `CommentSessions` and the comments routes. Pins: describe "Comments API"; the `it`s
   from "POST /api/comments accepts comment data" through "DELETE
   /api/comments/:threadId returns 404 for unknown thread"; "isolates comment sessions
   between different diff selections"; review-ops.integration.
7. `ReviewSummaries` and the summary routes. Pins: "Review summary API" 3900-4132,
   committed-summary.integration, live-approval.integration.
8. Verdicts and the approval routes. Pins: live-approval.integration, "approval requests
   and notifications" 2467-2534, named-reviews approval tests,
   conversation-approval.test.ts.
9. Review-ops routes (needs 5, 6, 8). Pins: review-ops.integration.test.ts.
10. Named-reviews routes (needs 4, 5, 6). Pins: named-reviews.integration.test.ts.
11. Diff routes (needs 4, 7). Pins: the `GET /api/diff` `it`s, describe "Clear
    Comments", and the stdin `it`s "GET /api/diff sets openInEditorAvailable=false for
    stdin diff", "…gives each stdin patch its own digest", "…has no stdin digest for a
    Git diff".
12. Live socket and lifecycle. Pins: "Live connection" 2732-3007, "Keep-alive"
    2535-2731, "Server startup" 669-1069.
13. Leftover `server.test.ts` blocks: "Conversation API" (3055-3899) exercises
    conversation.ts:555-721 and moves to `conversation-routes.test.ts` (matching the module
    name in `p3-20261114-server-modules.md` task 8); "keeps serialized
    server event fields aligned with the schema command" (3136-3450) arguably belongs in
    `src/cli/schema.test.ts`.

### Duplication to remove while moving (same commits)

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
- The stdin refusal answers 400 at 1113, 1164, 2027 and 404 at 1203, 1272 for the same
  condition. Unifying the status is a behavior change: separate commit, ask first.
- The idle-exit sequence (2458-2466) duplicated the ship-it one (2265-2273), which the
  compat plan removes, so after that it has one caller; move it into `lifecycle.ts` as
  is.

### Not in scope (noted for a later decision)

- Fallbacks that hide errors: line-count turns a Git error into `0` (1228-1239); blob
  turns any error into 404 "File not found" (1305-1307); `|| 'HEAD'` at 1126, 1276.
  `||` where `??` is meant at 1126, 1276, 2343 (changing these changes behavior); at
  372, 527 and 1298 `??` gives the same result for the types involved, so those can
  change in any commit.
- Request bodies are checked by hand with `typeof` per route (804, 838, 886, 1932,
  2032). See the arc's "Rejected for now" on a validator library.
