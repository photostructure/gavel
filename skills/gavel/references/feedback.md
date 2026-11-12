# Feedback and snapshots

Use the launch record's host and API port for every command. Read the snapshot
on resume, after missed output or HTTP 409, and before acting on a verdict. An
inbox message from gavel carries only the human events since its last message:
each new or edited comment with its IDs and revision `cursor`, plus `code`, the
excerpt the reviewer saw, when the thread saved one; and each verdict change.
Answer comments from those events; read the snapshot for a thread's earlier
messages, and a fresh one before acting on a verdict. Reuse a snapshot
unless new human feedback, a version conflict, a verdict, or the final
pre-commit check requires another. Repeated recovery without new state ends the
turn.

```sh
<gavel-command> comment snapshot --host <host> --port <api-port>
```

The top-level `cursor` is a stream checkpoint; each message's `progress.cursor` is
its exact revision for receipts and replies. Do not swap them or use a progress
event's stream cursor as a message revision.

- `store.error`: tell the user why review changes are not being saved.
- `approval`: inspect every review before reporting missing approval.
- Awaiting an answer: every message in `threads[].messages` that has a
  `progress` whose `status` is neither `replied` nor `noted`. Agent messages
  have no `progress`.
- Approve: act on every user message (`origin` absent or `user`)
  in an unresolved thread, including ones already replied to.
- A thread with `resolution.resolved` and `resolution.updatedAt` at or after a
  message's `updatedAt` confirms that message's work: mark it Noted; do not redo
  it. A later edit makes it unconfirmed and requires normal handling.
- `summary.fromCommit: true`: the server copied the browsed commit's message; it
  is not a proposal and does not create a review tab.
- `codeSnapshot.content`: the excerpt the reviewer commented on. A thread's
  original capture anchor may predate the current capture.

## Reply or acknowledge

Discover payloads with `<gavel-command> schema status` or `schema reply` before
composing JSON. Write JSON with a file-writing tool, then send it on stdin:

```sh
<gavel-command> comment <status|reply> --host <host> --port <api-port> < <json-file>
```

Status requires `reviewId`, `threadId`, `messageId`, the message revision `cursor`,
and `status`: `delivered`, `read`, `thinking`, `replying`, or `noted`.
Reply requires `reviewId`, `threadId`, `inReplyTo` (the message ID), `cursor`, and
`body`. Replies mark Replied. Neither action resolves a thread.
Summary and approval events need no comment receipt.

When a message continues an earlier exchange, read that thread's earlier messages
in the snapshot.

## Read the version the reviewer saw

For named frozen captures or `stdin` selections (including PR patches), start
with the inbox event's `code` or the thread's `codeSnapshot.content`; the
working file may differ and the selection may name no commit.
For other selections, use:

| Selection | New side                       | Old side                     |
| --------- | ------------------------------ | ---------------------------- |
| `staged`  | `git show :<filePath>`         | `git show <base>:<filePath>` |
| `.`       | Working file                   | `git show <base>:<filePath>` |
| `working` | Working file                   | `git show :<filePath>`       |
| Commit    | `git show <target>:<filePath>` | `git show <base>:<filePath>` |

For renamed files, `filePath` is the new name. Find the old name with
`git diff --find-renames --name-status`, passing `<base> <target>` for commits,
`--cached <base>` for `staged`, `<base>` for `.`, or no revision for `working`.
