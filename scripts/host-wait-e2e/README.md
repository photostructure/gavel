# Host wait check

`run.sh` checks the harness and `gavel wait` without running a model. It makes
no paid API calls and needs no logged-in `claude`.

Run `pnpm build` first: the script uses this checkout's `dist/cli/index.js`.
It prints the log's path, `$WORKTREE_ROOT/gavel-wait-e2e-<stamp>.log`, on its
first line, and finishes in about ten seconds. `WORKTREE_ROOT` defaults to
`~/src/worktrees/tmp`.

```sh
PROJECT_ROOT=$(git rev-parse --show-toplevel)
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh                   # 127.0.0.1
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh --host 10.1.1.24  # LAN-bound server
```

The fixture is a scratch repository under `$WORKTREE_ROOT`, a named
review served with `--no-open`, and a Node WebSocket on `/api/live` that holds
reviewer presence the way an open browser tab does. Comments and approvals are
posted through the same HTTP endpoints the browser uses. The server starts
without `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET` and
`CODEX_THREAD_ID`, so its activity does not reach the inbox of the Claude Code or
Codex session that runs the script.

The script then checks that:

1. a posted comment is queued as a user message;
2. `gavel wait` returns that comment;
3. a second `gavel wait` exits 0 and reports the approval;
4. closing the reviewer's connection ends a third `gavel wait` with exit 4.

It does not check what a host does while it waits. Claude Code reviews get
feedback through the session inbox, not `gavel wait`, so a model-driven check
of `gavel wait` would not test that path; no check measures model calls per
human event.
