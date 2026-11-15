---
title: gavel comment can wait forever on a hung server and may cut off its JSON output
priority: p2
section: CLI
---

# TPP: `gavel comment` hangs and truncation

Found by reading during the 2026-11-14 refactor audit (line numbers at `d905dec`).

- `comment add`, `comment get` and `comment resolve` / `reopen` / `delete` send requests
  with no timeout (comment.ts:74, 112, 167). The other companion commands pass
  `AbortSignal.timeout(30000)` at 9 sites. A server that accepts the connection and
  never answers makes these commands wait forever.
- `comment.ts` calls `process.exit(1)` right after printing JSON (comment.ts:216-225).
  Lines 30, 85 and 117 also exit, after a stderr message; once `process.exit` goes, 85
  and 117 need a `return`, and `handleCommandError` (typed `never`) needs a new type. `conversation.ts:39` and `review.ts:260` set `process.exitCode` instead,
  with a comment saying this lets buffered output drain. Where piped stdout is
  asynchronous (macOS), the JSON could be cut off. Reasoned, not reproduced.

Both are behavior changes an agent can observe (`Changelog:` trailer).
Fix the timeout in `serverFetch` (cli/server-url.ts:27-38), not in comment.ts. Give it
a default `signal: AbortSignal.timeout(30000)` that a caller's `init.signal` replaces
(index.ts:595 passes its own 3000 ms signal). Then delete the eight explicit 30 s
signals passed to it: conversation.ts:61, 114, 143, 169 and review.ts:315, 348, 458, 482. This TPP owns that change. `p3-20261114-cli-cleanup.md` task 2 still owns
`reportServerError`.

Acceptance: a `comment.test.ts` case that stubs `AbortSignal.timeout` (asserting it is
called with `30000` and returning a controller's signal), makes the mocked `fetch` reject
when that signal aborts, aborts it, and asserts the command ends through its error path;
and one asserting `process.exitCode` is set and `process.exit` is not called. Do not test
the timeout with fake timers: Vitest's fake timers do not fire `AbortSignal.timeout`
(checked with Vitest 4.1.9 and 5.0.5 on Node 24 during review of this plan). Merely
checking that a signal is passed would also accept a signal with no deadline.
