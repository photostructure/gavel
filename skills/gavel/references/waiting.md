# Waiting on a supported host

Use this only after verifying that background commands have no host deadline and
their completion starts a new agent turn. Codex always hands back without a waiter.
For every other host, inability to prove either capability means hand back.

Recovery is bounded per server and human-feedback batch: allow at most one retry
for an argument, connection, or cursor error. Only newly delivered, actionable
human feedback resets that allowance. A second recovery failure or an empty or
unusable successful event batch ends the turn. An unchanged snapshot on the first
recovery still permits the single retry; it never resets the retry allowance.

1. Read the filtered snapshot from [feedback.md](feedback.md). Handle existing
   verdicts, changed summaries, and pending comments before waiting.
2. Save each port's top-level cursor. Arm only when at least one review is
   connected; otherwise share the URL and end the turn. Detached launches open no
   tab, so wait only after the user connects.
3. Run one background command in the main session, covering every server on the
   host. In Claude Code, use Bash `run_in_background`:

   ```sh
   <gavel-command> wait --host <host> --port <port> --after '<port>=<cursor>'
   ```

   Repeat `--port` and `--after` for other servers. To add a server, stop the old
   waiter (Claude Code: `TaskStop`) and start one with every port and saved cursor.

Handle completion according to its exit code:

| Exit                       | Action                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0                          | Handle every human `comment.created`/`comment.updated` not already Replied or Noted. Reply or explicitly mark Noted; Queued messages otherwise return on every wait. Handle approval and summary events without receipts. Save the winning port's batch cursor, or a later launch-stream cursor, and retain the other ports' cursors. Re-arm for remaining reviews only after actionable feedback is handled. |
| 1, invalid local arguments | Correct the arguments named on stderr and re-arm once.                                                                                                                                                                                                                                                                                                                                                        |
| 1, other error             | Report stderr and end the turn. Unsupported presence reporting is terminal.                                                                                                                                                                                                                                                                                                                                   |
| 2                          | Snapshot the port named on stderr. If it fails, report the stopped server and re-arm once for the others. If it answers, reconcile and re-arm once with that snapshot's cursor for this port; preserve the other ports' cursors.                                                                                                                                                                              |
| 3                          | Reconcile a filtered snapshot and pending work, then wait with its cursor.                                                                                                                                                                                                                                                                                                                                    |
| 4                          | No review is attended. End the turn; never automatically retry.                                                                                                                                                                                                                                                                                                                                               |

Drop a port only when none of its reviews awaits the user. Approval of one review
does not finish other reviews; conditional approval with open conditions is still
pending. Presence changes alone request no work. If a host kills the waiter at
its deadline, do not re-arm it with a longer timeout.

On terminal failure, explain that the user's next chat message resumes the work.
Preserve the latest cursor and pending work; do not recheck an unchanged server.

Transport details: [waiting for review](https://github.com/photostructure/gavel/blob/main/docs/waiting-for-review.md).
