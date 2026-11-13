# Waiting for human review

## Claude Code: the server sends feedback to the session

Claude Code exports its session's cross-session inbox to Bash commands as
`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET` and
`CLAUDE_CODE_MESSAGING_TOKEN`. A server launched with those variables, including a
`--background` one, owns its reviews on behalf of that session; `review create`
sends the creating session's inbox for its own review, or `null` when the
creating process has none. The token stays in the server's memory; no file or
API response contains it. Commands a user types with `!` in Claude Code, and
commands run in a separate terminal, do not receive these variables: a server
they launch has no owning session, and the page offers **Copy resume prompt**.
A server launched with `--no-conversation` has no inbox and sends nothing,
whatever its environment.

The server sends human verdicts, comments, and comment edits to
the owning session. Agent activity never sends anything. A verdict sends after
2 seconds; comments alone wait until 5 seconds pass without
more of them. One message covers every review of that session with unsent
activity: a line per review with its current verdict and the number of messages
awaiting an answer, then only the human events no message has carried yet (above
50,000 characters, the snapshot command instead). Each event carries only the
fields an agent acts on. A comment has `type` (`comment.created` or
`comment.updated`), `review` (the review's name, or `base..target`), `reviewId`,
`threadId`, `messageId`, `cursor`, and `body`; `intent` when the reviewer set
one; for a comment on lines, `file`, `side`, and `line`; and `code`, the excerpt
the reviewer saw, when the thread saved one. A general comment in
**Conversation** has no location, and a thread imported without code has no
`code`. A verdict has `type` (`review.approval`),
`review`, `reviewId`, and `verdict` (`null` when the reviewer cleared it).
A newer edit of a queued comment, or a newer verdict, replaces the queued one.
The agent reads a fresh snapshot before acting on a verdict. An idle session
starts a turn with the message. The agent ends its turn after sharing the URL;
it runs no waiter.

Claude Code sends no reply on its inbox, so the server knows only that the inbox
accepted the message. With `crossSessionInbound` set to `hold` or `refuse`, Claude
Code accepts the bytes but withholds the message, and the page still shows it as
sent; `gavel pending` cannot recover it. Left unset, it also holds them while the
session bypasses permission prompts, because gavel's messages declare no
permission mode, unless the server still descends from the session's Claude Code
process. A `--background` server does not: it detaches from its launcher. Set it
to `accept` for gavel's messages to start turns in every permission mode.

`GET /api/inbox` reports, for each review, `ready`, `pending`, `sent`
(`via: "inbox"` or `"prompt"`), `failed` with the error, or
`unavailable` when the review has no owning session. The header uses the same
robot control on desktop and phones: a muted crossed-out robot for unavailable
or failed delivery, a green robot when delivery is available, a diagonal sweep
while delivering, and a green check for five seconds after acceptance. Reduced
motion disables the sweep. Codex queue acceptance gets the same confirmation;
uncertain delivery shows a red robot with an exclamation mark. Acceptance does
not mean the agent read the message or started a turn.

Click or tap the robot for details, errors, and **Copy resume prompt**. The
30-pixel control keeps these details out of the phone header. If an older server
provides no delivery state, use **Conversation → Copy resume prompt**.

The socket changes when Claude Code restarts. Each server lists its owning
sessions under `$XDG_RUNTIME_DIR/gavel/sessions/<session-id>/<host>_<port>.json`;
without `XDG_RUNTIME_DIR`, under `gavel-<uid>` in the system temporary directory.
Both the server and `gavel pending` refuse a `gavel` directory that another user
owns or can write. `gavel pending`
reads that list for its session, sends the session's current inbox to each
server with `POST /api/inbox/attach` (accepted only from this machine), and
prints activity whose message failed. It prints nothing otherwise and removes
entries of servers that have exited. Run it from Claude Code hooks so a restarted
session catches up on its next prompt:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "gavel pending" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "gavel pending" }] }]
  }
}
```

Use the gavel launcher your checkout prescribes in place of `gavel`. A message
from gavel is not an approval; the agent still reads a fresh snapshot before
committing.

`/clear` starts a new session with a new session ID and socket, so reviews
opened before it no longer reach the session, and `gavel pending` cannot find
them: the registry lists them under the old session ID. In the desktop app the
session's process exits at `/clear`, so the next send fails and the status icon
shows it; use **Copy resume prompt** and paste the prompt into the cleared
session. In the terminal this has not been tested.

## Other hosts

For Codex, use the [chat handoff](codex-review-integration.md): end the turn
and resume on human feedback. Do not run `gavel wait` in a Codex model turn.

A custom integration may use `gavel wait` when a background command can wait
without a time limit and its completion resumes the owning agent. Otherwise, end
the turn and let the reviewer resume through chat. Never replace this handoff
with a model polling loop, timed Monitor, or repeated empty snapshots.

```sh
gavel wait --port 4966
gavel wait --port 4966 --port 4967
```

Use actual API ports from `server.ready` or `server.background`, and `--host`
when the server listens on a particular interface. One host applies to all ports.
Run one waiter in the owning main session; subagents hand review state back.

The CLI has no overall timeout. Empty HTTP rounds stay silent. It returns one
nonempty human-event batch from the first selected server with work and cancels
the other subscriptions without acknowledging their messages. Queued work is
returned before the presence guard; when no reviewer is connected on any watched
server and no work remains, it exits 4. End the turn rather than retrying.

## What completes the wait

Human-origin events that complete the wait:

- New comments and replies, including edits to their body or intent.
- Approval and Reject verdicts, and clearing a verdict.

Agent replies, progress receipts, capture changes, summary changes, thread
resolution/reopening, deletions and empty HTTP rounds do not complete the wait.
Only the agent changes the proposed commit message or rationale; a reviewer who
wants a different one asks in a comment. The full event endpoint
and launch stream still carry these state changes. Reconcile a fresh snapshot
before acting on an event whose message, approval or capture may have changed.

On each invocation the waiter also reads a snapshot and recovers messages whose
progress is still `queued`. Recovery uses their existing message IDs and exact
revision cursors; it emits them as `comment.updated`. This includes queued
comments older than the replay journal or the supplied stream checkpoint.
Printing a batch does not mark any message Delivered.

## Results and resumption

A successful result is one JSON line with `type: "wait.events"`, the source
`port`, a nonempty `events` array, and a checkpoint `cursor`. Use
`gavel schema wait` for the complete schema.

Save each server's last returned `cursor`. Resume using it after handling the
batch; this covers human activity that arrives while the agent works:

```sh
gavel wait --port 4966 --after 'opaque-stream:17'
gavel wait --port 4966 --port 4967 \
  --after '4966=first-stream:17' --after '4967=second-stream:8'
