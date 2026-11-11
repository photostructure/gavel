---
name: gavel
description: Open a requested diff in gavel with reading-guide comments and a proposed commit message. Use for an explicit gavel/viewer request, skill invocation, or standing gavel-review instruction. Ordinary code reviews belong in chat.
---

# Gavel

Open the requested diff, guide the reader, and handle feedback within the approved
scope. A viewer request alone grants no edit or commit permission. Do not post PR
findings to GitHub. Make authorized fixes only in the owning checkout.

## Token use: zero idle model turns

Human review must cause zero idle model turns. A review can stay open for hours;
repeated checks spend tokens even when nothing changes. Treat this as a hard
execution constraint, not a preference for shorter replies.

- Start work only for a user message or actual human review feedback. An open
  review, connected browser, empty result, timeout, or process exit is not work.
- Never poll, sleep between checks, schedule a monitor, or keep a subagent alive
  to wait for review. Do not read unchanged snapshots or process output on a timer.
- In Codex, always hand back and end the turn; do not run `gavel wait`. Other hosts
  may use one silent background waiter only under the capability rules below.
- Read one snapshot per server on resume. Read another only for newly delivered
  human feedback, a version conflict, or the final approval check before commit.
- If recovery repeats without new state, or a waiter returns no actionable human
  feedback, preserve pending work, report the problem, and end the turn. Never
  restart a failed or timed-out wait in a loop.

## Choose the scope

- With no named target, show this session's uncommitted paths and hunks in a named
  review. Exclude other sessions' work, including changes in the same file.
- If this session's work is already committed, list its short SHAs and subjects
  and ask whether to show them. Use each commit's own message; for a range, use
  one subject per line. Keep approvals enabled until the commits reach their
  landing branch (`git merge-base --is-ancestor <sha> <base>` exits 1); use
  `--no-lgtm` once they have landed.
- For a named branch, commit, range, or PR (`--pr <url>`), review for defects
  before launching. Seek approval by default; use `--no-lgtm` when the user
  explicitly requests read-only review or every target commit has already landed.
- Show one commit as `<sha>`; show consecutive commits as
  `<last-sha> <first-sha>^` for one approval, or as a stack for separate approvals.
  If unrelated commits intervene, name them and ask whether to include them or
  show this session's commits separately. Use immutable SHAs when approval matters.

## Size and group reviews

Honor the user's grouping, including a request for one whole diff. Otherwise aim
for about 300 weighted changed lines per review, without a fixed file-count
ceiling. Count additions and deletions in the reviewed patch with
`git apply --numstat < <patch>`. For native tracked changes use
`git diff --numstat HEAD -- <paths>`; for commits use `<base> <target>` instead
of `HEAD`. Add the lines in scoped untracked text files; Git diff omits them.
Count only included paths/hunks, not unrelated shared-tree changes. Apply these weights:

| Content                                   | Weight per line |
| ----------------------------------------- | --------------: |
| Tests                                     |             0.2 |
| Configuration                             |             0.5 |
| Complicated SQL, concurrency, native code |             1.5 |
| Lockfiles, generated or vendored files    |               0 |
| Other                                     |               1 |

