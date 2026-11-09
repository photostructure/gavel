# Waiting for human review

For Codex, use the [chat handoff](codex-review-integration.md): end the turn
and resume on human feedback. Do not run `gavel wait` in a Codex model turn.

Other hosts may use `gavel wait` only when a background command can wait without
a time limit and its completion resumes the owning agent. Check the host's tool
contract; see the [Claude waiting workflow](https://github.com/photostructure/gavel/blob/main/skills/gavel/SKILL.md).
Otherwise, end the turn and let the reviewer resume through chat. Never replace
this handoff with a model polling loop, timed Monitor, or repeated empty snapshots.

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
- Approval, revocation, and Not yet verdicts.
- Saved changes to the proposed commit message or rationale.

Agent replies, progress receipts, capture changes, thread resolution/reopening,
deletions and empty HTTP rounds do not complete the wait. The full event endpoint
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
Queued messages are recovered, but existing approvals and summaries are read
from that snapshot by the agent; only subsequent changes wake the waiter. To
cover approval or summary changes before the first wait, reconcile a snapshot
yourself and pass its cursor. Keep the last checkpoint for every other server
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
state over its heartbeat connection. Visibility changes update metadata without
disconnecting the tab. Closing one of several tabs does not shut down the server.
Connected hidden tabs count as connected; visibility does not prove attention.
An interrupted browser connection is not approval or evidence that review is done.

The browser shows whether an agent listener is attached. `gavel wait` supplies a
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

Explicit delivery receipts, capture/version checks and conditional approval
authorization from [the conversation protocol](agent-conversations.md) still apply.