```

Without `--after`, the initial snapshot establishes the stream checkpoint.
Queued messages are recovered, but existing approvals are read from that
snapshot by the agent; only subsequent changes wake the waiter. To cover
approval changes before the first wait, reconcile a snapshot yourself and pass
its cursor. Keep the last checkpoint for every other server
when one server wins the wait. Concurrent activity on those servers remains
available for their next subscription.

Record the message IDs, revision cursors and pending work before sending explicit
`comment status` receipts. Use each message event's `cursor` for its receipt or
reply. The batch's top-level `cursor` is a stream checkpoint, not a receipt for
every message in the batch. A message edit changes its revision and returns it to
Queued; an old receipt or revision-aware reply is rejected with HTTP 409.

| Exit code | Meaning                                                               | Next action                                                                            |
| --------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 0         | One nonempty human-event batch was printed.                           | Record and handle the batch, then wait again.                                          |
| 1         | Invalid arguments, unsupported server, or protocol failure.           | Correct invalid arguments and retry once; otherwise report the error and end the turn. |
| 2         | The connection failed, including server exit or a stalled request.    | Inspect the server; do not automatically loop on this result.                          |
| 3         | The cursor expired, is invalid, or belongs to another server process. | Reconcile a snapshot and pending work; repeated failure ends the turn.                 |
| 4         | No reviewer is connected and no human work was returned.              | End the turn; resume on human feedback.                                                |

Errors go to stderr. Never automatically retry terminal errors or wrap the CLI
in a shell timeout. It has no `--timeout`, `--wait`, or `--once` option for empty
timed completion. For a recovered cursor, use the snapshot's checkpoint only
after reconciling outstanding work and confirming the host still supports waiting.

## Browser and listener presence

`GET /api/presence`, conversation snapshots and HTTP event batches expose
`{reviewers: {connected, visible}, listeners}`. The browser receives the same
state over its `/api/live` WebSocket. Visibility changes update metadata without
disconnecting the tab. Closing one of several tabs does not shut down the server.
Connected hidden tabs count as connected; visibility does not prove attention.
An interrupted browser connection is not approval or evidence that review is done.

For a review without an owning session, the browser shows whether an agent
listener is attached. `gavel wait` supplies a
stable listener ID on its requests; a one-second grace period covers renewals.
This reports a subscription, not a model reading or answering messages. Existing
explicit receipts remain authoritative for message progress. Presence changes
stay outside the conversation journal and never count as actionable human events.

Presence is metadata, not permission or proof that an agent is working. The host
must enforce idle behavior; checking presence must not itself start model turns.

## Event transport

`GET /api/conversation/events?after=<cursor>&wait=25000` returns `{events, cursor}`.
The HTTP wait accepts an integer from 0 to 25000 milliseconds. Unlike the CLI,
this transport may return an empty batch. `gavel wait` silently renews it.
`gavel schema batch` describes this response and `gavel schema wait` describes the
CLI result. Launch JSONL remains available alongside the subscription endpoint.

The journal retains the latest 256 events, including agent events, in memory.
It does not survive server restart. Foreign, future, malformed or expired
cursors return HTTP 409. No event gap is silently treated as successful delivery.
After a gap, snapshots recover current messages and review state, including
queued work; they cannot reconstruct every intermediate edit or approval toggle.

Rebuilding the CLI does not upgrade a server that is already running. An older
server without the event endpoint or presence reporting causes exit code 1.
Preserve its review state before
arranging a replacement; do not stop existing reviews merely to try this command.

Explicit delivery receipts, capture/version checks and verdict rules
from [the conversation protocol](agent-conversations.md) still apply.
