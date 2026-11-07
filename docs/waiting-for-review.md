# Waiting for human review

`difit wait` attaches to running conversation-enabled servers and stays silent
while waiting for human activity. It has no overall timeout. HTTP request
deadlines stay inside the process: empty responses do not print a checkpoint or
complete the command.

```sh
difit wait --port 4966
difit wait --port 4966 --port 4967
```

Use `--host <hostname-or-IP>` when the server listens on a particular interface.
The selected host applies to all repeated ports; it defaults to localhost.

Use the actual API ports from `server.ready` or `server.background`. Run one waiter
in the owning main agent session using its host's background-command facility.
Subagents return their review IDs, URLs, ports and pending work to that session.
The waiter prints one JSON object and exits when any selected server produces a
nonempty batch. It cancels the remaining HTTP subscriptions without acknowledging
their messages.

The server must report reviewer presence. Existing queued messages and replayed
human events are handled first. If every selected server has no connected
reviewer and no human work, the waiter reports that once on stderr and exits 4.
End the agent turn on that result; do not re-arm it in a polling loop. While any
review is attended, every selected port remains subscribed, including ports whose
browser windows may be reopened. Absence is detected by the end of the current
HTTP round (at most 25 seconds under normal operation), or server exit is reported
if the server closes first.

For Codex desktop, use the [Codex integration workflow](codex-review-integration.md):
end the turn during human review, then use the browser's **Copy resume prompt**
button when there is feedback. A detached server alone does not establish a
delivery path to an idle chat.

Do not wrap the waiter in a timed shell command, run it as a foreground polling
loop, or watch it with a Monitor that expires periodically. Those host mechanisms
can wake a model even while this command is silent. Verify the host's background
task lifetime; the CLI cannot override a limit imposed by the host. For Claude
Code, read the session's Bash tool definition, including what its `timeout`
parameter means for background commands, and check its version and session
mode: the [Claude Code documentation](https://code.claude.com/docs/en/tools-reference#time-limit-for-background-commands)
distinguishes local attended sessions, whose background commands have no time
limit, from unattended sessions, whose background commands are capped; older
versions can differ. An idle host
without an event delivery mechanism requires the turn to remain active or a human
to resume it.

## What completes the wait

Human-origin events that complete the wait:

- New comments and replies, including edits to their body or intent.
- LGTM approval and revocation.
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

One stdout line has this shape:

```json
{
  "type": "wait.events",
  "port": 4966,
  "events": [
    {
      "type": "review.approval",
      "origin": "user",
      "cursor": "opaque-stream:17",
      "reviewId": "review-id",
      "selection": { "baseCommitish": "HEAD", "targetCommitish": "." },
      "approved": true,
      "timestamp": "2026-11-03T00:00:00Z"
    }
  ],
  "cursor": "opaque-stream:17"
}
```

Save each server's last returned `cursor`. Resume using it after handling the
batch; this covers human activity that arrives while the agent works:

```sh
difit wait --port 4966 --after 'opaque-stream:17'
difit wait --port 4966 --port 4967 \
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

| Exit code | Meaning                                                               | Next action                                                             |
| --------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 0         | One nonempty human-event batch was printed.                           | Record and handle the batch, then wait again.                           |
| 1         | Invalid arguments, unsupported server, or protocol failure.           | Correct the problem before retrying.                                    |
| 2         | The connection failed, including server exit or a stalled request.    | Inspect the server; do not automatically loop on this result.           |
| 3         | The cursor expired, is invalid, or belongs to another server process. | Reconcile a snapshot and pending work, then use that snapshot's cursor. |

Errors go to stderr. There is no automatic retry loop on terminal errors, and no
`--timeout`, `--wait` or `--once` option that can enable empty timed completion.
The old `comment watch` command remains removed.

Exit **4** means no reviewer is connected on any selected server and no human
work was returned. End the turn and resume on human feedback; never automatically
retry this result.

## Browser and listener presence

`GET /api/presence`, conversation snapshots and HTTP event batches expose
`{reviewers: {connected, visible}, listeners}`. The browser receives the same
state over its heartbeat connection. Visibility changes update metadata without
disconnecting the tab. Closing one of several tabs does not shut down the server.
Connected hidden tabs count as connected; visibility does not prove attention.
An interrupted browser connection is not approval or evidence that review is done.

The browser shows whether an agent listener is attached. `difit wait` supplies a
stable listener ID on its requests; a one-second grace period covers renewals.
This reports a subscription, not a model reading or answering messages. Existing
explicit receipts remain authoritative for message progress. Presence changes
stay outside the conversation journal and never count as actionable human events.

This guard prevents blind unattended waiting through this CLI. It cannot stop an
unrestricted agent from inventing a separate shell polling loop. The host must
enforce any prohibition on arbitrary polling; presence cannot impose a model-token
budget. Use a host integration that invokes the model only for actual feedback,
rather than running the model to check for feedback.

## Event transport

`GET /api/conversation/events?after=<cursor>&wait=25000` returns `{events, cursor}`.
The HTTP wait accepts an integer from 0 to 25000 milliseconds. Unlike the CLI,
this transport may return an empty batch. `difit wait` silently renews it.
`difit schema batch` describes this response and `difit schema wait` describes the
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

Explicit delivery receipts, capture/version checks and conditional LGTM
authorization from [the conversation protocol](agent-conversations.md) still apply.
