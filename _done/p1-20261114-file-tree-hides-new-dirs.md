---
title: File tree hides files under a directory that appears after a reload
priority: p1
section: Web UI
---

# TPP: File tree hides new directories after a reload

Status: COMPLETE. Base commit `47c5959`.

## Problem

`FileList` seeded its expanded-directory set once from the first tree and never
updated it. A watch reload or the ignore-whitespace refetch keeps `FileList` mounted, so
a directory that first appeared on a reload rendered collapsed and hid its files. For
example, a review holding only `src/client/App.tsx` shows the directory `src/client`; a
reload that adds `src/index.ts` creates a new `src` node, which was not in the set. The
expand-all toggle compared set sizes, so it also showed "Expand all" while every
directory the user had opened was open.

## Outcome

- `FileList` stores collapsed directories (`collapsedDirs`, initially empty), so new
  directories start expanded. The `getAllDirectoryPaths` seed is gone; the function
  remains for the toggle.
- Expand all sets an empty set; collapse all sets every current directory path.
- `isAllExpanded` is true when the tree has at least one directory and none of the
  current directories is collapsed. Stale paths of directories that left the tree do
  not affect it. The "at least one directory" condition keeps the old behavior for a
  tree with no directories (the toggle shows "Expand all").
- A directory the user collapsed stays collapsed when a reload splits a merged node
  (`src/client` becomes `src` > `client`), because the merged node already carried the
  deepest path, `src/client`.
- No localStorage or cookie state stores expanded directories, so nothing needed
  migrating.
- `FileList.test.tsx` gains a reload test (fails at `47c5959`: `src/client/App.tsx` is
  not rendered) and a test of single-directory collapse, expand all, and collapse all.
