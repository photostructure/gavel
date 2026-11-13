---
name: gavel
description: Open a requested diff in gavel for human review, with reading-guide comments and a proposed commit message. Use when the user names gavel, requests its viewer, or has a standing gavel review instruction. Ordinary code reviews belong in chat.
---

# Gavel for Codex

Use this workflow in Codex desktop, CLI, IDE, and subagents. Do not load the
Claude entry point at `skills/gavel/SKILL.md`.

## Human review: end the turn

Serve with `--background`, share the URL, record pending work, and end the turn
once the current feedback batch is handled. Leave the server running until its
reviews are done (see Approval and completion). A live
shell process does not establish delivery into an idle chat.

Human review must cause zero idle model turns:

- Never use `gavel wait`, HTTP long-polling, sleeps, polling scripts, repeated
  process reads, heartbeats, schedules, goals, or monitors to await feedback.
- A tool yield, empty result, timeout, cache expiry, or browser presence change
  is not feedback. Do not refresh an unchanged snapshot to find work or warm a cache.
- Subagents return the review identity, URL, API address, and pending work to
  the main session, then finish. Never keep one alive to own a review server.
- Handle delivered human events directly. Read a snapshot for manual resume,
  missing thread context, newly delivered feedback, version conflicts, or the
  final approval check. End the turn again after handling the batch.

When the server has a Codex CLI supporting `codex queue`, gavel queues only human
verdicts and comments to `CODEX_THREAD_ID` and Codex home. Batches contain human
text and code context. Large batches arrive as an instruction to read a local
UTF-8 file containing the complete batch. Read it before acting; `@file` does not expand automatically. If the file is missing or
inaccessible, report that and recover through the manual resume prompt.

The robot briefly confirms transport acceptance, then returns to available;
neither state proves the chat resumed. A delivered verdict alone is not commit
approval. Gavel starts no daemon and resumes no other controller. A closed chat
may need manual resumption. An existing external controller may deliver events;
do not invent or test a bridge during ordinary review. Consult the
[Codex integration guide](https://github.com/photostructure/gavel/blob/main/docs/codex-review-integration.md)
only for delivery setup or diagnosis.

If delivery is unavailable or the chat stays idle, use the manual handoff: the
robot's **Copy resume prompt**, or the same button on the last verdict's toast,
which offers it when the verdict cannot reach the chat. Use
**Conversation → Copy resume prompt** only when there is no delivery state or
owning session. Paste into this chat;
copying alone does not resume Codex. Do not substitute a foreground wait.

## Open the requested patch

Use separate servers for Codex and Claude Code. Never add either host's reviews
to the other's server: final-verdict handoff follows the launching host.

Before a review you initiate, run `<launcher> idle` once. A nonzero exit or
`idleMs >= 600000` means the user is away: do not launch. Finish everything else,
including tests and second-opinion review, report that the change is ready for gavel, and end the turn. Launch when the user
asks; do not poll `idle`. Skip this check when the latest user message requests
review, since they may be reading on another device.

1. Run from the reviewed repository's Git root. Use the user's or repository's
   prescribed gavel launcher for every command.
   On first use, check that `--help` has `--review`, `--background`, and `--jsonl`.
   Reuse that build. Report missing capabilities; do not switch installs or use npx.
2. Capture only this session's uncommitted paths/hunks in a named review. If none
   of this session's work remains uncommitted, list short SHAs and subjects and
   ask whether to show them; do not launch yet. Use each commit's own message,
   or one subject per line for a range. Keep approvals on for unlanded commits:
   `git merge-base --is-ancestor <sha> <base>` exits 1. Use `--no-lgtm` once every
   target commit's check returns 0.
   Show one commit as `<sha>`, consecutive commits as `<last-sha> <first-sha>^`
   for one approval, or a stack when the user wants separate approvals. If other commits
   intervene, name them and ask whether to include them or show yours separately.
   For a user-named branch, range, or PR, review for defects before showing it.
   Seek approval unless the user requests read-only review or all target commits
   have landed; use `--no-lgtm` in those cases.
3. Include a proposed Conventional Commit message with `--commit-message` and a
   short explanation with `--why`. Add reading-guide comments with repeatable
   `--comment` arguments: where to start, surprising behavior, and verified
   findings. Anchor each point to its line; skip self-explanatory code.
   On a review longer than a few hunks, link the comments into a tour: give
   each thread an `id` unique across the server's reviews (prefix the review
   name) and link in Markdown with `[next](#thread=<id>)`,
   `[parser](#file=<path>&line=40-52)` (add `&side=old` for deleted lines), or
   `[API half](?review=<name>#thread=<id>)`. A named review holds only its
   captured hunks; link only to lines inside them. End `--why` with the tour's
   first link, such as `Start here: [parser](#thread=<id>)`; the rationale
   renders the same Markdown.
   **About** identifies the launching agent and session. Gavel detects the host
   from the rollout `originator` and uses `$CODEX_THREAD_ID`. Override wrong values
   with `--agent <host>` and `--agent-session-id <id>`. Pass
   `--agent-session-name <title>` only when known; Codex does not export it.
   A reused server keeps its launching chat's identity.
