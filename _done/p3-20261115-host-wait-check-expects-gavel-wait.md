---
title: The host wait check fails whenever the agent follows the gavel skill
priority: p3
section: Testing
---

# The host wait check fails whenever the agent follows the gavel skill

`scripts/host-wait-e2e/run.sh` told a real Claude Code session to follow
`skills/gavel/SKILL.md`, then failed setup unless a `gavel wait` process was running
for the review's port. The skill's "Wait for feedback" section forbids `gavel wait`:
Claude Code reviews get feedback through the session inbox. So the `tui` and `desktop`
modes failed at setup whenever the agent did what it was told.

## Decision

Matthew, 2026-11-15 (question DF-9, accepted as recommended): drop the `tui`, `print`
and `desktop` modes and keep `selftest`, which runs no model. Rewriting the check to
measure inbox delivery was rejected because it would need live-model runs.

## Outcome

- `run.sh` now runs only the former `selftest` and takes only `--host`. The model
  modes, the transcript model-call counting, tmux handling, the agent prompt and the
  waiter-process check are deleted, along with the options only they used.
- `README.md` describes the remaining check and says it measures no model calls.
- `_todo/p3-20261109-idle-review-token-limits.md` no longer says the check measures
  model calls.
- `user_comment` lost its optional thread-ID parameter, which only the deleted reply
  phase used.
- The server the script starts is launched without `CLAUDE_CODE_SESSION_ID`,
  `CLAUDE_CODE_MESSAGING_SOCKET` and `CODEX_THREAD_ID`. Before, a run inside a Claude
  Code or Codex session delivered its simulated comment and approval to that session's
  inbox. With a fake `CODEX_THREAD_ID` and a stub `codex` on `PATH`, the script made one
  `codex queue --thread` call before the change and none after; inside a Claude Code
  session, a run created no file under `$XDG_RUNTIME_DIR/gavel/sessions`.
- The scratch repository and log go under `$WORKTREE_ROOT`, which defaults to
  `~/src/worktrees/tmp`, the path the script used before.
- `p3-20261114-cli-cleanup.md` cites the script's `dist/cli/index.js` line, now
  `run.sh:12`. `p1-20261114-remove-backward-compat.md` names the approval and comment
  endpoints the remaining check still uses, so it is unchanged.

Base commit: `47c5959`.
