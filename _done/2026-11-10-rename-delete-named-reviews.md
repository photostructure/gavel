---
title: Rename and delete named reviews on a running server
section: Named reviews
---

# TPP: rename and delete named reviews

## Summary

An agent that picked a poor review name, or no longer needs a review, can only stop the
server and start again, which drops every review's comments from the page. Add
`gavel review rename <name> <new-name>` and `gavel review delete <name>`. A rename keeps
the review ID, conversation, proposal, verdict and capture history under the new name. A
delete removes the review's tab and frees its name; its threads stay in **Conversation**,
labeled "(deleted)", until the server stops.

## Current phase

Complete.

- [x] Server: `POST /api/reviews/:name/rename` `{name}` and `DELETE /api/reviews/:name`
- [x] CLI: `review rename` and `review delete`
- [x] Schema: `review.renamed` and `review.deleted` events, `snapshot.deletedReviews`
- [x] Browser: follow a rename or delete of the open review by its ID; deleted threads in
      Conversation
- [x] Docs, skills, CHANGELOG

## Required reading

- **AGENTS.md**
- **docs/agent-conversations.md**: named captures and saved reviews

## Decisions

Made by the maintainer in conversation on 2026-11-10 (accepted as recommended):

- The review name stays the key for its state. A rename moves the state in the named-review
  store, the conversation, the comment-session cache, the server's current/initial/launch
  selections, and the saved-review file.
- A delete removes the saved-review file. The deleted review's threads live only in this
  server's memory, so a restart drops them, and `gavel review unapply <name>` can no longer
  find it by name (unapply first, or pass the patch with `-`).

- 7B-8: the review-ops queue (9dac2b3) landed first, and this change was replayed onto it.
  That queue keeps no browser copy of sent threads and never posts a whole thread list, so the
  browser-side guards this change had added against a deleted review's threads reaching a new
  review with its name were dropped: taking a named review's threads only from the server
  (7B-3), the load gate (7B-6), and sending the review ID with each save (7B-7).
- Each review snapshot an open page reads moves the reviewer's unconfirmed ops for every
  renamed review, found by its ID, to the new name, so they reach the renamed review whichever
  review the page shows. An op the reviewer queued on a deleted review that the server had
  not yet confirmed is sent to whatever review then has its name. It is the reviewer's own new change about the same
  name, not a stale copy of the deleted review's threads.

Taken by the agent while designing:

- Rename and delete emit `review.renamed` and `review.deleted`, like `review.capture`.
  `gavel wait` ignores them because they have agent origin.
- A delete drops the review's comments and verdicts that had not reached the agent's session
  inbox, because the agent can no longer answer them. Delivering them marked as belonging to a
  deleted review was the alternative.
- A rename drops the browser's viewed-file marks and unsent drafts for that review, which are
  keyed by name, and `?review=<old>` links in comments stop resolving.

## Review

The reviewed diff applies to main at 9dac2b3.

- Vetoed: deleting the shown review in a repository with no commits leaves HEAD vs `.`
  unviewable. That view never rendered there: an unnamed `gavel .` launch fails on the same
  `parseDiff` call.
