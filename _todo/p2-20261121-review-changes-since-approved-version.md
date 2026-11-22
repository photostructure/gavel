---
title: Show a reviewer only what changed since the version they approved, inside the same named review
priority: p2
section: Review server
---

# TPP: Changes since the approved version

## Summary

When an agent runs `review update` on a named review, the reviewer sees the whole
diff again, and Approve moves to the new version without the reviewer looking at
it. To avoid the re-read, gavel's own AGENTS.md ("Reviews After Approval") tells
agents to open a separate review holding only the unseen diff, which splits one
change's comments and approval across tabs. After a rebase, the reviewer has no
way to tell which commits of a stack changed.

This plan adds a "changes since vN" view to a named review, records which version
the reviewer approved, carries comment threads across a recapture whose hunks did
not change, and documents a `git range-diff` recipe that updates each review of a
rebased stack in place.

## Current phase

Next: hunk matching (task 2).

- [x] Design settled: see Decisions and Solutions
- [x] Viewed-file hash ignores hunk line numbers: `getDiffContentForHashing` in
      `src/client/utils/diffUtils.ts`, pinned by `pnpm test diffUtils`
- [x] `approvedVersion` recorded and exposed: `pnpm test conversation-approval named-reviews.integration`
- [ ] Hunk matching between two capture versions
- [ ] Server returns the delta for a `since` version
- [ ] "Changes since vN" view in the web UI
- [ ] Threads carried across an unchanged hunk
- [ ] Docs and skill updated
- [ ] Reviewed

## Decisions

Accepted as recommended on 2026-11-21 (5A-1 A, 5A-2 A, 5A-3 A):

- Approve keeps following a changed recapture, as `onRevision` does today, so a
  reviewer's Approve still covers the fixes their comments asked for. The review
  shows the version the reviewer approved, opens on the changes since it, and the
  snapshot exposes that version so an agent can tell the reviewer has not seen
  the newer code. What an agent may commit does not change.
- gavel does not pair rebased commits. The agent runs `git range-diff` and runs
  `review update` on each paired review with the new commit's patch; gavel's part
  is the hunk matching and thread carryover below. Unnamed commit reviews
  (`gavel <sha>`) get none of this beyond viewed-file marks.
- The viewed-file hash stops including hunk line numbers, fixed in its own commit
  before this plan's work.

## Required reading

- AGENTS.md, especially "Design Principles" and "Reviews After Approval"
- `skills/gavel/SKILL.md` "Act on verdicts" and `skills/gavel/references/reviews.md`
  "Refresh a capture"
- `src/server/named-reviews.ts` (`NamedReviewStore.update`, `versions`)
- `src/server/conversation.ts` (`Conversation.setCapture`, `onRevision`,
  `recordApproval`, `setVerdict`)
- `src/server/git-diff.ts` (`GitDiffParser.parseChunks`)
- `src/client/components/VerdictControl.tsx`
- `src/client/utils/outdatedComments.ts` (`isThreadOutdated`)
- `src/client/hooks/useViewedFiles.ts`
- `p2-20261107-server-only-review-state.md`: viewed-file marks are planned to move
  to the server (A2-17); this plan adds no new browser-only review state
- `p3-20261117-capture-update-recollapses-viewed-files.md`: the same recapture
  path re-collapses viewed files

## Lore

- Every capture version's patch is already kept: `NamedReviewStore` holds a
  `versions` map, and the saved review keeps `captures[]` with each version's
  `patchDigest` and `baseCommit`, restored by `NamedReviewStore.restore`. No new
  storage is needed to compare two versions.
- `GET /api/reviews/:name?version=N` returns that version's `files`, but those are
  `CapturedFile` entries with hunk ranges only, no line content or header context,
  and `/api/diff` serves only the current version. The client cannot match an
  earlier version's hunks from the existing API; task 3 adds a server answer.
- `GitDiffParser.parseChunks` drops Git's `\ No newline at end of file` marker, so
  two patches that differ only in a final newline parse to identical `DiffFile`s.
  Hunk matching must read the raw patch text, not parsed files.
- `patchDigest` is a digest of the raw patch bytes (`review-capture.ts`). After a
  rebase onto upstream changes to a commit's files, `git diff --full-index` blob
  lines and hunk offsets change, so an unchanged commit still advances the
  version. Hunk matching must ignore those.
- `Conversation.setCapture` re-records Approve on every changed capture with
  origin `agent`, overwriting `approval.captureVersion`. After a follow, nothing
  records which version the reviewer actually approved; task 1 adds that.
