---
title: Show a verdict the server has not confirmed on the verdict buttons
section: Web UI
---

# Queued verdict not shown on the verdict buttons

Seen in play testing on 2026-11-13. With the gavel server stopped and toast-a approved, clicking **Approved** to clear the verdict left the button green and **Approved**, and the unsaved-changes toast's count went up by one on each click (to 7). When the server came back, the queued verdicts were sent in order.

Likely cause, from reading the code but not confirmed: the verdict buttons show `approval.verdict` from `useReviewApproval`, which is the server's last answer. `handleVerdict` in App.tsx queues a `verdict.set` op through `useReviewOps`, but the queue's verdict is not reflected on the buttons the way queued comments are shown. So each click still reads **Approved** and queues another `clear`.

Fix test-first: an App test that fails review-ops sends, clicks **Approved**, and expects **Approve** (not pressed), and expects a second click to queue `approve`.
