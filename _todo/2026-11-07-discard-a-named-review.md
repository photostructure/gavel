---
title: Discard one named review from a running server
section: Review server
---

# Discard a named review

A named review stays in the page's review tabs until its server stops, even when it will never be committed. `gavel review` has only `capture`, `create`, and `update`, and the server's `/api/reviews` routes (`src/server/server.ts:705-738`) can read, create, and recapture a review but not remove one. The only way to clear a superseded tab is to stop the server, which closes every other review on it.

Seen on 2026-11-07: a server held `site-walkthrough`, `static-demo-tpp`, and `delete-site`. The first two were superseded by the third, but their tabs stayed beside it until the server stopped, and the reviewer expected the middle one to be gone.

Add `gavel review discard <name> --port <port>` and a matching control in the page. Discarding should drop the review's tab and its saved copy under `.git/gavel` (`src/server/review-store.ts`), and tell connected agents with an event. Open questions: whether discarding needs confirmation in the page, whether a review with a verdict or unanswered user comments can be discarded, and what the page shows when the open review is discarded.
