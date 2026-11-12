---
title: Give every review a verdict, then move the reviewer on
section: Approval
---

# TPP: Give every review a verdict, then move the reviewer on

## Summary

With several reviews on one server, the maintainer kept missing every review after
the first, and the only way to decline one was to close the window, which agents
could not tell from leaving. Every review now gets one of two verdicts in the
header: **Approve** or **Reject**. (It shipped with three: **Approve as-is**,
**Approve after comments**, and **Not yet**; Not yet became Reject, and the two
approvals became one Approve that follows the agent's revisions.) After a
verdict the page counts down to the next review without one, or to closing the
tab once every review has one.

Celebration timing, which shipped alongside it, has its own plan:
[2026-11-07-shorter-approval-celebrations.md](../_done/2026-11-07-shorter-approval-celebrations.md).

## Current phase

Next: the manual check in Chrome and Firefox under Tasks; the maintainer offered to
test Firefox.

- [x] Server verdict — `pnpm vitest run src/server/conversation-approval.test.ts src/server/live-approval.integration.test.ts src/server/named-reviews.integration.test.ts`
- [x] Verdict buttons, tab marks, follow-up countdown — `pnpm vitest run src/client/components/VerdictControl.test.tsx src/client/components/VerdictFollowUpNotice.test.tsx src/client/hooks/useVerdictFollowUp.test.ts src/client/components/ReviewQueueBar.test.tsx`, then `pnpm vitest run src/client/App.namedReviews.test.tsx -t "after a verdict"` (a `-t` filter applies to every file listed)
- [x] Docs and skills — `docs/approval-modes.md`, `docs/agent-conversations.md`, `README.md`, `skills/gavel/SKILL.md`, `.claude/skills/gavel-dev/SKILL.md`, `CHANGELOG.md`
- [x] Reviewed — `coding:second-opinion` LAND on every batch, base `646b773`. Codex
      reviewed only the server batch; front-end batches ran the Claude reviewer alone
      (the maintainer's standing instruction).
- [ ] Integration in a real browser — the manual steps under Tasks

## Required reading

- **AGENTS.md**
- **docs/approval-modes.md**: the verdicts and what ends each
- `src/client/hooks/useVerdictFollowUp.ts`: the countdown's state machine

## Interfaces other work may collide with

Check these before merging work that touches approval, the header, or review tabs.

- Not yet is now Reject, recorded as `ReviewApproval.verdict: 'reject'` through
  `PUT /api/approval`, and only the reviewer clears it; see
  [2026-11-10-reject-verdict.md](../_done/2026-11-10-reject-verdict.md).
- Approve as-is and Approve after comments are now one Approve
  (`ReviewApproval.verdict: 'approve'`), which follows recaptures, summary edits, and
  diff changes, and which comments do not revoke. `ReviewVerdict` is
  `'approve' | 'reject'`; `conditionalSupported` and `ReviewApproval.diffDigest` are
  gone (requests still send `diffDigest`), and `useReviewApproval` takes only its URL.
- `ApprovalSplitButton.tsx` is renamed (`git mv`) to `VerdictControl.tsx`;
  `describeApproval` moved with it. Any branch importing the old path breaks.
- `App.tsx`: `handleShipIt(mode, revoke)` became `handleVerdict('as-is' |
  'after-comments' | 'not-yet' | 'revoke')`, now `handleVerdict(ReviewVerdict | 'clear')`
  with `ReviewVerdict` `'approve' | 'reject'`. `handleRevisionChange`'s second
  argument changed from `addHistory: boolean` to `'push' | 'replace' | null`.
  `approvalControlRef` is now set through the `setVerdictControl` callback ref,
  which also anchors the notice.
- Review tabs (`ReviewQueueBar`) switch with `history.replaceState`, not
  `pushState`, so Back no longer steps between reviews. The bar takes a `pulse`
  prop. Its labels changed: "Not approved" is now "Needs a verdict", and the count
  reads "2 of 3 need a verdict" / "All 3 have a verdict". Tests on other branches
  that query the old labels will fail after a merge.
- `App.tsx` adds a `beforeunload` listener that calls `preventDefault` while any
  review that asks for approval lacks a verdict, next to the existing comment
  beacon listener.
- `src/client/styles/global.css`: `verdict-pulse-0` / `verdict-pulse-1` keyframes.

## Lore

- Decisions the maintainer made in conversation: Not yet (now Reject) is one click and needs no
  comment; separate buttons from 1280px, one menu below (with three buttons the
  header needed about 1198px at 1024px, measured in the browser pane; not
  re-measured for two); idle buttons
  are neutral, because a red-tinted idle Not yet "looks like I've already pushed
  not yet"; hover tints only the border (green, violet; the yellow after-comments
  button is gone),
  because tinted text was too faint in dark mode; clicking the pressed button
  clears the verdict; the countdown notice sits under the verdict buttons, "where
  I'm looking"; auto-close, accepting that Back no longer moves between reviews;
  a 10 s countdown (it was 3 s to switch, 5 s to close) and a 1.6 s pulse beat
  (it was 0.8 s), both lengthened at their request; a chosen button is filled in
  its verdict's color (green, violet); **Switch now** /
  **Close now** beside **Cancel** skip the wait; the notice and its default button
  are blue, because green beside the verdict buttons reads as approval.
- The countdown notice renders through `FloatingPortal` because the header group
  (`flex min-h-0 flex-col overflow-hidden` in `App.tsx`) clips anything below the
  header. The portal needs a non-modal `FloatingFocusManager` (no initial focus,
  no return focus, no close on blur), or Cancel lands last in tab order and a
  keyboard user cannot reach it before the 10 s countdown ends.
- `window.close()` works only for a tab with one history entry or one a script
  opened (HTML standard). Playwright cannot test this: pages it creates count as
  script-opened and close at any history length. The Claude desktop app's browser
  pane also closes at any length.
- `useReviewSummary` drops its draft when the summary URL changes, so every
  verdict is disabled while the summary is dirty or saving; otherwise the
  countdown's switch or close would discard the draft.
- A pulse that is still above 0 replays whenever the tab bar remounts, which
  every review switch does behind the loading screen; the hook reports `pulse: 0`
  after 6.4 s (the animation's length) or when another review opens.
- The hook ticks once per displayed second, not every 250 ms: it runs in `App`,
  so each tick re-renders the whole page.
- The open review's own approval hook (`currentHasVerdict`) is fresher than its
  entry in the tab list; a verdict cleared from another tab stops any countdown,
  so the tab never closes over a review that needs a verdict again. A recapture
  no longer clears a verdict, so it leaves the countdown running.
- With `--no-conversation`, a verdict lives in the server's `approvals` map; no test
  covers that path.

## Tasks

- [ ] Manual check in Chrome and Firefox, from a build served by
      `node dist/cli/index.js`, with two named reviews on one server:

  1. Approve the first review. The notice under the buttons counts down 10 s and
     opens the second, and the second review's tab pulses.
  2. Choose Reject on the second. The notice counts down 10 s. If the tab has one
     history entry it closes; otherwise the notice says the tab can be closed.
  3. Reload with a review that has no verdict. The browser asks before leaving.
  4. After a verdict, Tab past the remaining verdict buttons. Focus moves to
     **Switch now** (or **Close now**), then **Cancel**.
