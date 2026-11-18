---
title: Show a verdict the server has not confirmed on the verdict buttons
priority: p2
section: Web UI
---

# Queued verdict not shown on the verdict buttons

Seen in play testing on 2026-11-13. With the gavel server stopped and toast-a approved, clicking **Approved** to clear the verdict left the button green and **Approved**, and the unsaved-changes toast's count went up by one on each click (to 7). When the server came back, the queued verdicts were sent in order.

## Cause

Confirmed: the verdict buttons showed `approval.verdict` from `useReviewApproval`, the server's last answer. `handleVerdict` in App.tsx queues a `verdict.set` op through `useReviewOps`, and nothing showed that op, so each click still read **Approved** and queued another `clear`.

## Outcome

Complete. The page now follows the recorded decision in `p2-20261107-server-only-review-state.md`, "the page shows the server's state with queued ops applied on top", for the verdict as it already did for comments:

- `useReviewOps` returns `verdict`, the latest `verdict.set` op still in the queue (`'clear'` for a clear), next to the threads it already overlays.
- App.tsx shows `shownVerdict`, that op's verdict over `approval.verdict`, on the verdict buttons, the verdict toast, the Shift+A/Shift+X check that ignores the verdict already shown, `currentHasVerdict` for the next step, and the click-time verdict that decides whether an approval celebrates.
- The answer to a verdict op takes it out of the queue before the page reads the approval back. `useReviewApproval.applied` shows the applied verdict in that gap and ignores reads that started before it, so the button does not flash back to the old verdict.
- A new verdict closes the next-step toast of the earlier one (`verdictFollowUp.cancel()` in `handleVerdict`). Without that, a Reject queued while the server was down left the toast reading "Rejected You can close this page." while the server held the approval.

Each click now changes the shown verdict, so the unsaved-changes count rises once per real change (clear, then approve, and so on), and a click or shortcut never queues the verdict the page already shows.

Tests in `App.reviewOps.test.tsx`, each seen failing before its fix: "shows a waiting verdict change on the verdict buttons", "keeps showing a verdict the server applied while the page reads it back", "closes the next step for a confirmed verdict when a new verdict waits". Two existing tests clicked a pressed verdict expecting another op of the same verdict; their clicks now follow the new buttons ("celebrates once for an approval given again after a waiting clear", "does not start the next step for a waiting Reject that a later clear replaced").

## Decisions taken without the maintainer

- The flash between the answer and the read-back is closed by `useReviewApproval.applied` rather than by adding the verdict to the `POST /api/review-ops` answer. The answer route would change the server and give the page two server sources for the verdict to reconcile.
- An answer another tab got (`elsewhere`) still shows the server's previous verdict until the read-back, since this tab does not know whether the op was applied.

## Review

Claude reviewer LAND on pass 2, on base commit `47c5959`. The Codex slot is missing: front-end batch, by the maintainer's standing instruction. No findings were vetoed.
