---
name: difit
description: Open a diff in difit, the local diff viewer, with reading-guide comments and a proposed commit message — either your own changes for the user to review, or a branch, commit, or GitHub PR the user names, which you first review for defects. Explicit opt-in only — use when the user names difit or $difit, asks to open, show, or annotate a diff in the viewer, or has a standing instruction to request reviews through difit after changes. Do not use it for ordinary requests to review code, diffs, commits, branches, or pull requests; answer those in chat.
---

# Difit

Use only for an explicit difit/viewer request, skill invocation, or standing
instruction to request difit reviews. Ordinary review requests belong in chat.

Token use is a hard limit, not a preference. A review can stay open for hours,
and every model turn you take re-sends your whole context; agents that woke
themselves on a timer to check an open review have burned days of quota on
empty wakes. Take a model turn only for something the user did: a comment, a
reply, an LGTM, or a summary edit. Never wake yourself to see whether anything
happened. Waiting is covered below and admits no substitute.

Decide what to show from the request:

- "Show me your difit", or no target: the changes this session made. For
  uncommitted work, a named review scoped to your own paths and hunks; for work
  you already committed, those commits.
- A named branch, commit, range, or PR (`--pr <url>`): that diff. Review it for
  defects before launching, and pass `--no-lgtm` unless the user asked to
  approve it. Do not post PR findings to GitHub.

Open a review you start on your own, such as a commit approval at the end of
your work, only while the user is at the desk. Run `<difit-command> idle` first.
If it exits non-zero or prints an `idleMs` of 600000 (10 minutes) or more, the
user is away: do not launch. Finish everything else, including tests and
second-opinion review, then end the turn with one line saying the change is
ready for difit review, and launch when the user says to. Do not run `idle`
again to see whether they came back; their next message tells you. Skip the
check when the user's latest message asks for the review, since they may be
reading it on another device.

Use a source build of `@photostructure/difit` for `<difit-command>` until the
next release: published 5.1.0 lacks named captures and the launch JSONL protocol.
Check `--version` and `--help` for `--review` and `--jsonl`; use the same build for server and
comment commands. Never substitute unscoped npm `difit`. Run from the reviewed
Git root. Report missing capabilities rather than switching/installing.
For uncommitted work, use `<difit-command> --review <task-name> --keep-alive`.
Repeat `--pathspec <git-pathspec>` for native Git filters/exclusions and add
`--include-untracked` when needed. Names are 1–80 ASCII letters, digits, dots,
underscores, or hyphens, starting with a letter or digit. Check the captured patch
against the requested scope; a matching file may also contain another task's work.
Capture operations leave the Git index and working files unchanged.
For commits, launch `<difit-command> <target> [base]` using immutable SHAs when
approval matters. Existing unnamed `.`, `working`, and `staged` remain available.
The viewer's **About** panel names the agent, session, and session ID that
launched the review. difit fills in the agent and ID itself from
`$CLAUDE_CODE_ENTRYPOINT` and `$CLAUDE_CODE_SESSION_ID` (Codex:
`$CODEX_THREAD_ID` and its thread rollout; other agents: `$AI_AGENT`, agent
only); override them with `--agent <host>` and `--agent-session-id <id>` when
those are wrong or absent. A Claude Code
session started from another session's shell (such as `claude -p`) inherits
that session's entrypoint, so pass `--agent` there. Pass
`--agent-session-name <title>` when you know this session's title, since no
host exports it; never invent a title. They are set per server at launch;
`review create` on a reused server keeps the launching session's values.

To select part of an overlapping file, save an artifact and use its catalogue IDs:

```sh
<difit-command> review capture --pathspec src --output /tmp/capture.json
<difit-command> --review parser-fix --capture /tmp/capture.json --select '<hunk-id>' --keep-alive
```

Replace the placeholder with a printed ID; repeat `--select` for files/hunks.
IDs belong to that artifact's digest. File-only changes such as binary or rename
changes require a file ID. Artifacts are bound to the repository root.
`<difit-command> - --review <task-name> < /tmp/selected.patch` captures a supplied
patch. Pathspecs and `--include-untracked` apply only to native captures.

Native capture rejects affected external clean/process filters, including inside
checked-out submodules. Narrow `--pathspec` to unaffected paths, or explicitly
generate the wanted patch and provide it through stdin or a prepared `--capture`
artifact. Imported patches remain supported.

