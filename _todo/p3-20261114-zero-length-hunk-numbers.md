---
title: Expanding a zero-length hunk shows wrong line numbers
priority: p3
section: Viewers
---

# TPP: Zero-length hunk expansion line numbers

With `--context 0`, Git writes zero-length hunks such as `@@ -5,0 +6,2 @@`. Expanding
around one gives wrong numbers, because `useExpandedLines.ts:580`, `:675-676` and `:430`
(at `d905dec`) assume the first hidden line is `oldStart - 1`, which is off by one when
the old length is 0. A scratch probe during the 2026-11-14 refactor audit showed that
after expand-all, the old 5 / new 5 row above the insert is missing and every later new
line number is off by one. The mirror case (a pure deletion, `+N,0`) is reasoned, not
reproduced.

`buildChunkRanges` in `DiffViewer.tsx:146` drops zero-line hunks; fix it consistently
with the hook. Land `p3-20261114-client-pure-logic.md` task 1's removal of the repeated gap formulas
(575-585 / 429-434, 634-636 / 440-446) first, as its own commit. This fix then changes
one formula instead of three (580, 675-676, 430). Do not combine the fix and that
commit.

Acceptance: `useExpandedLines.test.ts` cases for a zero-length insertion and a
zero-length deletion, expanded both ways, with the expected old and new numbers.
