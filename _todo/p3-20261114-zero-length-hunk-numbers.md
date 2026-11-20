---
title: Expanding a zero-length hunk shows wrong line numbers
priority: p3
section: Viewers
---

# TPP: Zero-length hunk expansion line numbers

With `--context 0`, Git writes zero-length hunks such as `@@ -5,0 +6,2 @@`. Expanding
around one gives wrong numbers, because three formulas in `useExpandedLines.ts` (the
first-chunk count `chunk.oldStart - 1` in `getHiddenLinesBefore`, the `endOld` and `endNew`
of the up expansion in `getExpandedChunk`, and the `gapStart` of the up ranges in
`expandAllLines`) assume the first hidden line is `oldStart - 1`, which is off by one when
the old length is 0. A scratch probe during the 2026-11-14 refactor audit showed that
after expand-all, the old 5 / new 5 row above the insert is missing and every later new
line number is off by one. The mirror case (a pure deletion, `+N,0`) is reasoned, not
reproduced.

`buildChunkRanges` in `DiffViewer.tsx` drops zero-line hunks with its `lines <= 0` check; fix it consistently
with the hook. Land `p3-20261114-client-pure-logic.md` task 1's removal of the repeated gap formulas
(`getHiddenLinesBefore`'s gap count / the up ranges in `expandAllLines`, and
`getHiddenLinesAfter`'s trailing count / the down range in `expandAllLines`) first, as its
own commit. This fix then changes one formula instead of the three named above. Do not
combine the fix and that commit.

Acceptance: `useExpandedLines.test.ts` cases for a zero-length insertion and a
zero-length deletion, expanded both ways, with the expected old and new numbers.
