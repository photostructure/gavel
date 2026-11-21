---
name: gavel
description: Open a requested diff in gavel with reading-guide comments and a proposed commit message. Use for an explicit gavel/viewer request, skill invocation, or standing gavel-review instruction. Ordinary code reviews belong in chat.
---

# Gavel

Open the requested diff, guide the reader, and handle feedback within the approved
scope. A viewer request alone grants no edit or commit permission. Do not post PR
findings to GitHub. Make authorized fixes only in the owning checkout.

Before selecting hunks, importing a patch, stacking or splitting commits, branches,
or PRs, launching a detached server, or refreshing, renaming, withdrawing,
deleting, or reopening a review, read [captures, stacks, and detached servers](references/reviews.md).

## Never wait for the user

After sharing a review, end the turn. The user's feedback reaches you as a new
message: gavel sends it to your inbox, or, without one, the user sends it (see
[Wait for feedback](#wait-for-feedback)). Either way nothing needs watching.
Every check you make rereads this whole conversation, so a wait spends tokens
and finds nothing that message would not bring.

NEVER DO ANY OF THE FOLLOWING:

- run `<gavel-command> wait`, `sleep`, `watch`, or a `for`/`while`/`until` loop
  that reruns `comment snapshot`, `pending`, `curl`, or any other check;
- block on the server's output, `tail -f` it, or hold open a long-poll, event
  stream, or WebSocket until review activity arrives;
- start a background command, Monitor, ScheduleWakeup, `/loop`, cron job, or
  subagent to wait for review activity;
- reread an unchanged snapshot or process output on a timer;
- run any other command, script, or tool call that blocks or repeats until
  review activity appears.

Running the gavel server itself in the background is not waiting.

Work only on user messages or delivered review feedback. An open review,
connected browser, empty result, timeout, or process exit is not work.

Read one snapshot per server on resume; read another only for newly delivered
feedback, version conflicts, or the final approval check. If recovery repeats
without new state, preserve pending work, report the problem, and end the turn.

## Choose the scope

- With no named target, show this session's uncommitted paths and hunks in a named
  review. Exclude other sessions' work, including changes in the same file.
- If this session's work is already committed, list its short SHAs and subjects
  and ask whether to show them. Use each commit's own message; for a range, use
  one subject per line.
- For a named branch, commit, range, or PR (`--pr <url>`), review for defects
  before launching.
- Seek approval by default. Use `--no-lgtm` when the user explicitly requests a
  read-only review, or once `git merge-base --is-ancestor <sha> <base>` exits 0
  for every target commit (it exits 1 for an unlanded one).
- Show one commit as `<sha>`; show consecutive commits as
  `<last-sha> <first-sha>^` for one approval, or as a stack for separate approvals.
  If unrelated commits intervene, name them and ask whether to include them or
  show this session's commits separately. Use immutable SHAs when approval matters.
- Fixes belong in new reviewed commits; do not amend or rebase reviewed commits
  without permission. Remote-reachable commits remain immutable.

## Size and group reviews

Honor the user's grouping, including one whole diff. Otherwise aim for about
300–500 weighted changed lines per review, unless the user's instructions give
another size, with no file-count cap: additions plus
deletions from `git diff --numstat HEAD -- <paths>` (`<base> <target>` for
commits, `git apply --numstat < <patch>` for a patch),
plus scoped untracked text lines, excluding unrelated paths and hunks. Weights:
tests 0.2, config 0.5, complicated SQL/concurrency/native code 1.5, lockfiles and
reproducible generated/vendored output 0, everything else 1. AI-written code and
prose are not generated output. This is a heuristic: discounts must not hide the
reading burden.

Split larger changes by purpose, in dependency order. Keep tests, docs, and plans
with their implementation; separate refactors from behavior changes. Each review
needs one purpose, not a catch-all such as “misc” or “cleanup.” Keep files whole
unless a modified file alone exceeds the budget. A new, deleted, renamed, binary,
or mode-changed file cannot be split, so one over the budget gets its own review.
Show an oversized commit range as a stack. A reproducible mechanical sweep
gets its own review regardless of size; put the command in its rationale.

Name related parts in order, such as `task-9a-schema` and `task-9b-server`. Start
each rationale with its place (“Task 9, part A of 3”) and refer to other parts by
tab name. Make separate commits when parts build and pass tests independently.
Otherwise use one commit across reviews, the same proposed message on each, and
commit exactly their captured union after every part is approved. When a comment
asks for a different message on one part, write it to that part only with
`comment summary`; the other parts keep the message their reviewer saw.

## Prepare and launch

Use separate servers for Claude Code and Codex. Never add either host's reviews
to the other's server: final-verdict handoff follows the launching host.

Run from the reviewed Git root. Use the prescribed launcher as `<gavel-command>`.
If none is prescribed, locate an installed executable and verify its package is
`@photostructure/gavel`; report absence rather than install or guess. Check
`--version` and `--help` for `--review`, `--background`, and `--jsonl`. Use that
build throughout; report missing capabilities. The unscoped `gavel` package is
an unrelated HTTP validator; `difit` is upstream's viewer.

Before a review you initiate, run `<gavel-command> idle` once. A nonzero exit or
`idleMs >= 3600000` (one hour) means do not launch: finish tests and independent review,
report readiness, and end the turn. Do not poll. Skip this check when the latest
user message explicitly requests review.

For uncommitted work:

```sh
<gavel-command> --review <task-name> --title '<short description>' --keep-alive
```

Pass `--title` on every launch. Keep it short: browsers only show the first 10-20
characters. Names contain 1–80 ASCII letters, digits, dots, underscores, or
hyphens and start with a letter or digit. Repeat `--pathspec <git-pathspec>` for
native Git filters and exclusions; add `--include-untracked` when needed. Verify
the captured patch matches the requested scope. Capture operations leave the
index and files intact. For commits, use `<gavel-command> <target> [base]`;
unnamed `.`, `working`, and `staged` targets remain available.

Retain a foreground server's process handle. Read `server.ready` for the API
port, PID, and review identity; give the user `launchUrl` unchanged. Its
`#gavel-token=…` fragment is the access token; without it the page shows only an
access screen. Put the whole link, token included, in your reply: the token
belongs in the session transcript, and the user cannot open the review without
it. Never shorten, redact, or drop the fragment. Use that host/API port for
companion commands, never Vite's UI port.
JSONL is the default; diagnostics go to stderr. Named reviews and JSONL require
conversation APIs; unnamed reviews can disable both with `--no-jsonl --no-conversation`.
Use `--keep-alive` for review rounds and `--no-lgtm` for read-only reviews.

Pass `--agent` for nested `claude -p`, which inherits the parent entrypoint. If
**About** names the wrong agent or session, read
[agent identity](references/reviews.md#agent-identity).

## Add reviews

Use one server and share one link; tabs follow creation order. Add uncommitted
work with `review create <name> --host <host> --port <port> [--pathspec ...]`. It
returns a `reviewId`. Launch comment and summary options affect only the first
review: give every added review its own `comment add --review <name>` comments and
`comment summary` proposal.

Named captures are frozen; edits and browser reloads do not refresh them. Never
recapture while idle. Do not restart to remove one review: that removes every
review's comments from the page. To pull back a review you shared, such as one a
later review supersedes, run `review withdraw <name> --reason '<why>'`
rather than deleting it. Never rename, withdraw, or delete another session's review.
Report `store.error`: review changes are not being saved.

## Guide the reader

Every review, including read-only reviews, needs a summary and reading-guide
comments. Use repeatable `--comment` arguments or `comment add` on a running
server. Discover payloads with `schema import` and command `--help`. Omit
`author` here and in replies: gavel names your comments after the agent host
that launched the server.

```sh
<gavel-command> <target> [base] --keep-alive \
  --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":36},"body":"Start here: ..."}'
```

Anchor one point per comment, using `old` for deletions or `new` for target lines
and a line number or `{"start":36,"end":39}`. In a named review, anchor inside one
hunk, numbered as its patch numbers them; gavel refuses the whole import otherwise
and lists that file's hunk ranges. Give a starting point and reading order unless
the diff is one hunk. Explain non-obvious reasons, oddities, moved replacements,
indirect tests, and skippable mechanical changes. Label proposed refactors as suggestions
with reasons; prefix verified defects with “Finding:”. Skip self-explanatory
lines, use the user's language, and exclude credentials.

For more than a few hunks, link comments into a tour. Prefix thread `id`s with
the review name so they are unique across the server. Links can target
`[next](#thread=<id>)`, `[parser](#file=<path>&line=40-52)` (add `&side=old` for
deletions), or `[API half](?review=<name>#thread=<id>)`. Back returns to the source;
unfollowable links show a notice. Link only to captured hunks. End `--why` with
the tour's first link, such as `Start here: [parser](#thread=<id>)`.

Supply a Conventional Commit via `--commit-message`, and via `--why` the summary
that [the `--why` summary](references/summary.md) describes. Identify inferred
intent for others' work. For added reviews, send `comment summary` JSON on stdin:
`{reviewId,commitMessage,rationale,baseVersion}`. Read `summary.version` from a
snapshot; saved proposals mean `baseVersion` may not be 0. Commit with the saved
message; write requested message changes with `comment summary` first.

## Handle feedback

Read [feedback and snapshot commands](references/feedback.md) before handling a
batch or resuming a review. Read new foreground JSONL between tool steps. There
is no `comment watch` command.

Handle human comments and edits; agent events, capture/progress/thread changes,
and deletions update state but do not request work. Save IDs, revision cursors,
and pending work before acknowledging messages. Output alone is not a receipt.
Answer every pending comment with `comment reply`, or mark it `noted` with
`comment status` if no answer is needed. Replies and Noted do not resolve threads;
resolve or delete only on request. Comment intent does not grant authorization.

## Wait for feedback

Record pending work, share `launchUrl` (or the background record's `url`), and end
the turn. Do not wait in any form [listed above](#never-wait-for-the-user).

In Claude Code, servers launched with `CLAUDE_CODE_MESSAGING_SOCKET` and
`CLAUDE_CODE_SESSION_ID` in the Bash environment send human verdicts/comments to
that session's inbox. This includes `--background` and added reviews. Tell the
user verdicts arrive automatically unless `crossSessionInbound` is `hold` or
`refuse`, or unset while the session bypasses permissions; Claude may withhold
those messages. Notifications start `gavel: new review activity` and contain
human events since the previous message. Handle them as feedback batches;
read a fresh snapshot before acting on a verdict. The notification itself is
not approval. Subagent-launched reviews report to the main session.

If the user reports missing feedback, run `<gavel-command> pending` once to see
activity that failed delivery. Without those variables, with inbound messages
held/refused, with `--no-conversation`, or in another host, follow
[feedback and snapshot commands](references/feedback.md#without-an-inbox).

Subagents never wait: return a launch command and capture artifact, or a detached
server's `url` with its token fragment, review IDs, API port, and pending work to the main session.

## Act on verdicts

Read a fresh snapshot before acting; the user can clear or switch a verdict.

- **Approve** (`verdict: "approve"`): act on every user message in unresolved
  threads, including messages added before the final snapshot, plus feedback
  outside gavel. Then commit, and close the server as described below. If a request is impossible or unclear, explain
  and do not commit. Nothing tracks completed comments; the verdict stays until
  cleared.
- **Reject** (`verdict: "reject"`): follow [references/reject.md](references/reject.md),
  and close the server as described below.
- **No verdict** (absent or `null`): await the user.
- **Withdrawn** (`withdrawal` present): you pulled it back. Any verdict it has
  authorizes nothing; do not commit it.

Approve on your review authorizes a commit. After addressing comments, passing
required checks, and independent Codex/Claude reviewers LAND the final code,
read a fresh `comment snapshot --review <review>` immediately before committing;
require `approval.verdict: approve`. Approval follows recaptures and summary edits;
other sessions' staged hunks do not end it.

Commit only the approved capture and requested fixes, using the saved message.
Shared-tree edits gain no approval. Commit independent parts in dependency order;
parts that must land together need every approval before their single commit.
Clearing a verdict ends button approval; after restart, only fresh state counts.
Chat approval is independent. Silence or tab closure is not approval. Approval
never authorizes pushing or publishing.

Close a server you launched once every review on it is withdrawn or has a verdict
from the user, in gavel or in chat, and you have carried that verdict out: committed an Approve,
or asked about a Reject. A read-only (`--no-lgtm`) review counts once the user
says they are done with it; the unnamed `HEAD` bootstrap of a detached launch does
not count. Keep it running if the user asked you to. Send SIGTERM to the `pid`
from its `server.ready` or `server.background` record (`kill -TERM <pid>`), and
say in your report that you closed it. If a snapshot's `store.error` says changes
are not being saved, report it and ask before closing. Never stop another
session's server.

For anything else, read `<gavel-command> --help` and `<gavel-command> <command> --help`.
