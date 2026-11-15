---
title: File tree hides files under a directory that appears after a reload
priority: p1
section: Web UI
---

# TPP: File tree hides new directories after a reload

`FileList` seeds `expandedDirs` once from the first tree (FileList.tsx:244-246 at
`d905dec`) and never updates it. A watch reload (`handleWatchReload`, App.tsx about
1009-1016) and the ignore-whitespace refetch keep `FileList` mounted. Example: a review
holding only `src/client/App.tsx` shows the directory `src/client`; a reload adds
`src/index.ts`, which creates a new `src` node that is not in the set, so it renders
collapsed and both files disappear from the tree. `isAllExpanded` (348) compares set
sizes, so the expand-all toggle can show the wrong state too. Reproduced by a scratch
test during the 2026-11-14 refactor audit (not committed).

Fix, test-first: store collapsed directories instead of expanded ones, so new
directories start expanded. Acceptance: a `FileList.test.tsx` case that rerenders with a
file in a new directory and finds both files.
