---
title: Split git-diff.ts, and share the helpers server code repeats
priority: p3
section: Refactor
---

# TPP: Server modules

## Summary

`git-diff.ts` (1,035 lines) mixes Git I/O with about 470 lines of pure unified-diff
parsing that tests reach through 34 `(parser as any).parseFileBlock` casts. Server and
shared code also repeat the Git repository-environment list, sha256-hex (11 sites), `isRecord` (six copies), `processAlive`, the inbox registry
path, and the enumerations that `src/cli/schema.ts` and `src/types` both spell out.
Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1.

- [x] Inventory (below, at `d905dec`)
- [ ] Tasks, one commit each
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- The comment above `REPOSITORY_ENVIRONMENT` in `src/server/git-client.ts` (says direct Git invocations should agree with
  simple-git's environment)
- `p3-20261110-git-env-config-isolation.md`

## Lore

- Path unquoting differs on purpose: capture (`decodePath` in review-capture.ts) throws on
  non-UTF-8 paths and unknown escapes; the viewer (`decodeGitPath` in git-diff.ts) returns Git's
  quoted form. A shared function that unquotes to bytes, with each caller keeping its
  own UTF-8 rule, keeps both. The quote and space checks in `parseDiffHeaderPaths` (git-diff.ts) treat any backslash-preceded quote as
  escaped, which misreads a path ending in `\`; `gitHeaderPaths` in review-capture.ts tracks escape
  state correctly (reasoned, not reproduced).
- `parsePatch(capture.patch)` reparses the whole patch (up to 8 MiB) on every call to
  `capturedFileContent`, `pathsWithoutContext`, `filesWithoutAddedLines` and
  `selectCapture`; `capturedFileContent` runs once per blob request. Reasoned, not
  measured. Memoizing by capture digest would avoid it; measure first.
- `src/utils` is shared with the browser, so `node:crypto` helpers do not go there.
- `git` in `approval.ts` runs `git diff --full-index` without `gitEnvironment` on purpose:
  it must match the digest of the diff the gavel skill pipes.
- `isRecord` copies disagree on arrays: those in review-capture.ts and commentImports.ts
  allow them; those in user-config.ts and userSettings.ts (named `isPlainObject`), cli/review.ts and utils/reviewOps.ts
  reject them. Check the two permissive callers before switching.
- Simplicity: share constants, regexes and identical functions (`digest`, `isRecord`,
  the hunk regex, `serializeLineRange`). Do not build a general runner or mapper whose
  options encode each caller's differences. Split a file only for conflicts or coupling
  that the git log shows.

## Tasks

Acceptance for each: listed tests pass (tasks 1-2 rewrite git-diff.test.ts; its `it`
names must survive); `pnpm build`, `pnpm check` and `pnpm knip` pass.

1. **Split git-diff.ts.** Move unified-diff parsing (`parseUnifiedDiff`,
   `foldTypeChange`, `splitPlainUnifiedDiff`, `decodeGitPath`, `extractPathFromLine`,
   `parseDiffHeaderPaths`, `extractMetadataPath`, `parseFileBlock`,
   `countLinesFromChunks`, `parseChunks`) into
   `src/server/unified-diff.ts` as plain functions; none uses `this.git`. Tests call them
   directly instead of through `(parser as any)`. Leave no delegating method on
   `GitDiffParser` for a function that only tests called. While there: `getDefaultBranch`
   and `getOriginDefaultBranch` parse `symbolic-ref` the same way;
   use `isWorkingTreeTarget` only where all three of `'.'`, `'working'`, `'staged'` are
   tested (`validateCommit`, and the `currentBase` and `currentTarget` checks in
   `getRevisionOptions`). Keep `getGitattributesSourceArgs` and
   `getBlobContent` as they are: they test only `'working'` and `'.'` and send
   `staged` to the index (`--cached`, `git show :path`); `isWorkingTreeTarget` there
   would read the working tree for a staged review (pinned by "uses git show for staged
   files"). `shortHash` for `hash.substring(0, 7)` (in `resolveCommitish` and `getRevisionOptions`); `BranchInfo` / `CommitInfo` for
   the inline return type of `getRevisionOptions`. Pins: git-diff.test.ts, git-diff.metadata.test.ts,
   git-diff.capture.test.ts.
2. **Fix `getBlobContent`** (git-diff.ts): `cwd: this.repoPath` (today it relies
   on `process.cwd()` being inside the repo, true for every current caller), and one blob
   size limit (10 MB here, 64 MiB in `MAX_REVIEW_BLOB_BYTES`, which review-capture.ts's `readBlob` uses). Rework the `getBlobContent`
   describe in git-diff.test.ts. The static `node:fs` and `node:child_process` imports landed with
   `p3-20261115-blob-reads-git-dir-and-ignored-files.md`.
3. **review-capture.ts tidies, no split.** Add one ENOENT/ENOTDIR helper for the `lstat` catch blocks
   in `disabledFilterEnvironment` and `assertNativeFilterSupport`. Ask Matthew whether the untracked-directory check in
   `captureWorkingTree`'s `includeUntracked` loop is a deliberate recheck of the earlier "Reject unsupported untracked
   directories" loop; if it is redundant, delete it. Pins:
   review-capture.test.ts.
4. **One repository-environment list.** Move `gitEnvironment` (review-capture.ts)
   into `git-client.ts`. Make it and `createGitClient` read the one
   `REPOSITORY_ENVIRONMENT`, which today is declared in both git-client.ts and
   review-capture.ts. Have `getRepositoryName` (git-diff.ts) call the exported
   `getGitCommonDirectory` (review-capture.ts). Add no shared `runGit`, because
   the five runners differ in every option: review-capture uses `GIT_OPTIONS`, accepted
   exit codes, the 8 MiB message and Buffer output; `run` in cli/unapply.ts uses
   `LC_ALL=C`, an unlimited buffer and string output; `git` in cli/approval.ts uses no
   `gitEnvironment` (see Lore) and 64 MiB; the `execFileSync` calls in `getBlobContent` (git-diff.ts) are synchronous with
   10 MB; `getGitRoot` in cli/utils.ts runs a synchronous shell string. Pins:
   git-client.test.ts, review-capture.test.ts, unapply.test.ts, git-diff tests.
5. **One `digest`.** Use the exported `digest` (review-capture.ts, or a new
   `src/server/hash.ts`) for the inline sha256-hex in server.ts (`EMPTY_DIFF_DIGEST`; `repositoryId`, `commentImportId`
   and `stdinDiffDigest` in `startServer`; `normalizeThreadPayload`; `importId` in the `POST /api/comment-imports` route;
   the one in `normalizeComment` is left out because the compat plan deletes that function; these move with
   `p2-20261114-split-server-ts.md`, so name the enclosing function when they have); the reply `id` in conversation.ts's
   `POST /api/conversation/reply` route; `hashName` in review-store.ts; `diffDigest` in git-diff.ts's `parseDiff`.
   The `repositoryId` fallback in server.ts's `startServer` recomputes the private `repositoryId()` (review-capture.ts); export
   it.
6. **Small shared helpers.**
   - `isRecord` in a new `src/utils/guards.ts`, rejecting arrays (see Lore).
   - `processAlive` (cli/pending.ts = review-store.ts), the registration
     shape `{host, port, pid}` and `join(registryRoot, 'sessions', sessionId)`
     (pending.ts's `Registration` and `collectPending`; `SessionInbox.addTarget` and `SessionInbox.registryFile`): export from
     `session-inbox.ts` or a new `inbox-registry.ts`.
   - The progress key `JSON.stringify([threadId, messageId])` (conversation.ts's `Conversation.update`,
     `threadsWithProgress`, `setProgress` and `POST /api/conversation/reply` route; client `useAgentUpdates`'s `allUpdates`
     and `setRead`, CommentThreadCard.tsx's `readMark`): one
     helper in `src/utils`.
     The format is persisted in saved reviews; do not change it.
   - The hunk-header regex (`parseHunk` in review-capture.ts; `splitPlainUnifiedDiff` and `parseChunks` in git-diff.ts).
   - commentImports.ts: `serializeLineRange` = `cloneLineRange`.
     Replacing `cloneThread` with `structuredClone` changes behavior (the line
     branch drops unknown fields and keeps `isQuestion` only when true); ask first.
   - Line validation exists three times with different strictness (`normalizeLineValue`,
     in server.ts at `d905dec`, moving to `comment-payload.ts` in the server split,
     falls back to 1; `normalizeLineRange` in commentImports.ts throws; `isPosition` in reviewOps.ts
     accepts 0, fractions, start > end). One `parseLineRange` in commentImports.ts that
     reviewOps also uses; making reviewOps stricter is a behavior change (its own
     commit).
7. **Shared enumerations as `as const` arrays in `src/types`:** progress statuses
   (the `order` array in conversation.ts's `setProgress` and its `POST /api/conversation/status` route;
   `CommentProgress` in types/diff.ts; the `CommentProgress` and `StatusRequest` definitions in schema.ts;
   `awaitingAnswer` in session-inbox.ts), intents (`isIntent` in reviewOps.ts), verdicts, shutdown
   reasons. `schema.ts` passes them to `enumeration(...)`; validators use them. Also
   export the limits schema.ts restates: summary 16000/4000 (`parseReviewSummaryInput` in review-summary.ts;
   the `initialSummary` error in server.ts's `startServer` and the `POST /api/conversation/summary` error; `summaryFields`
   in schema.ts), the 16 MiB named-review limit (the `/api/reviews` JSON body limit in server.ts;
   `serializeReviewRequest` in cli/review.ts), the review-name regex (`validateReviewName` in utils/review-name.ts, the
   `ReviewName` definition in schema.ts),
   `^[\w-]{1,100}$` (`SESSION_ID` in session-inbox.ts, the `tab` check in server.ts's `upgrade` handler, the `listener`
   check in conversation.ts's `GET /api/conversation/events` route, `NamedReviewStart`'s `inbox.sessionId` in
   schema.ts). Pins: schema.test.ts, server.test.ts "keeps serialized server event
   fields aligned with the schema command".

## Leave alone

`named-reviews.ts`, `review-store.ts`, `generated-file-check.ts` (apart from its dead
fields), `file-watcher.ts` (apart from small items in the dead-code plan), `schema.ts` as
a data file (apart from task 7), and `src/types/live.ts`, `reviewOps.ts`, `review.ts`,
`events.ts`, `presence.ts`.

Rejected:

- The four-file split of `review-capture.ts`. The file changed in 8 commits from
  2026-08-01 to `d905dec` (App.tsx 102, server.ts 51), so it causes no measured
  conflicts, and importers using disjoint parts do not couple each other.
- A shared comment-event mapper and actionable-event predicate. The comment-event construction in
  `Conversation.update` (conversation.ts)
  clones `line`, `codeSnapshot` and `capture` and stamps `this.cursor` and a new
  timestamp, while `queuedMessages` in wait.ts copies references and uses `message.progress.cursor`
  and `message.updatedAt`; `SessionInbox.handle` in session-inbox.ts interleaves the predicate with its
  withdraw branch.
- An IPv6 host-bracketing helper: each site (`SessionInbox.message` in session-inbox.ts, `serverUrl` in
  cli/server-url.ts, the `app.listen` callback in server.ts) is one inline expression.
- Moving `conversation.ts`'s routes, the client-only types in types/diff.ts, or adding a
  base interface for the stream events: no conflict evidence or second user.
