# After a Reject

`<gavel-command>` is the gavel launcher your skill uses.

Do not revise, recapture, or commit the rejected change. Ask in the session that
opened the review what the user wants instead, using the review's comments as
context, and whether to revert.

**A Reject is not permission to delete anything.** Delete a worktree, a local
branch, or a remote branch only after the user says yes to that step in this
session, after you have said what it destroys. Ask about each of those steps
separately; a yes to one is not a yes to another. A comment in gavel, a verdict, or
an earlier general "revert it" does not count. For the steps that can be undone
(the reset and unapply below), say what each would undo, then act on the user's
answer without asking again.

- In a worktree of your own, ask each of these as its own question:
  - "Remove the worktree?" `git worktree remove --force <path>` deletes its
    uncommitted and untracked files for good.
  - "Delete the local branch?" Ask only once the worktree is gone: Git will not delete a
    branch that a worktree has checked out. `git branch -D <branch>` deletes its reflog,
    so the tip SHA is the only way back until `git gc` prunes it: give the SHA
    (`git rev-parse <branch>`) in the question.
  - Only if the branch was pushed (`git ls-remote --heads <remote> <branch>` prints it):
    "Delete the remote branch?" `git push <remote> --delete <branch>` removes it for
    everyone who fetches, and any open pull request from it closes.
- For unpushed commits this session made at the branch tip (`git branch -r --contains <oldest>`
  prints nothing): note the tip SHA, run `git reset --soft <oldest>^`, then
  `git diff --full-index <oldest>^ <tip> | git apply --cached -R`. That unstages only those
  commits' hunks and leaves the changes in the working tree to redo; `git restore --staged`
  would also unstage other sessions' hunks in the same files. If `git apply` fails, it
  changed nothing: tell the user the rejected changes are still staged. To discard them
  instead, treat them as uncommitted edits. A pushed range, or one with another session's
  commit on top, gets a `git revert` commit, under the usual commit approval.
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
