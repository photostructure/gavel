---
title: Replace Not yet with a final Reject verdict, and let agents unapply a rejected review
section: Approval
---

# TPP: Reject verdict and `gavel review unapply`

## Summary

The maintainer never clicked **Not yet** in its first two days, because comments
already send a review back. They still need a way to record "no" on one review in a
batch: without a verdict, the follow-up countdown keeps bringing them back to it.
**Not yet** becomes **Reject**, and Reject means the change is done with: only the
reviewer clears it, and the agent stops, asks what the user wants instead, and asks
whether to revert. The verdict becomes the only verdict field in the approval JSON,
and a new `gavel review unapply` reverses exactly a named review's hunks in a shared
checkout without touching other sessions' edits.

This supersedes [2026-11-07-approval-verdict-field.md](../_done/2026-11-07-approval-verdict-field.md)
and [2026-11-09-clarify-conditional-approval-state.md](../_done/2026-11-09-clarify-conditional-approval-state.md),
and the first plan's unmerged branch `tpp/verdict-field` (562fddd). That commit conflicts with
main in 22 files, so it serves only as a list of call sites and tests to cover.

## Current phase

Complete.

- [x] Commit 1: Reject verdict, `verdict` as the only field, GET/PUT/DELETE routes (daeadd8)
- [x] Commit 2: `gavel review unapply` and `gavel review reapply` (dfed24d)

## Required reading

- **AGENTS.md**
- **docs/approval-modes.md**: what each verdict means and what clears it
- `git show 562fddd`: the earlier verdict-field change, for call sites

## Decisions

Made by the maintainer in conversation on 2026-11-09 and 2026-11-10:

- Keep a "no" verdict, renamed **Reject**, in violet, with the token renamed to
  `--color-verdict-reject`.
- Reject is final for those diffs: only the reviewer clears it. A recapture, a summary
  change, or a diff change does not.
- After Reject the agent does not revise or commit. It asks the user what should happen
  instead, asks whether to revert, and says what a revert would affect.
- `verdict?: 'as-is' | 'after-comments' | 'reject'` is the only verdict field;
  `approved`, `requested`, `mode`, and `notYet` go away.
- Routes: `GET`, `PUT`, `DELETE /api/approval?<selection>`. PUT sets the verdict with
  the existing version and digest preconditions; DELETE clears it.
- Revert in a separate worktree removes the worktree and deletes its branch. Unpushed
  tip commits this session made are undone and redone; the skill uses `git reset --soft`
  and then reverse-applies only those commits' diff to the index
  (`git diff <oldest>^ <tip> | git apply --cached -R`). A plain `git reset`, or
  `git restore --staged` on the changed files, also unstages other sessions' staged
  hunks in them (probed 2026-11-10).
- Revert in a shared checkout: a gavel subcommand (accepted as recommended) that wraps
  `git apply -R`. The maintainer rejected a first version that merged each file with
  `git merge-file` to keep nearby edits by other sessions: it re-implemented `git apply`
  in about 600 lines. The recovery stash is an emergency snapshot of whole files; edits by
  other sessions in the same files need no special handling (maintainer, 2026-11-10).
- When another session's edit is within 3 lines of a hunk, as with adjacent CHANGELOG
  bullets, unapply stashes and then reverts what it can (`git apply -R -C0 --reject`)
  instead of refusing, and reports the hunks left in place (maintainer, F1-10 A,
  2026-11-10). Files with a hunk that adds no lines keep the context check
  (`git apply -R --reject`), because `-C0` puts a reversed deletion at its old line
  number, and so does every file on reapply (maintainer, F1-11 A, 2026-11-10).
- Edits are made in the primary checkout so the maintainer can test them there.

- The agent asks once whether to revert, saying what each step would affect (uncommitted
  changes or branch commits that would be lost). The user's answer in the session is
  enough; there is no second "are you sure", for any step.

## Commit 1 tasks

1. Types: `ReviewApproval.verdict`; drop `approved`, `requested`, `mode`, `notYet`, and
   the top-level `approved` on `review.approval` events. Saved reviews from earlier
   versions are not migrated: they restore without a verdict, keeping their old
   `approved` and `mode` fields, which nothing reads (the maintainer, in review, on
   2026-11-10: no one else uses gavel yet).
2. `src/server/conversation.ts`: Reject is cleared only by the reviewer; as-is is still
   revoked by recapture, summary change, and diff change; after-comments is unchanged.
3. `src/server/server.ts`: GET/PUT/DELETE `/api/approval`; 409 for a stale view, 400
   for an unknown verdict; remove POST, `/conditional`, `/not-yet`.
4. CLI: `src/cli/schema.ts`; `gavel approval status` rows drop their top-level `approved`
   and `name` (read `approval.verdict` and `selection.reviewName`);
   `scripts/host-wait-e2e/run.sh`.
5. Client: `useReviewApproval`, `utils/verdict.ts`, `VerdictControl`, `ReviewQueueBar`,
   `App.tsx`; token and classes in `global.css` and `appearanceTheme.ts`.
6. SKILL.md (three copies), `docs/approval-modes.md`, `docs/agent-conversations.md`,
   `docs/waiting-for-review.md`, CHANGELOG (rewrite the violet line; breaking
   `### Changed`), and the stale "red" in `2026-11-07-review-verdicts.md`.

## Commit 2 tasks

- [x] `gavel review unapply <name> [-] [--dry-run] [--patch-digest <digest>]` and
      `gavel review reapply`, in `src/cli/unapply.ts`: a wrapper around `git apply -R` (and
      `git apply`) on the named review's saved capture, read from `<git-common-dir>/gavel`
      (no server needed), or a patch on stdin with `-`. Unapply refuses while the capture's
      paths are staged and does not change what is staged; before writing, both store a
      `git stash create` snapshot of the tracked files. When the exact apply fails, unapply
      runs `git apply -R -C0 --reject` (`-R --reject` for files with a hunk that adds no
      lines) and reapply `git apply --reject`, reporting the hunks left in place.
- [x] Tests (`src/cli/unapply.test.ts`) and CLI wiring tests (`src/cli/review.test.ts`).
- [x] Skill, `docs/approval-modes.md`, `docs/cli.md`, CHANGELOG.
- [x] Second-opinion review, then gavel with a manual test script.

## Lore

- `git merge-file -p --object-id <current> <after> <before>` reversed one session's
  edit on line 5 and kept another session's edits on lines 8 and 15 (exit 0); `git
  apply -R` of the same patch failed, because line 8 sat in its context. An edit on
  line 6 made `merge-file` exit 1 with conflict markers. Probed in a scratch repo on
  2026-11-10.
- `git stash push -- <paths>` resets the shared index for those paths, so it can
  unstage another session's staged changes; the shared-checkout revert avoids it.
- No agent tool found reverts only its own hunks: Claude Code `/rewind`, Cursor and
  Cline checkpoints, and Aider restore whole files or trees; Codex removed `/undo`
  (openai/codex PR 8424). GitButler separates sessions in one directory but needs
  every session to work through its workspace branch.
