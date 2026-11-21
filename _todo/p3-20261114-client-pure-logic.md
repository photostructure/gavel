---
title: Move pure logic out of large client hooks and components into tested utils
priority: p3
section: Refactor
---

# TPP: Pure logic out of client hooks and components

## Summary

Several large client files mix React state with pure computation that has no unit
tests: gap and merge math in `useExpandedLines`, the reconcile step in
`useViewedFiles` (455), position search in `useKeyboardNavigation` (606), notebook
parsing in `NotebookDiffViewer` (1,254), block building in `MarkdownDiffViewer` (901),
and model and label code living in components (`SettingsModal`, `DiffQuickMenu`,
`FileList`, `CommentsListModal`). This plan adds unit tests for that computation and
deletes the repeats inside each file, without changing behavior. Code moves to another
module only when a second file imports it or the move removes an import cycle.
Otherwise it stays in its file, and tests import it from there. Part of
`p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1 (useExpandedLines characterization tests).

- [x] Inventory (below, at `d905dec`)
- [ ] Repeats removed and moves made, one commit each
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- `p3-20261114-zero-length-hunk-numbers.md` and
  `p3-20261114-keyboard-nav-defects.md`: both fix code this plan moves. Do
  the fix or the move first, not both in one commit.
- The worktree on branch `feat/ship-it` edits `viewers/TextDiffViewer.tsx` and
  `viewers/types.ts`; check `git worktree list` before the viewer tasks.

## Lore

- `getMergedChunks` must keep reusing `chunk.lines` when nothing in a chunk was
  expanded: DiffChunk's `useMemo` keys on that array. App builds its merged chunks in a
  `useMemo` keyed on `getMergedChunks`, so they change in the same render as an expansion.
- `DiffViewer`'s `buildChunkRanges` drops zero-line hunks while the
  hook's math does not. Do not unify them until the zero-length hunk defect is fixed.
- The `keyboardNavigation/` split is half done: `navigationCore.ts`,
  `navigationFilters.ts`, `scrollUtils.ts` exist; the hook still holds the
  pure search code. No new files are needed there.
- `StorageService` forwards six positional arguments through seven methods (`getStorageKey`,
  `getDiffContextData`, `saveDiffContextData`, `getCommentThreads`, `removeCommentThreads`,
  `getViewedFiles`, `saveViewedFiles`).
- Simplicity: a commit in this plan should delete lines, not only move them. If a move
  removes nothing and fixes no import cycle or component-to-util dependency, skip it.
  Put tests on functions exported from the file that holds them.

## Tasks

Acceptance for each: the existing tests named pass unchanged, new or moved pure
functions have unit tests in a `*.test.ts` beside the file that holds them, and
`pnpm build` passes.

1. **useExpandedLines.** First add characterization tests for `oldStart !== newStart`
   (every fixture has them equal), two expansions accumulating on one range,
   `expandAllBetweenChunks` folding a `'down'` range into `'up'`, a middle gap expanded
   from both sides. Then, as its own commit, remove the in-file repeats: the
   content-merge block (in `expandLines`, `expandAllBetweenChunks` and `expandAllLines`),
   the generation and loading wrapper
   (three times), the range lookup (five times), the gap formulas (`getHiddenLinesBefore`
   / the `'up'` ranges in `expandAllLines`, `getHiddenLinesAfter` / its last-chunk `'down'`
   range). Extract a
   range reducer (`addRange` from the find-or-add range update in `expandLines`,
   `consolidateGap` from the `'down'`-into-`'up'` merge in `expandAllBetweenChunks`,
   `wholeFileRanges` from the range list built in `expandAllLines`) only where it replaces
   one of those repeats. Use the
   `ExpandedLine` type
   (in types/diff.ts) instead of casting `as DiffLine` (twice in `getExpandedChunk`). That
   alone does not remove the `'isExpanded' in` checks in DiffViewer.tsx's
   `hasExpandedLines`, DiffLineRow.tsx's `getLineClass` and SideBySideDiffChunk.tsx's
   `isExpandedLine`: lines reach them through `MergedChunk.lines:
   DiffLine[]` and DiffChunk's `chunk` prop. Leave the three checks: removing them means
   retyping four shared types (`MergedChunk.lines`, `DiffChunkProps.chunk`,
   `viewers/types.ts`, `SideBySideLine`; `viewers/types.ts` is also edited on branch
   `feat/ship-it`) for three one-line checks. Share `DEFAULT_EXPAND_COUNT` (declared in
   both the hook and ExpandButton.tsx). Pins: useExpandedLines.test.ts.
2. **DiffViewer gap expansion.** Keep the gap-expansion code (the module-level helpers
   from `LineRange` through `getLastChunkIndex`, the `commentTargets` memo, and the
   `useEffect` that calls `buildGaps` and queues expansions) in DiffViewer.tsx (514
   lines); a hook with one caller would only move it.
   Add thread-driven, `'before'`, `'after'` and old-side cases to DiffViewer.test.tsx
   "context expansion for line drafts" (every case today uses `threads={[]}` and a
   new-side `'between'` gap). Derive `DiffViewerProps` from
   `DiffViewerBodyProps` (23 fields repeat it) and spread the pass-through props.
3. **useViewedFiles.** Replace the five copies of the epoch guard (one in the load effect's
   `processAutoCollapsedFiles`, and two each in `toggleFileViewed` and `setFilesViewed`:
   on entry and after hashing) with one closure inside the hook. The entry copies in
   `toggleFileViewed` and `setFilesViewed` also test `!hasLoadedInitialViewedFiles`; keep
   that test at those two calls. Leave the reconcile step (the `if (initialFiles ...)`
   block in `processAutoCollapsedFiles`) and the composite key (the `indexedByKey` key,
   three uses within 30 lines) where they are: the file changed in 2 commits from 2026-08-01 to
   `d905dec`, and two test files already pin it. Folding `toggleFileViewed`
   into `setFilesViewed` is a larger DRY refactor: ask first. Pins:
   useViewedFiles.test.ts, useViewedFiles.namedCaptures.test.ts.
4. **Keyboard navigation.** Move into existing modules: `switchSidePosition` (from
   the body of `switchSide`) and a `fileStartPosition` (replacing the hand-built
   first-line positions in the `{` and `}` hotkeys, `focusNextUnviewedFile`,
   `rememberFilePosition` and App's `handleFileOpened`) and
   `nextUnviewedFileIndex` into `navigationCore.ts`. `fileStartPosition` returns the raw
   position without `fixSide`: `focusNextUnviewedFile` and `rememberFilePosition` keep
   calling `fixSide`,
   `{` / `}` keep not calling it, and App's caller keeps its `lines[0]` check. The keyboard
   defects in `p3-20261114-keyboard-nav-defects.md` are fixed in place before or after
   this move, never inside it; if they landed first, move the fixed code. Also the comment index as a `Set` (`commentIndex`;
   only `.has` is called) into `navigationFilters.ts`; the viewport-centre search
   (in `moveToCenterOfViewport`) and `SCROLL_CONSTANTS` into `scrollUtils.ts`. Collapse
   `navigate`, `createNavigationCommand` and the four `navigateTo*` wrappers into one
   `move(filter, direction)`. Add `navigationCore.test.ts`. Pins:
   useKeyboardNavigation.test.tsx.
5. **StorageService.** By the time this runs, `p1-20261114-delete-dead-code.md` and
   `p1-20261114-remove-backward-compat.md` have removed `branchToHash`, `getStorageSize`
   and `getCommentThreads` / `removeCommentThreads`; re-read the file first. Replace the
   remaining positional arguments with a `DiffContextRef` object. Move the prefix scan, written five times (`cleanupOldData`,
   `getStorageSize`, useReviewOps.ts's `readQueue`, useCommentDrafts.ts's
   `sweepExpiredDrafts`, useAgentUpdates.ts's `readSeenMessages`), into one
   `keysWithPrefix(prefix)` export. Use `isWorkingTreeTarget` only in
   `normalizeStorageBase`, which tests all three of `'.'`, `'working'`, `'staged'`.
   `normalizeCommitish` and `normalizeStorageTarget` test only `'.'` and
   `'working'` and map `'staged'` to a separate `STAGED` key; `isWorkingTreeTarget` there
   would make staged reviews share the working-tree records. Add a test that `staged`
   and `working` targets give different keys (none exists). Pins: the key strings in StorageService.test.ts.
6. **NotebookDiffViewer.** First add unit tests for the regex path, pairing by id with
   reorder / add / delete, pairing by index, a whitespace-only change cell, and an
   unparseable blob (the file has two tests today). Then store `beforeText` /
   `afterText` instead of one-line `NotebookSourceLine`s (`buildSourceLines`), which removes four
   helpers. Export what the tests need from NotebookDiffViewer.tsx. Its only non-test
   importer is `viewers/registry.ts`, so it gets no new module.
7. **Mechanical moves out of components:**
   - The appearance-settings model (SettingsModal.tsx's `APPROVAL_ANIMATIONS`,
     `ApprovalAnimation`, `AppearanceSettings`, `DEFAULT_IGNORE_WHITESPACE`,
     `DEFAULT_SETTINGS`, `FONT_FAMILIES` and its `export type` line) to
     `utils/appearanceSettings.ts`; 16 non-test files import it from the component,
     including `approvalCelebration.ts` and `viewers/types.ts`. Use
     `resolveThemePreference` (appearanceTheme.ts) for the two inline copies
     (in `getCurrentTheme` and `handleThemeChange`). `getSettingsForResolvedTheme` is a
     `useCallback` local to `useAppearanceSettings.ts`; move it to a module function
     before `handleThemeChange`'s syntax-theme fallback can use it.
   - `formatReviewSelection` (DiffQuickMenu.tsx) and the constants it reads, to
     `utils/revisionLabels.ts`, because App imports it from the component.
     The presets and `describeSelection` stay in DiffQuickMenu, their only non-test user.
     Use `isWorkingTreeTarget` for `UNCOMMITTED_TARGETS`.

## Leave alone

- `utils/approvalCelebration.ts`: one entry point, cohesive. A draw /
  physics split would push about 12 internals across a module boundary. Small tidies
  only: constants used before their declarations (the `BALLOON_*` constants used in
  `BURSTS.balloons`; `STAMP_DROP` used in `step`), the identical `'ember'` and `'ink'`
  cases (in `draw`).
- `CommentThreadCard.tsx`: cohesive; do not split it.
- `MarkdownDiffViewer.tsx`, the FileList tree helpers and the CommentsListModal
  grouping: each has one user, so a move to a util module would remove nothing.
- ImageDiffViewer, TextDiffViewer, registry, DiffLineRow, DiffCodeLine.
