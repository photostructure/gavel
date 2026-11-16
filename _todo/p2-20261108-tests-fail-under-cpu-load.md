---
title: Stabilize the tests that fail when the machine is heavily loaded
priority: p2
section: Testing
---

# Tests that fail under CPU load

Placeholder. Not started.

With several agents running, at load averages of 100 to 215 on 2026-11-08, full `pnpm vitest run` passes failed in these places, and the same tests passed alone or with `--maxWorkers=2`. The cause is established only where stated.

- `src/server/review-capture.test.ts`, "keeps large submodule preflight metadata outside the patch byte limit": hit its 5000 ms timeout at 5059 ms, and took 4720 ms in a passing run at load 147.
- `dev/dev-launcher.test.ts`: "opens the named review and capability… (JSONL: true)", which may be the empty-file read that `_todo/p1-20261109-dev-launcher-reads-empty-file.md` records, and two shutdown assertions, whose cause is not established.
- `src/client/App.agentUpdates.test.tsx`, "clears the approval label when an approval-change notification arrives", which failed under its earlier name, "updates the pending approval label when an approval-change notification arrives". Cause not established.
- `src/client/components/CommentsListModal.test.tsx`, "sends a general question and filters resolved conversations without navigating". Cause not established.
- `src/client/App.largeFiles.test.tsx`, "collapses files that become large on reload and keeps a loaded one open": hit its 5000 ms timeout in 24 of 24 runs at 47c5959 with 24 copies of the file running at once. With the fix in `p1-20261112-review-update-scrolls-to-top.md` all 24 copies passed, but the test failed once (7518 ms) in five full `src/client` runs. The test draws a 1025-row file in happy-dom on load, on Load diff, and again on reload; that this is where the time goes is not measured.

Each needs its cause found and the wait, clock or shared state fixed. A longer blanket timeout or a retry is not a fix.
