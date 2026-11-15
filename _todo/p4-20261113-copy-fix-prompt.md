---
title: Offer a fix prompt when a new agent session takes over a review
priority: p4
section: Web UI
---

# Copy a fix prompt for a taken-over review

Shelved on 2026-11-14 in favor of session-derived server ports ([server-port.ts](../src/server/server-port.ts)), which keep a review's port stable for its owning session, so another review rarely takes over the page's address. A fix prompt is still needed in one case: the owning chat is gone, and a new session restarts the review on its own port, so the page's waiting changes (in localStorage for the old host and port) never reach it.

What an implementation must do, learned from a built and reviewed attempt:

- Offer **Copy fix prompt** only once the page cannot reach this review at its address again. While a restart can bring the review back to the same port, the page resends its queue itself, and a pasted prompt delivers the same comments and verdict twice.
- Carry the waiting ops with their original IDs, and have the agent post them to `POST /api/review-ops`. The review's saved ledger (`appliedOps`) then answers a later resend from the page as `duplicate`. Re-adding comments by hand creates new IDs, so a later resend duplicates them. The ledger is saved per patch (`savedReviewKey`), so a restart from a different patch starts an empty ledger.
- Make the pasting session the new owner. The prompt names the prior agent, session name, session ID and hostname (all in `reviewContext`). The pasting agent restarts the review, and on the same host tells the prior session it took over and where the review now runs.
