---
title: Share logic between the unified and split diff chunk renderers
priority: p3
section: Refactor
---

# TPP: Diff chunk renderers

## Summary

`DiffChunk.tsx` (451 lines) renders unified mode and, in split mode, returns
`<SideBySideDiffChunk>` (739 lines) from its `if (mode === 'split')` branch, after all of its own hooks have run.
The two renderers duplicate word-diff pairing, thread lookup, thread and composer rows,
selection highlighting, the keyboard comment trigger, element IDs, and the gutter and
code cells. In split mode both compute word diffs, so `computeWordLevelDiff` runs twice
per pair and DiffChunk's result is thrown away (hook order checked at `d905dec`). Part
of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1 (characterization tests).

- [x] Duplication mapped (below)
- [ ] Characterization tests for the uncovered paths
- [ ] DiffChunk becomes a dispatcher
- [ ] Duplicates removed
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- `src/client/components/DiffChunk.tsx`, `SideBySideDiffChunk.tsx`, `DiffLineRow.tsx`,
  `DiffCodeLine.tsx`, `CommentThreadCard.tsx` (props)
- `p3-20261109-diffchunk-whitespace-snapshot.md` (open against DiffChunk)
- `p3-20261114-keyboard-nav-defects.md`: its h / l fix needs the same
  delete-to-add pairing that task 3 extracts
- `p3-20261114-client-shared-ui.md` tasks 6 and 7 (line-range helpers and the
  `'left' | 'right'` type) touch the same lines as task 7 here; do them in one place

## Duplicated logic (S = SideBySideDiffChunk, D = DiffChunk, R = DiffLineRow, C = DiffCodeLine)

1. Word-diff pairing: S's `convertToSideBySide`, D's `wordLevelDiffMap`. `utils/wordLevelDiff.ts` has no tests.
2. Thread lookup: `getThreadsForLine` in S and in D. Both filter and sort the whole thread list for
   every row on every render. The ordering differs: split lists old-side threads first;
   unified sorts a row's threads by `createdAt`.
3. Thread rows: S's "Comment threads row" block, D's `lineThreads.map`; the 11 card props are identical.
4. Composer rows: S's "Comment form row" block, D's `lineComposers.map`.
5. Selection highlight: S's `getSelectedLineStyle`; D's `getDragSelectionStyle` and the
   `selectedLineStyle` prop it passes to `DiffLineRow`. Same logic, different CSS:
   split uses Tailwind `after:` utilities, unified uses the `tr.comment-selected` and
   `tr.drag-selected` rules in global.css. Three tests in DiffChunk.test.tsx assert the
   class names: "ignores a %s %s on a line number", "tints the rows a saved range covers
   while the pointer is over its thread", and "tints only the saved range side in split view".
6. Keyboard comment trigger: the `commentTrigger` `useEffect` in S and in D. The delete-line branches are
   unreachable (the `c` hotkey in `useKeyboardNavigation` skips a deleted line).
   In split mode D's effect also runs and calls `onCommentTriggerHandled` a second time
   (reasoned).
7. Element IDs built by hand in D's `lineId` and S's `oldLineNavId` / `newLineNavId` instead of `getElementId`
   (utils/navigation/domHelpers.ts). If either copy drifts, scrolling to the cursor
   stops finding its element.
8. Gutter cell: S's line-number `<td>` under each of its "Old side" and "New side"
   comments vs R's two line-number `<td>`s.
9. Code cell: S's `data-diff-side` `<td>` contents vs C's rendered markup. The token lookup is written twice and
   behaves differently (S's misspelled `getProcomputedTokens`; C's `getPrecomputedTokens`).
10. Line background: S's `isExpandedLine` and `getSideBySideLineClass` vs R's `getLineClass`.

Within S: the side-hit test three times (`getClickedLineTarget`, the row's `onMouseEnter`,
and its `onMouseMove`); `onMouseEnter` and `onMouseMove` set hover state with the same
logic; the old and new cells (the "Old side" and "New side" blocks) differ only by side.

The thread-action callbacks (`onGenerateThreadPrompt`, `onToggleThreadResolved`,
`onRemoveThread?`, `onRestoreComment?`, `onReplyToThread`, `onRemoveMessage`,
`onUpdateMessage`) are declared six times: `DiffViewerBodyProps` (viewers/types.ts),
`DiffChunkProps`, `SideBySideDiffChunkProps`, `DiffViewerProps`, `CommentThreadCardProps`
(renamed `onGeneratePrompt`), `CommentsListModalProps`. `onAddComment`, `onLineClick`
and the `commentTrigger` shape repeat the same way.

## Lore

