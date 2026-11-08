---
title: Opening the next review during the switch countdown started a close countdown
section: Review verdicts
---

# Close countdown while a review still needs a verdict

With two named reviews on one server, the reviewer approved `task9-rebuild-guard` and, while the page counted down to switching to `task9-idle-sync`, opened `task9-idle-sync` from its tab. That review had no verdict, yet the page showed "All 2 reviews have a verdict. Closing this tab in 10s". In Firefox, which ignores `window.close()` on a tab with more than one history entry, that turned into "You can close this tab."

Observed on 2026-11-07 in Firefox. The server recorded one verdict, Approve as-is on `task9-rebuild-guard`; `task9-idle-sync` kept `approval: { approved: false }`. Letting the countdown finish on its own switched correctly in every reproduction, because `runNextStep` clears the phase before it switches.

## Cause

In `useVerdictFollowUp.ts`, opening another review changed `current` in one render. Two effects then ran in the same flush: the `currentKey` effect called `setPhase(null)`, and the effect that reacts to `hasTarget` still saw the old `switch` phase. `nextReviewNeedingVerdict` skips the open review, so with `task9-idle-sync` open and `task9-rebuild-guard` approved it found no target, and that effect called `countdown(undefined)`, which queued a close phase after the `null`.

## Fix

Each phase records the key of the review that was open when it began, and the hook ignores a phase whose review is no longer open. The `hasTarget` effect therefore sees no phase in the render where another review opens.

- [x] Red, then green: `pnpm vitest run src/client/App.namedReviews.test.tsx -t "ends the countdown when the reviewer opens the next review from its tab"`
- [x] Reviewed with `coding:second-opinion`: LAND on base `bd03aa2`. Codex skipped (front-end; the maintainer's standing instruction).
