---
title: Refactor arc — break up App.tsx and server.ts, remove compat code, DRY the rest
priority: p1
section: Refactor
---

# TPP: Refactor arc

## Summary

Feature branches conflict in `src/client/App.tsx` (2,613 lines; changed in 102 commits
from 2026-08-01 to `d905dec`, more than any other file) and `src/server/server.ts` (2,611 lines,
51 commits). Both are one closure each: `App()` and `startServer()`. The code also carries
backward-compatibility paths for older gavel builds and data shapes, which Matthew ruled
unnecessary (2026-11-14: no users besides him, servers are ephemeral). Across the rest
of `src/` the same helpers and test fixtures are written several times.

This file owns the order of the work and the lore every child needs. The children own
the tasks. Audit date and base commit: 2026-11-14, `d905dec`. The children cite code by
name; search for the name, and use `git log -S` for code removed since then.

## Children, in order

1. `p1-20261114-delete-dead-code.md` and `p1-20261114-remove-backward-compat.md`. They
   shrink the files before anything moves, so later steps move less code. Both edit
   the thread-copy effect in `App.tsx` (its `migratedRecordsRef`) and `StorageService.getCommentThreads`, so run them one after the
   other, the compat plan's thread-copy item first. The compat plan's `appliedOps` item cannot land before
   2027-02-10; the splits do not wait for it.
2. `p1-20261114-shared-test-helpers.md`. The splits need only part of it. The App split
   needs task 2's `renderApp` and the `useFileWatch` mock, because it splits
   `App.test.tsx` into about six files. The server split needs task 3, because every file
   split out of `server.test.ts` needs its `git-diff.js` mock and the `start` helper.
   Tasks 1 and 4 do not block either split.
3. `p1-20261114-split-app-tsx.md` and `p2-20261114-split-server-ts.md`. Independent of
   each other; they can run in parallel worktrees.
4. Later, as separate work that this arc does not wait for (in any order):
   - `p3-20261114-diff-chunk-renderers.md`
   - `p3-20261114-client-pure-logic.md`
   - `p3-20261114-client-shared-ui.md`
   - `p3-20261114-cli-cleanup.md`
   - `p3-20261114-server-modules.md`

   Tasks in these that edit `App.tsx` or `server.ts` (named in each child) go after the
   matching split, or are folded into it.

Defects the audit found are in their own placeholder TPPs and do not wait for this arc:

- `p1-20261114-file-tree-hides-new-dirs.md`
- `p3-20261114-zero-length-hunk-numbers.md`
- `p3-20261114-keyboard-nav-defects.md`
- `p2-20261114-weak-tests.md`
- `p2-20261114-comment-cli-hangs.md`
- `p2-20261114-small-audit-defects.md`

## Done when

- Each concern with a small boundary (few inputs and outputs, nothing reaching back in)
  lives in its own file, as the split plans list. `App.tsx` and `server.ts` keep the
  entangled core: diff loading and review selection in `App.tsx`; startup, `/api/diff`,
  named reviews, review ops, the live socket and shutdown in `server.ts`. There is no
  line-count target for either file.
- No code path exists only for an older gavel build or data shape.
- The arc leaves less code than it found: at the end, production and test line counts
  under `src/` are both lower than at `d905dec`. Measure both commits with the same
  command (set `c` to the commit):

  ```bash
  c=d905dec; git ls-tree -r --name-only $c src | grep -E '\.(ts|tsx|css)$' | while read f; do printf '%s %s\n' "$(git show $c:$f | wc -l)" "$f"; done | awk '{ if ($2 ~ /\.test\.|\.testing\.|\/test-|__mocks__/) t+=$1; else p+=$1 } END { print "production", p, "test", t }'
  ```

  The splits add files, so the file count is not a target.

- `make preflight` passes.

## Lore

- Each step is a behavior-preserving move, except the compat removals and the defect
  fixes. Keep moves and behavior changes in separate commits, so a reviewer can read a
  move as a move.
- Simplicity. Each child should leave fewer things to understand. Prefer deleting code
  to moving it, and moving it unchanged to writing new code. Add a shared helper, hook,
  context, option or parameter only when the copies it replaces have the same shape today
  and the helper needs no options argument to serve them all. When a helper needs one,
  the copies differ: leave them. If a task would add an element without removing a larger
  one, drop it and say so in the child. When a move exposes more mess, follow Kent Beck's
  "Getting Untangled": commit the move, note the rest in the child, and do only what the
  current step needs.
- `vi.mock` resolves by module ID. Moving a hook _call_ from App into a new hook keeps
  the existing mocks working. Moving or renaming a mocked _module_ breaks every test that
  mocks it. Mocked modules include `useDiffComments`, `useViewedFiles`, `useViewport`,
  `useFileWatch`, `DiffViewer`, `DiffChunk`, `ToastStack`, `approvalCelebration`,
  `clipboard`, `scrollUtils`, `diffUtils`, `StorageService`, and on the server and CLI
  `git-diff.js`, `review-capture.js`, `server/server.js` and `cli/utils.js`. The list is
  not exhaustive: run `rg "vi.mock\(" src` before moving a module.
- knip runs in `make preflight` and CI. An export left unused after a move fails there.
  knip counts imports from tests as use, and it cannot see unused fields of a returned
  object, class methods, or interface members.
- The repo convention for test-only modules that sit in `src/` is `*.testing.ts`
  (`src/client/utils/liveConnection.testing.ts`) or a `test-*.ts` file
  (`src/server/test-access-token.ts`). Check that knip accepts a new one.
- Upstream (`UPSTREAM.md`): after the splits, upstream difit patches to `App.tsx` and
  `server.ts` no longer apply mechanically. The fork already re-implements upstream items
  case by case, so this changes how an item is ported, not whether.
- Other work at audit time: the worktree on branch `feat/ship-it` (`difit-ship-it`)
  edits `viewers/TextDiffViewer.tsx`, `viewers/types.ts` and `server.ts`; the Codex
  worktree on branch `codex/jsonl-events` edits `server.ts` (both had no commits after
  2026-10-29 and look abandoned; not confirmed); the unmerged Codex worktree
  `comment-link-range-fix` (detached at 94d5f58) edits `hooks/useCommentLinks.ts`. The
  primary checkout also had uncommitted edits to `App.tsx`, `useReviewOps.ts` and other
  client files from another session. Check `git worktree list` and `git status` before
  each child.
- Design principles: the "Design Principles: Keep It Simple" section of `AGENTS.md`
  (KISS, YAGNI, delete first, fail visibly). Every child follows it. There is no
  `TDD.md`.

## Rejected for now

- Deriving `src/cli/schema.ts` from `src/types` (or the reverse). It needs a new
  dependency (ts-json-schema-generator, json-schema-to-ts, zod, typebox or valibot).
  The children share the enumerations as `as const` arrays instead
  (`p3-20261114-server-modules.md`). A validator library would also replace the hand
  validators in `utils/reviewOps.ts`, `utils/commentImports.ts` and the route checks in
  `server.ts` and `conversation.ts`. Matthew decides if that is worth a dependency.
