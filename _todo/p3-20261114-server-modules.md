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
- `src/server/git-client.ts:1-10` (says direct Git invocations should agree with
  simple-git's environment)
- `_todo/p3-20261110-git-env-config-isolation.md`

## Lore

- Path unquoting differs on purpose: capture (review-capture.ts:174-221) throws on
  non-UTF-8 paths and unknown escapes; the viewer (git-diff.ts:386-496) returns Git's
  quoted form. A shared function that unquotes to bytes, with each caller keeping its
  own UTF-8 rule, keeps both. git-diff.ts:533, 539 treats any backslash-preceded quote as
  escaped, which misreads a path ending in `\`; review-capture.ts:232-236 tracks escape
  state correctly (reasoned, not reproduced).
- `parsePatch(capture.patch)` reparses the whole patch (up to 8 MiB) on every call to
  `capturedFileContent`, `pathsWithoutContext`, `filesWithoutAddedLines` and
  `selectCapture`; `capturedFileContent` runs once per blob request. Reasoned, not
  measured. Memoizing by capture digest would avoid it; measure first.
- `src/utils` is shared with the browser, so `node:crypto` helpers do not go there.
- `approval.ts:23-26` runs `git diff --full-index` without `gitEnvironment` on purpose:
  it must match the digest of the diff the gavel skill pipes.
- `isRecord` copies disagree on arrays: review-capture.ts:445 and commentImports.ts:18
  allow them; user-config.ts:24, userSettings.ts:13, review.ts:209, reviewOps.ts:10
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
   `countLinesFromChunks`, `parseChunks`; 195-305, 386-742) into
   `src/server/unified-diff.ts` as plain functions; none uses `this.git`. Tests call them
   directly instead of through `(parser as any)`. Leave no delegating method on
   `GitDiffParser` for a function that only tests called. While there: `getDefaultBranch`
   (920-942) and `getOriginDefaultBranch` (944-966) parse `symbolic-ref` the same way;
   use `isWorkingTreeTarget` only where all three of `'.'`, `'working'`, `'staged'` are
   tested (746, 1011, 1019). Keep 308 (`getGitattributesSourceArgs`) and 771
   (`getBlobContent`) as they are: they test only `'working'` and `'.'` and send
   `staged` to the index (`--cached`, `git show :path`); `isWorkingTreeTarget` there
   would read the working tree for a staged review (pinned by "uses git show for staged
   files"). `shortHash` for `hash.substring(0, 7)` (906, 1003); `BranchInfo` / `CommitInfo` for
   the inline return type at 968-976. Pins: git-diff.test.ts, git-diff.metadata.test.ts,
   git-diff.capture.test.ts.
2. **Fix `getBlobContent`** (git-diff.ts:768-818): static `node:` imports instead of
   `await import('fs')` (772) and `await import('child_process')` (792), `cwd:
   this.repoPath` (today it relies on `process.cwd()` being inside the repo, true for
   every current caller), and one blob size limit (10 MB here, 64 MiB at
   review-capture.ts:509). The `vi.mock('child_process')` / `vi.mock('fs')` in
   git-diff.test.ts:19-38 depend on the current names; check whether Vitest applies them
   to `node:` specifiers. Rework the `getBlobContent` describe (85-213).
3. **review-capture.ts tidies, no split.** Add one ENOENT/ENOTDIR helper for 877-888
   and 958-969. Ask Matthew whether the untracked-directory check at 1066-1069 is a
   deliberate recheck of 1042-1046; if it is redundant, delete it. Pins:
   review-capture.test.ts.
4. **One repository-environment list.** Move `gitEnvironment` (review-capture.ts:77-90)
   into `git-client.ts`. Make it and `createGitClient` read the one
   `REPOSITORY_ENVIRONMENT`, which today is declared at both git-client.ts:6 and
   review-capture.ts:15. Have `getRepositoryName` (git-diff.ts:38-41) call the exported
   `getGitCommonDirectory` (review-capture.ts:156-160). Add no shared `runGit`, because
   the five runners differ in every option: review-capture uses `GIT_OPTIONS`, accepted
   exit codes, the 8 MiB message and Buffer output; cli/unapply.ts:37-46 uses
   `LC_ALL=C`, an unlimited buffer and string output; cli/approval.ts:23-26 uses no
   `gitEnvironment` (see Lore) and 64 MiB; git-diff.ts:792-818 is synchronous with
   10 MB; cli/utils.ts:50-62 (`getGitRoot`) runs a synchronous shell string. Pins:
   git-client.test.ts, review-capture.test.ts, unapply.test.ts, git-diff tests.
5. **One `digest`.** Use the exported `digest` (review-capture.ts:69-71, or a new
   `src/server/hash.ts`) for the inline sha256-hex at server.ts:216, 251, 377, 380, 1392,
   1908 (1341 is in `normalizeComment`, which the compat plan deletes; these move with
   `p2-20261114-split-server-ts.md`, so name the enclosing function when they have); conversation.ts:682; review-store.ts:95-97 (`hashName`); git-diff.ts:173.
   server.ts:251 recomputes the private `repositoryId()` (review-capture.ts:73); export
   it.
6. **Small shared helpers.**
   - `isRecord` in a new `src/utils/guards.ts`, rejecting arrays (see Lore).
   - `processAlive` (cli/pending.ts:24-32 = review-store.ts:124-132), the registration
     shape `{host, port, pid}` and `join(registryRoot, 'sessions', sessionId)`
     (pending.ts:18-22, 53; session-inbox.ts:405, 409-416): export from
     `session-inbox.ts` or a new `inbox-registry.ts`.
   - The progress key `JSON.stringify([threadId, messageId])` (conversation.ts:360, 373,
     497, 511, 527, 675; client useAgentUpdates.ts:62, 75, CommentThreadCard.tsx:85): one
     helper in `src/utils`.
     The format is persisted in saved reviews; do not change it.
   - The hunk-header regex (review-capture.ts:261, git-diff.ts:269, 698).
   - commentImports.ts: `serializeLineRange` (485-491) = `cloneLineRange` (289-298).
     Replacing `cloneThread` (333-353) with `structuredClone` changes behavior (the line
     branch drops unknown fields and keeps `isQuestion` only when true); ask first.
   - Line validation exists three times with different strictness (`normalizeLineValue`,
     server.ts:1311-1333 at `d905dec`, moving to `comment-payload.ts` in the server split,
     falls back to 1; commentImports.ts:39-63 throws; reviewOps.ts:34-41 `isPosition`
     accepts 0, fractions, start > end). One `parseLineRange` in commentImports.ts that
     reviewOps also uses; making reviewOps stricter is a behavior change (its own
     commit).
7. **Shared enumerations as `as const` arrays in `src/types`:** progress statuses
   (conversation.ts:517-525, 623; types/diff.ts:125; schema.ts:257, 580;
   session-inbox.ts:186), intents (reviewOps.ts:16-17 `isIntent`), verdicts, shutdown
   reasons. `schema.ts` passes them to `enumeration(...)`; validators use them. Also
   export the limits schema.ts restates: summary 16000/4000 (review-summary.ts:14-16,
   server.ts:520, 1680, schema.ts:35-43), the 16 MiB named-review limit (server.ts:561-564,
   cli/review.ts:217-220), the review-name regex (utils/review-name.ts:4, schema.ts:108),
   `^[\w-]{1,100}$` (session-inbox.ts:37, server.ts:2391, conversation.ts:581,
   schema.ts:171). Pins: schema.test.ts, server.test.ts "keeps serialized server event
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
- A shared comment-event mapper and actionable-event predicate. conversation.ts:395-417
  clones `line`, `codeSnapshot` and `capture` and stamps `this.cursor` and a new
  timestamp, while wait.ts:96-115 copies references and uses `message.progress.cursor`
  and `message.updatedAt`; session-inbox.ts:316-322 interleaves the predicate with its
  withdraw branch.
- An IPv6 host-bracketing helper: each site (session-inbox.ts:502, cli/server-url.ts:18,
  server.ts:2588) is one inline expression.
- Moving `conversation.ts`'s routes, the client-only types in types/diff.ts, or adding a
  base interface for the stream events: no conflict evidence or second user.
