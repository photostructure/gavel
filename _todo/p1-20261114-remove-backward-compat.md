---
title: Remove code that exists only for older gavel builds and data shapes
priority: p1
section: Refactor
---

# TPP: Remove backward-compatibility code

## Summary

Matthew's decision (2026-11-14): gavel has no users besides him and its servers are
ephemeral, so every compatibility path goes. This plan lists each path found at
`d905dec`, what removing it deletes, and what happens to data he already has. Part of
`p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1 (in-process compat), one commit per item. Task 2's thread-copy item is done
(it ran first, as the arc orders).

- [x] Inventory (below)
- [ ] In-process compat removed
- [ ] Persisted-data compat removed
- [ ] Agent-contract compat removed, skill and docs updated
- [ ] Reviewed

## Required reading

- `AGENTS.md` (commit trailers: `!` and `Changelog:` for removed endpoints, flags, fields)
- `p1-20261114-refactor-arc.md`
- `p2-20261107-server-only-review-state.md` (the "Migration" bullet under "Done
  (2026-11-11)" describes the thread migration this plan deletes; the "What the browser
  stores now" section stays)
- `p1-20261114-delete-dead-code.md`: both plans edit App.tsx's thread-copy effect (`migratedRecordsRef`) and
  `StorageService.getCommentThreads` / `removeCommentThreads`. Run this plan's task 2 thread-copy item
  first, so the dead-code plan does not edit `branchToHash` in code this plan deletes.

## Lore

- Before the difit-to-gavel rename (ec44ff7) and 318ce1b, gavel had settings migrations.
  They are gone: no `DIFIT_*` variables, no `difit-` storage keys, no `.git/difit` reads.
- The only way a page and a server run different builds, apart from `pnpm dev`, is a
  server left running across `pnpm build`: `express.static` (in `startServer`, server.ts) serves the
  new `dist/client` to the old server's page. The access token is per user, not per
  launch, so it does not stop this.
- Saved reviews expire: `vacuum()` (review-store.ts, run from `startServer` in server.ts) deletes
  records untouched for 7 days. Browser records never expire, because
  `StorageService.cleanupOldData` has no production caller (see
  `p1-20261114-delete-dead-code.md`).
- `format: 1` on saved reviews (`saveReview` in server.ts, `SavedReview` in review-store.ts) is never read. It is
  not compat; `p1-20261114-delete-dead-code.md` deletes it as a write-only field.
- A removal often leaves something with nothing to do: a parameter only the removed path
  passed (`outputFinalComments`' `selection`), an optional field only it left unset
  (`DiffResponse.repositoryId?`), or a type only it used. Delete it or make it required
  in the same commit, and `rg` each removed name.
- 3221b79 changed `ReviewVerdict` from `'as-is' | 'after-comments' | 'reject'` to
  `'approve' | 'reject'` with no compat code. It landed on main on 2026-11-12 at 17:45
  -0800 (dd6f723 and a96706d landed in the same push), so saved records holding the old
  values expire by 2026-11-20 at the latest; nothing to do. Use landing dates
  (`git log -1 --format=%ci <sha>`), not author dates, for every date in this plan.

### Looks like compat, is current behavior (leave it)

- The "older server" wording around `delivery` being undefined (the comment above
  `ReviewPresenceIndicator` in App.tsx's `headerActions`, the doc comment on `AgentDeliveryStatus`). `--no-conversation` returns `{reviews: []}` from
  `/api/inbox`, so `delivery` is undefined then too. Only the wording is stale: say "a
  server without conversations" instead; that rewording is tracked in
  `p2-20261114-small-audit-defects.md`. (`useInboxDelivery`'s non-OK-response fallback
  is compat; see task 1.)
- The 404 message in `gavel wait` (`request` in wait.ts) fires against a current server started
  with `--no-conversation --no-jsonl`, which registers no conversation routes
  (`conversationEnabled`, and the `if (conversation)` around `registerConversationRoutes` in
  `startServer`). Keep the conversation-mode hint; drop only its "needs a
  build with /api/conversation/events" wording.
- `--lgtm` / `--ship-it` (added together in 6f09ae5), `-v`, `@` for HEAD.
- Capture `schemaVersion` stays: `validateCapture` rejects any other value with an error
  (review-capture.ts), and it is part of the capture JSON that agents read. The
  other one-value version fields (`DiffContextStorage.version`,
  `ViewedHashIndex.version`, `hashVersion`, config.json `version`) are not compat but
  serve no reader; `p1-20261114-delete-dead-code.md` deletes them.
- `sendToCodex` (codex-queue.ts) probes `codex queue --help`. It handles older Codex CLIs, not
  older gavel.
- `normalizeStoredSettings` (useAppearanceSettings.ts) merges defaults over the
  stored settings cookie. No settings field or approval animation was added after the
  `gavel-settings` cookie began (ec44ff7, 2026-11-07; the last, `balloons`, was 0e25759 on
  2026-11-06), and every save writes the whole object, so removing it deletes nothing an
  existing cookie needs. It keeps the next new field from reading as `undefined` (and
  throwing for object-valued reads such as `settings.approvalAnimations[id]`
  in `SettingsModal`). Keep it. Its font-family matching (`firstFamily`)
  is compat, though: it maps a saved font stack to a newer one. It came in with cf5e556
  (2026-11-04), before the `gavel-settings` cookie began (ec44ff7, 2026-11-07), and no
  font stack in SettingsModal.tsx changed between ec44ff7 and `d905dec`. Delete it and
  the non-object `return null` check at its top (`readClientSettings` already throws on a non-object
  cookie). Keep the two spreads:
  `raw === undefined ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...raw, approvalAnimations: {...} }`.
- The `positionalArgs` check in `main` of scripts/measure-performance.js rejects a positional size argument. It is
  argument validation, not compat: without it `pnpm perf large` would silently run the
  `medium` case. Keep it (a generic "unexpected argument" message is fine).

## Tasks

### 1. In-process compat (no persisted data involved)

Each is its own commit.

- **`POST /api/ship-it`** (server.ts, commented "Compatibility for older
  clients"). No client code calls it, and since 32e7e75 it needs `X-Gavel-Token`, which
  no script sends. Also remove the shutdown reason `'approved'` that only this route
  emits (`ServerShutdownEvent.reason` in types/events.ts and schema.ts) and the `selection`
  parameter of `outputFinalComments` (server.ts). Delete these six tests in server.test.ts's
  "Ship it option" describe: "prints comments, then the approval line, then exits on POST
  /api/ship-it", "writes JSONL approval and approved shutdown before draining ship-it
  output", "approves the requested selection after another tab changes revisions", the
  `it.each` "rejects browser-simple $contentType approval requests", "waits for stdout to
  flush before exiting", "does not register POST /api/ship-it without the shipIt option";
  and live-approval.integration.test.ts's "refuses the legacy approve-and-exit route". Breaking for JSONL consumers matching `'approved'`:
  `!` and a `Changelog:` trailer.
  Acceptance: `pnpm test server live-approval schema` passes; `rg "ship-it" src` finds
  only the CLI flag.
- **Earlier queue receipt** `EarlierQueueReceipt` / `normalizeDelivery`
  (useInboxDelivery.ts, and the cast to `EarlierQueueReceipt` in `refresh`). The server emits only
  `via: 'inbox' | 'prompt'`. Delete the `it.each` "normalizes an earlier running server queue
  receipt: %j" in useInboxDelivery.test.ts.
- **`useInboxDelivery`'s fallback for a non-OK or non-JSON `/api/inbox` answer**
  (in `refresh`, useInboxDelivery.ts) and its tests "ignores a response from a server that
  predates the inbox" and "reports nothing when the
  server has no inbox endpoint" (useInboxDelivery.test.ts). Delete the non-JSON fallback
  (`.catch(() => undefined)`, the `Array.isArray(body?.reviews)` check, the "server older
  than the inbox" comment) and the "predates the inbox" test, which serves HTML with status 200. Keep
  `response.ok`: a current server answers a missing or wrong token with HTTP 401 and
  `{error}` (the `/api` middleware in server.ts that calls `hasAccessToken`), and `apiFetch` does not throw on a
  non-OK status. Change the "no inbox endpoint" 404 test to that 401 case and rename it. Not confirmed: whether the hook
  runs while the access screen shows; if it cannot, the `ok` check can go too.
- **Upstream diff-mode names** `side-by-side` / `inline` (`normalizeDiffViewMode` in utils/diffMode.ts
  and `parseDiffViewMode` in App.tsx). No
  gavel build wrote them into the `gavel-settings` cookie. Unknown values already fall
  back to `split`.
- **Unused `DiffLine.type` variants** `'hunk' | 'remove' | 'context' | 'header'`
  (types/diff.ts), left from upstream's TUI (added in a212b4e, since removed). The
  parser emits only add, delete, normal (`parseChunks` in git-diff.ts). Delete the readers:
  the `'remove'` / `'context'` checks in `isDeletionLine` and `isContextLine` and the `'header'` /
  `'hunk'` skip in `buildPreviewBlocks` in MarkdownDiffViewer.tsx, the same two checks in
  NotebookDiffViewer.tsx,
  and the `filter` in `getDiffContentForHashing` (client/utils/diffUtils.ts); change the `'context'` fixtures in
  MarkdownDiffViewer.test.tsx to `'normal'`. Acceptance: `pnpm build` (tsc) passes.
- **`comment add` defaults** for fields every server sends (comment.ts: the optional
  types of `CommentImportResponse`, and `?? true`, `?? imports.length`, `?? []` in the `add`
  action of `createCommentCommand`).
- **`gavel wait`'s missing-presence error** (`waitForPort` in wait.ts; test
  "rejects an older server that cannot report presence" in wait.test.ts). The server always
  passes presence (the `registerConversationRoutes` call in `startServer`). The
  404 message in `request` stays (see "Looks like compat").
- **`ReviewContext` returning null without context** (`if (!context) return null` in
  `ReviewContext`, test "renders nothing for older servers without context" in
  ReviewContext.test.tsx), **AboutPanel's "Review information is unavailable from
  this server."** (AboutPanel.tsx), and **StorageService's missing-`repositoryId` path**
  (test "should work without repositoryId (backward compatibility)" in StorageService.test.ts). The server
  always sends both. Not confirmed: whether the client reads storage before `/api/diff`
  answers. Check that first; make `DiffResponse.repositoryId` and
  `DiffResponse.reviewContext` (types/diff.ts) required if it holds.
- **`launchUrl ?? url`** in dev/dev-stdout.js (`launchUrl` is required by
  `ServerReadyEvent` in schema.ts).
- **Skill text advising older builds**: the `--version` / `--help` capability check under
  "Prepare and launch" in skills/gavel/SKILL.md.

### 2. Persisted-data compat

Each removal silently drops some of Matthew's existing browser or saved data. That is
accepted by his 2026-11-14 decision; the effect of each is recorded so it does not
surprise him.

- Done: **Copy of pre-review-op browser threads into the op queue**: App.tsx's thread-copy effect
  (`migratedRecordsRef`), `getCommentThreads` / `removeCommentThreads` (StorageService.ts), and the
  `threads?` / `deletedComments?` fields of `DiffContextStorage` (types/diff.ts;
  `DeletedComment` itself stays, `useDiffComments` uses it). Tests: App.reviewOps
  `legacyRecord` and its two tests ("sends the threads an earlier version kept in the browser
  once, then removes them", "does not send the threads an earlier version kept when started
  with --clean"), StorageService.test.ts's "reads and removes the sent threads earlier versions
  kept, and keeps viewed files", App.reviewOps "reads the old browser copy of a review once…"
  (spies on `getCommentThreads`), App.namedReviews `keepLegacyThreads`. Effect: a browser
  record not reopened since dd6f723 landed (2026-11-12) keeps threads the server never
  got; they are never sent.
  Coordinate with `p2-20261107-server-only-review-state.md` and delete its lines
  about the migration in the same commit.
- **Old `review:<name>` storage key** (`getNamedReviewStorageRef`, App.tsx).
  Replace with the hex key for every name (keeping only one form avoids the
  `a.b` / `a_2e_b` collision that the `encode` helper in `generateStorageKey`
  (StorageService.ts) creates). Tests: the two App.namedReviews tests that pinned this key observed it only
  through the thread copy and went with it, so no App-level test covers the
  `named-review:` hex branch until this item adds one.
  Effect, for every existing named review whose name has no `.`: its unsent line,
  reply and edit drafts are no longer shown (the ref feeds `draftScope`
  through `storageSelection` and `commentsContextKey` in `App`, and `readDrafts` in
  useCommentDrafts.ts; they expire from localStorage after 7
  days), and its viewed-file records are not found under the new key. Viewed marks can
  still come back through the repository hash index (the `getViewedHashIndex` lookup in `useViewedFiles`) when
  the file content is unchanged.
- **sessionStorage drafts** (a96706d, landed 2026-11-12): `STDIN_DIGEST_SUFFIX`
  (useCommentDrafts.ts), the `copySessionDrafts` call in `readDrafts`, `copySessionDrafts`,
  the comment on `sweepExpiredDrafts` that mentions it. Tests: the "drafts from
  sessionStorage" and "drafts of an unnamed stdin patch saved before scopes had a digest"
  describes (useCommentDrafts.test.tsx) and the sessionStorage half of `refuseStorageWrites`
  and `afterEach`.
  Effect: none unless a tab has stayed open since a96706d landed (2026-11-12).
- **Optional `appliedOps` in saved reviews**: make `SavedReviewState.appliedOps`
  required (review-store.ts) and drop `?.length ?? 0` (the `worthSaving` check in `saveReview`,
  server.ts). In `Conversation.getReview` (server/conversation.ts) write `saved ? saved.appliedOps : []`: a brand-new review has no
  saved record and still needs an empty ledger, so the default cannot simply go. Do this
  on or after 2026-11-20, once vacuum (7 days by mtime) has removed records written
  before dd6f723 landed (2026-11-12 17:45 -0800). Earlier, a restored old record makes
  `[...this.getReview(selection).appliedOps]` (`Conversation.getAppliedOps`) throw a TypeError at
  startup or on the first request for that review. The splits do not wait for this
  item; it edits one line wherever `saveReview`'s `worthSaving` check has moved to. Tests:
  delete review-ops.integration.test.ts's "loads a saved record written before the
  ledger existed"; add `appliedOps: []` to the `SavedReview` fixtures: `saved` in
  approval.test.ts, `saved` in unapply.test.ts's "picks a saved review by name, and asks for a
  digest when the name is ambiguous", `savedFixture` in review-store.integration.test.ts,
  and `review` in review-store.test.ts. Acceptance: `pnpm test review-ops review-store approval
  unapply` and `pnpm build` pass.

### 3. Agent-contract compat

These change what an agent may send or read. Update `skills/gavel/` and the affected
`--help` and `gavel schema` text in the same commit, mark the subject with `!`, and say in
the `Changelog:` trailer what an agent must change.

- **The `{comments: [...]}` body of `POST /api/comments`** (`LegacyComment`):
  `normalizeComment` (server.ts), the `comments` branch and error text of
  `parseCommentsPayload` (server.ts), `LegacyComment` and its `anyOf` branch in
  `CommentsRequest` (schema.ts), the "neither threads nor comments" wording in the
  `CommentsRequest` description (schema.ts), the `Comment` type
  (types/diff.ts), and the `Comment[]` branch of `formatCommentsOutput`
  (`normalizeLegacyComment` and the union in `formatCommentsOutput`'s signature,
  commentFormatting.ts; convert the three tests in the `formatCommentsOutput` describe of
  commentFormatting.test.ts to `CommentThread[]`). No caller in
  the repo sends this body (scripts/host-wait-e2e/run.sh posts `threads`). About 23
  server.test.ts sites use it as a fixture and need `threads`
  (`rg -n '\{ comments\b|^\s*comments: \[' src/server/server.test.ts` lists them). Afterwards such a body gets HTTP 400.
- **`comment remove` alias** (`.alias('remove')` in `createCommentCommand`, comment.ts). Tests
  "reserves "remove" as an alias for deletion" and "works via the remove alias" in
  comment.test.ts.
- **Thread-level `isQuestion`**, which predates root-message `intent` (498a059 then
  e56fe35). Moved to p2-20261117-drop-comment-intents.md, which removes it together with
  `intent`; the page stopped reading and writing both in 429df7f.
- **Reply without a revision cursor** (the optional-`cursor` validation and the
  `input.cursor` checks in the `/api/conversation/reply` route of `registerConversationRoutes`,
  server/conversation.ts; `ReplyRequest`'s required list and description in schema.ts; the
  `reply` argument help in `addConversationCommands`, src/cli/conversation.ts, which says
  "optional cursor/author"). The skill already requires the cursor (the "Reply requires"
  sentence in skills/gavel/references/feedback.md). Find the tests that reply without
  one (`rg "conversation/reply" src --glob '*.test.*'`) before changing them.
- **Prefixed rename and copy metadata in input patches** (`extractMetadataPath`,
  git-diff.ts, from 4335456). Git never writes `rename from a/<path>`; only a
  hand-made stdin patch could. git-diff.test.ts's "handles rename metadata with
  alternative git prefixes" pins the prefixed case: delete it, keeping coverage of
  native unprefixed rename metadata. The `rename` row of review-capture.test.ts's `it.each`
  "requires a whole-file ID for %s metadata alongside a hunk" feeds
  `rename from a/file.txt` without asserting the path; run it after the change.

## Not in scope

- Non-conversation mode (`--no-conversation --no-jsonl`) and its `approvals` /
  `summaries` maps in server.ts. It is a current option; removing it is a product
  decision, not compat. It is the largest second code path left in server.ts: 44 lines
  there match `approvals\b|summaries\b|!conversation|conversation ?|conversation?\.|if (conversation)`,
  and the two maps are declared as `const approvals` and `const summaries` in `startServer`. Matthew decides whether it stays.
- `PUT`/`DELETE /api/approval`, `GET /api/presence` and `POST /api/comments` itself have
  no in-repo caller except scripts/host-wait-e2e/run.sh. They are documented agent API,
  not compat. Candidates if Matthew wants a smaller API. So is the second name of each
  approval flag (`--lgtm, --ship-it` and `--no-lgtm, --no-ship-it`, cli/index.ts).