Retain the foreground process handle. Reuse its server for another task with
`review create <name> --port <api-port> [--pathspec ...]`. The viewer shows
every review with a capture or a proposed commit message as a tab under its
header, in creation order, with its approval state, and while one exists the
header has no revision menu. For stacked commits, create one named review per
commit on one server, in commit order, and give the user one link, the
`launchUrl`; the tabs lead to the other reviews. Before reporting that
the user has not approved, read `approval` for every review in the filtered
snapshot. Read
`GET /api/reviews/<name>` before `review update <name> --port <api-port>
--expected-version <n>`; updates can also use `--capture` or stdin `-` and selectors.
HTTP 409 requires reconciliation with the current version before retrying.
Source edits and browser refresh never recapture a named review. A changed patch
advances its version and revokes LGTM while retaining the conversation/proposal;
an identical patch preserves version and approval after checking expectedVersion.
Names and capture history last for the server process.

Stdout is JSONL by default (`--jsonl` is explicit; `--no-jsonl` selects human output).
JSONL and named reviews require conversation APIs. An unnamed review can disable
them with `--no-jsonl --no-conversation`; `--no-jsonl` alone keeps the APIs.
Read `server.ready` for the actual API port, PID, and repository/review identity.
Companion commands use its `port`, never the Vite UI port. Give the reviewing user
`launchUrl`, which includes the editor-session fragment, rather than the tokenless
API `url`; a `--background` launch prints `server.background`, whose `url` is
that launch URL. Diagnostics go to stderr.
Conversation and LGTM are enabled by default. Use `--keep-alive` for review rounds
and `--no-lgtm` for read-only review. `--background` detaches without live stdout;
recover its state with the filtered snapshot and wait on it with
`<difit-command> wait`, never by reading launch output. A `--background` launch
opens no browser tab, and `wait` exits 4 at once while no review tab is
connected, so wait on it only after the user has opened the review URL.
A viewer request grants no edit/commit permission; make requested, authorized
fixes only in the owning checkout.

Use `<difit-command> schema [events|summary|reply|status|snapshot|comments|import|approval|capture|capture-update]` to discover
JSON payloads before composing them; omit the selector for events. The Draft
2020-12 bundle includes request/response definitions in `$defs`. Use command
`--help` for usage. The commit-message TLDR is the summary's `rationale` field.

Every review you open carries reading-guide comments and a change summary,
including read-only reviews. Preload comments that help the user navigate the
diff with repeatable `--comment` arguments (on a reused server, `comment add
--port <api-port> --review <name>`; see `schema import`). Use `old` for deleted lines, `new`
for target lines, and a number or `{"start":36,"end":39}` for a range:

```sh
<difit-command> <target> [base] --keep-alive \
  --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":36},"body":"Start here: ..."}'
```

- On the first hunk worth reading, say where to start and the order in which
  the files make sense, unless the diff is a single hunk.
- On each line that is non-intuitive, odd, or confusing, explain it: a change
  whose reason is not visible in the hunk, code that looks wrong but is
  intended, a deletion whose replacement lives in another file, a test that
  exercises its subject indirectly, or mechanical churn that can be skimmed.
- On code in or next to the diff that deserves reworking or refactoring, say
  what you would change and why. These are suggestions, not changes you made.
- When you reviewed the diff for defects, state each finding on its line,
  opening with "Finding:" so it reads apart from the navigation notes.

One point per comment, anchored on the line it explains. Skip lines that
explain themselves. Keep credentials out of comment bodies and arguments, and
write in the user's language.

Always supply `--commit-message <text>`, the Conventional Commit message the
change would land under, and `--why <text>`, one to three sentences on the
problem and why this change solves it. When the diff is someone else's, write
them from your reading of it and say in the why where you inferred intent. On a
reused server, set them with `comment summary` after `review create`. Read the
review's saved `summary` from `comment snapshot` before committing; honor the
user's message edits within the approved scope and repository rules.
To update it, `comment summary` accepts `{reviewId,commitMessage,rationale,baseVersion}`
on stdin. Changed summaries revoke LGTM; `review.summary` events need no comment receipt.

