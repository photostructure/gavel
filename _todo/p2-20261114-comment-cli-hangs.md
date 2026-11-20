---
title: gavel comment can wait forever on a hung server and may cut off its JSON output
priority: p2
section: CLI
---

# TPP: `gavel comment` hangs and truncation

Found by reading during the 2026-11-14 refactor audit (code as of `d905dec`).

- `comment add`, `comment get` and `comment resolve` / `reopen` / `delete` send requests
  with no timeout (their `serverFetch` calls in `createCommentCommand`, comment.ts). The other companion commands pass
  `AbortSignal.timeout(30000)` at 9 sites. A server that accepts the connection and
  never answers makes these commands wait forever.
- `comment.ts` calls `process.exit(1)` right after printing JSON (the `resolve` / `reopen` / `delete` action in `createCommentCommand`).
  `handleCommandError` and the `!response.ok` branches of `comment add` and `comment get` also exit, after a stderr message; once `process.exit` goes, those two
  branches need a `return`, and `handleCommandError` (typed `never`) needs a new type. `reportError` in conversation.ts and in review.ts set `process.exitCode` instead,
  with a comment saying this lets buffered output drain. Where piped stdout is
  asynchronous (macOS), the JSON could be cut off. Reasoned, not reproduced.

Both are behavior changes an agent can observe (`Changelog:` trailer).
Fix the timeout in `serverFetch` (cli/server-url.ts), not in comment.ts. Give it
a default `signal: AbortSignal.timeout(30000)` that a caller's `init.signal` replaces
(`registerShutdownHandlers` in index.ts passes its own 3000 ms signal). Then delete the eight explicit 30 s
signals passed to it, in the `snapshot`, `summary`, `status` and `reply` commands of conversation.ts and the `create`, `update`, `rename` and `delete` commands of review.ts. This TPP owns that change. `p3-20261114-cli-cleanup.md` task 2 still owns
`reportServerError`.

Acceptance: a `comment.test.ts` case that stubs `AbortSignal.timeout` (asserting it is
called with `30000` and returning a controller's signal), makes the mocked `fetch` reject
when that signal aborts, aborts it, and asserts the command ends through its error path;
and one asserting `process.exitCode` is set and `process.exit` is not called. Do not test
the timeout with fake timers: Vitest's fake timers do not fire `AbortSignal.timeout`
(checked with Vitest 4.1.9 and 5.0.5 on Node 24 during review of this plan). Merely
checking that a signal is passed would also accept a signal with no deadline.
