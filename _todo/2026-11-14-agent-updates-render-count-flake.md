---
title: Stabilize the Conversation render-count test in App.agentUpdates.test.tsx
section: Tests
---

# Conversation render-count test fails under full-suite load

"leaves the diff unrendered when Conversation opens and closes" (`src/client/App.agentUpdates.test.tsx`) failed once in seven full `vitest run`s on 2026-11-14, on the session-derived ports change, and passed in three runs of that file alone. It reads its baseline render count as soon as `DiffViewer` has rendered once more after mount, so a later render from the initial load that lands after that read fails the final equality. Not established: whether `main` without that change fails the same way, and which load step renders late. Fix by waiting until the initial load has settled (for example, until the render count stops changing) before taking the baseline.
