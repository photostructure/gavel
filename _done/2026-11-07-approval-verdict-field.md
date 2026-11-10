---
title: Store a review's verdict as one field instead of separate approval flags
section: Review server
---

# One verdict field on ReviewApproval

Done by [2026-11-10-reject-verdict.md](../_todo/2026-11-10-reject-verdict.md), which made
`verdict?: 'as-is' | 'after-comments' | 'reject'` the only verdict field and dropped
`approved`. The branch `tpp/verdict-field` (562fddd) was not merged.

## Problem

`ReviewApproval` (`src/types/conversation.ts`) records the reviewer's verdict as
separate flags: `approved`, `requested`, `mode` (`as-is` or `after-comments`) and
`notYet`. Each place that asks "has this capture a verdict?" checks its own
subset:

- `src/server/conversation.ts`: `setCapture` revokes on `approved || notYet` (a
  conditional after-comments approval is handled in the branch above it);
  `setSummary` revokes on `approved || requested || notYet`; `setApproval(…, false)`
  returns early on the negation of those three.
- `src/server/server.ts`: `revokeIfDiffChanged` and
  `revokeApprovalIfDiffChanged` check `approved || notYet`; the review-summary
  POST handler revokes on `approved || requested || notYet`.
- `src/client/utils/verdict.ts`: `hasVerdict` checks `requested || notYet`.

A new verdict state means finding and extending every such check. Matthew asked
on 2026-11-07 whether one state would be cleaner and DRY (difit review of the
saved-reviews change); a separate refactor over a `hasVerdict()`-style helper
was accepted as recommended (A2-13).

## Direction

Replace the verdict flags with one field, for example
`verdict?: 'as-is' | 'after-comments' | 'not-yet'`, keeping `approved` only if
callers need "commit may proceed" separately from the verdict.

The approval JSON is read by the HTTP API (`/api/approval`, `comment snapshot`),
the JSON Schema (`src/cli/schema.ts`), the client (`App.tsx`, `VerdictControl.tsx`,
`useReviewApproval.ts`, `ReviewQueueBar.tsx`, `utils/verdict.ts`), the skills
(`skills/gavel/SKILL.md`'s snapshot `jq` filter, and the verdict paragraphs in
that skill and `.claude/skills/gavel-dev/SKILL.md`), and review records saved under `.git/gavel` (a saved
record with the old flags must still restore). Plan the migration for each.