- Re-approving is blocked twice today: `Conversation.setVerdict` returns early
  when the verdict is unchanged, and `VerdictControl`'s Approve button, pressed
  whenever the verdict is approve, clears the verdict on click. Shift+A does
  nothing when the verdict is already approve (the `onVerdict` handler in
  `App.tsx` skips the shown verdict). Only the narrow-header verdict menu sends
  approve again.
- `isThreadOutdated` marks every thread outdated when its `capture.version`
  differs from the shown capture, whether or not its hunk changed.
- Before the hash fix, `useViewedFiles` restored viewed state across a rebase from
  its per-repository (path, hash) index only when the file's hunk headers were
  byte-identical, so a hunk shifted by upstream edits showed "changed since
  viewed". The fix bumped `VIEWED_HASH_VERSION` to 2; viewed records saved before
  it show as changed once.
- The ps-brief skill (PhotoStructure) is said to run `gavel <new> <previous>` and
  `git range-diff` by hand for delta re-briefs; this was not found in the
  photostructure `.claude/` directory or the coding-skills repo on 2026-11-21.
  Update ps-brief after this plan lands.

## Solutions

### Preferred: filter the current capture's hunks against an earlier version

The server compares the raw hunk text of the two versions' patches, file by file
at the same path. A hunk's text is its lines from the patch, including any
`\ No newline at end of file` marker, plus its header context, with the
`@@ -a,b +c,d @@` numbers removed. Matching is one-to-one: each vN hunk can
account for one current hunk. When a hunk text occurs more often in the current
patch than in vN (the same edit made in two identical places), every copy of it
counts as changed, because which copy is new cannot be told. The view hides
unchanged hunks and keeps the current capture's line numbers, so comments, links
and expansion work as they do now.

What this does not cover:

- A hunk that vN had and the current capture lacks (a reverted change) has
  nothing to show in the current patch. Each file lists "N hunks removed since vN",
  and files present only in vN are listed by path.
- An edit next to an unchanged hunk can merge or split hunks; the merged hunk
  counts as changed and shows in full.
- A renamed file matches by its new path only, so a rename counts as all-changed.

The default comparison point is `approvedVersion` when it is older than the
current capture; the reviewer can pick any earlier version.

### Rejected

- A separate review holding only the unseen diff (AGENTS.md today): splits one
  change's comments and approval across tabs.
- Diffing vN's target file contents against the current target contents: when the
  versions have different `baseCommit`s, as after a rebase, upstream changes show
  up as changes the agent made.
- Matching in the client from parsed `DiffFile`s: the parser drops the final-newline
  marker, and the API serves no earlier version's lines.
- "Since I last viewed": viewed marks are per file in browser storage and record
  no capture version, so they cannot name a comparison point.
- Hunk-level viewed marks: more stored state for an answer the version delta
  already gives.
- Keeping the version number when a recapture differs only in line numbers and
  blob IDs: the new patch has new line numbers, and anchors, expansion and image
  blobs read the stored capture, so swapping bytes under one version would break
  them. The version advances; the delta is empty and threads carry over.
- `git patch-id` for hunk identity: it ignores whitespace changes, which hides
  whitespace-only edits in YAML, Python and Markdown, and imported patches would
  still need an in-process match.
- Server-side pairing of rebased commits (5A-2 B): gavel would have to model
  stacks, store old and new ranges, and reimplement range-diff's commit matching.
- Clearing Approve on a changed recapture (5A-1 B): every requested-fix round
  would need another click, against the approval rules in AGENTS.md and the
  maintainer's instructions.

## Tasks

1. `approvedVersion` on `ReviewApproval`: set to the capture version when the
   reviewer sets Approve, left alone by an agent-origin follow, and cleared with
   the verdict. `setVerdict` with approve while already approved at an older
   version updates it and emits `review.approval`. Exposed in `comment snapshot`.
   Acceptance: `src/server/conversation-approval.test.ts` cases for follow (field
   kept), re-approve (field advances), clear and reject (field absent); the
   capture-replacement case in `src/server/named-reviews.integration.test.ts`
   checks the snapshot after a follow and after a re-approve over HTTP. Done; the
   `approvedVersion` lines in both skills' `SKILL.md` and in
   `references/reviews.md` landed with it.
2. Hunk matching: a pure function over two raw patches that returns, per current
   file, which hunks are unchanged and how many vN hunks are gone, plus vN-only
   paths. Acceptance: unit tests covering a pure rebase (shifted offsets, changed
   blob lines: everything unchanged), one edited hunk, a reverted hunk, a merged
   hunk, a whitespace-only edit (changed), adding or removing a final newline
   (changed), the same edit repeated in two identical places where vN had one
   (both changed), and a rename.
