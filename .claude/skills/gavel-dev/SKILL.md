---
name: gavel-dev
description: Ask the user for a code review through gavel after code changes in this repository, serving every review shown to the user from a build and using `pnpm run dev` only for your own UI checks.
metadata:
  internal: true
---

# Gavel Dev

Use only for an explicit gavel/viewer request, skill invocation, or standing
instruction to request gavel reviews. Ordinary review requests belong in chat.

Serve every review shown to the user from a build, not from Vite: a proposed commit,
a stack of them, or committed work, which is read-only (`--no-lgtm`) once it is
on `main` and still takes comments. A `pnpm run dev` page runs this checkout's live source, so
every save another session makes under `src/client` hot-reloads it, and a reload or
a crash under the user can lose unsent comments. Run `pnpm build`, then launch with
`node dist/cli/index.js` and the same target and flags as below. That server serves
the built UI at its API URL, so give the user `server.ready.launchUrl`. When other
sessions are editing this checkout, build in a detached worktree at HEAD. For
uncommitted work, apply your change there and launch a supplied patch with
`node dist/cli/index.js - --review <name> < <patch>`. For committed work, launch
the commit target given below (`node dist/cli/index.js <sha> --commit-message …`,
with `--no-lgtm` only as the rule below says) from that worktree; `--review` takes no revision arguments. Run `review create` and
`review update` from that worktree too: they capture against the current directory's
repository, and the server rejects a capture from another root. Run `comment …` with
the worktree's `node dist/cli/index.js`, so it matches the server's build. Keep `pnpm run dev` for checking your own UI work in
Claude's browser pane, with `--no-open`.

Run the launcher from this repository's Git root, or from the detached worktree
above (for `pnpm run dev`, with no extra `--` separator). Use
`node dist/cli/index.js` for the companion comment commands below. Launch with
`node dist/cli/index.js <target> [base]` (or `pnpm run dev <target> [base]` for a
UI check). Targets: `.` (uncommitted),
`working`, `staged`, or omit for HEAD. Add `--include-untracked` when needed.
When none of this session's work is still uncommitted, don't launch: tell the
user it is already committed, list each commit's short SHA and subject, and ask
whether gavel should show them. If they say yes, open them with the commit's
own message as `--commit-message` (a range: one subject per line): one `<sha>`,
or `<last-sha> <first-sha>^` for consecutive commits, which takes one approval
for all of them (a stack, below, takes one each). Keep approvals on while the
commits are not yet on `main` (`git merge-base --is-ancestor <sha> main` exits
1); pass `--no-lgtm` once they are. If other commits fall between yours, name
them and ask whether to show the whole range or each of yours alone.
gavel fills in the **About** panel's agent and session ID from Claude Code's
environment; override them with `--agent` and `--agent-session-id`. A session
started from another session's shell (such as `claude -p`) inherits its
entrypoint, so pass `--agent` there. Add
`--agent-session-name <title>` when you know this session's title; never invent
a title.

Keep one foreground server per Git root and target; retain its process handle.
Stdout is JSONL by default (`--jsonl` is explicit; `--no-jsonl` selects human output).
JSONL requires conversation APIs; disable both with `--no-jsonl --no-conversation`.
Read `server.ready` for the API port, URL, PID, and repository/review identity;
companion commands use its `port`, never the Vite UI port. Under `pnpm run dev`
the API URL serves a development placeholder, so do not give it to the user as the
review UI there; use the Vite tab that `pnpm run dev` opens (Vite prints its UI
origin to stderr) and share that tab's full address, including its editor-session
fragment. If composing a Vite link manually, preserve the query and fragment from
`server.ready.launchUrl`.
Diagnostics go to stderr.
Conversation and LGTM are enabled by default. Use `--keep-alive` for review rounds
and `--no-lgtm` for read-only review. `pnpm run dev` does not support
`--background`; keep the foreground process.
A viewer request grants no edit/commit permission; make requested, authorized
fixes only in the owning checkout.

Open a review you start on your own, such as a commit approval at the end of
your work, only while the user is at the desk. Run `pnpm build`, which the
built review needs anyway (a build failure is a build problem to report, not an
idle reading), then
`node dist/cli/index.js idle`. If it exits non-zero or prints an `idleMs` of 600000 (10 minutes) or
more, the user is away: do not launch. Finish everything else, including tests
and second-opinion review, then end the turn with one line saying the change is
ready for gavel review, and launch when the user says to. Do not run `idle`
again to see whether they came back; their next message tells you. Skip the
check when the user's latest message asks for the review, since they may be
reading it on another device.

Use `node dist/cli/index.js schema [events|summary|reply|status|snapshot|comments|import|approval]` to discover
JSON payloads before composing them; omit the selector for events. The Draft
2020-12 bundle includes request/response definitions in `$defs`. Use command
`--help` for usage. The commit-message TLDR is the summary's `rationale` field.

