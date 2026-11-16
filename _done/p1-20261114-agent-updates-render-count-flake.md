---
title: Stabilize the Conversation render-count test in App.agentUpdates.test.tsx
priority: p1
section: Tests
---

# Conversation render-count test fails under full-suite load

"leaves the diff unrendered when Conversation opens and closes" (`src/client/App.agentUpdates.test.tsx`) failed once in seven full `vitest run`s on 2026-11-14. It took its render-count baseline once the unread count showed and `DiffViewer` had rendered once more after mount, so a later render from the initial load could land after the baseline and fail the final equality.

## Outcome

The late render comes from the viewed-files load. `useViewedFiles` hashes every file before it commits the loaded viewed files, on its own schedule relative to the comments fetch, and App's "Initialize collapsed files from viewed files" effect then replaces `collapsedFiles` with a new set, which every `DiffViewer` receives. Instrumenting the test's `DiffViewer` mock showed that in every failing run the render after the baseline changed only `collapsedFiles`, right after the render that changed `reviewedFiles`. The failure reproduces on `main` at `47c5959` with 64 concurrent vitest processes of this file on a 32-core machine (`AssertionError: expected 17 to be 16`, 12 of 256 runs); the changed test failed 0 of 896 runs under the same load.

Both render-count tests ("opens and closes" and "a reply is marked read", which took its baseline the same way) now add a generated file to the fixture and wait for its "Expand file" button before counting. A generated file is auto-marked viewed, so it collapses only through that initialization effect, which is the initial load's last render. The `rendersBefore` wait each test used is deleted.

Reverting 1ef8304's changes to `src/client/App.tsx` and `src/client/hooks/useAgentUpdates.ts` still fails both tests (`expected 40 to be 28`, `expected 58 to be 56`), as does making only `handleToggleThreadResolved` a new function on each render.

Review: `coding:second-opinion` verdict LAND (Codex and Claude) on the diff against base commit `47c5959`. No findings were vetoed.
