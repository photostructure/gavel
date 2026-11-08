---
title: Stabilize the tests that fail when the machine is heavily loaded
section: Testing
---

# Tests that fail under CPU load

Placeholder. Not started.

With several agents running, at load averages of 100 to 215 on 2026-11-08, full `pnpm vitest run` passes failed in these places, and the same tests passed alone or with `--maxWorkers=2`. The cause is established only where stated.

- `src/server/review-capture.test.ts`, "keeps large submodule preflight metadata outside the patch byte limit": hit its 5000 ms timeout at 5059 ms, and took 4720 ms in a passing run at load 147.
- `dev/dev-launcher.test.ts`: "opens the named review and capability… (JSONL: true)", which may be the empty-file read that `_todo/2026-11-09-dev-launcher-test-reads-empty-file.md` records, and two shutdown assertions, whose cause is not established.
- `src/client/App.agentUpdates.test.tsx`, "clears the approval label when an approval-change notification arrives", which failed under its earlier name, "updates the pending approval label when an approval-change notification arrives". Cause not established.
- `src/client/components/CommentsListModal.test.tsx`, "sends a general question and filters resolved conversations without navigating". Cause not established.

Each needs its cause found and the wait, clock or shared state fixed. A longer blanket timeout or a retry is not a fix.