4. Launch once with `--background --keep-alive --title '<short description>'`.
   Pass `--title` on every launch. Keep it short: browsers only show the first
   10-20 characters. Read the finite
   `server.background` record: `port`, `pid`, and `url`. Its `url` is the reviewing
   link. Open it in the requested browser when browser tools are available.
   Record the reviewed repository, API host/port, review name/ID, capture identity,
   summary version, pending message revisions, and proposed next action.
5. Share the URL and hand back. A visible tab or a live server does not require
   keeping this turn active. If the host cannot preserve a detached server,
   report that limitation; do not substitute an active model as its owner.

Use the launch's API host and port for every companion command, including LAN
servers; never assume localhost or a development UI port. Reuse an existing
review's server. Add reviews with `review create <name> --host <host> --port <port>`,
which returns `reviewId`. Launch `--comment`, `--commit-message`, and `--why`
affect only the first review: give each added review comments through `comment add --review <name>` and a proposal through
`comment summary`. Set `baseVersion` to its snapshot's summary `version`, including
restored proposals; do not assume 0.

Reviews with a capture or proposal appear as tabs in creation order, replacing
the header's revision menu. A browsed commit's own message (`fromCommit: true`)
is not a proposal and creates no tab.

For stacks, create one review per commit, in commit order, on one server; share
the `server.background` URL. Commit each approved part in that order. For existing
commits, launch the first as `<sha>` with its own `--commit-message`; add later ones:

```sh
git diff --full-index <sha>^ <sha> | <launcher> review create <name> - --host <host> --port <port>
```

The `-` is required. Give each its own message with `comment summary`. Approval
without open comments permits landing an existing commit; there is nothing to
commit. Requested fixes go in new reviewed commits. Never amend or rebase the
reviewed commits without asking.

