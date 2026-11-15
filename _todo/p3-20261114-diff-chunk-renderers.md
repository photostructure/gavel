---
title: Share logic between the unified and split diff chunk renderers
priority: p3
section: Refactor
---

# TPP: Diff chunk renderers

## Summary

`DiffChunk.tsx` (451 lines) renders unified mode and, in split mode, returns
`<SideBySideDiffChunk>` (739 lines) at line 274, after all of its own hooks have run.
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
- [ ] Shared pieces extracted
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- `src/client/components/DiffChunk.tsx`, `SideBySideDiffChunk.tsx`, `DiffLineRow.tsx`,
  `DiffCodeLine.tsx`, `CommentThreadCard.tsx` (props)
- `_todo/p3-20261109-diffchunk-whitespace-snapshot.md` (open against DiffChunk)
- `p3-20261114-keyboard-nav-defects.md`: its h / l fix needs the same
  delete-to-add pairing that task 3 extracts
- `p3-20261114-client-shared-ui.md` tasks 6 and 7 (line-range helpers and the
  `'left' | 'right'` type) touch the same lines as tasks 4 and 7 here; do them in one
  place

## Duplicated logic (S = SideBySideDiffChunk, D = DiffChunk, R = DiffLineRow, C = DiffCodeLine)

1. Word-diff pairing: S:341-389, D:215-271. `utils/wordLevelDiff.ts` has no tests.
2. Thread lookup: S:252-262, D:165-173. Both filter and sort the whole thread list for
   every row on every render. The ordering differs: split lists old-side threads first;
   unified sorts a row's threads by `createdAt`.
3. Thread rows: S:653-701, D:377-412; the 11 card props are identical.
4. Composer rows: S:703-731, D:414-443.
5. Selection highlight: S:281-312, D:191-211 and 331-340. Same logic, different CSS:
   split uses Tailwind `after:` utilities, unified uses global.css:397-436. Three tests
   assert the class names (DiffChunk.test.tsx:153-155, 217, 230).
6. Keyboard comment trigger: S:203-215, D:122-135. The delete-line branches are
   unreachable (the hotkey never fires on a deleted line, useKeyboardNavigation.ts:541-543).
   In split mode D's effect also runs and calls `onCommentTriggerHandled` a second time
   (reasoned).
7. Element IDs built by hand at D:316 and S:447-454 instead of `getElementId`
   (utils/navigation/domHelpers.ts:9-10). If either copy drifts, scrolling to the cursor
   stops finding its element.
8. Gutter cell: S:547-572 and 601-624 vs R:79-96.
9. Code cell: S:577-597 and 629-649 vs C:66-82. The token lookup is written twice and
   behaves differently (S:243-250, misspelled `getProcomputedTokens`; C:46-57).
10. Line background: S:100-119 vs R:30-43.

Within S: the side-hit test three times (125/144, 494-497, 514-517); `onMouseEnter` and
`onMouseMove` (491-541) set hover state with the same logic; the old and new cells
(546-650) differ only by side.

The thread-action callbacks (`onGenerateThreadPrompt`, `onToggleThreadResolved`,
`onRemoveThread?`, `onRestoreComment?`, `onReplyToThread`, `onRemoveMessage`,
`onUpdateMessage`) are declared six times: viewers/types.ts:51-63, DiffChunk.tsx:52-63,
SideBySideDiffChunk.tsx:52-63, DiffViewer.tsx:48-60, CommentThreadCard.tsx:373-384
(renamed `onGeneratePrompt`), CommentsListModal.tsx:66-77. `onAddComment`, `onLineClick`
and the `commentTrigger` shape repeat the same way.

## Lore

- The side-less-thread branches in S (258, 264-279, 658, 665-667) are unreachable:
  `toCommentThread` always sets `side`. They compile because `CommentThread.side?` is
  optional (types/diff.ts:246). Making it required touches shared types and fixtures;
  ask first.
- `React.memo` on DiffLineRow (R:45) never skips a render, because D passes new arrow
  functions every render (reasoned, not measured).
- Untested in either mode: the comment trigger, half-width layout, word highlighting.

## Tasks

1. Add tests first: comment trigger in both modes, word highlighting in both modes, unit
   tests for `utils/wordLevelDiff.ts`, and a mode switch during a range selection (click
   unified line 10, switch to split and back, Shift-click line 12: today that opens a
   comment on 10-12). Acceptance: they pass on the current code.
2. Make `DiffChunk` a `memo` dispatcher; move the unified body to `UnifiedDiffChunk.tsx`.
   Keep `useLineRangeDrag` (DiffChunk.tsx:108-118) in the dispatcher: its
   `selectionAnchor` survives mode switches today only because `DiffChunk` stays mounted
   (useLineRangeDrag.ts:37-49), and a conditionally mounted child would reset it.
   This removes the double word-diff and the double trigger call in split mode, and
   makes D's dead layout switch go away (see `p1-20261114-delete-dead-code.md`).
   Acceptance: `pnpm test DiffChunk DiffViewer` passes.
3. Extract `pairChangedLines(lines)` into `utils/chunkLinePairs.ts` (or reuse it, if the
   h / l fix in `p3-20261114-keyboard-nav-defects.md` already extracted it) and a
   word-diff map used by both bodies. Move `convertToSideBySide` (S:314-404) into
   `utils/sideBySideLines.ts` (its counter fallbacks at S:318-396 are unneeded: every
   line has its number). Keyboard and renderer must keep using the same pairing.
4. Add `useThreadsByLine(threads)` keyed by `${side}:${lastLineOf(line)}`. Keep each
   mode's current ordering, or ask Matthew to pick one; unifying it is a visible change.
5. Add `ChunkThreadRow`, `ChunkComposerRow` and `LineNumberCell` in
   `components/ChunkCommentRows.tsx`. Reusing `DiffCodeLine` for the split code cell is a
   visible change, not a move: `DiffCodeLine` has `showPrefixBorder` but no `side` or
   prefix-off prop; its wrapper is `min-h-[16px]` with `px-3` on the highlighter, where
   split uses `min-h-[20px] px-3` on the wrapper (S:578, 630 vs C:62, 73, 78); split
   renders no prefix span; and split looks up tokens by side, while `DiffCodeLine`
   prefers new tokens for unchanged lines (S:590-593, 642-645 vs C:47-58). Either add
   props that keep split's markup exactly, or make the reuse its own commit with a
   headless-browser check, like task 8.
6. Use `getElementId` in both renderers.
7. Add `ThreadActionProps` and `LineClickProps` to `src/client/viewers/types.ts`; the six
   declarations use `Pick` or extend it. Acceptance: `pnpm build` (tsc).
8. Selection-highlight CSS unification is a visible change (class names and possibly
   rendering). Separate commit; check in headless Chromium, since happy-dom does not
   resolve CSS layers.
