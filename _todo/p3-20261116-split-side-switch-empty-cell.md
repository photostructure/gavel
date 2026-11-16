---
title: h / l from a split row with an empty cell jump to another row
priority: p3
section: Web UI
---

# TPP: h / l from a row whose other cell is empty

Found in review of `p3-20261114-keyboard-nav-defects.md`; present at `840cfb6`.

When the split row under the cursor has no cell on the target side, `switchSide` in
`src/client/hooks/useKeyboardNavigation.ts` searches forward, then backward, by line index
for a line with content on that side, not by split row. With lines del0, del1, del2, add3,
normal4, split view shows add3 beside del0, so `l` on del2 lands on add3, two rows up,
instead of normal4, one row down. Fix: search the rows from `pairChangedLines`
(`src/client/utils/chunkLinePairs.ts`) outward from the cursor's row, and decide whether the
nearest row above or below wins. Acceptance: a failing `useKeyboardNavigation.test.tsx` case
for the example above before the fix.
