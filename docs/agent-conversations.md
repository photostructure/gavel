# Review conversations

For uncommitted work, start `difit --review <task-name> --keep-alive` and retain
the foreground process handle. This captures the selected patch under a stable
review name. For commits, use `difit <target> <base> --keep-alive` with immutable
SHAs for approval. Conversation and LGTM are enabled by default. `--keep-alive`
lets questions continue across browser disconnects; LGTM keeps the review open
when approval changes.

Each resolved comparison retains its conversations and change summary. Browser
Back/Forward restores the saved resolved comparison and discussion. Reloading a
URL with symbolic refs such as `HEAD` follows their current commits, which can
select a new conversation context. The revision menu's **Recent reviews** list
also reopens earlier resolved comparisons with comments or a summary. While any
review asks for approval, the review tabs replace the revision menu. The URL
records the requested base, target, and comparison mode.
Retained-review links keep the saved resolved base, including merge-base reviews
reopened after switching branches.

## Named captures for uncommitted work

A named review holds an immutable patch and keeps the same conversation and
proposal when an agent explicitly updates that patch. Names are 1–80 ASCII
letters, digits, dots, underscores, or hyphens, starting with a letter or digit.
Use one name per task. Names are scoped to the server and repository root. A
restarted server knows a named review again once it is launched or created with
the same name and patch, which restores its capture history and conversation
([saved reviews](#saved-reviews)).

Capture the current tracked changes from HEAD with repeatable native Git
pathspecs. Quote pathspecs so Git receives exclusions and glob syntax unchanged:

```sh
difit --review parser-fix --pathspec src --pathspec ':(exclude)src/generated/**' --keep-alive
```

Add `--include-untracked` to include untracked file contents. Capture operations
read the index and working tree without staging, stashing, or editing them.
Pathspecs include every matching change, including changes from another task.
Check the selected patch against the intended scope before requesting approval.

Native capture rejects selected paths whose configured clean or process filters
would execute external commands, including affected paths inside checked-out
submodules. Narrow `--pathspec` to unaffected files, or explicitly generate the
wanted patch and supply it through stdin or a prepared `--capture` artifact.
Imported patches remain supported.

Capture artifacts allow up to 8 MiB of UTF-8 patch bytes. Creating or updating a
named review on a running server has a separate 16 MiB serialized JSON limit;
escaped patch text and catalogue metadata count toward it. The CLI checks before
sending, and the server returns JSON HTTP 413 for oversized requests. Narrow the
selected patch, or launch a new local review from a saved artifact with
`--review <name> --capture <file>`.

For overlapping changes in one file, save an artifact and use its catalogue IDs:

```sh
difit review capture --pathspec src --include-untracked --output /tmp/capture.json
difit --review parser-subset --capture /tmp/capture.json --select '<file-id>' --select '<hunk-id>' --keep-alive
```

`--output` writes the full schema-version-1 artifact and prints a compact file/hunk
catalogue; without `--output`, stdout contains the full artifact. Replace the
placeholder IDs with IDs from that exact catalogue. Repeat `--select` to include
whole files or individual hunks. IDs contain the artifact's patch digest; line or
hunk numbers alone cannot identify a stable selection. A subset has its own
digest and catalogue. Binary, mode, rename, addition, deletion, and submodule
changes require a whole-file ID. Artifacts are bound to their repository root.
`difit - --review parser-fix < /tmp/selected.patch` also captures a supplied patch.
`--pathspec` and `--include-untracked` apply only to native captures; `--select`
can narrow an artifact or supplied patch.

Use the actual `server.ready.port` to create another task on the same server or
to update an existing task. Read its current metadata before updating:

```sh
difit review create docs-update --port 4966 --pathspec docs
curl --fail --silent http://localhost:4966/api/reviews/parser-fix
difit review update parser-fix --port 4966 --expected-version 1 --pathspec src --pathspec ':(exclude)src/generated/**'
```

A review asks for approval when it carries a capture or a proposed commit
message. A message the server copied from a browsed commit (`fromCommit`) is not
a proposal, and after a commit moves HEAD only the newest unnamed review for each
of `.`, `staged`, and `working` counts, with or without a proposal. A different
base browsed for one of those targets before an agent proposes makes a newer
review that hides the proposal's tab; that is unsupported. While any review asks
for approval, approved or not, the viewer's header shows the open review's name
in place of the revision menu, so the reviewer can't open comparisons the agent
didn't ask about, and a review bar under the header lists every review that asks
for approval. The bar is hidden only when the open review is the sole one. It
starts with a count
such as "2 of 3 need a verdict", then shows every review as a tab in creation
order, with a ✓ (approved), ✕ (not yet), or ○ (no verdict) mark in its verdict button's color. Hovering a tab shows its
proposed commit message title. When the tabs don't fit on one row, the bar shows
only the open review's tab with a ⌄; it opens a list of every review with its
mark, commit message title, and approval. Picking a review opens it in the same
browser tab and keeps the editor connection. It replaces the browser's history entry
instead of adding one, so Back does not step between reviews and the page can still
close itself once every review has a verdict. The **Change summary** panel stays open or closed across reviews and
reloads, the way the reviewer last left it.

An update can instead use `--capture /tmp/next-capture.json` and repeatable
`--select` IDs, or `difit review update parser-fix - --port 4966
--expected-version 1 < /tmp/selected.patch`. Capture updates are explicit: source
edits and browser refresh leave the displayed patch unchanged.

`GET /api/reviews/:name` returns current metadata and the file/hunk catalogue with
`reviewId`; add `?version=<n>` to read a retained capture catalogue.
`POST /api/reviews` accepts `{name,capture}` and returns the same response shape
as update with `updated:true`.
`POST /api/reviews/:name/capture` accepts `{expectedVersion,capture}` and returns
`{reviewId,name,version,patchDigest,baseCommit,repositoryId,updated}`. A stale
expected version returns HTTP 409 with `{error,current}`; inspect `current` and
reconcile before retrying. Even an identical-patch update checks the expected
version. An identical patch preserves the version and approval. A changed patch
advances the version and revokes LGTM, retaining the conversation and proposal
under the same name and `reviewId`. Earlier inline anchors retain their original
capture version/digest and appear outdated after the capture changes.

## Discover payloads

Run `difit --help` for commands and `difit comment <command> --help` for companion
command usage. `difit schema` prints a JSON Schema Draft 2020-12 bundle for launch
events. Select a root with `difit schema events`, `summary`, `reply`, `status`, or
`snapshot`; `comments`, `import`, and `approval` describe the other control payloads.
`capture` validates a saved artifact and `capture-update` describes its guarded
update request.
The bundle's `$defs` also describe request/response payloads, comment
messages and edits, progress, threads, and approval. Read the installed build's
schema rather than copying payload definitions from another version.

The proposed commit message is `commitMessage`; its TLDR is `rationale` in
`comment summary` JSON. Both are editable in the browser, and saved changes emit
`review.summary`. Comments, replies, and progress reports are JSON as described
below. Schema discovery does not start a review server.

## Launch output and event consumption

Foreground stdout emits one JSON object per line by default. `--jsonl` selects
this explicitly; `--no-jsonl` selects human-readable output. Startup diagnostics
go to stderr in both modes; human-mode comment and approval output goes to stdout.
There is no separate `comment watch` command. `difit wait` long-polls
`GET /api/conversation/events`; see [waiting for human review](waiting-for-review.md).
Otherwise, read output from the running launch process between tool steps.
`--background` detaches the server and returns connection information without
live stdout; use foreground `--keep-alive` for active agent conversations. JSONL
and named reviews require conversation APIs. For unnamed reviews, disable
conversations with `--no-jsonl --no-conversation`. `--no-jsonl` alone retains the
control APIs.

The first `server.ready` event includes `port`, `url`, `launchUrl`, `pid`, `reviewContext`,
`selection`, `reviewId`, and `timestamp`. Named reviews also include `capture`
metadata: `name`, `version`, `patchDigest`, `baseCommit`, and `repositoryId`.
Use its actual API port for companion commands: 4966 may be occupied, and the Vite UI port is not the API port.
`url` is the API origin without an editor token. For production launches, give
the reviewing user `launchUrl`: its fragment carries the editor-session token
needed for open-in-editor actions. In development, the review UI is the Vite tab
opened by `pnpm run dev`; preserve the query and fragment from `launchUrl` when
constructing a link on the Vite origin.
`server.shutdown` includes `reason`, `pid`, and `timestamp`.

Each submitted comment or reply emits an event as soon as the browser saves it,
without waiting for approval or closing the tab. Partial text still being typed
is not sent. Message events include `type` (`comment.created` or `comment.updated`),
`origin` (`user` or `agent`), `cursor`, `reviewId`, `selection`, `threadId`,
`messageId`, `file`, `side`, `line` (a number or `{start,end}`), `body`, `author`,
`timestamp`, and the available `codeSnapshot`. Named review message events include
current `capture` metadata and the thread's original `anchorCapture` version and
digest. The code snapshot records the excerpt the commenter saw. Unnamed
working-tree selections can change on reload; use a named capture to retain a
fixed patch.

The stream also carries `review.capture`, `review.approval`, `review.summary`, `comment.progress`,
`comment.deleted`, `thread.resolved`, `thread.reopened`, and `thread.deleted`.
Progress events include review, thread, and message IDs, `selection`, agent `origin`, stream
`cursor`, `progress`, and `timestamp`. Their `progress.cursor` identifies the
comment revision; their outer `cursor` identifies the progress event. Thread
events include review/thread IDs, `selection`, `origin`, `cursor`, and `timestamp`.
`comment.deleted` additionally identifies `messageId` and contains no body.
These state changes are not new work requests. `review.capture` has agent origin,
`reviewId`, `selection`, current `capture` metadata, `cursor`, and `timestamp`.
Named `review.summary` and `review.approval` events also include current capture
metadata. A snapshot includes each named review's current `capture` and each
thread's original `capture` version/digest.

Persist handled message IDs, cursors, and pending work before marking launch
output handled. Writing an event to stdout does not prove the agent received it;
send an explicit Delivered receipt with `comment status` after consumption.
After output loss or server restart, run `comment snapshot --port <port>` to
obtain `{reviews,cursor}`. Each review includes its `id` (use as `reviewId`),
selection, threads, and message IDs. A snapshot recovers current state, including
message deletions and edits, rather than missed events. Reconcile outstanding work
and existing replies, then continue consuming new launch output. `difit wait
--after <cursor>` resumes from a stream cursor; see
[waiting for human review](waiting-for-review.md). The snapshot and its state checkpoint
cursor are captured together. Compare that cursor for equality with concurrently
buffered live event cursors: a matching event's state change is already reflected
in the snapshot. Treat the tokens as opaque; do not decode or sort them. A
consumer that waits next with `difit wait` passes the checkpoint cursor to
`--after`, so an approval or summary edit made after the snapshot is not
missed; only a consumer that keeps reading live launch output may ignore it.
Use message `progress.cursor` for status/reply
revision guards, not the snapshot's checkpoint cursor. An existing detached server can be recovered
through snapshots, but it has no launch stream available to the agent.

JSONL output does not itself wake an idle agent. On a host that starts a turn
when a background command exits and puts no time limit on it, wait while idle by
running `difit wait` as one background command; the harness wakes the agent
once, when it exits. On other hosts, end the turn. See
[waiting for human review](waiting-for-review.md). Do not wait with a monitor on the launch output: in the
tested Claude harness a Monitor expires after its configured timeout (at most 30
minutes), and each expiry wakes the agent even when no record arrived. A subagent
does not wait for the user. Harness shutdown can also terminate the foreground
review process; `--keep-alive` only covers browser disconnects.

Consume records in emission order using their cursors. Startup can emit a seeded
summary whose timestamp predates `server.ready`; sorting by timestamp would put
the stream in the wrong order. If a companion command rejects a stale summary
or comment revision, fetch a fresh snapshot before retrying.

Browser storage may restore old threads into a restarted server. These arrive
as created events, preserving agent origin. Compare message IDs and bodies with
persisted handled work and existing replies before answering restored questions.

Reply by IDs from the event, using JSON on stdin to avoid shell quoting errors:

```sh
difit comment reply --port 4966 < /tmp/difit-reply.json
```

```json
{
  "reviewId": "<event.reviewId>",
  "threadId": "<event.threadId>",
  "inReplyTo": "<event.messageId>",
  "body": "The answer, or what changed and how it was verified.",
  "cursor": "<event.cursor>",
  "author": "Codex"
}
```

Use a file-writing tool to create the JSON. The reply API checks the exact review,
thread, and parent message, even after another browser tab changes revisions.
Identical retries are idempotent. Deleted threads/parents return 404; reconcile
instead of creating a new conversation at the same line. Replies render live
through the existing browser event connection. Ignore `origin: "agent"` events
when deciding whether to answer, to avoid replying to your own replies.

Read questions and change requests as they arrive. Answer questions in-thread;
start requested changes while the user continues reviewing. Ordinary review text
does not authorize commits. A read-only review of someone else’s PR or a stdin
diff does not grant write permission; perform requested fixes only in the
checkout that owns those changes. Leave answered threads visible. Resolution
preserves history and can be reopened; deletion is a separate explicit action.
This CLI transports messages; it does not invoke a
model or automatically resume an idle agent. The active agent must read new launch output
between tool steps, or its host must forward events to its session. Do not claim
to keep listening after ending a turn without such a host integration.

## Proposed commit message and rationale

The review's proposed commit message and short rationale explain what would be
committed and why. Seed the initial selection when starting difit:

```sh
difit . --commit-message 'fix: preserve review intent' --why 'Keep the proposed change clear during review.'
```

The browser can edit and save these fields for each diff selection, including
with `--no-jsonl --no-conversation`. They are saved with the review
([saved reviews](#saved-reviews)), except for an unnamed stdin patch or under
`--no-conversation`, where they disappear when the server restarts. Saving a changed proposal revokes any existing LGTM approval for that
selection. Editing these fields never executes Git or creates a commit.

A commit that moves HEAD gives a `staged` or `.` diff a new base commit, and so
a new review. That review starts with the previous review's summary unless its
diff is empty or a commit between the two bases has the proposed message, as
happens once the proposed commit lands. Approval and comment threads stay on
the previous review.

`comment snapshot --port <port>` includes `summary` on each review:
`{commitMessage,rationale,version,updatedAt?,fromCommit?}`. `fromCommit: true`
means the server copied `commitMessage` from the commit being browsed, so nobody
proposed it; any summary save removes it, even one that keeps the text, and such a
review gets no review tab.
Use that review's `id` and summary version to write a proposal without following
another tab's current selection:

```sh
difit comment summary --port 4966 < /tmp/difit-summary.json
```

```json
{
  "reviewId": "<snapshot.reviews[n].id>",
  "commitMessage": "fix: preserve review intent",
  "rationale": "Explain the reason for this change.",
  "baseVersion": 0
}
```

The command prints the saved summary. A stale `baseVersion` fails; read the
latest snapshot and reconcile the proposal before retrying. Empty strings clear
the fields. Commit messages are limited to 16000 characters and rationales to 4000. Unchanged saves preserve the version and emit no event.

Saved changes emit `review.summary` events with `origin`, `reviewId`, `selection`,
`summary`, `cursor`, and `timestamp`. These events have no thread or message ID
and require no comment receipt. Browser writes always use user origin; the agent
command always uses agent origin. Approval revocations emit `review.approval`
with the summary edit's origin; direct approval changes use user origin.

Browser API: `GET /api/review-summary?base=...&target=...&baseMode=merge-base`
returns the summary (initially empty, version 0, unless a restored review brought
its saved summary). `POST` to the same URL accepts
`{commitMessage,rationale,baseVersion}`. Agent writes use
`POST /api/conversation/summary` with the command's JSON shape. Both require
`application/json` and return the saved summary. Stale writes return HTTP 409
with `{error,summary}` containing the latest version. Browser updates broadcast
`reviewSummaryChanged` through the existing watch connection.

Approving with `POST /api/approval` includes the displayed `summaryVersion`.
For a named review, also include the displayed `captureVersion` and `patchDigest`.
For a `staged`, `working`, or `.` review, include the `diffDigest` from the
displayed `/api/diff` response.
The server rejects stale capture, diff, or proposal approval with HTTP 409. Revocation
remains available regardless of these versions.

## General conversation and comment intent

The header's **Conversation** button opens a panel containing general and inline
threads. The general composer accepts comments or questions about the whole review.
**Send** posts immediately. New comments, replies, and message edits share one
Intent radio group: **Comment** (default) shares context without requesting a
reply, **Change request** asks for a code change and follow-up, and **Question**
asks for an explanation. The body and existing authorization determine what the
agent should do; intent is not approval to commit, push, or publish. Explicit
root-message intent takes precedence over the older thread-level question flag,
which remains a fallback for saved threads without explicit intent.

After an agent reply, the reviewer can answer with one click. The buttons post
ordinary replies: "👍 Agreed: no reply needed." as a comment, and "❓ Still
unclear: please explain again in different words." or "👎 Disagree: please
reconsider, or defend the point." as questions. Handle them like typed replies:
mark the agreement `noted`, and answer the questions in the thread.

General threads and events have `scope: "review"` and omit file/line location.
Use the event's review/thread/message IDs for status and replies just as for inline
comments. Message events carry optional `intent`: `comment`, `question`, or `change`.
An intent change is a new message revision, like a body edit.

**Resolve thread** retains all messages and collapses the conversation. **Reopen**
restores it. The Conversation panel can show All, Open, or Resolved conversations.
Resolution is separate from reply status: an answer does not prove that a requested
change is resolved. Agents should resolve only when the user requests it.

```sh
difit comment resolve <threadId> --review <reviewId> --port <port>
difit comment reopen <threadId> --review <reviewId> --port <port>
```

Use `--review` from the event to avoid another tab's selected review. Without it,
these commands act on the server's current selection. The HTTP route is
`POST /api/comments/:threadId/resolution` with `{reviewId, resolved}`.
Resolution persists with comment history. It emits `thread.resolved` or
`thread.reopened` and refreshes the browser; deletion emits `thread.deleted`.
These events do not require comment receipts or replies.
`comment delete <threadId...> --port <port>` (alias `remove`) still deletes from
the current selection. Unlike older versions, `comment resolve` no longer deletes.
Delete only when the user explicitly requests removal.

## Comment progress

Each user message starts Queued → Delivered → Read. Work continues through
Thinking → Replying → Replied. Use Noted when a comment needs no response.
These are receipts and explicit agent reports, not inferred model activity.
Stdout output does not count as delivery. Report `delivered` explicitly after
consuming a user message. Read, Thinking, and Replying also require agent reports:

```sh
difit comment status --port <port> < /tmp/difit-status.json
```

```json
{
  "reviewId": "<event.reviewId>",
  "threadId": "<event.threadId>",
  "messageId": "<event.messageId>",
  "cursor": "<event.cursor>",
  "status": "thinking"
}
```

Send `delivered` after receiving the comment, `read` when you inspect it, `thinking` while investigating or
implementing its request, and `replying` while composing the answer. States can
be skipped; delayed requests cannot move progress backwards. Include the same
message-event cursor in the reply JSON to finish with Replied. Older replies
without a cursor still work but do not assert that the current wording was
answered. Editing a comment resets its progress; stale status/reply cursors
return 409. Reconcile the latest event or snapshot before proceeding. From a
snapshot, use the message's `progress.cursor`, not the snapshot's checkpoint cursor.
Deleted comments return 404. Status updates emit `comment.progress`, not new
message events. Use `progress.cursor` from a progress event for revision guards.
Reply to questions, requested changes, and anything needing clarification. Simple
acknowledgments and LGTM should be marked `noted` after considering them, without
a redundant answer. Noted records that no reply is needed; Read only records
inspection. Neither status resolves the conversation.

Progress is saved with its review, so a server that restores the review restores
its progress ([saved reviews](#saved-reviews)). Hover over a status for its last update time; an inactive
agent's last report is not proof it is still working. The HTTP status endpoint
is `POST /api/conversation/status` and accepts the same JSON as the CLI.

## LGTM and commit approval

The header's verdict buttons give commit approval for the reviewed scope, including
requested fixes: **Approve as-is**, or **Approve after comments are addressed** once
every included comment has completion evidence (see
[approval modes](approval-modes.md)). After the checks below, commit without asking
again in chat. A chosen **Approve as-is** is filled green, a chosen **Approve after comments** amber
(pending or complete), and a chosen **Not yet** red; clicking it again, or **Clear verdict** in the narrow-screen
menu, withdraws it.
**Not yet** records `approval.notYet: true` with `approved: false`: the reviewer is done
with this capture and wants a revision. Read the comments, revise, and recapture or
re-propose, which clears it and puts the review back in line for a verdict.
The server stays running. Approval is scoped to the displayed selection and is
restored after browser refresh, and by a restarted server that opens the same
review again ([saved reviews](#saved-reviews)).

After a verdict a notice under the verdict buttons counts down ten seconds, then opens the
next review without one, or, when every review has one, closes its tab. The browser closes
only a tab whose history holds one entry (or one a script opened); otherwise the page
says the tab can be closed. Closing the tab still shuts the server down unless it runs
with `--keep-alive`.

The launch stream emits a `review.approval` event with `reviewId`, `selection`,
`approved`, `approval`, `origin`, `cursor`, and `timestamp`. Not yet and revocation both
have `approved: false`; only `approval.notYet` tells them apart. It has no thread or message ID, and does
not need a comment receipt or reply. `comment snapshot` includes `approval`
on each review. After addressing comments and completing the checks below,
fetch a fresh snapshot immediately before committing and verify that the matching
review still has `approval.approved: true`. For a named review, require
`approval.captureVersion === capture.version`,
`approval.patchDigest === capture.patchDigest`, and
`approval.summaryVersion === summary.version`. For a `staged`, `working`, or `.`
review, the snapshot reports an as-is approval as revoked once the diff differs
from the one approved, for example after more hunks are staged. Check that the proposed commit
contains only the approved captured changes and authorized fixes; approval of a
capture does not establish ownership of later shared-tree edits. An older approval
event does not override a later revocation. Missing state or an unavailable server is not proof
of approval. Separate explicit chat approval is independent of the button state
unless the user revokes it. Revoking cannot undo a commit already made.

Match immutable targets to the saved SHA and mutable targets to the recorded
patch scope. A closed tab, quiet stream, timeout, resolved thread, answer, or
ordinary process exit is not approval.

The approval button uses `GET /api/approval?base=<base>&target=<target>` and
`POST /api/approval` with the same query. Approve with
`{"approved":true,"summaryVersion":0}` using the displayed summary version;
revoke with `{"approved":false}`. Include `baseMode=merge-base` where applicable.
For a named review, use `?review=<name>` and approve with
`{"approved":true,"captureVersion":1,"patchDigest":"<current-digest>","summaryVersion":0}`
using the displayed capture and summary values. For a `staged`, `working`, or `.`
review, also send `"diffDigest":"<digest from /api/diff>"`. Both
require `--ship-it`. GET returns the current approval, after revoking an as-is
approval whose `staged`, `working`, or `.` diff has changed; it also
works without conversation mode. The legacy `POST /api/ship-it` approve-and-exit
endpoint remains available to old clients for committed ranges, but the button
never calls it, and it refuses named, `staged`, `working`, and `.` reviews. An old
server without `/api/approval` must be rebuilt before using the button.

After LGTM, address every comment (answer questions or implement requested
changes), run the relevant checks, and obtain LAND from both Codex and Claude
second-opinion reviewers on the resulting code (for example via
`coding:second-opinion`; LAND means no remaining blocking findings). Then commit without asking for
approval again. Missing reviewers, outstanding comments, REVISE, or DISCARD keep
the commit blocked. Repeat review after code changes so LAND covers the final
tree. Approval does not cover unrelated additions and never authorizes a push,
publication, or invoking a landing workflow the user has not requested.

## Saved reviews

A server with conversation APIs saves each review's comments, comment progress,
proposal and approval under `<git-common-dir>/difit/`, the repository's
`.git/difit`, which its worktrees share and Git never commits, clones or pushes.
It saves after every change, so a stopped or crashed server loses nothing it
saved. A later server restores a review when it opens the same one:

- a named review, launched with `--review` or added with `review create`, with the
  same name and the same current patch, along with its whole capture history;
- any other review (a commit, a range, `staged`, `.`) that resolves to the same
  commits.

An unnamed stdin patch, and a server started with `--no-conversation`, save
nothing.

A restored review keeps its approval until the usual rules revoke it: a changed
capture, summary, or `staged`/`.` diff. A relaunch that passes the same
`--commit-message` and `--why` keeps the restored proposal and its approval; a
different one replaces the proposal and revokes approval. Repeated `--comment`
imports are not duplicated. A restored review gets a new review ID and a new
event stream, so run `comment snapshot` before sending status, replies, or a
`comment summary`, whose `baseVersion` is the restored summary's `version`.
Comment `progress.cursor` values from before the restart still work. A server
launched with `--clean` restores the launched review without its comments and
progress, and saves it that way; other reviews it opens keep theirs.

Each saved review has a lock naming the running server that saves it. While
another server on this host holds a review's lock, a new server neither restores
nor saves that review, so the two never overwrite each other; the new server
starts it empty and keeps it in memory only.

The snapshot (`comment snapshot`, `GET /api/conversation/snapshot`) carries
`store: { directory, error? }` for a server that saves reviews. `error`, when
present, lists what the server is not saving and why: a save that failed or waits
for a lock, a failed heartbeat, and reviews another running server saves, which
this one keeps in memory only. Until those clear, their changes are lost when the
server stops. It also lists files startup cleanup could not handle; those stay, and
saving is unaffected. A
`--background` server's stderr reaches nobody, so this field is the only report.

When a server starts, it deletes saved reviews that nobody changed for 7 days,
saved patches that no remaining review uses once they are 7 days old, and locks
whose server stopped.

`difit approval status <commit>` lists the saved reviews of a commit without a
running server: reviews that targeted the commit, and named reviews of exactly
`git diff --full-index <commit>^ <commit>`, the stacking recipe in the skills (full object names keep the digest stable as the repository grows). `difit approval status --patch-digest <digest>`
matches a named review by its current patch. Both print a JSON array, newest
first, of `{match, approved, name, selection, approval, commitMessage, updatedAt}`;
an empty array means no saved review matches.

## Compatibility

Published `@photostructure/difit` 5.1.0 does not contain this launch JSONL
protocol. Until the next release, use a source build and verify that `--help`
includes `--jsonl` and `--no-jsonl` and `difit schema` succeeds. Within this repository,
run `pnpm build` and launch any review the user will see with
`node dist/cli/index.js <target> <base> --keep-alive`, which serves the built UI; use
`pnpm run dev` only for UI development, since its page hot-reloads when client source
changes. Use `node dist/cli/index.js comment …` for companion commands. From another repository, an absolute
path to that built CLI preserves the reviewed repository as the working directory.
Keep the server and companion commands on the same build.

The HTTP equivalents are `GET /api/conversation/snapshot` (returns
`{reviews,cursor}`) and `POST /api/conversation/reply` (JSON body as above).
`GET /api/conversation/events?after=<cursor>&wait=<ms>` returns `{events,cursor}`. Conversation APIs require
`--conversation`, which is enabled by default. Responses include 400 for invalid
input, 409 for stale message cursors, capture versions/digests, or summary versions, 404 for unknown
review/thread/parent or a disabled endpoint, and 415 for non-JSON replies.
Stream cursors and review IDs last only for the server process.
