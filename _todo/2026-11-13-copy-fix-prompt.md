---
title: Offer a fix prompt when another gavel review takes over this page's port
section: Web UI
---

# Copy a fix prompt for a replaced review

When another gavel review now runs at this page's address, the header robot's menu says so ("Another gavel review now runs at this address…"), but the reviewer has no way to get this review back. The maintainer decided (2026-11-13) that the menu should offer **Copy fix prompt**: a prompt naming this review, its waiting verdicts and comments, and which agent chat to paste it into, so that agent reopens the review.

Still to do: count queued changes in `useReviewOps`, build the prompt's thread list from `useDiffComments`, and pass the prompt to `AgentDeliveryStatus` from App. A first attempt's App test failed with "Close conversation" not found after `reviewContext` was added to the diff mock; that failure was not investigated.
