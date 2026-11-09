# Feedback and snapshots

Use the launch record's host and API port for every command. Read a filtered
snapshot on resume, after missed output or HTTP 409, and before acting on a
verdict. Reuse the batch's snapshot unless new human feedback, a version conflict,
or the final pre-commit check requires another. Repeated recovery without new
state ends the turn. Use this filter even when a resume prompt names a raw snapshot:

```sh
set -o pipefail; <gavel-command> comment snapshot --host <host> --port <api-port> | jq -c '{cursor, connected: .presence.reviewers.connected, storeError: (.store.error // null), reviews: [.reviews[] as $r | {id: $r.id, selection: $r.selection, capture: ($r.capture | if . then {version, patchDigest} else null end), approval: ($r.approval | {approved, mode, requested, baselineCapture, notYet: (.notYet // false), cursor, open: [.conditions[]? | select(.addressed | not) | {threadId, messageId, cursor, intent}]}), commitMessage: $r.summary.commitMessage, fromCommit: ($r.summary.fromCommit // false), summaryVersion: $r.summary.version, pending: [$r.threads[] as $t | $t.messages[] | select(.progress and (.progress.status | IN("replied","noted") | not)) | {threadId: $t.id, messageId: .id, cursor: .progress.cursor, confirmed: (($t.resolution.resolved // false) and $t.resolution.updatedAt >= .updatedAt), filePath: $t.filePath, position: $t.position, code: $t.codeSnapshot.content, intent, body}]}]}'
```

The top-level `cursor` is a stream checkpoint for `wait --after`; each pending
message's `cursor` is its exact revision for receipts and replies. Do not swap
them or use a progress event's stream cursor as a message revision.

- `storeError`: tell the user why review changes are not being saved.
- `approval`: inspect every review before reporting missing approval. Preserve
  `baselineCapture` for comparison with the final conditional-approval patch.
- `confirmed: true`: the reviewer resolved the thread after its latest edit.
  Mark the pending message Noted; do not redo confirmed work. A later edit makes
  it unconfirmed and requires normal handling.
- `fromCommit: true`: the server copied the browsed commit's message; it is not
  a proposal and does not create a review tab.
- `code`: the excerpt the reviewer commented on. A thread's original capture
  anchor may predate the current capture.

## Reply or acknowledge

Discover payloads with `<gavel-command> schema status` or `schema reply` before
composing JSON. Write JSON with a file-writing tool, then send it on stdin:

```sh
<gavel-command> comment <status|reply> --host <host> --port <api-port> < <json-file>
```

Status requires `reviewId`, `threadId`, `messageId`, the message revision `cursor`,
and `status`: `delivered`, `read`, `thinking`, `replying`, or `noted`.
Reply requires `reviewId`, `threadId`, `inReplyTo` (the message ID), `cursor`, and
`body`. Replies mark Replied. Neither action resolves a thread or certifies a
conditional approval. Summary and approval events need no comment receipt.

When a message continues an earlier exchange, read only that thread:

```sh
set -o pipefail; <gavel-command> comment snapshot --host <host> --port <api-port> | jq -c --arg t <threadId> '.reviews[].threads[] | select(.id == $t) | {filePath, position, resolved: (.resolution.resolved // false), code: .codeSnapshot.content, messages: [.messages[] | {id, origin: (.origin // "user"), body}]}'
```

## Read the version the reviewer saw

For named frozen captures or `stdin` selections (including PR patches), start
with `code`; the working file may differ and the selection may name no commit.
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
