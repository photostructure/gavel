---
title: Let a running server take over a review whose lock belongs to a dead server
section: Server
---

# Let a running server take over a review whose lock belongs to a dead server

Placeholder; the lock code is not yet traced.

Two gavel servers ran on one repository (photostructure.com), both serving the
named review `article-small-reviews`. The first, PID 2292076, held the review's
lock in `.git/gavel/locks/`, so the second, on port 4968, kept that review's
changes in memory and reported in its snapshot's `store.error`: "kept in memory
only because another running gavel server saves them: article-small-reviews".

The first server was then killed. Its lock file and its record in
`.git/gavel/servers/` still name PID 2292076 on the same host, and `kill -0
2292076` reports no such process. The server on 4968 still reported the same
`store.error` afterwards, so the reviewer's Approve and any later comments lived
only in that process: a restart of it would have lost them.

Seen with the launcher's build of `main` at 9937258 on 2026-11-13.

Done means a running server notices that a lock it was waiting on belongs to a
process that no longer exists on this host, takes the lock, and writes its
in-memory changes to the store, with a test that fails before the fix.
