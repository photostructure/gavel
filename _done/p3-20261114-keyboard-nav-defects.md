---
title: Keyboard navigation lands on the wrong row in split view and for range comments
priority: p3
section: Web UI
---

# TPP: Keyboard navigation defects

Found by reading during the 2026-11-14 refactor audit. Finished against base commit
`840cfb6`.

## Outcome

- **h / l in split view** now move to the line the split view shows beside the cursor.
  The renderer's pairing moved from `SideBySideDiffChunk.tsx` (`convertToSideBySide`) into
  `pairChangedLines` in `src/client/utils/chunkLinePairs.ts`, which returns each split row
  as the line indices of its left and right cells; the renderer maps those rows to cells,
  and `switchSide` in `useKeyboardNavigation.ts` looks up the cursor's row. With del0,
  del1, add2, add3, h on add2 goes to del0 and h on add3 to del1 (before: del1, and the
  next unchanged line). `p3-20261114-diff-chunk-renderers.md` task 3 reuses
  `pairChangedLines`.
- **Shift+N / Shift+P** key the comment index on a range's last line (`lastLineOf` from
  `LineCommentComposer.tsx`), where the card renders, so a range that starts above the
  hunk is no longer skipped.
- **`{` / `}`** go through one `fileStartPosition`, which applies `fixSide` and returns
  null for a file without lines; `focusNextUnviewedFile` and `rememberFilePosition` use it
  too. `{` and `}` do nothing when their file has no lines.
- **`?`** is bound in `HelpModal.tsx` while the modal is open, with the same punctuation
  options as the navigation binding, so `?` closes the help it opened.

Checked in headless Chromium against a built worktree, on a repository whose `notes.txt`
hunk has two deletions above two additions and range comments on new lines 8-11 and 2-9.
Before the fix: h on "line ten, rewritten" went to old line 11 and h on "line eleven,
rewritten" to line 12; `{` and `}` left no cursor cell highlighted (cursor on the empty
left cell of an added file); Shift+N went to lines 2 and 8; a second `?` left the help
open. After: h went to old lines 10 and 11; `{` and `}` highlighted the right cell of the
first and last files; Shift+N went to lines 9 and 11; a second `?` closed the help.

## Decisions

- Maintainer decision (2026-11-15, question DF-7, accepted as recommended): bind `?` in
  HelpModal so `?` closes the help, matching its "Show/hide this help" row, rather than
  change the row's text.
- `{` with no lines in the first file does nothing, as `}` already did for a last file
  without chunks. Jumping to the first file that has lines was the alternative; it would
  differ from `}` and from what the key's help row ("first file") says.
- The split view's unchanged rows no longer get a shallow copy of the line as `newLine`;
  nothing compares the two objects.

## Review

Second opinion: `LAND`, with no findings, on the first pass of both batches (the
`chunkLinePairs.ts` extraction, then the keyboard and help fixes). Only the Claude reviewer
ran; Codex was skipped because the change is front-end only (maintainer's standing
instruction).

## Not done

- `p3-20261116-split-side-switch-empty-cell.md`: h / l from a row whose other cell is
  empty still search by line index, not by row. This was already the behavior at `840cfb6`.
