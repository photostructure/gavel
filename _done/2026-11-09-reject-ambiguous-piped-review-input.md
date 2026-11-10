---
title: Prevent omitted stdin markers from capturing the wrong diff
section: CLI
---

# Prevent omitted stdin markers from capturing the wrong diff

Matthew called the required `-` in `git diff ... | gavel review create name -` a
footgun: omitting it silently captured the uncommitted tree instead of the piped
patch, which could include another session's work. `review update` had the same
problem and could also drop originally included untracked files.

`resolveCommandReview` in [review.ts](../src/cli/review.ts) now exits with an
error, before capturing or contacting a server, when stdin is a pipe, socket, or
file and none of `-`, `--capture`, `--pathspec`, or `--include-untracked` was
given.

- [x] Piped patches, empty pipes, redirected files, and a pipe that never closes
      are rejected with no request sent; `-`, the null device, and native capture
      options still work — `pnpm exec vitest run src/cli/index.integration.test.ts -t "named review stdin"`
- [x] The rejection and its exemptions are pinned in unit tests — `pnpm exec vitest run src/cli/review.test.ts`
- [x] Reviewed — LAND from Codex and Claude; no model slot missing; base commit `c2010bd`

## Lore

- Claude Code's Bash tool and `codex exec` both run commands with fd 0 on
  `/dev/null` (measured 2026-11-09 with `ls -l /proc/self/fd/0`).
  `detectStdinSource` classifies `/dev/null` as `'tty'`, so agents' bare native
  captures still work.
- A script that spawns `review create` with an open stdin now gets the error and
  must redirect stdin from `/dev/null`, or pass `stdio: 'ignore'` from Node.
- Node's `stdio: 'pipe'` gives the child a socket on POSIX, so only a shell
  pipeline produces a real FIFO in a test.
- Not verified on Windows: how `fstat` classifies its pipes, and the `/dev/null`
  advice does not apply to `cmd.exe` or PowerShell.

## Solutions rejected

- Reading stdin and treating content as the patch blocks forever on a pipe that
  a host leaves open.
- Peeking at stdin with a timeout falls back to the wrong capture when `git diff`
  is slower than the timeout, which is the original bug.
- A new `--working-tree` flag is unnecessary: `</dev/null` already states the
  intent, and neither measured host needs it.

The same hazard on the `--review` launch is tracked in
[its own TPP](../_todo/2026-11-09-reject-piped-input-on-review-launch.md).
