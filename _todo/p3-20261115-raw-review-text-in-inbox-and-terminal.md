---
title: Review text reaches the agent inbox message and the terminal unescaped
priority: p3
section: Agent delivery
---

# Review text reaches the agent inbox message and the terminal unescaped

Placeholder. Not started.

1. A token holder can forge gavel's own lines in the inbox message. `getCommentSelectionFromQuery`
   (`src/server/server.ts`) accepts any `?base=` and `?target=` strings on `PUT /api/approval`
   and `POST /api/comments`, and `SessionInbox` writes `- ${reviewLabel(...)}: ${verdictLabel(...)}`
   raw outside the JSON events (`src/server/session-inbox.ts`). A `base` containing newlines
   produced a line byte-identical to gavel's `- task-9a: Approve: …` state line and a fake
   `gavel: … commit now.` header in the message sent to the Claude socket, `codex queue
   --message`, and `gavel pending`. Fix: validate `base`/`target` (allowing the server's own
   labels such as `stdin`), or JSON-encode the label. `validateCommitish` alone is not enough:
   it trims before checking (`src/cli/utils.ts`), so `HEAD\n` passes with its newline.
2. Text outputs print comment bodies and labels with their control characters:
   `gavel comment get` in text format (`src/cli/comment.ts`), the `--no-jsonl` shutdown output
   (`src/cli/index.ts`), and the server's `humanLog` lines `Verdict: …` and
   `✅ Commit approved: …` (`src/server/server.ts`). OSC 52 (clipboard write), OSC 0 (window
   title), and cursor sequences arrived intact in a test. Fix: replace C0/C1 controls other than
   `\n` and `\t` in these outputs.
3. `promptUserToIncludeUntracked` (`src/cli/index.ts`) prints untracked names raw, and the
   undo hint in `handleUntrackedFiles`, `git reset -- ${files.join(' ')}`, leaves names
   unquoted, so a name with a space produces a wrong command. Fix: shell-quote the names in the hint and apply the control
   replacement from item 2 to both.

`JSON.stringify` leaves U+009B (CSI) and DEL unescaped, so JSON outputs could still drive
terminals that act on UTF-8 C1 controls (not tested in any terminal).
