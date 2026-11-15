---
title: Split git-diff.ts and review-capture.ts, and share the helpers server code repeats
priority: p3
section: Refactor
---

# TPP: Server modules

## Summary

`git-diff.ts` (1,035 lines) mixes Git I/O with about 470 lines of pure unified-diff
parsing that tests reach through 34 `(parser as any).parseFileBlock` casts.
`review-capture.ts` (1,082 lines) holds four parts that its six importers use
disjointly. Server and shared code also repeat a Git process runner (five ways),
sha256-hex (11 sites), `isRecord` (six copies), `processAlive`, the inbox registry
path, and the enumerations that `src/cli/schema.ts` and `src/types` both spell out.
Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1.

- [x] Inventory (below, at `d905dec`)
- [ ] Tasks, one commit each
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `docs/structure.md`, `p1-20261114-refactor-arc.md`
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
  measured. A split makes memoizing by capture digest easy; measure first.
- `src/utils` is shared with the browser, so `node:crypto` helpers do not go there.
- `approval.ts:23-26` runs `git diff --full-index` without `gitEnvironment` on purpose:
  it must match the digest of the diff the gavel skill pipes.
- `isRecord` copies disagree on arrays: review-capture.ts:445 and commentImports.ts:18
  allow them; user-config.ts:24, userSettings.ts:13, review.ts:209, reviewOps.ts:10
  reject them. Check the two permissive callers before switching.

## Tasks

Acceptance for each: listed tests pass (tasks 1-3 rewrite git-diff.test.ts and split
review-capture.test.ts; their `it` names must survive); `pnpm build`, `pnpm check` and
`pnpm knip` pass.

1. **Split git-diff.ts.** Move unified-diff parsing (`parseUnifiedDiff`,
   `foldTypeChange`, `splitPlainUnifiedDiff`, `decodeGitPath`, `extractPathFromLine`,
   `parseDiffHeaderPaths`, `extractMetadataPath`, `parseFileBlock`,
   `countLinesFromChunks`, `parseChunks`; 195-305, 386-742) into
   `src/server/unified-diff.ts` as plain functions; none uses `this.git`. Tests call them
   directly instead of through `(parser as any)`. While there: `getDefaultBranch`
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
3. **Split review-capture.ts** into `capture-git.ts` (12-160 without `digest` 69-71 and
   the parsing interfaces `PatchLine`, `RawHunk`, `RawFile` 49-67, plus `gitRecords`,
   `gitPaths` 722-786), `capture-patch.ts` (those interfaces, parsing, `capturePatch`, `validateCapture`,
   `selectCapture`, `filesWithoutAddedLines`, `digest`; pure), `captured-content.ts`
   (509-669) and `working-tree-capture.ts` (788-1082). Add one ENOENT/ENOTDIR helper for
   877-888 and 958-969. Split review-capture.test.ts along the same lines (its describe
   at 221 mixes `captureWorkingTree` and `capturedFileContent`). Ask Matthew whether the
   untracked-directory check at 1066-1069 is a deliberate recheck of 1042-1046 or
   redundant. Pins: review-capture.test.ts, git-diff.capture.test.ts,
   conversation.capture.test.ts, unapply.test.ts, named-reviews.test.ts.
4. **One Git runner.** Export `runGit(cwd, args, {input, env, maxBuffer, acceptedCodes})` from
   `git-client.ts`, which owns `QUOTE_PATH_CONFIG` and `PATCH_HEADER_OPTIONS`; move
   `REPOSITORY_ENVIRONMENT` (declared at git-client.ts:6 and review-capture.ts:15) and
   `gitEnvironment` there. Callers: review-capture.ts:93-123, unapply.ts:37-49 (adds
   `LC_ALL=C`), approval.ts:23-26 (keep its environment, see Lore), git-diff.ts:792-818,
   cli/utils.ts:50-62 (`getGitRoot`, a shell string). `acceptedCodes` is required by
   review-capture's callers: `rev-parse --verify HEAD` accepts 128 (143), `show-ref`
   accepts 1 (148), and `git diff --no-index /dev/null <path>` exits 1 whenever the files
   differ (1073). The "Review capture exceeds the 8 MiB limit" message for
   `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` (117-118) stays with the capture callers.
   `getGitRoot` is synchronous and `cli/index.ts:462` calls it synchronously; keep a
   synchronous variant or leave it out. The git common dir is resolved
   twice (git-diff.ts:38-41, review-capture.ts:156-160). Pins: git-client.test.ts and the
   callers' tests.
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
   - The human-actionable event predicate (session-inbox.ts:316-322 = wait.ts:32-39
     `isActionable`) and the comment-event field mapping (conversation.ts:395-417 vs
     wait.ts:88-118).
   - IPv6 host bracketing (session-inbox.ts:502, cli/server-url.ts:18, server.ts:2588).
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
8. **Optional.** Move `conversation.ts`'s routes (555-722) to `conversation-routes.ts`
   (export `ConversationCursorError`, `ProgressError`); move client-only types
   (`ViewedFileRecord`, `ViewedHashIndex*`, `DeletedComment`, `DiffContextStorage`,
   `ExpandedLinesState`, `FileExpandedState`, `ExpandedLine`, `LineSelection`;
   types/diff.ts:180-302) to a client types file; a base interface for the 9 stream
   events in types/conversation.ts.

## Leave alone

`named-reviews.ts`, `review-store.ts`, `generated-file-check.ts` (apart from its dead
fields), `file-watcher.ts` (apart from small items in the dead-code plan), `schema.ts` as
a data file (apart from task 7), and `src/types/live.ts`, `reviewOps.ts`, `review.ts`,
`events.ts`, `presence.ts`.
