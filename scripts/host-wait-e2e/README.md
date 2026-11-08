# Host wait check

`run.sh` checks that a real Claude host waits for gavel review feedback without
waking the model while nothing happens. It counts model calls (assistant
transcript entries with `usage`) in `~/.claude/projects/**/<session>.jsonl`, so
it measures what the host spends, not what gavel prints.

It is a manual pre-release check, not CI: it needs a logged-in `claude` and
spends real tokens (a few model calls per phase). Run `pnpm build` first: the
server and the agent both use this checkout's `dist/cli/index.js`, and the
agent follows this checkout's `skills/gavel/SKILL.md`. Run it in the background
(except in desktop mode, which waits for Enter) and read the log named on its
first line, `~/src/worktrees/tmp/gavel-wait-e2e-<stamp>.log`; a full run takes
about two hours.

```sh
PROJECT_ROOT=$(git rev-parse --show-toplevel)
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh selftest                   # no model; checks the harness and gavel wait
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh selftest --host 10.1.1.24  # same, LAN-bound server
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh tui                        # Claude TUI in tmux, Sonnet, 75-minute idle
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh tui --host 10.1.1.24
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh print                      # claude -p; see below
$PROJECT_ROOT/scripts/host-wait-e2e/run.sh desktop --session <uuid> --port <port>
```

The fixture is a scratch repository under `~/src/worktrees/tmp/`, a named
review served with `--no-open`, and a `curl` connection to `/api/heartbeat`
that holds reviewer presence the way an open browser tab does. Comments,
replies and LGTM are posted through the same HTTP endpoints the browser uses.

Phases and expected model calls:

| Phase                         | Expected                                |
| ----------------------------- | --------------------------------------- |
| idle (default 75 minutes)     | zero                                    |
| user comment                  | some, and the comment reaches `replied` |
| user reply in the same thread | some, and the reply reaches `replied`   |
| the ending chosen by `--end`  | some                                    |
| after the end (10 minutes)    | zero, and no `gavel wait` left running  |

Each of these ends the agent's wait, so one run tests one of them:
`--end lgtm` (the default) approves the review, `--end absent` closes the
reviewer's connection (`gavel wait` exits 4), and `--end exit` kills the server
(`gavel wait` exits 2). The idle phase only needs its full length once; pass
`--idle 600` for the other endings.

`claude -p` limits background commands, so an agent that follows the skill
arms no waiter and ends its turn. The run then fails at setup with "no gavel
wait is running", which is the expected result. A run that instead fails the
idle phase when the limit stops the waiter means the agent armed one against
the skill.

For the desktop app, build the same fixture the other modes create: a scratch
repository whose `notes.txt` reads `one`, `two`, `three` in its first commit and
has line two changed to `two changed` in the working tree, served with
`node $PROJECT_ROOT/dist/cli/index.js --review e2e --keep-alive` from that repository. Start a desktop session
there, pass its session ID and the review's API port, and paste the printed
prompt into that session. For `--end absent`, close every gavel tab on that
server first, since any open tab keeps the reviewer present. Check the iPad
case by hand: open the review
in Safari on the LAN, switch apps for a few minutes, and confirm the agent
still answers a comment made after switching back.
