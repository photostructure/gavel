---
title: The open review's tab keeps its no-verdict mark after the reviewer approves it
section: Review verdicts
---

# Open review tab keeps its no-verdict mark

With two named reviews on one server, approving the second review while its tab is open left the tab strip saying a review still needs a verdict, while the banner below it said every review had one.

Observed on 2026-11-07 with reviews `gavel-header` and `readme-hero`. The reviewer approved `gavel-header` (Approve as-is), then opened `readme-hero` and approved it.

- `comment snapshot` showed `approval.approved: true`, `mode: "as-is"` for both reviews (`readme-hero` at 2026-11-07T23:27:54.826Z), so the server recorded both verdicts.
- The `readme-hero` tab kept the hollow circle that marks a review without a verdict (`ApprovalMark` in `ReviewQueueBar.tsx`), and the queue label read "… need a verdict" (`ReviewQueueBar.tsx:103-108`).
- `VerdictFollowUpNotice` showed "All 2 reviews have a verdict. You can close this tab." (`VerdictFollowUpNotice.tsx:48,78`).

`ReviewQueueBar` derives every tab mark and its label from its `reviews` prop (`<ReviewQueueBar reviews={approvalRequests}>` in `App.tsx`); the notice reads its count elsewhere. Not confirmed: the `reviews` list is not refreshed for the open review after its own verdict, while the notice sees that review's current approval.

## Outcome

No production change. The bug does not reproduce at HEAD, and the maintainer recalled fixing it. In a real server and headless Chromium, the tab, count and notice agreed in all five scenarios tried. A build without `c95f561` (`_done/2026-11-07-close-countdown-with-review-left.md`) showed this notice text beside a hollow tab when the reviewer clicked the next review's tab during the switch countdown, and the observation above predates that fix. The sequence as written, with the tab still hollow after the second approval, reproduced on neither build.

- [x] Regression tests, which pass on unchanged production code: `pnpm vitest run src/client/App.namedReviews.test.tsx -t "the open review in the tab bar"`. Removing each of the three list refreshes in `App.tsx` fails exactly its matching test.
- [x] Reviewed with `coding:second-opinion`: LAND on base `f3e74c3`. Codex skipped (front-end; the maintainer's standing instruction).