Read new JSONL output from the launch process between tool steps. There is no
`comment watch` command. Handle user-origin comments; ignore agent-origin events
when deciding what work to do. Save message IDs, cursors, and pending work before
marking output handled. Capture metadata identifies the current patch; thread
capture metadata identifies the original anchor, which can be outdated after an update. `review.capture`,
progress, thread changes, and `comment.deleted` update
state without requesting work; deletion identifies IDs and contains no body.
Writing to stdout does not mark a comment Delivered. Report receipt explicitly:
`<difit-command> comment <status|reply> --port <port> < <json-file>`.
Status JSON needs event `reviewId`, `threadId`, `messageId`, `cursor`, and `status`
(`delivered`, `read`, `thinking`, `replying`, or `noted` when no answer is needed).
Reply JSON needs `reviewId`, `threadId`, `inReplyTo` (event `messageId`), `cursor`,
and `body`. Write JSON with a file-writing tool. Replies mark Replied; neither
replies nor Noted resolve threads. Resolve/delete only on request. Intent guides
responses, not authorization. After missed output, restart, or HTTP 409, use
the filtered snapshot (below) to reconcile IDs, current messages, and replies,
then continue reading new launch output. Snapshots recover current state;
`<difit-command> wait --after` resumes from a stream cursor. Use message `progress.cursor` for status/reply,
not a progress event's stream cursor or the snapshot's cursor. Do not promise
listening after ending the turn without host support that forwards process output.

