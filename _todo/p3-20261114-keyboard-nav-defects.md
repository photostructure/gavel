---
title: Keyboard navigation lands on the wrong row in split view and for range comments
priority: p3
section: Web UI
---

# TPP: Keyboard navigation defects

Found by reading during the 2026-11-14 refactor audit (line numbers at `d905dec`); none
reproduced in a browser yet.

- **h / l in split view can land on another row.** `useKeyboardNavigation.ts:143-165`
  pairs only adjacent lines, but `SideBySideDiffChunk.tsx:341-387` pairs `deleteLines[k]`
  with `addLines[k]`. With del0, del1, add2, add3: h on add2 goes to del1, and h on add3
  falls through to the next normal line. Tests use only one-to-one pairs.
- **Shift+N / Shift+P go to the wrong line of a range comment.** The comment index keys
  on `thread.line[0]` (useKeyboardNavigation.ts:62), but the card renders at the end
  line (positionHelpers.ts:68-70, LineCommentComposer.tsx:33-34,
  SideBySideDiffChunk.tsx:255-257). A range starting outside the hunk is skipped.
- **`{` / `}` can put the cursor on an empty split cell.** useKeyboardNavigation.ts:356-405
  skips `fixSide`, and `{` does not check that file 0 has lines.
- **`?` cannot close the help it opened.** HelpModal disables the `navigation` scope
  (HelpModal.tsx:17-24) and `?` is bound only there (useKeyboardNavigation.ts:552); the
  help row says "Show/hide this help". Confirmed from react-hotkeys-hook 5.3.3 source.
  Product decision: bind `?` in HelpModal, or change the text.

These fixes do not wait for the refactor arc. Fix the code where it is today
(useKeyboardNavigation.ts:139-238 for h / l, 356-405 for `{` / `}`, 59-70 for Shift+N/P),
and the later moves in `p3-20261114-client-pure-logic.md` task 4 carry the fixed code.
For h / l, first extract the delete-to-add pairing from SideBySideDiffChunk.tsx:341-387
into `utils/chunkLinePairs.ts` as `pairChangedLines` in a move-only commit, then call it
from the keyboard code in the fix commit; `p3-20261114-diff-chunk-renderers.md` task 3
then reuses it instead of extracting it. Acceptance: a failing
`useKeyboardNavigation.test.tsx` case per bullet before each fix.
