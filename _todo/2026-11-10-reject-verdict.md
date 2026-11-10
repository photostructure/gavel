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

Commit 1, the Reject verdict.

- [ ] Commit 1: Reject verdict, `verdict` as the only field, GET/PUT/DELETE routes
- [ ] Commit 2: `gavel review unapply` and `gavel review reapply`

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
- Revert in a shared checkout: a recovery snapshot (`git stash create` + `git stash
  store`), then `git apply -R`, then `git merge-file`, stopping on conflicts. It lives
  in a gavel subcommand (accepted as recommended).
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

1. Test rebuilding a file's before and after contents from a capture in a temporary
   index (`GIT_INDEX_FILE`); this is reasoned, not tested.
2. `gavel review unapply <name> [--dry-run] [--patch <file>]`: snapshot, check every
   file, write none on any conflict, print JSON with per-file results, the stash name,
   and created-file blob IDs.
3. `gavel review reapply <name>`: re-apply the capture forward with `git merge-file`.
4. Tests in temporary repos: own-only file, another session's edit three lines away,
   adjacent edit (conflict, nothing written), created and deleted files, `--dry-run`,
   unapply then reapply.
5. SKILL.md shared-checkout revert becomes the command; `docs/cli.md`, schema,
   CHANGELOG.

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