Before reporting missing approval, read every review's snapshot `approval`.
Reopening the same named patch or commits restores saved reviews, but changes
review IDs and event streams. The server saves comments itself. For restored
reviews, read `comment snapshot` before status, reply, or summary writes; use the
restored summary version. `approval status <sha>` reads saved approvals
after server shutdown. Report `store.error` and why changes are not being saved
([saved reviews](https://github.com/photostructure/gavel/blob/main/docs/agent-conversations.md#saved-reviews)).

Rename with `review rename <name> <new-name> --host <host> --port <port>`; identity,
comments, proposal, and verdict stay. Delete an unwanted review you created with
`review delete <name> --host <host> --port <port>`, freeing its name. Its comments
remain in **Conversation** until shutdown. Do not restart to remove one review:
that removes every review's comments from the page. Never stop, replace, rename,
or delete another session's reviews.

For overlapping files, use `review capture --output <artifact>` and its printed
file/hunk IDs with `--capture` and `--select`. Pathspecs alone can include another
session's changes. Check the capture's actual scope. To recapture after fixes,
read the named review's current version and use `review update --expected-version`.
Pass `-` for a supplied patch; repeat native `--pathspec` and `--include-untracked`
options, or use `--capture` with selectors. Update does not reuse the original filters.
Source edits and browser reloads do not update a frozen capture. HTTP 409 requires
reconciliation before retrying. Do not recapture as an idle activity.

## Split large changes

Honor the user's grouping, including a request for one whole diff. Otherwise aim
for about 300 weighted changed lines per coherent review, with no file-count cap.
This is a heuristic, not a validated cutoff. Count additions and deletions with
`git apply --numstat < <patch>`, or `git diff --numstat HEAD -- <paths>` for native
tracked changes (`<base> <target>` for commits). Add scoped untracked text lines;
exclude unrelated paths/hunks. Weights: tests 0.2, config 0.5, complicated SQL,
concurrency and native code 1.5, reproducible generated/vendored output and
lockfiles 0, everything else 1. AI-written code and prose are not generated output.
Consider raw counts too: discounts must not hide the reading burden.
The [Cisco study](https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf)
favors a few hundred inspected lines;
[Google](https://google.github.io/eng-practices/review/developer/small-cls.html)
favors self-contained changes without excessive splitting.

Split by purpose, in dependency order, never by directory or file count:

- Each review needs one purpose expressible without “and”; no “misc” or “cleanup”
  buckets. A file that fits nowhere gets its own review.
- Keep tests, docs, and plans with their implementation; separate refactors from
  behavior changes. A reproducible mechanical sweep gets its own review,
  regardless of size, with the reproducing command in its rationale.
- Keep files whole unless a modified file alone exceeds the budget; then split
  uncommitted hunks with `--select`, or use separate patches for committed parts. New, deleted, renamed,
  binary, and mode-changed files cannot be split; oversized ones get their own review.
- An oversized commit range needs a stack; split oversized commits further.

Name parts in order (`task-9a-schema`, `task-9b-server`). Start each rationale
with its place (“Task 9, part A of 3”) and say what each other part holds, by tab name.
Use separate commits when parts build and pass tests independently. Otherwise,
propose the same commit message on every part and commit exactly their captured
union once all are approved. If feedback changes one part's message, update only
that part with `comment summary` and use it for the commit.

To split existing commits, branches, or PRs, fetch the PR head if needed and
prepare separate patches. For a branch/PR, use
`git merge-base <landing-branch> <target>` as `<base>` to exclude newer landing
commits; include both names of renamed files. A background launch cannot read
stdin: launch unnamed on `HEAD --background --keep-alive` without `--comment`,
`--commit-message`, or `--why`. Pipe each part's
`git diff --full-index <base> <target> -- <paths>` to
`<launcher> review create <name> - --host <host> --port <port>`, then add comments
and summaries. Set the launch URL's `review` query to the first part. Require
every part's snapshot approval; `approval status <sha>` matches only whole-commit
patches.

## Handle one feedback batch

Start with delivered human events. For a manual resume, missing context, or the
final approval check, run `comment snapshot --host <host> --port <port>`. Save large
JSON privately in a temporary file; display only selected reviews' metadata,
pending human messages, and needed context. Do not dump full conversations,
diffs, or schemas repeatedly. Limit handoffs to IDs, versions, URLs, pending
revisions, and next actions.

Handle every unanswered human message, including Delivered, Read, Thinking,
Replying, and saved pending work; Queued alone misses unfinished claims. Replied
and Noted cover exact revisions; edits need a new answer or acknowledgement.

Record work before receipts. For receipts/replies, use the message's
`progress.cursor`, not the stream cursor. Send progress with `comment status` and answers in the original thread
with `comment reply`, which marks Replied. Use Noted only when no answer or work
remains. Resolve or delete threads only on request. Human message intent does
not expand authorization.
On HTTP 409, snapshot and reconcile. If conflicts repeat without new state or the
server is unreachable, preserve pending revisions, report the failed operation,
and hand back. Never retry an unchanged request or relaunch on a timer.

For unfamiliar payloads, read the command's `--help`. `schema <selector>` includes
all `$defs`: save it once and inspect only the needed definition and references.
Read additional protocol docs only for operations not covered here.

## Approval and completion

Read and honor the saved summary before committing. For Approve (`verdict: "approve"`),
read every human message (`origin: user` or absent) in threads without
`resolution.resolved: true`, including Replied/Noted messages, plus feedback outside gavel. Act on all requests, run checks and
independent Codex/Claude review, then commit and close the server as described below. If a request is impossible or
unclear, explain and do not commit. Nothing tracks completed comments; the
verdict stays until the user clears it.

For Reject (`verdict: "reject"`), do not revise, recapture, or commit. Ask in this
session what to do instead and whether to revert, explaining what each revert
step undoes; see the approval guide for steps. Close the server as described below.
Only the user clears Reject.
Put a new attempt in a new named review.

Button approval authorizes a commit, never a push. Immediately before committing,
read a fresh snapshot and require `approval.verdict: approve`. Approval follows
recaptures and summary edits; other sessions' staged hunks do not end it. Compare
the actual commit scope with the approved patch and feedback: shared-tree edits
gain no permission. Commit without asking again.

Close a server you launched once the user has given every review on it a verdict,
in gavel or in chat, and you have carried that verdict out: committed an Approve,
or asked about a Reject. A read-only (`--no-lgtm`) review counts once the user
says they are done with it; the unnamed `HEAD` bootstrap of a detached launch does
not count. Keep it running if the user asked you to. Send SIGTERM to the `pid`
from its `server.ready` or `server.background` record (`kill -TERM <pid>`), and
say in your report that you closed it. If a snapshot's `store.error` says changes
are not being saved, report it and ask before closing. Never stop another
session's server.

See the [approval guide](https://github.com/photostructure/gavel/blob/main/docs/approval-modes.md)
for verdict rules. When authorized work is done, end the turn until user feedback.
