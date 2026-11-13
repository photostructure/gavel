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
verdict a toast under the verdict buttons offers the next review without one, or
says the page can be closed once every review has one, beside Undo and Dismiss;
nothing moves until the reviewer clicks. Its message shows the header's delivery
robot and says whether the verdict reached the agent, then what is left.

Celebration timing, which shipped alongside it, has its own plan:
[2026-11-07-shorter-approval-celebrations.md](../_done/2026-11-07-shorter-approval-celebrations.md).

## Current phase

Next: the manual check in Chrome and Firefox under Tasks; the maintainer offered to
test Firefox.

- [x] Server verdict — `pnpm vitest run src/server/conversation-approval.test.ts src/server/live-approval.integration.test.ts src/server/named-reviews.integration.test.ts`
- [x] Verdict buttons, tab marks, follow-up toast — `pnpm vitest run src/client/components/VerdictControl.test.tsx src/client/components/VerdictFollowUpNotice.test.tsx src/client/hooks/useVerdictFollowUp.test.ts src/client/components/ReviewQueueBar.test.tsx`, then `pnpm vitest run src/client/App.namedReviews.test.tsx -t "after a verdict"` (a `-t` filter applies to every file listed)
- [x] Docs and skills — `docs/approval-modes.md`, `docs/agent-conversations.md`, `README.md`, `skills/gavel/SKILL.md`, `.claude/skills/gavel-dev/SKILL.md`, `CHANGELOG.md`
- [x] Reviewed — `coding:second-opinion` LAND on every batch, base `646b773`. Codex
      reviewed only the server batch; front-end batches ran the Claude reviewer alone
      (the maintainer's standing instruction).
- [ ] Integration in a real browser — the manual steps under Tasks

## Required reading

- **AGENTS.md**
- **docs/approval-modes.md**: the verdicts and what ends each
- `src/client/hooks/useVerdictFollowUp.ts`: the follow-up's state machine

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
  comment; separate buttons whenever the header has room, one menu otherwise
  (`useHeaderFit` hides labels, the review name and the logo before it collapses
  the buttons; with two buttons and a 24-character review name the header fits
  at 1024px, measured in the browser pane); idle buttons
  are neutral, because a red-tinted idle Not yet "looks like I've already pushed
  not yet"; hover tints only the border (green, violet; the yellow after-comments
  button is gone),
  because tinted text was too faint in dark mode; clicking the pressed button
  clears the verdict; the follow-up notice sits under the verdict buttons, "where
  I'm looking"; Back no longer moves between reviews; a 1.6 s pulse beat (it was
  0.8 s), lengthened at their request; a chosen button is filled in its verdict's
  color (green, violet); the notice and its default button are blue, because green
  beside the verdict buttons reads as approval. The 10 s countdown to switching or
  closing (first 3 s and 5 s) became a toast that waits for a click, after it
  switched reviews while the maintainer was reading Conversation. Its message
  reads "Approved." and "Sending to the agent…", then "Sent to the agent." with
  the next review's name and how many still need a verdict, or that the page can
  be closed ("page", not "tab": phones and tablets may not show tabs). Below it
  sit **Undo** (clears the verdict, as its pressed button does) and **Switch to
  `<name>`**, with an **×** (Dismiss) in the corner. A **Close tab** button was
  dropped: browsers honour `window.close()` only in a tab a script opened or one
  with a single history entry, and comment links, the revision picker, and pages
  the tab showed before gavel all add entries; it did nothing in the maintainer's
  Firefox. The server marks a verdict pending before it answers, so `App.tsx`
  reads the delivery before the toast opens; otherwise an earlier comment's
  receipt would show as the verdict's.
- The follow-up notice renders through `FloatingPortal` because the header group
  (`flex min-h-0 flex-col overflow-hidden` in `App.tsx`) clips anything below the
  header. The portal needs a non-modal `FloatingFocusManager` (no initial focus,
  no return focus, no close on blur), or its buttons land last in tab order, far
  from the verdict buttons a keyboard user just pressed. Its slide-in animates
  `translate`, because Floating UI positions it with `transform`.
- `window.close()` works only for a tab with one history entry or one a script
  opened (HTML standard), so nothing in the follow-up calls it. Playwright cannot
  test closing: pages it creates count as
  script-opened and close at any history length. The Claude desktop app's browser
  pane also closes at any length.
- `useReviewSummary` drops its draft when the summary URL changes, so every
  verdict is disabled while the summary is dirty or saving; otherwise the
  follow-up's switch would discard the draft.
- A pulse that is still above 0 replays whenever the tab bar remounts, which
  every review switch does behind the loading screen; the hook reports `pulse: 0`
  after 6.4 s (the animation's length) or when another review opens.
- The open review's own approval hook (`currentHasVerdict`) is fresher than its
  entry in the tab list; a verdict cleared from another tab ends the follow-up,
  so it never says the page can be closed over a review that needs a verdict again. A
  recapture no longer clears a verdict, so it leaves the follow-up showing.
- With `--no-conversation`, a verdict lives in the server's `approvals` map; no test
  covers that path.

## Tasks

- [ ] Manual check in Chrome and Firefox, from a build served by
      `node dist/cli/index.js`, with two named reviews on one server:

  1. Approve the first review. The toast under the buttons reads "Approved" with
     **Undo**, **Switch to `<second>`**, and **×**, and the second review's tab
     pulses. With a Claude Code session attached, its message reads "Sending
     to the agent…", then "Sent to the agent. `<second>` still needs a verdict."
     After 20 s nothing has moved; **Switch to `<second>`** opens it.
  2. Choose Reject on the second. The toast reads "Sending to the agent…", then
     "Sent to the agent. All 2 reviews have a verdict, so you can close this
     page.", and offers only **Undo** and **×**.
  3. Reload with a review that has no verdict. The browser asks before leaving.
  4. After a verdict, Tab past the remaining verdict buttons. Focus moves to
     **Undo**, then **Switch to `<name>`** when another review needs a verdict,
     then **×**.
  5. Click **Undo**. The verdict clears and the toast goes away.