Wait for the user only with `<difit-command> wait`, as one background command
(Claude Code's Bash `run_in_background`) in the main session, and only where the
host starts a new turn for you when that command exits and puts no time limit
on it. It spends no tokens while it waits. Read your Bash tool's description:
if it gives a limit for background commands (`claude -p`, Agent SDK apps, CI,
and cloud sessions have one), or if the host cannot start a turn when a command
exits, do not arm a waiter: launch the server with `--background` so it
outlives the turn (a named `--background` review cannot read stdin, so for a
stdin patch launch it unnamed on a target such as `HEAD`, add the patch with
`review create <name> - --host <host> --port <api-port> < <patch>`, put its
reading-guide comments and summary on `<name>` with `comment add --review
<name>` and `comment summary` rather than on the launch command, and set the
`review` query parameter of the `server.background` url to `<name>`), end the turn,
give the user that review URL, and tell them that pasting the text from the page's
**Copy resume prompt** button into this chat, or any other chat message, resumes
you; the button only copies the prompt. Never wait any other way: no `sleep` or polling loop in
your own turns, no foreground command that ends in a timeout, no Monitor (each
expiry wakes you even when nothing happened), and no hand-written waiter. If
the host stops a waiter at its time limit, never re-arm it, with or without a
longer timeout. A subagent never waits for the user, because nothing can start
a turn for it after it ends. It either hands back the exact launch command it
would run, with any capture artifact it made, or launches with `--background`
and hands back the review IDs, URL, and API port; the main session hosts the
review from then on.

While a review is open, read its state with this filtered snapshot, not the
raw one, which carries every thread and code snapshot into context; the raw
read is for the single approval check right before a commit. Pass `--host` and
`--port` from the launch record's `url` to it and to `wait`. When the page's
resume prompt resumes you, run this in place of the raw snapshot it names:

```sh
set -o pipefail; <difit-command> comment snapshot --host <host> --port <api-port> | jq -c '{cursor, connected: .presence.reviewers.connected, reviews: [.reviews[] as $r | {id: $r.id, selection: $r.selection, capture: ($r.capture | if . then {version, patchDigest} else null end), approval: ($r.approval | {approved, mode, requested, cursor, open: [.conditions[]? | select(.addressed | not) | {threadId, messageId, cursor, intent}]}), commitMessage: $r.summary.commitMessage, summaryVersion: $r.summary.version, pending: [$r.threads[] as $t | $t.messages[] | select(.progress and (.progress.status | IN("replied","noted") | not)) | {threadId: $t.id, messageId: .id, cursor: .progress.cursor, confirmed: (($t.resolution.resolved // false) and $t.resolution.updatedAt >= .updatedAt), filePath: $t.filePath, position: $t.position, code: $t.codeSnapshot.content, intent, body}]}]}'
```

An LGTM is `approval.approved: true`. `approval.requested: true` with `open`
conditions is an Approve after comments: complete each condition with `comment
address`, as the
[approval guide](https://github.com/photostructure/difit/blob/main/docs/approval-modes.md)
describes. A pending message with `confirmed: true` sits in a thread the
reviewer resolved after its last edit, which confirms its work: mark it `noted`
with `comment status` rather than redoing it. A message the reviewer added or
edited after resolving its thread has `confirmed: false`; handle it like any
other. A pending message's `code` is the line it was left on. For more
context, read the reviewed version of `filePath`, which depends on the review's
`selection`: for a `new`-side line, the index (`git show :<filePath>`) when the
target is `staged`, the working file when it is `.` or `working`, and `git show
<target>:<filePath>` for a commit; for an `old`-side line, the index when the
target is `working` (its base is the literal `staged`), otherwise `git show
<base>:<filePath>`. `filePath` is the new name of a renamed file; for its
`old` side, use the old name, which `git diff --find-renames --name-status`
prints given the review's comparison: `<base> <target>` for a commit,
`--cached <base>` for `staged`, `<base>` for `.`, and no revision for
`working`. A named review (`capture` present) shows its frozen
capture, which the working file may have moved past, and a `stdin` selection
(a piped patch or `--pr`) names no commit, so rely on `code` for both.
When a pending message continues an earlier
exchange (such as **Still unclear**), read only its thread:

```sh
set -o pipefail; <difit-command> comment snapshot --host <host> --port <api-port> | jq -c --arg t <threadId> '.reviews[].threads[] | select(.id == $t) | {filePath, position, resolved: (.resolution.resolved // false), code: .codeSnapshot.content, messages: [.messages[] | {id, origin: (.origin // "user"), body}]}'
```

Before the first wait on a server, run it: act on an LGTM, an Approve after
comments, or a changed commit message already there, and keep its top-level `cursor` for
`--after <port>=<cursor>`. Arm the waiter only when `connected` is above 0;
otherwise give the user the review URL and end the turn, since their next
message resumes you. Keep one waiter covering every server you host on a
host (repeat `--port`), never two. To add a server, stop the waiter (Claude
Code's `TaskStop`) and start one covering every port with each saved cursor.

Never leave a user comment unanswered. On exit 0, handle each
`comment.created` and `comment.updated` event whose message is not already
`replied` or `noted`: answer it with `comment reply`, or mark it `noted` with
`comment status` when it needs no answer. A message left `queued` returns in
every later wait and costs a turn each time. `review.approval` and
`review.summary` events take no receipt. Replace the winning port's saved
cursor with the batch's `cursor`, or with a later one you read from launch
output, keep the other ports' cursors, and re-arm. Drop a port only when no
review on it still awaits the user: an LGTM ends the wait for its review, not
for other reviews on that server, and an Approve after comments with open
conditions does not end it. On exit 2, run the filtered snapshot on the
port stderr names; if it fails, tell the user that server stopped and re-arm once
for the others, and if it answers, re-arm once with the saved cursors. On exit
3, run the filtered snapshot, handle what it lists, and wait with its cursor.
On exit 1 whose stderr names your own arguments (such as `--after` or
`--port`), correct them and re-arm once. On any other exit 1, or exit 4, do not
re-arm: tell the user why (exit 1 prints the reason on stderr; exit 4 means no
review tab is connected) and that their next message resumes you. Before ending
any turn, run the filtered snapshot on every running server and handle what it
lists.

Approve as-is, or a fully addressed Approve after comments, on a review you opened
is commit approval. Commit only the recorded scope/requested fixes after
addressing comments, passing checks, and independent Codex/Claude LAND on final code.
Require matching `approval.approved: true` in a fresh snapshot immediately before
commit. For named reviews also match `approval.captureVersion` and
`approval.patchDigest` to the snapshot's `capture`, and `approval.summaryVersion`
to `summary.version`. Check the actual commit scope against the approved capture;
later shared-tree edits do not acquire approval. Revocation/restart invalidates
prior button approval. Then commit without asking again. Separate chat approval is independent; silence/tab closure is not
approval. This rule never authorizes a push or publication.

Details: [conversation protocol](https://github.com/photostructure/difit/blob/main/docs/agent-conversations.md).
