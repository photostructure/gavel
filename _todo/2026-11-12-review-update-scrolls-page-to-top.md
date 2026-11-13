---
title: Keep the reviewer's scroll position when the agent updates the review
section: Web UI
---

# Keep the reviewer's scroll position when the agent updates the review

Placeholder; the cause in the client is not yet traced.

When the agent runs `gavel review update <name>` while the reviewer has that
review open, the page scrolls back to the top. A reviewer reading a thread
further down loses their place right after the agent posts its revision, which
is usually the moment they want to read the agent's reply.

Seen with the build of `main` at 9937258 on a two-file review
(`src/client.ts`, `src/retry.ts`): the reviewer was reading a change-request
thread on `src/client.ts:15`; within a second of `review update` advancing the
capture to version 2, the page showed the Change summary at the top. Every
inline thread is also marked Outdated, which the schema documents as intended.

Done means the open page keeps its scroll position (the visible file and line)
across a capture update, with a test that fails before the fix.
