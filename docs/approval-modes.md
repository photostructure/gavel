# Approval modes

The verdict buttons have two actions. **Approve** tells the agent to act on all
the current comments, run the required checks and reviews, and then commit.
**Reject** says the change is done with: the agent stops
and asks the user what to do instead. None of them authorizes a push, publication,
or unrelated changes.

Approval snapshots and `review.approval` events carry the reviewer's `verdict`,
which is absent until there is one:

- `verdict: "approve"`: act on the current comments, then commit once the required
  checks and reviews pass.
- `verdict: "reject"`: do not revise, recapture, or commit. See
  [acting on Reject](#acting-on-reject).
- No `verdict`: there is no verdict.

The nested `approval` object on approval events has the same fields as snapshots.
`PUT /api/approval` sets a verdict with `{"verdict": ...}` and the displayed
`captureVersion` and `patchDigest`, or the `diffDigest`; it returns HTTP 409 when
they are stale. Approve also requires the displayed `summaryVersion`; Reject does
not endorse the proposed message, so it ignores the summary.
`DELETE /api/approval` clears the verdict and requires no matching versions.

## Acting on Approve

1. Read every unresolved comment in `comment snapshot`, including ones already
   replied to, plus any feedback the reviewer gave in the session or outside gavel.
2. Act on all of them within the reviewed scope. Answer questions in their threads.
   If a request cannot be done or its meaning is unclear, explain the problem and
   do not commit.
3. Run the required checks and independent review.
4. Immediately before committing, read a fresh snapshot. Stop if the reviewer cleared
   the verdict or chose another, act on any feedback added since, and use the latest
   saved commit message.

Nothing records which comments are done, and the agent certifies nothing to the
server. Addressing a comment does not resolve or delete it. Keep the existing rule
to resolve or delete only on request. Permission does not extend to other changes
in a shared working tree.

## Acting on Reject

1. Do not revise, recapture, or commit the rejected change.
2. In the session that opened the review, ask the user what should happen instead,
   using the review's comments as context, and ask whether to revert.
3. Say what each revert step would undo, then act on the user's answer without
   asking again:
   - In a worktree of the agent's own: `git worktree remove --force <path>`, then
     `git branch -D <branch>`. `--force` deletes the worktree's uncommitted and
     untracked files for good. Deleting the branch also deletes its reflog, so its
     commits are recoverable only by the tip SHA, until `git gc` prunes them: put
     that SHA (`git rev-parse <branch>`) in the reply before deleting.
   - For unpushed commits the session made at the branch tip (`git branch -r
     --contains <oldest>` prints nothing): note the tip SHA, run
     `git reset --soft <oldest>^`, then
     `git diff --full-index <oldest>^ <tip> | git apply --cached -R`. The commits
     stay in the branch's reflog, and their changes stay in the working tree,
     unstaged, to redo. Reverse-applying only those commits' diff to the index keeps
     other sessions' staged hunks, even in the same files; a plain `git reset` or
     `git restore --staged` would unstage them. If `git apply` fails, it changes
     nothing: another session staged an edit that overlaps, so stop and tell the user
     that the rejected changes are still staged. If the user wants the changes gone
     instead, they are now uncommitted edits: see the next item. A pushed range, or
     one with another session's commit on top, gets a `git revert` commit instead,
     under the usual commit approval.
   - For uncommitted edits in a shared checkout, when the rejected change is a named
     review: run `gavel review unapply <name> --dry-run` and include its output in the
     question. If the name is ambiguous, that run lists each saved capture's digest
     instead: rerun the dry run with `--patch-digest <the rejected review's digest>` and
     include that output. On a yes, run `gavel review unapply <name> --patch-digest
     <digest>` with the dry run's `patchDigest`. It stores a stash of the tracked files,
     runs `git apply -R` on that capture's patch, and reports in `rejected` any hunk whose
     lines another session has since changed; `gavel review reapply <name> --patch-digest
     <digest>` undoes it ([details](cli.md#undo-a-named-reviews-change)).
     For any other review, ask how. `git stash push` takes whole files and resets the
     shared index, so it can take another session's work.
4. Put a new attempt up as a new named review. Only the reviewer clears a Reject,
   so a recapture of the rejected review would still show it rejected.

## When a verdict ends

**Approve** and **Reject** end only when the reviewer clears them or chooses
another verdict. New, edited, resolved, or reopened comments leave them in
place, and so do capture updates, diff changes, and the agent's summary edits
(only the agent writes the summary; the browser shows it read-only). Under Approve,
the approval's `captureVersion`, `patchDigest`, and `summaryVersion`
follow the current capture and summary, so a commit does not need them to match the
capture the reviewer first saw. A Reject keeps the versions of the capture it
rejected.

Because Approve follows the agent's revisions, the server does not check that the
committed change is the one the reviewer saw. For a `staged`, `working`, or `.`
review, hunks another session stages after the verdict do not end it either. The
agent commits only the reviewed scope and the fixes the comments asked for.

A restarted server that opens the same review restores its approval
([saved reviews](agent-conversations.md#saved-reviews)). Presence and browser
closure never grant approval.

Use `gavel schema approval` for the request schema.
