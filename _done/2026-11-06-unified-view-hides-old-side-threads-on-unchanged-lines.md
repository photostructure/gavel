---
title: Show old-side threads on unchanged lines in unified view
section: Diff comments
---

# Unified view hides old-side threads on unchanged lines

Fixed. `DiffChunk`'s `getThreadsForLine` now places threads with `lineShowsTarget`, the rule forms already use, so a thread sits under the row with its last number on its own side.

- [x] Red, then green: `pnpm vitest run src/client/components/DiffChunk.test.tsx -t "thread placement"`
- [x] Reviewed with `coding:second-opinion`: LAND on base `d0a944d`. Codex skipped (front-end; the maintainer's standing instruction).

## Problem

Split view lets a reviewer comment on the old column of an unchanged line, which
creates a thread with `side: 'old'`. Unified view looks up threads for an
unchanged row with `getThreadsForLine(line.newLineNumber, 'new')`
(`src/client/components/DiffChunk.tsx`), and `getThreadsForLine` requires
`thread.side === side`. Display threads always carry `side`
(`src/utils/commentThreads.ts`), so such a thread appears nowhere in unified view;
it shows only in split view and in Conversation.

Line-comment drafts already place an old-side form under the unchanged row with
that old number in unified view (`lineShowsTarget` in
`src/client/components/LineCommentComposer.tsx`), so a comment sent from that form
vanishes from the unified diff after Send.

Found on 2026-11-06 while making unsent comment drafts survive reloads.

## Direction

Place a row's threads with the same rule as forms: a thread sits under the line with
its last number on its side. Old-side threads that split view already created on
unchanged lines would then start showing in unified view.