This line budget and its weights are planning heuristics, not validated cutoffs. Consider
raw added/deleted lines too; discounts must not hide the reading burden. Zero
weight covers reproducible mechanical output, not AI-written code or prose.
The [Cisco study](https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf)
favors a few hundred inspected lines; [Google's guidance](https://google.github.io/eng-practices/review/developer/small-cls.html)
prioritizes a self-contained change and warns against splitting too finely.

Split larger changes by purpose, in dependency order. Keep tests, docs, and plans
with their implementation; separate refactors from behavior changes. Each review
needs one purpose, not a catch-all such as “misc” or “cleanup.” Keep files whole
unless a modified file alone exceeds the budget; then split its hunks, with
`--select` for uncommitted work or a separate patch per part for committed work.
A new, deleted, renamed, binary, or mode-changed file cannot be split, so one over
the budget gets its own review.
A reproducible mechanical sweep gets its own review regardless of size; put the
command in its rationale. An oversized commit range needs a stack, with oversized
commits split further.

Name related parts in order, such as `task-9a-schema` and `task-9b-server`. Start
each rationale with its place (“Task 9, part A of 3”) and refer to other parts by
tab name. Make separate commits when parts build and pass tests independently.
Otherwise use one commit across reviews, the same proposed message on each, and
commit exactly their captured union after every part is approved. When a comment
asks for a different message on one part, write it to that part only with
`comment summary`: copying it to the others would revoke their Approve as-is.

## Prepare and launch

Use the launcher prescribed by the user or repository as `<gavel-command>`.
If neither prescribes one, locate an installed executable and verify its owning
package is `@photostructure/gavel`; report absence rather than install or guess.
Run from the reviewed Git root. Check `--version` and `--help` for `--review`,
`--background`, and `--jsonl`; use the same build for all commands.
Report missing capabilities instead of switching or installing packages. The
unscoped `gavel` package is an unrelated HTTP validator; `difit` is upstream's viewer.

Before a review you initiate, run `<gavel-command> idle` once. A nonzero exit or
`idleMs >= 600000` means do not launch. Finish tests and independent review, report
that the change is ready, and end the turn. Do not poll for the user's return.
Skip this check when the latest user message explicitly asks for the review.

For uncommitted work:

```sh
<gavel-command> --review <task-name> --title '<short description>' --keep-alive
```

Pass `--title` on every launch. Keep it short: browsers only show the first 10-20
characters.

Names contain 1–80 ASCII letters, digits, dots, underscores, or hyphens and start
with a letter or digit. Repeat `--pathspec <git-pathspec>` for native Git filters
and exclusions; add `--include-untracked` when needed. Verify the captured patch
matches the requested scope. Capture operations leave the index and files intact.
For commits, use `<gavel-command> <target> [base]`; unnamed `.`, `working`, and
`staged` targets remain available.

To select overlapping hunks, capture once and use that artifact's catalogue IDs:

```sh
<gavel-command> review capture --pathspec src --output /tmp/capture.json
<gavel-command> --review parser-fix --capture /tmp/capture.json --select '<hunk-id>' --keep-alive
```

Repeat `--select` for files or hunks. IDs belong to the artifact's digest and
repository root; binary and rename-only changes require file IDs. Import a patch
with `<gavel-command> - --review <name> < <patch>`. Pathspecs and untracked-file
options apply only to native captures. If external clean/process filters block
capture, including in submodules, narrow the paths or explicitly prepare a patch
or capture artifact.

Retain a foreground server's process handle. Read `server.ready` for its API port,
PID, and review identity. Share `launchUrl`, including its editor-session fragment;
Use the host and API port from the launch URL for every companion command,
never Vite's UI port. JSONL is the default;
diagnostics go to stderr. Named reviews and JSONL require conversation APIs.
An unnamed review can disable both with `--no-jsonl --no-conversation`.
Use `--keep-alive` for review rounds and `--no-lgtm` for read-only reviews.

`--background` detaches, opens no browser, and prints `server.background`; its
`url` is the launch URL. It has no live stdout: recover state through snapshots.
A named background launch cannot read stdin. For a detached patch review, launch
unnamed on `HEAD --background --keep-alive` without `--comment`, `--commit-message`,
or `--why`, so the bootstrap does not become a review tab. Create the named review
from stdin, add its comments and summary, and set the URL's `review` query parameter
to its name.

The About panel identifies the launching agent/session from the host environment
and, for Codex, its rollout. Override incorrect or missing values with `--agent`
and `--agent-session-id`; a nested `claude -p` inherits its parent's entrypoint, so
pass `--agent`. Set `--agent-session-name` only when the title is known. Reusing a
server retains its launching session's identity.

## Add reviews and refresh captures

Use one server and share one link; tabs follow creation order. Add uncommitted
work with `review create <name> --host <host> --port <port> [--pathspec ...]`. It returns a
`reviewId`. Launch comment and summary options affect only the first review: give every added review
its own `comment add --review <name>` comments and `comment summary` proposal.

For existing commits, launch the first SHA with its message and `--keep-alive`.
Add later commits in order:

```sh
git diff --full-index <sha>^ <sha> | <gavel-command> review create <name> - --host <host> --port <port>
```

The `-` is required; without it, `review create` exits with an error.
Each approval covers its own review. Approving an existing commit permits landing
it; requested fixes belong in new reviewed commits. Do not amend or rebase the
reviewed commits without permission; remote-reachable commits remain immutable.

To split an existing commit, branch, or PR, fetch the PR head if needed and use
`git diff --full-index <base> <target> -- <paths>` for each part. For a branch or
PR, `<base>` is `git merge-base <landing-branch> <target>`, which keeps the landing
branch's newer commits out of the parts and the size count. List both names of a
renamed file. Pipe the first patch to `<gavel-command> - --review <name> --keep-alive` and later patches to
`review create <name> - --host <host> --port <port>`. Use the detached procedure above when needed.
Landing requires every part's snapshot approval; `approval status <sha>` matches
only a whole-commit patch.

Named captures are frozen; edits and browser reloads do not refresh them. Before
`review update <name> --host <host> --port <port> --expected-version <n>`, read
`GET /api/reviews/<name>`. Preserve the intended scope: pass `-` for a supplied
patch, repeat the native `--pathspec` and `--include-untracked` options, or use
`--capture` with selectors.
Without a patch source or filters, update captures the whole uncommitted tree;
it does not reuse the original options. Reconcile HTTP 409 before retrying. An identical patch preserves version and
approval; a changed patch advances the version and invalidates as-is approval.
Do not recapture while idle.

Reopening the same named patch or commits restores saved conversations, proposals,
and approval, but review IDs and event cursors change. Snapshot before sending
status, replies, or summaries. Report `store.error`: review changes are not being
saved. `approval status <sha>` also reads saved approval after server shutdown.

## Guide the reader

Every review, including read-only reviews, needs reading-guide comments and a
summary. Preload repeatable `--comment` arguments or use `comment add` on an
existing server. Discover payloads with `schema import` and command `--help`.

```sh
<gavel-command> <target> [base] --keep-alive \
  --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":36},"body":"Start here: ..."}'
```

Use `old` for deletions, `new` for target lines, and a line number or
`{"start":36,"end":39}` range. Anchor one point per comment:

- Give a starting point and reading order unless the diff is one hunk.
- Explain non-obvious reasons, intentional oddities, moved replacements, indirect
  tests, and mechanical changes the reader can skim.
- Label suggested refactors as suggestions and explain why they would help.
- Prefix verified defects with “Finding:” to distinguish them from navigation.

On a review longer than a few hunks, link the comments into a tour. Give each
thread an `id` unique across the server's reviews (prefix the review name) and link
in Markdown: `[next](#thread=<id>)`, `[parser](#file=<path>&line=40-52)` (add
`&side=old` for deleted lines), or `[API half](?review=<name>#thread=<id>)`. Back
returns to the linking comment, and a link gavel cannot follow shows a notice. A
named review holds only its captured hunks; link only to lines inside them. End
`--why` with the tour's first link, such as `Start here: [parser](#thread=<id>)`;
the rationale renders the same Markdown.

Skip self-explanatory lines, use the user's language, and keep credentials out.
Supply `--commit-message` as a Conventional Commit and `--why` as one to three
sentences explaining the problem and solution. For others' work, identify inferred
intent. For added reviews, send `comment summary` JSON on stdin:
`{reviewId,commitMessage,rationale,baseVersion}`. Read `summary.version` from a
snapshot for `baseVersion`; do not assume 0 because saved proposals may exist.
Changed summaries revoke Approve as-is. Commit with the saved summary; when a
comment asks for a different message, write it with `comment summary` first.

## Handle feedback

Read [feedback and snapshot commands](references/feedback.md) before handling a
batch or resuming a review. Use its filtered snapshot during review; reserve the
full snapshot for the final approval check. Read new foreground JSONL between
tool steps. There is no `comment watch` command.

Handle human comments and edits; agent events, capture/progress/thread changes,
and deletions update state but do not request work. Save IDs, revision cursors,
and pending work before acknowledging messages. Output alone is not a receipt.
Answer every pending comment with `comment reply`, or mark it `noted` with
`comment status` if no answer is needed. Replies and Noted do not resolve threads;
resolve or delete only on request. Comment intent does not grant authorization.
Reconcile a snapshot after missed output, restart, or HTTP 409.

## Wait or hand back

Never wake a model on a timer to check a review. Use only `<gavel-command> wait`,
in the main session, when the host both delivers background completion to a new
turn and imposes no background deadline. Read the host tool's lifetime rules.
Otherwise use a detached server, record pending work, and end the turn. Give the
URL and tell the user to paste **Copy resume prompt** into this chat or send a
message here when ready to continue. Explain that the button only copies text;
it does not resume the agent. Do not promise listening without host delivery.

No polling loops, sleeps, timed foreground waits, expiring Monitors, or custom
waiters. Never re-arm a waiter killed by a host deadline. Subagents never wait:
return a launch command and capture artifact, or a detached server's URL, review
IDs, API port, and pending work to the main session.

Before arming a supported waiter, read [the waiting procedure](references/waiting.md).
After handling a batch, preserve its cursor and pending work. On a supported
host, re-arm one waiter as the procedure directs; otherwise hand back with the
URL and resumption instructions. Do not reread an unchanged snapshot.

## Act on verdicts

Read a fresh snapshot before acting: the user can clear or switch a verdict.

| Verdict                                             | Action                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| Approve as-is: `verdict: "as-is"`                   | Verify final scope and commit prerequisites below.                 |
| Approve after comments: `verdict: "after-comments"` | Act on all current comments, then commit.                          |
| Reject: `verdict: "reject"`                         | Stop: do not revise, recapture, or commit. Ask what to do instead. |
| No verdict (`verdict` absent or `null`)             | Await the user.                                                    |

For Approve after comments, read every entry in the filtered snapshot's
`comments`, plus any feedback in this session or outside gavel, and act on all
of them, including any added before the final snapshot. If a request cannot be
done or its meaning is unclear, explain the problem and do not commit. Nothing
tracks which comments are done, and the verdict stays until the user clears it.
See the
[approval guide](https://github.com/photostructure/gavel/blob/main/docs/approval-modes.md).

After Reject, ask in this session what the user wants instead, using the review's
comments as context, and whether to revert. Say what each revert step would
undo, then act on the user's answer without asking again:

- In a worktree of your own: `git worktree remove --force <path>`, then
  `git branch -D <branch>`. `--force` deletes uncommitted and untracked files for good,
  and deleting the branch deletes its reflog: give the tip SHA (`git rev-parse <branch>`)
  in your reply first, since it is the only way back until `git gc` prunes it.
- For unpushed commits this session made at the branch tip (`git branch -r --contains <oldest>`
  prints nothing): note the tip SHA, run `git reset --soft <oldest>^`, then
  `git diff --full-index <oldest>^ <tip> | git apply --cached -R`. That unstages only those
  commits' hunks and leaves the changes in the working tree to redo; `git restore --staged`
  would also unstage other sessions' hunks in the same files. If `git apply` fails, it
  changed nothing: tell the user the rejected changes are still staged. To discard them
  instead, treat them as uncommitted edits. A pushed range, or one with another session's commit on top,
  gets a `git revert` commit, under the usual commit approval.
- For uncommitted edits in a shared checkout from a named review: put the output of
  `<gavel-command> review unapply <name> --dry-run` in your question. If the name is
  ambiguous, that run lists each saved capture's digest instead: rerun the dry run with
  `--patch-digest <the rejected review's digest>` and put that output in the question. On a
  yes, run `review unapply <name> --patch-digest <patchDigest from the dry run>`. It runs
  `git apply -R` on that capture's patch, after a stash of the tracked files. `refused` means
  nothing changed; `rejected` lists hunks it left in place: report either. `review reapply
  <name> --patch-digest <digest>` undoes it. For other reviews, ask how:
  `git stash push` takes whole files and resets the shared index, so it can take another
  session's work.

Only the user clears a Reject. Never recapture a rejected review; put a new attempt
up as a new named review.

Approve as-is or Approve after comments on a review you opened is
commit approval. After comments, required checks, and independent Codex/Claude
LAND on final code, read a fresh full snapshot immediately before committing.
Require `approval.verdict` to be `as-is` or `after-comments`; for named captures approved as-is,
also match:

- `approval.captureVersion` to `capture.version`;
- `approval.patchDigest` to `capture.patchDigest`;
- `approval.summaryVersion` to `summary.version`.

Commit only the approved capture and requested fixes, using the saved message.
Shared-tree edits gain no approval. Commit approved parts in dependency order;
parts that must land together require every approval before their single commit.
Revocation invalidates button approval; after restart, only fresh state counts.
Separate chat approval is independent. Silence or tab closure is not approval.
Approval never authorizes pushing or publishing.

Protocol details: [agent conversations](https://github.com/photostructure/gavel/blob/main/docs/agent-conversations.md).
