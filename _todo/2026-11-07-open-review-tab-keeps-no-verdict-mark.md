---
title: The open review's tab keeps its no-verdict mark after the reviewer approves it
section: Review verdicts
---

# Open review tab keeps its no-verdict mark

With two named reviews on one server, approving the second review while its tab is open left the tab strip saying a review still needs a verdict, while the banner below it said every review had one.

Observed on 2026-11-07 with reviews `gavel-header` and `readme-hero`. The reviewer approved `gavel-header` (Approve as-is), then opened `readme-hero` and approved it.

- `comment snapshot` showed `approval.approved: true`, `mode: "as-is"` for both reviews (`readme-hero` at 2026-11-07T23:27:54.826Z), so the server recorded both verdicts.
- The `readme-hero` tab kept the hollow circle that marks a review without a verdict (`ApprovalMark` in `ReviewQueueBar.tsx`), and the queue label read "… need a verdict" (`ReviewQueueBar.tsx:103-108`).
- `VerdictFollowUpNotice` showed "All 2 reviews have a verdict. You can close this tab." (`VerdictFollowUpNotice.tsx:46,76`).

`ReviewQueueBar` derives every tab mark and its label from its `reviews` prop (`<ReviewQueueBar reviews={approvalRequests}>` in `App.tsx`); the notice reads its count elsewhere. Not confirmed: the `reviews` list is not refreshed for the open review after its own verdict, while the notice sees that review's current approval.

Fix test-first: a client test that renders two reviews, records a verdict on the open one, and expects its tab mark and the queue label to change, failing before the fix.
