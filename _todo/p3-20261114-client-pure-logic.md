---
title: Move pure logic out of large client hooks and components into tested utils
priority: p3
section: Refactor
---

# TPP: Pure logic out of client hooks and components

## Summary

Several large client files mix React state with pure computation that has no unit
tests: gap and merge math in `useExpandedLines` (813 lines), the reconcile step in
`useViewedFiles` (455), position search in `useKeyboardNavigation` (606), notebook
parsing in `NotebookDiffViewer` (1,254), block building in `MarkdownDiffViewer` (901),
and model and label code living in components (`SettingsModal`, `DiffQuickMenu`,
`FileList`, `CommentsListModal`). This plan moves each into a util module with its own
tests, without changing behavior. Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1 (useExpandedLines characterization tests).

- [x] Inventory (below, at `d905dec`)
- [ ] Moves, one commit each
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- `_todo/p3-20261114-zero-length-hunk-numbers.md` and
  `_todo/p3-20261114-keyboard-nav-defects.md`: both fix code this plan moves. Do
  the fix or the move first, not both in one commit.
- The worktree on branch `feat/ship-it` edits `viewers/TextDiffViewer.tsx` and
  `viewers/types.ts`; check `git worktree list` before the viewer tasks.

## Lore

- `getMergedChunks` must keep reusing `chunk.lines` when nothing in a chunk was
  expanded: DiffChunk's `useMemo` keys on that array. App reads the function through
  `getMergedChunksRef` and recomputes on `lastUpdatedAt` (App.tsx:832-858).
- `utils/mergedChunks.ts:2` imports the `MergedChunk` type backwards from the hook.
- `DiffViewer`'s `buildChunkRanges` (DiffViewer.tsx:146) drops zero-line hunks while the
  hook's math does not. Do not unify them until the zero-length hunk defect is fixed.
- Possible double expansion in `DiffViewer` (reasoned, not reproduced): in the render
  after an expansion resolves, `isExpandLoading` is false while App's merged chunks are
  still stale, so the effect can queue the same expansion again. Counts are clamped, so
  nothing shows, but the stored count grows. Check it while extracting
  `useExpandCommentGaps`.
- The `keyboardNavigation/` split is half done: `navigationCore.ts`,
  `navigationFilters.ts`, `scrollUtils.ts` exist; the hook still holds about 250 lines of
  pure search. No new files are needed there.
- `StorageService` forwards six positional arguments through seven methods (102-109,
  130-137, 197-205, 238-245, 260-267, 293-300, 315-323).

## Tasks

Acceptance for each: the existing tests named pass unchanged, the new util has its own
`*.test.ts`, and `pnpm build` passes.

1. **useExpandedLines.** First add characterization tests for `oldStart !== newStart`
   (every fixture has them equal), two expansions accumulating on one range,
   `expandAllBetweenChunks` folding a `'down'` range into `'up'`, a middle gap expanded
   from both sides. Then move 555-791 and the `MergedChunk` type into
   `utils/mergedChunks.ts`, plus range reducers `addRange` (from 282-305),
   `consolidateGap` (343-392), `wholeFileRanges` (428-447). Remove the in-file repeats
   while moving: the content-merge block (311-314, 398-401, 452-455), the generation and
   loading wrapper (three times), the range lookup (five times), the gap formulas
   (575-585 / 429-434, 634-636 / 440-446). Use the `ExpandedLine` type
   (types/diff.ts:300-302) instead of casting `as DiffLine` (694, 722). That alone does
   not remove the `'isExpanded' in` checks at DiffViewer.tsx:290, DiffLineRow.tsx:32,
   SideBySideDiffChunk.tsx:100-102: lines reach them through `MergedChunk.lines:
   DiffLine[]` and DiffChunk's `chunk` prop. Removing the checks means retyping
   `MergedChunk.lines`, `DiffChunkProps.chunk`, `viewers/types.ts` and `SideBySideLine`;
   `viewers/types.ts` is also edited on branch `feat/ship-it`. Do it as its own commit or
   leave the checks. Share `DEFAULT_EXPAND_COUNT` (hook :12 and
   ExpandButton.tsx:4). Pins: useExpandedLines.test.ts, mergedChunks.test.ts.
2. **DiffViewer gap expansion.** Extract `hooks/useExpandCommentGaps.ts` (108-207,
   263-276, 340-408), with the pure helpers next to the gap math in
   `utils/mergedChunks.ts`. First add thread-driven, `'before'`, `'after'` and old-side
   cases to DiffViewer.test.tsx "context expansion for line drafts" (every case today
   uses `threads={[]}` and a new-side `'between'` gap). Derive `DiffViewerProps` from
   `DiffViewerBodyProps` (23 fields repeat it) and spread the pass-through props.
3. **useViewedFiles.** Move the reconcile step (129-209) to
   `utils/viewedFilesReconcile.ts` as a pure function. Replace the five copies of the
   epoch guard (109-113, 318-321, 337-340, 376-379, 394-397) with one helper and the
   inline composite key (175, 184, 203) with one function. Folding `toggleFileViewed`
   (323-359) into `setFilesViewed` (381-424) is a larger DRY refactor: ask first. Pins:
   useViewedFiles.test.ts, useViewedFiles.namedCaptures.test.ts.
