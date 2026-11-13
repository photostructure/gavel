---
title: Finish every approval celebration within 3 seconds
section: Approval
---

# TPP: Finish every approval celebration within 3 seconds

Celebrations ran 3.4 to 6.5 seconds, long enough to hold the reviewer on a review
they had finished. `src/client/utils/approvalCelebration.ts` now multiplies each
frame's elapsed time by `SPEED = 2` after the `MAX_FRAME` clamp, so every burst
follows the same path at double speed, and stops any burst at `MAX_SECONDS = 3`
real seconds (only balloons reach the cap). Durations and `DISCO_REST` stay in
simulated seconds.

`pnpm vitest run src/client/utils/approvalCelebration.test.ts` pins the 3-second
limit and the halved disco timings. The author could not watch the bursts at the new
speed: the browser pane stopped painting frames during the check.

Related: `2026-11-07-review-verdicts.md`,
whose countdown starts with the celebration.
