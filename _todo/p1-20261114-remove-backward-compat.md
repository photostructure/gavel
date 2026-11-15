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

Next: task 1 (in-process compat), one commit per item.

- [x] Inventory (below)
- [ ] In-process compat removed
- [ ] Persisted-data compat removed
- [ ] Agent-contract compat removed, skill and docs updated
- [ ] Reviewed

## Required reading

- `AGENTS.md` (commit trailers: `!` and `Changelog:` for removed endpoints, flags, fields)
- `p1-20261114-refactor-arc.md`
- `docs/agent-conversations.md` ("Compatibility" section, saved reviews)
- `_todo/p2-20261107-server-only-review-state.md` (the "Migration" bullet under "Done
  (2026-11-11)" describes the thread migration this plan deletes; the "What the browser
  stores now" section stays)
- `p1-20261114-delete-dead-code.md`: both plans edit App.tsx:1736-1765 and
  `StorageService.getCommentThreads` / `removeCommentThreads`. Run this plan's task 2 thread-copy item
  first, so the dead-code plan does not edit `branchToHash` in code this plan deletes.

## Lore

- Before the difit-to-gavel rename (ec44ff7) and 318ce1b, gavel had settings migrations.
  They are gone: no `DIFIT_*` variables, no `difit-` storage keys, no `.git/difit` reads.
- The only way a page and a server run different builds, apart from `pnpm dev`, is a
  server left running across `pnpm build`: `express.static` (server.ts:2313) serves the
  new `dist/client` to the old server's page. The access token is per user, not per
  launch, so it does not stop this.
- Saved reviews expire: `vacuum()` (review-store.ts:390, run at server.ts:265) deletes
  records untouched for 7 days. Browser records never expire, because
  `StorageService.cleanupOldData` has no production caller (see
  `p1-20261114-delete-dead-code.md`).
- `format: 1` on saved reviews (server.ts:483, review-store.ts:59) is never read. It is
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

- The "older server" wording around `delivery` being undefined (App.tsx:2557-2559,
  AgentDeliveryStatus.tsx:309). `--no-conversation` returns `{reviews: []}` from
  `/api/inbox`, so `delivery` is undefined then too. Only the wording is stale: say "a
  server without conversations" instead; that rewording is tracked in
  `p2-20261114-small-audit-defects.md`. (`useInboxDelivery`'s non-OK-response fallback
  is compat; see task 1.)
- The 404 message in `gavel wait` (wait.ts:66-70) fires against a current server started
  with `--no-conversation --no-jsonl`, which registers no conversation routes
  (server.ts:253-255, 1533). Keep the conversation-mode hint; drop only its "needs a
  build with /api/conversation/events" wording (and the same at
  waiting-for-review.md:208-209).
- `--lgtm` / `--ship-it` (added together in 6f09ae5), `-v`, `@` for HEAD.
- Capture `schemaVersion` stays: `validateCapture` rejects any other value with an error
  (review-capture.ts:482-483), and it is part of the capture JSON that agents read. The
  other one-value version fields (`DiffContextStorage.version`,
  `ViewedHashIndex.version`, `hashVersion`, config.json `version`) are not compat but
  serve no reader; `p1-20261114-delete-dead-code.md` deletes them.
- `codex-queue.ts:74-77` probes `codex queue --help`. It handles older Codex CLIs, not
  older gavel.
- `normalizeStoredSettings` (useAppearanceSettings.ts:21-43) merges defaults over the
  stored settings cookie. No settings field or approval animation was added after the
  `gavel-settings` cookie began (ec44ff7, 2026-11-07; the last, `balloons`, was 0e25759 on
  2026-11-06), and every save writes the whole object, so removing it deletes nothing an
  existing cookie needs. It keeps the next new field from reading as `undefined` (and
  throwing for object-valued reads such as `settings.approvalAnimations[id]`,
  SettingsModal.tsx:484). Keep it. Its font-family matching (useAppearanceSettings.ts:28-34)
  is compat, though: it maps a saved font stack to a newer one. It came in with cf5e556
  (2026-11-04), before the `gavel-settings` cookie began (ec44ff7, 2026-11-07), and no
  font stack in SettingsModal.tsx changed between ec44ff7 and `d905dec`. Delete it and
  the non-object check at :22-24 (`readClientSettings` already throws on a non-object
  cookie). Keep the two spreads:
  `raw === undefined ? DEFAULT_SETTINGS : { ...DEFAULT_SETTINGS, ...raw, approvalAnimations: {...} }`.