- The side-less-thread branches in S (`!thread.side ||` in `getThreadsForLine`,
  `getCommentLayout`, and the `thread.side || 'new'` fallback and `getCommentLayout` call
  in the thread row) are unreachable:
  `toCommentThread` always sets `side`. They compile because `CommentThread.side?` is
  optional (the `CommentThread` type in types/diff.ts). Making it required touches shared types and fixtures;
  ask first.
- `React.memo` on DiffLineRow never skips a render, because D passes new arrow
  functions every render (reasoned, not measured).
- Untested in either mode: the comment trigger, half-width layout, word highlighting.
- Per-row thread filtering (`getThreadsForLine` in S and D) is not measured; add no index unless a
  profile shows it costs time. The two lookups also match differently: D uses
  `lineShowsTarget` with `thread.side ?? 'new'`, while S lets a side-less thread match
  both sides (`!thread.side ||` in S's `getThreadsForLine`).
- Simplicity: success means fewer lines and fewer props, not more files. Share a piece
  only where both renderers' code is identical today. When a shared component would need
  a prop for each way the modes differ, leave it in each renderer. Delete unreachable
  branches instead of sharing them: the delete-line trigger branches (item 6), the
  counter fallbacks, and the side-less-thread branches if Matthew agrees.

## Tasks

1. Add tests first: comment trigger in both modes, word highlighting in both modes, unit
   tests for `utils/wordLevelDiff.ts`, and a mode switch during a range selection (click
   unified line 10, switch to split and back, Shift-click line 12: today that opens a
   comment on 10-12). Acceptance: they pass on the current code.
2. Make `DiffChunk` a `memo` dispatcher; move the unified body to `UnifiedDiffChunk.tsx`.
   Keep the `useLineRangeDrag()` call in the dispatcher: its
   `selectionAnchor` survives mode switches today only because `DiffChunk` stays mounted
   (`getCommentLineFromAnchor` and `openShiftClickComment` in useLineRangeDrag.ts), and a conditionally mounted child would reset it.
   This removes the double word-diff and the double trigger call in split mode, and
   makes D's dead layout switch go away (see `p1-20261114-delete-dead-code.md`).
   Acceptance: `pnpm test DiffChunk DiffViewer` passes.
3. Extract `pairChangedLines(lines)` into `utils/chunkLinePairs.ts` (or reuse it, if the
   h / l fix in `p3-20261114-keyboard-nav-defects.md` already extracted it) and a
   word-diff map used by both bodies. Delete the counter fallbacks in
   `convertToSideBySide` (its `oldLineNum` / `newLineNum` counters; every line has its number). That removes its
   dependence on `chunk.oldStart` / `chunk.newStart`, so make it a module-level function
   in SideBySideDiffChunk.tsx instead of a `useCallback`. Do not create a new module:
   the `sideBySideLines` `useMemo` is its only caller. Keyboard and renderer must keep using the same pairing.
4. Inside SideBySideDiffChunk only: render the old and new cells (the "Old side" and
   "New side" blocks) from one local function of the side; replace the three side-hit
   tests (`getClickedLineTarget`, `onMouseEnter`, `onMouseMove`) with one function; give
   the row's `onMouseEnter` and `onMouseMove` one hover update.
5. Share the gutter cell's long class string with DiffLineRow (the
   `w-[var(--line-number-width)]` class on the line-number `<td>`s in both) as one
   exported constant, not a component. Leave the thread and composer rows in each
   renderer, because their markup differs: unified renders one `<tr>` per thread with
   `colSpan={3}` and `m-2 mx-4` (D's `lineThreads.map`); split renders all of a row's threads in one
   `<tr>` with `colSpan={4}` and `m-2 mx-3` (S's "Comment threads row" block). A shared row would need layout,
   colSpan and margin props on top of the card props. Do not reuse `DiffCodeLine` for the
   split code cell: it differs in wrapper height and padding, prefix span and token
   lookup (S's `min-h-[20px] px-3` wrappers and `getProcomputedTokens` calls vs C's
   `min-h-[16px]` wrapper, `px-3` on its highlighters, and `getPrecomputedTokens`).
6. Use `getElementId` in both renderers.
7. Add `ThreadActionProps` and `LineClickProps` to `src/client/viewers/types.ts`; the six
   declarations use `Pick` or extend it. Acceptance: `pnpm build` (tsc).
8. Selection highlight: keep one of the two implementations, split's Tailwind `after:`
   utilities (S's `getSelectedLineStyle`) or unified's `tr.comment-selected` /
   `tr.drag-selected` rules in global.css, and delete the other. This is a
   visible change (class names and possibly rendering). Separate commit; check in headless Chromium, since happy-dom does not
   resolve CSS layers.