3. Server delta: `/api/diff` for a named review accepts `since=N` and returns,
   with the current diff, each hunk's unchanged flag, each file's removed-hunk
   count, and the vN-only paths. Acceptance: `src/server/server.test.ts` cases for
   a valid `since`, `since` equal to the current version (nothing changed), and an
   unknown version (HTTP 404).
4. Web UI: when `approvedVersion` is older than the current capture, the review
   header shows "Approved at vN · changes since vN" and opens with the filter on;
   a control turns it off and picks another version. In that state the Approve
   button is not pressed, reads "Approve v<current>", and clicking it sends
   approve; a "Clear" control beside it sends clear, since the pressed button was
   the wide header's only way to clear a verdict. Shift+A also sends approve in
   that state. Acceptance: Testing Library
   tests for the header, the filter, the removed-hunk note, the Approve click, and
   the Clear click, and Shift+A; play-test steps in the commit's review.
5. Thread carryover: on `review update`, a thread anchored in a hunk that task 2
   calls unchanged moves to the new line numbers and the new `capture`; others
   stay outdated. Done on the server so snapshots show it. Acceptance:
   `conversation.test.ts` or `named-reviews.test.ts` cases for a carried thread, a
   thread on an edited hunk (outdated), and a review-scope thread (unaffected).
6. Docs, in the same commits as the behavior they describe:
   - AGENTS.md "Reviews After Approval": replace "Never recapture a review the user
     approved, or ask them to approve it again" and "go in a new review that holds
     only the diff the user has not seen" with: update the approved review in
     place with `review update`; the reviewer reads the changes since the version
     they approved. Keep the list of changes that need no new verdict, and give
     the check for the rest: commit only once a fresh snapshot shows
     `approval.approvedVersion` equal to `capture.version`. Asking for that
     re-approval is allowed, since the reviewer reads only the delta. Rewrite the
     kept sentences that point at the separate review ("That new review needs no
     verdict…", "Second-opinion passes after an approval also cover only that
     diff") to name the changes since the approved version instead.
   - `SKILL.md` "Act on verdicts", in both `skills/gavel/` and `.codex/skills/gavel/`,
     keeps requiring `approval.verdict: approve` (5A-1); the `approvedVersion`
     check is this repository's rule, not the shipped skill's. Add that the
     changes since the approved version are waiting in the delta view.
   - `references/reviews.md` "Refresh a capture": the delta view; a new "Update a
     rebased stack" section: run
     `git range-diff <old-base>..<old-tip> <new-base>..<new-tip>`, run
     `review update` with each paired commit's new patch, create a review for each
     new commit, withdraw the review of each dropped commit.

## Working log

- 2026-11-21, Claude Code `44812c1c-b80d-4efd-b173-84eefe35d45a`, primary checkout.
  Wrote this plan and the viewed-file hash fix. The original brief said viewed
  state "resets" after a rebase; reading `useViewedFiles` showed the per-repository
  index restores it and the defect was hunk line numbers in the hash. Reviewed this
  plan with second-opinion, reviewers Codex `01a200a9-2435-7be2-aae9-493adf4c5dfd`
  and Claude `9aed1182-3184-4370-8646-3d4e5a8c4fa5`. Accepted: R594-A (no
  checkable rule for when a fix needs a new verdict), R594-B (the pressed Approve
  button clears instead of re-approving), R594-C (the API serves no earlier
  version's hunk lines), R557-A (one vN hunk could hide two identical current
  hunks), R557-B (the parser drops the final-newline marker), R594-D (turning the
  pressed Approve button into "Approve v<current>" removed the wide header's only
  clear control).
- 2026-11-21, Claude Code `44812c1c-b80d-4efd-b173-84eefe35d45a`, primary checkout.
  Task 1. Missteps: the plan named `conversation.test.ts` and `server.test.ts` for
  the tests, but the approval cases live in `conversation-approval.test.ts` and
  `named-reviews.integration.test.ts`; and Lore claimed Shift+A re-approves, which
  the `onVerdict` guard in `App.tsx` prevents (caught by the Codex reviewer).
  Reviewed the task 1 diff, 2 passes, Codex `01a20142-088d-75d3-96fc-76d0a86c0f43`
  and Claude `e23f0698-6701-4770-87f0-317e353f7b8a`: R798-A accepted (the Codex
  copy of the skill lacked the `approvedVersion` sentence).