4. **Keyboard navigation.** Move into existing modules: `switchSidePosition` (from
   139-238) and a `fileStartPosition` (replacing the hand-built first-line positions at
   360-375, 390-405, 439-447, 465-473 and App.tsx:1219-1222) and
   `nextUnviewedFileIndex` into `navigationCore.ts`. `fileStartPosition` returns the raw
   position without `fixSide`: the callers at 439-447 and 465-473 keep calling `fixSide`,
   `{` / `}` keep not calling it, and App's caller keeps its `lines[0]` check. The keyboard
   defects in `p3-20261114-keyboard-nav-defects.md` are fixed in place before or after
   this move, never inside it; if they landed first, move the fixed code. Also the comment index as a `Set` (59-70;
   only `.has` is called) into `navigationFilters.ts`; the viewport-centre search
   (250-302) and `SCROLL_CONSTANTS` into `scrollUtils.ts`. Collapse 79-127 into one
   `move(filter, direction)`. Add `navigationCore.test.ts`. Pins:
   useKeyboardNavigation.test.tsx.
5. **StorageService.** By the time this runs, `p1-20261114-delete-dead-code.md` and
   `p1-20261114-remove-backward-compat.md` have removed `branchToHash`, `getStorageSize`
   and `getCommentThreads` / `removeCommentThreads`; re-read the file first. Replace the
   remaining positional arguments with a `DiffContextRef` object. Move the prefix scan, written five times (475-481, 510-513,
   useReviewOps.ts:21, useCommentDrafts.ts:150, useAgentUpdates.ts:20), into one
   `keysWithPrefix(prefix)` export. Use `isWorkingTreeTarget` only at 170, which tests
   all three of `'.'`, `'working'`, `'staged'`. Lines 60 and 183 test only `'.'` and
   `'working'` and map `'staged'` to a separate `STAGED` key; `isWorkingTreeTarget` there
   would make staged reviews share the working-tree records. Add a test that `staged`
   and `working` targets give different keys (none exists). Pins: StorageService.test.ts; the key strings at App.reviewOps.test.tsx:74,
   App.namedReviews.test.tsx:280.
6. **NotebookDiffViewer.** First add unit tests for the regex path, pairing by id with
   reorder / add / delete, pairing by index, a whitespace-only change cell, and an
   unparseable blob (the file has two tests today). Then move 17-51, 85-481, 492-532,
   708-741 to `utils/notebookPreview.ts`. Storing `beforeText` / `afterText` instead of
   one-line `NotebookSourceLine`s (478-481) removes four helpers.
7. **MarkdownDiffViewer.** Move 19-48, 73-211, 353-481 to
   `utils/markdownPreviewBlocks.ts`. Pins: MarkdownDiffViewer.test.tsx describes
   "MarkdownDiffViewer", "two-side fetch", "MarkdownFullPreview integration",
   "MarkdownDiffPreview frontmatter diff".
8. **Mechanical moves out of components:**
   - The appearance-settings model (SettingsModal.tsx:17-38, 58-85, 559) to
     `utils/appearanceSettings.ts`; 16 non-test files import it from the component,
     including `approvalCelebration.ts:1` and `viewers/types.ts:13`. Use
     `resolveThemePreference` (appearanceTheme.ts:128-137) for the two inline copies
     (159-164, 176-181). `getSettingsForResolvedTheme` is a `useCallback` local to
     `useAppearanceSettings.ts:67`; move it to a module function before 183-191 can use
     it.
   - DiffQuickMenu labels and presets (53-129, 225-257 as `describeSelection`, 259-339
     as `buildQuickDiffPresets`) to `utils/revisionLabels.ts`; App imports
     `formatReviewSelection` from the component today (App.tsx:36). Use
     `isWorkingTreeTarget` for `UNCOMMITTED_TARGETS` (59).
   - FileList tree helpers (`TreeNode`, `getAllDirectoryPaths`,
     `getReviewedDirectoryPaths`, `buildFileTree`, `filterFileTree`) to
     `utils/fileTree.ts`.
   - CommentsListModal grouping (96-105, 182-216) to `utils/conversationThreads.ts`.
     Keep `generalDraft` (162-165) above the `key={openings}` root (379); two integration
     tests pin the draft surviving close and reopen.

## Leave alone

- `utils/approvalCelebration.ts` (1,025 lines): one entry point, cohesive. A draw /
  physics split would push about 12 internals across a module boundary. Small tidies
  only: constants used before their declarations (402-407 used at 367-369; 541 used at
  497), the identical `'ember'` and `'ink'` cases (926-931).
- `CommentThreadCard.tsx`: cohesive; a split into `ThreadMessageItem.tsx` and
  `threadReadMark.tsx` is optional and low value.
- ImageDiffViewer, TextDiffViewer, registry, DiffLineRow, DiffCodeLine.