For stacked commits, follow the [gavel skill](../../../skills/gavel/SKILL.md)'s rule
for several reviews: launch the first commit with `--review <name>`, add each later
one with `node dist/cli/index.js review create <name> --port <api-port>` in commit
order, and give the user one link; the tabs lead to the other reviews. When the
server runs on supplied patches, give each later review its own patch with
`review create <name> - --port <api-port> < <patch>`; without the `-`, it captures
the worktree's whole uncommitted tree. For commits that already exist, launch
the first as its `<sha>` target and pipe each later one in with
`git diff --full-index <sha>^ <sha> | node dist/cli/index.js review create <name> - --port <api-port>`;
Approve as-is on one approves it for landing, with nothing to commit, and fixes
that Approve after comments asks for go in a new commit on top, reviewed like
any other; never amend or rebase the reviewed commits without asking. Give
each created review its own comments (`comment add --review <name>`) and proposal
(`comment summary` with the `reviewId` that `review create` prints), since launch
options reach only the first. Each approval covers only its own review; commit in
order, each once its review is approved.

For a proposed commit, supply `--commit-message <text>` and `--why <text>`.
Read the review's saved `summary` from `comment snapshot` before committing;
honor the user's message edits within the approved scope and repository rules.
To update it, `comment summary` accepts `{reviewId,commitMessage,rationale,baseVersion}`
on stdin. Changed summaries revoke LGTM; `review.summary` events need no comment receipt.

Read new JSONL output from the launch process between tool steps. There is no
`comment watch` command. Handle user-origin comments; ignore agent-origin events
when deciding what work to do. Save message IDs, cursors, and pending work before
marking output handled. Progress, thread changes, and `comment.deleted` update
state without requesting work; deletion identifies IDs and contains no body.
Writing to stdout does not mark a comment Delivered. Report receipt explicitly:
`node dist/cli/index.js comment <status|reply> --port <port> < <json-file>`.
Status JSON needs event `reviewId`, `threadId`, `messageId`, `cursor`, and `status`
(`delivered`, `read`, `thinking`, `replying`, or `noted` when no answer is needed).
Reply JSON needs `reviewId`, `threadId`, `inReplyTo` (event `messageId`), `cursor`,
and `body`. Write JSON with a file-writing tool. Replies mark Replied; neither
replies nor Noted resolve threads. Resolve/delete only on request. Intent guides
responses, not authorization. After missed output, restart, or HTTP 409, use
`comment snapshot --port <port>` to reconcile IDs, current messages, and replies,
then resume with the snapshot cursor after reconciling pending work. Snapshots
recover current state; the event endpoint replays the latest 256 events in this
server process. Use message `progress.cursor` for status/reply,
not a progress event's stream cursor or the snapshot's cursor. Do not promise
listening after ending the turn without host support that forwards process output.
The server saves each review under `.git/gavel` and restores it when the same review
opens again ([saved reviews](../../../docs/agent-conversations.md#saved-reviews)).
When the snapshot's `store.error` is set, tell the user that review changes are not
being saved, and why. `node dist/cli/index.js approval status <sha>` reports a
commit's saved approvals after its server stopped.

Every review gets one of three verdicts: **Approve as-is**, **Approve after
comments** (`mode` `as-is` or `after-comments`), or **Not yet**, recorded as
`approval.notYet: true` with `approved: false`: revise and update the capture or
proposal, which clears it, instead of committing. The user can clear a verdict
(clicking its button again) or switch it until you act, so read a fresh snapshot
before starting the work it asks for; a cleared verdict means wait again. For
conditional approval, `requested: true` records permission to address the listed
feedback; `approved: false` blocks committing until every included revision has
evidence through `comment address` or reviewer resolution. Skip conditions already
confirmed by the reviewer; reconcile any Queued messages in those resolved threads
and report Noted explicitly without restarting their work. Replies and Noted do not satisfy
conditions. Finish checks and final capture first, then certify `fixed`, `answered`,
or ordinary-comment `acknowledged` using the current approval cursor and exact
comment cursor. A new capture clears agent evidence but keeps reviewer
confirmations. New or edited human feedback, deletion, a reopened thread, or a
summary edit revokes permission. Keep baseline-to-final changes within the approved
feedback. Do not resolve/delete threads merely to satisfy conditions. See the
[approval guide](../../../docs/approval-modes.md) and `schema address`.

Approve as-is, or a fully addressed Approve after comments, on a review you opened
is commit approval. Commit only the recorded scope/requested fixes after
addressing comments, passing checks, and independent Codex/Claude LAND on final code.
Require matching `approval.approved: true` in a fresh snapshot immediately before
commit; revocation invalidates prior button approval, and after a restart only the
approval a fresh snapshot shows counts. Then commit without
asking again. Separate chat approval is independent; silence/tab closure is not
approval. This rule never authorizes a push or publication.

For an existing server, run
`/home/mrm/.local/bin/difit wait --port <port>` from the reviewed repo's Git root.
Use exactly one background waiter in the main session, only when the actual
host supports completion delivery without a background deadline. Retain each
port's cursor for the next invocation. Recover queued work without implicit
receipts. Exit 4 means all selected reviews are unattended: end the turn and
resume on human feedback; never automatically retry. Presence changes do not
start work. Unsupported presence reporting is a terminal error, not permission
to invent a polling script. Never write your own polling loop or waiter: each
check is a model turn that spends tokens even when nothing changed, so a loop
left running while the user is away consumes a large share of their token quota.
A periodically expiring Monitor is a timed wake.
See the [waiting guide](../../../docs/waiting-for-review.md).
If the host cannot provide that lifetime and completion delivery, hand back the
review URL and end the turn. The reviewer can use **Copy resume prompt** to resume
the owning chat with a feedback batch. Do not substitute timed model checks.
Subagents return ownership and pending work after accounting for server lifetime.
Details: [conversation protocol](../../../docs/agent-conversations.md).