- `scripts/measure-performance.js:402-428` rejects a positional size argument. It is
  argument validation, not compat: without it `pnpm perf large` would silently run the
  `medium` case. Keep it (a generic "unexpected argument" message is fine).

## Tasks

### 1. In-process compat (no persisted data involved)

Each is its own commit.

- **`POST /api/ship-it`** (server.ts:2245-2275, commented "Compatibility for older
  clients"). No client code calls it, and since 32e7e75 it needs `X-Gavel-Token`, which
  no script sends. Also remove the shutdown reason `'approved'` that only this route
  emits (types/events.ts:23, schema.ts:393) and the `selection` parameter of
  `outputFinalComments` (server.ts:2108). Delete the six tests at server.test.ts:4273,
  4313, 4356, 4395 (the `it.each` "rejects browser-simple $contentType approval
  requests"), 4415, 4449 and live-approval.integration.test.ts:244-249; edit
  agent-conversations.md:466-469. Breaking for JSONL consumers matching `'approved'`:
  `!` and a `Changelog:` trailer.
  Acceptance: `pnpm test server live-approval schema` passes; `rg "ship-it" src` finds
  only the CLI flag.
- **Earlier queue receipt** `EarlierQueueReceipt` / `normalizeDelivery`
  (useInboxDelivery.ts:18-35, cast at :52-54). The server emits only
  `via: 'inbox' | 'prompt'`. Delete the `it.each` at useInboxDelivery.test.ts:57-80.
- **`useInboxDelivery`'s fallback for a non-OK or non-JSON `/api/inbox` answer**
  (useInboxDelivery.ts:45-50) and its tests "ignores a response from a server that
  predates the inbox" (useInboxDelivery.test.ts:174) and "reports nothing when the
  server has no inbox endpoint" (:184). Delete the non-JSON fallback
  (`.catch(() => undefined)`, the `Array.isArray(body?.reviews)` check, the "server older
  than the inbox" comment) and the test at :174, which serves HTML with status 200. Keep
  `response.ok`: a current server answers a missing or wrong token with HTTP 401 and
  `{error}` (server.ts:553-558), and `apiFetch` does not throw on a non-OK status. Change
  the 404 test at :184 to that 401 case and rename it. Not confirmed: whether the hook
  runs while the access screen shows; if it cannot, the `ok` check can go too.
- **Upstream diff-mode names** `side-by-side` / `inline` (utils/diffMode.ts:7-12 and
  `parseDiffViewMode`, App.tsx:136, 138). No
  gavel build wrote them into the `gavel-settings` cookie. Unknown values already fall
  back to `split`.
- **Unused `DiffLine.type` variants** `'hunk' | 'remove' | 'context' | 'header'`
  (types/diff.ts:29), left from upstream's TUI (added in a212b4e, since removed). The
  parser emits only add, delete, normal (git-diff.ts:721). Delete the readers at
  MarkdownDiffViewer.tsx:73, 75, 98, NotebookDiffViewer.tsx:90, 92 and
  client/utils/diffUtils.ts:53; change the `'context'` fixtures in
  MarkdownDiffViewer.test.tsx to `'normal'`. Acceptance: `pnpm build` (tsc) passes.
- **`comment add` defaults** for fields every server sends (comment.ts:15-20 optional
  types, :89-92 `?? true`, `?? imports.length`, `?? []`).
- **`gavel wait`'s missing-presence error** (wait.ts:129-134; test
  wait.test.ts:326-332). The server always passes presence (server.ts:1534-1542). The
  404 message at 66-70 stays (see "Looks like compat").
- **`ReviewContext` returning null without context** (ReviewContext.tsx:37-39, test
  ReviewContext.test.tsx:79-82), **AboutPanel's "Review information is unavailable from
  this server."** (AboutPanel.tsx:219-225), and **StorageService's missing-`repositoryId` path**
  (test labelled "backward compatibility", StorageService.test.ts:108-112). The server
  always sends both. Not confirmed: whether the client reads storage before `/api/diff`
  answers. Check that first; make `DiffResponse.repositoryId` (types/diff.ts:85) and
  `DiffResponse.reviewContext` (:86) required if it holds.
- **`launchUrl ?? url`** in dev/dev-stdout.js:28-31 (`launchUrl` is required by
  schema.ts:369).
- **Docs and skill text advising older builds**: SKILL.md:86-87,
  agent-conversations.md:537-541 and :469, waiting-for-review.md:50-51 and :208-211.
  Move the current HTTP reference at agent-conversations.md:543-552 out from under the
  "Compatibility" heading.

### 2. Persisted-data compat

Each removal silently drops some of Matthew's existing browser or saved data. That is
accepted by his 2026-11-14 decision; the effect of each is recorded so it does not
surprise him.

- **Copy of pre-review-op browser threads into the op queue**: App.tsx:1736-1765,
  `getCommentThreads` / `removeCommentThreads` (StorageService.ts:235-283), and the
  `threads?` / `deletedComments?` fields of `DiffContextStorage` (types/diff.ts:222-227;
  `DeletedComment` itself stays, `useDiffComments` uses it). Tests: App.reviewOps
  `legacyRecord` (282-293) and its two tests (1026-1087), StorageService.test.ts:156-199,
  App.reviewOps "reads the old browser copy of a review once…" (895-905, spies on
  `getCommentThreads`), App.namedReviews `keepLegacyThreads` (277-283). Effect: a browser
  record not reopened since dd6f723 landed (2026-11-12) keeps threads the server never
  got; they are never sent.
  Coordinate with `_todo/p2-20261107-server-only-review-state.md` and delete its lines
  about the migration in the same commit.
- **Old `review:<name>` storage key** (`getNamedReviewStorageRef`, App.tsx:167-174).
  Replace with the hex key for every name (keeping only one form avoids the
  `a.b` / `a_2e_b` collision that `generateStorageKey`, StorageService.ts:31-34,
  creates). Tests: App.namedReviews.test.tsx:612-651 ("does not restore ambiguous legacy
  discussion into %s", "recovers the existing unambiguous legacy discussion for %s").
  Effect, for every existing named review whose name has no `.`: its unsent line,
  reply and edit drafts are no longer shown (the ref feeds `draftScope`,
  App.tsx:274-314, and useCommentDrafts.ts:68-75; they expire from localStorage after 7
  days), and its viewed-file records are not found under the new key. Viewed marks can
  still come back through the repository hash index (useViewedFiles.ts:170-192) when
  the file content is unchanged.
- **sessionStorage drafts** (a96706d, landed 2026-11-12): `STDIN_DIGEST_SUFFIX`
  (useCommentDrafts.ts:41), the call at :75, `copySessionDrafts` (:90-115), the comment
  at :145-147. Tests: the "drafts from sessionStorage" and "drafts of an unnamed stdin
  patch saved before scopes had a digest" describes (useCommentDrafts.test.tsx:337-473)
  and the sessionStorage half of `refuseStorageWrites` (:39) and `afterEach` (:49).
  Effect: none unless a tab has stayed open since a96706d landed (2026-11-12).
- **Optional `appliedOps` in saved reviews**: make `SavedReviewState.appliedOps`
  required (review-store.ts:47-48) and drop `?.length ?? 0` (server.ts:472). At
  conversation.ts:132 write `saved ? saved.appliedOps : []`: a brand-new review has no
  saved record and still needs an empty ledger, so the default cannot simply go. Do this
  on or after 2026-11-20, once vacuum (7 days by mtime) has removed records written
  before dd6f723 landed (2026-11-12 17:45 -0800). Earlier, a restored old record makes
  `[...this.getReview(selection).appliedOps]` (conversation.ts:160) throw a TypeError at
  startup or on the first request for that review. The splits do not wait for this
  item; it edits one line wherever server.ts:472 has moved to. Tests: delete
  review-ops.integration.test.ts:801-818 ("loads a saved record written before the
  ledger existed"); add `appliedOps: []` to the `SavedReview` fixtures at
  approval.test.ts:45-57, unapply.test.ts:339-349, review-store.integration.test.ts:600-611
  and review-store.test.ts:45-57. Acceptance: `pnpm test review-ops review-store approval
  unapply` and `pnpm build` pass.

### 3. Agent-contract compat

These change what an agent may send or read. Update `skills/gavel/` and
`docs/agent-conversations.md` in the same commit, mark the subject with `!`, and say in
the `Changelog:` trailer what an agent must change.

- **The `{comments: [...]}` body of `POST /api/comments`** (`LegacyComment`):
  `normalizeComment` (server.ts:1335-1370), the `comments` branch and error text
  (server.ts:1452-1456), `LegacyComment` and its `anyOf` branch (schema.ts:637-672), the
  "neither threads nor comments" wording (schema.ts:653), the `Comment` type
  (types/diff.ts:108-117), and the `Comment[]` branch of `formatCommentsOutput`
  (`normalizeLegacyComment`, commentFormatting.ts:94-113, union at :198-199; convert the
  three tests at commentFormatting.test.ts:294-366 to `CommentThread[]`). No caller in
  the repo sends this body (scripts/host-wait-e2e/run.sh posts `threads`). About 23
  server.test.ts sites use it as a fixture and need `threads` (242, 293, 778, 862, 958,
  1406, 1635, 1652, 1668, 1687, 1714, 1799, 2627, 3242, 3245, 3460, 3555, 3587, 3669,
  3741, 3825, 4285, 4368). Afterwards such a body gets HTTP 400.
- **`comment remove` alias** (comment.ts:138). Tests comment.test.ts:94-96, 379-394;
  docs agent-conversations.md:375 and :378.
- **Thread-level `isQuestion`**, which predates root-message `intent` (498a059 then
  e56fe35). No saved data can hold `isQuestion` without a root intent, but the field is
  in the schema's `CommentThread` (schema.ts:64), so agents can read it. Read fallbacks:
  commentFormatting.ts:151, CommentThreadCard.tsx:682. Writers and pass-throughs:
  useDiffComments.ts:29, 79, 102, 108-112; reviewOps.ts:179-181; commentImports.ts:350,
  453-456; commentThreads.ts:12; server.ts:1381, 1423; App.tsx:1835; CommentForm.tsx:11, 86. Types: types/diff.ts:154, 239. Docs: agent-conversations.md:352-354. About 46
  fixture references across 12 test files (`rg -c isQuestion src`).
- **Reply without a revision cursor** (conversation.ts:661-665, 676, 690, 716;
  schema.ts:563-566; docs agent-conversations.md:406-408; the `reply` argument help in
  src/cli/conversation.ts:155, which says "optional cursor/author"). The skill already
  requires the cursor (skills/gavel/references/feedback.md:57). Find the tests that reply without
  one (`rg "conversation/reply" src --glob '*.test.*'`) before changing them.
- **Prefixed rename and copy metadata in input patches** (`extractMetadataPath`,
  git-diff.ts:575-586, from 4335456). Git never writes `rename from a/<path>`; only a
  hand-made stdin patch could. git-diff.test.ts:710-733 ("handles rename metadata with
  alternative git prefixes") pins the prefixed case: delete it, keeping coverage of
  native unprefixed rename metadata. review-capture.test.ts:127 feeds
  `rename from a/file.txt` without asserting the path; run it after the change.

## Not in scope

- Non-conversation mode (`--no-conversation --no-jsonl`) and its `approvals` /
  `summaries` maps in server.ts. It is a current option; removing it is a product
  decision, not compat. It is the largest second code path left in server.ts: 44 lines
  there match `approvals\b|summaries\b|!conversation|conversation ?|conversation?\.|if (conversation)`,
  and the two maps start at server.ts:512-513. Matthew decides whether it stays.
- `PUT`/`DELETE /api/approval`, `GET /api/presence` and `POST /api/comments` itself have
  no in-repo caller except scripts/host-wait-e2e/run.sh. They are documented agent API,
  not compat. Candidates if Matthew wants a smaller API. So is the second name of each
  approval flag (`--lgtm, --ship-it` and `--no-lgtm, --no-ship-it`, cli/index.ts:152-153).
