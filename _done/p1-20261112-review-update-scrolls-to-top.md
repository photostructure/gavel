---
title: Keep the reviewer's scroll position when the agent updates the review
priority: p1
section: Web UI
---

# Keep the reviewer's scroll position when the agent updates the review

Complete. Base commit: `47c5959`.

When the agent ran `gavel review update <name>` while the reviewer had that
review open, the page scrolled back to the top.

## Causes

1. App kept merged chunks in state and rebuilt them in an effect keyed on
   `diffDataVersion`. The refetch after a capture update bumped the version, so
   for one commit `getMergedChunksForVersion` returned nothing and every
   DiffViewer drew its header with no lines. The page collapsed and the
   browser clamped the scroll position to 0. A Profiler check in the App test
   showed that commit drawing `file.md` with no rows.
2. `useLazyDiffRendering` included the capture version and patch digest in its
   revision key, so every capture update reset the rendered files to the first
   eight. A reviewer past the eighth file saw it turn into a placeholder.
   Chromium's scroll anchoring brought the page back after 160 to 700 ms;
   Firefox stayed on the eighth file.

## What changed

- `src/client/App.tsx` builds the merged chunks with `useMemo` from
  `renderedFilePaths`, `filesByPath` and `getMergedChunks`. `getMergedChunks`
  already returns unexpanded chunks for a diff it has not seen, so no version
  check is needed. `src/client/utils/mergedChunks.ts` and its test are
  deleted, as are `lastUpdatedAt`, `lastUpdatedFilePath` and
  `markFileUpdated` in `useExpandedLines`, which only fed the old effect.
- `useLazyDiffRendering` keys on the requested diff and the capture name, so a
  new capture of the open review keeps its rendered files, as a working-tree
  reload already did. Files the update adds render when they come near the
  viewport.
- Tests: `App.namedReviews.test.tsx` "keeps the open file drawn in every
  commit of a capture update" and `useLazyDiffRendering.test.ts` "keeps the
  files it rendered when the open review gets a new capture version". Both
  failed before the fix.

## Measured in headless browsers

A built server in a scratch repository, with the page scrolled down, then
`gavel review update` with a patch that changes lines above the viewport:

| Case | Before (47c5959) | After |
| --- | --- | --- |
| 2 files, Chromium | scrollTop 2500 to 0 | 2500 to 2600, same line (`clientValue157`) |
| 2 files, Firefox | scrollTop 2500 to 0 | 2500 to 2600, same line |
| 12 files, in the 11th, Chromium | dips to 314, back after about 0.7 s | 20944 to 21044, same line, no dip |
| 12 files, in the 11th, Firefox | ends at 6307 in `f04.ts` | 20945 to 21045, same line, no dip |

The 100 px change is the scroll anchoring for the rows the update added above.

## Decisions

- Merged chunks are computed during render instead of keeping the previous
  chunks until new ones are ready: keeping old chunks would pair them by index
  with the new diff's chunks in `presentationChunksByPath`.
- `largeFilesKey` keeps the capture version, so large files still collapse
  again on a new capture. Its comment no longer claims it equals the
  lazy-render key.
- Plans that described the deleted code or cited shifted `useExpandedLines.ts`
  lines are corrected: `p3-20261114-client-pure-logic.md`,
  `p1-20261114-split-app-tsx.md`, `p1-20261114-delete-dead-code.md`,
  `p3-20261114-client-shared-ui.md`.

## Review

Verdict: LAND on base `47c5959`. Codex skipped (front-end; maintainer's standing
instruction); Claude reviewer LAND after two passes. No findings were vetoed.

## Open

- A new capture still re-collapses every large file, including one the
  reviewer loaded, and the `commentsCaptureKey` reset re-collapses viewed
  files. A reviewer reading inside such a file loses the visible line. Not
  reproduced in a browser.
