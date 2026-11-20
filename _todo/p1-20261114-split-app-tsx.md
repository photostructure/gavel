---
title: Split App.tsx into concern hooks and header, sidebar and dialog components
priority: p1
section: Refactor
---

# TPP: Split App.tsx

## Summary

`App()` (App.tsx at `d905dec`) holds 37 `useState`, 35 `useRef`, 24
`useEffect`, 40 `useCallback` and 24 `useMemo`, then one 540-line JSX tree. To follow one
concern, a reader has to collect its state, effects, handlers and JSX from places spread
across the whole file. This plan moves each concern whose boundary is small (few inputs and
outputs, nothing reaching back into App) into its own hook, and each large JSX region into
its own component. The entangled core stays in App.tsx: diff loading, review selection,
revisions and popstate. App wires hook output into components and keeps that core. The
conflict replay below shows the split will not remove many merge conflicts: most of them
come from two features in one concern, and those lines move together. Part of
`p1-20261114-refactor-arc.md`.

## Current phase

Next: after `p1-20261114-delete-dead-code.md`, `p1-20261114-remove-backward-compat.md` and
`p1-20261114-shared-test-helpers.md` task 2 land, step 1 below.

- [x] Map and conflict analysis (below)
- [x] Design settled: composition root, props only
- [ ] Deletions and duplicate removal in place (step 1)
- [ ] Extractions, one commit each, in the order below (steps 2-12)
- [ ] `App.test.tsx` split along the new modules (step 13)
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- `p1-20261114-delete-dead-code.md` and `p1-20261114-remove-backward-compat.md`: they
  delete App.tsx code this plan would otherwise move (`branchToHash` arguments,
  `getNamedReviewStorageRef`, the legacy-thread copy)
- `src/client/App.tsx` in full before step 1; it changes often
- `_todo/p2-20261113-queued-verdict-not-shown.md` (plans changes to `handleVerdict`)
- `p1-20261114-agent-updates-render-count-flake.md`

## Where conflicts come from

Touches, measured over App.tsx history at `d905dec` (hunk start lines per commit; script was
in a scratch directory):

| Region                                       | Last 50 commits touching it |
| -------------------------------------------- | --------------------------- |
| Imports                                      | 22                          |
| `useState` block (first 80 lines of `App()`) | 12                          |
| Hook and handler body                        | 40                          |
| JSX                                          | 35                          |

Within the JSX, the `<header>` was touched by 22 of the last 60 commits, the
`CommentsListModal` props by 8, the `DiffViewer` props by 5.

Touches are not conflicts. Replaying each pair of consecutive App.tsx commits as parallel
branches (B's change applied to A's parent with a 3-way `git merge-file`) over the last 60
commits (`903707b..d905dec`) gave 13 conflicting pairs:

- 8 were two features in one concern: review tabs (eb9d8a3/bc5978f), agent replies
  (2aa3972/14ff928), change summary (0d52609/ff4ede5), verdict delivery (aa4458f/b963ee6),
  sidebar highlight (6aa3e68/a5e015d), verdict follow-up (aa32f66/8d0008d), and two edits
  to the root shell (ed26f9d/c5b9ac6, c5b9ac6/17574e1). No split prevents these.
- 2 were different concerns that a split separates: the picker edit against hide-header,
  which wrapped and re-indented the header (bc5978f/ed26f9d), and popstate code
  next to the verdict follow-up (8d0008d/6701adb).
- 2 shared one line or one prop list: the derived key `reviewScope` (dd6f723/ff78460) and the
  `DiffViewer` props (ab253fc/a012e38). Moving the code does not change these.
- 1 was the difit-to-gavel rename.

Imports had 27 touches in those 60 commits and no simulated conflict. Expect the split to
make App easier to read, not to remove many conflicts.

Mechanisms seen in sampled diffs (b963ee6, a4699a2, 99ea7f0, 9d9d6ee, f26016e):

1. One feature edits several distant places: b963ee6 (agent delivery) changed imports,
   the `useInboxDelivery` call, the `useFileWatch` arguments, `useVerdictFollowUp`
   options, the header, the alerts, and `CommentsListModal.headerActions`.
2. The `useFileWatch` call takes 7 positional callbacks; its destructuring line rewraps
   whenever a field is added. `p1-20261114-shared-test-helpers.md` task 2 replaces them
   with named handlers.
3. The header is one flat run of siblings: `VerdictControl`, `ToastStack`, alerts,
   `AgentDeliveryStatus`, the Conversation button, the picker.
4. `finishVerdict` / `handleVerdict` and `loadRecentReviews` are
   single long functions that verdict, review-list and rename features all edit.

## Lore

- Extract a concern when its boundary is small: few inputs and outputs, and nothing in App
  reaching back into it. If an extraction turns out to need a long argument list, or new
  refs to carry state across the boundary, it stays in App.
- A move adds no context, getter, wrapper component, option, or new ref. A hook argument or
  prop for a value App already has is fine.
- Delete and dedupe in place first, in their own commits; then move what is left unchanged,
  so each move reads as a move.
- Code that only one file uses stays in that file. A piece of a few lines (the page title
  effect, the loading and error screens, a single component call) stays inline unless
  extracting it makes App easier to read without a new interface.
- Closures call things declared later in `App()`; this works only because the calls
  happen after render: `verdictFollowUp` (used in `finishVerdict`; declared by the
  `useVerdictFollowUp` call), `inboxDelivery` (used in `finishVerdict`; declared by the
  `useInboxDelivery` call), `handleCopyAllComments` (used in `useKeyboardNavigation`'s
  `onCopyAllComments`), `handleNavigateToDraftLine` and `canShowLinkedLine` (used in
  `handleNavigateToComment`). An extracted hook must take these as
  arguments or callbacks.
- Refs do two different jobs:
  - Refs that cross a kept boundary, because the callee stays in App and is declared
    later: `fetchDiffDataRef` (`fetchDiffData` stays in App, and `useVerdict` and
    `useLiveReviewEvents` call it), `switchReviewRef` (`useReviewList` calls
    `handleRevisionChange`, which stays in App), and `stopCelebrationRef` (`useVerdict`
    owns it and returns a stop function, which `handleRevisionChange` calls). Pass
    these as hook arguments. `loadRecentReviewsRef` goes in step 1.
  - Latest-value refs: `finishVerdictRef`, `toggleThreadResolvedRef`,
    `retargetOpsRef`. They keep a callback's
    identity stable or let a deferred callback read the current render's state, so they
    must stay refs inside whichever hook takes them. Replacing `toggleThreadResolvedRef`
    with an argument re-renders the whole diff on every App render (see
    `handleToggleThreadResolved`, commit 1ef8304); replacing `finishVerdictRef` makes a
    verdict answer that arrives after a retry run a stale closure (see the comment above
    `finishVerdict`).
- `activeCommentsContextRef` is a generation counter mutated during render. It
  stays in App with review selection; `useVerdict` takes the generation it reads.
- `DiffViewer` is memoized (its `memo` export in components/DiffViewer.tsx). Keep it off any context
  whose value changes on read marks or toggles: commit 1ef8304 and the `diffViewerRenders`
  render-count test in App.agentUpdates.test.tsx pin that. That test waits for the initial
  load to finish before counting (`p1-20261114-agent-updates-render-count-flake.md`), so a
  count mismatch means a real extra render.
- `FileList` is `memo` (its export in FileList.tsx), but App passes it callbacks and JSX
  recreated every render (`handleFileOpened`, `handleFirstCommentOpened`, the inline
  `onScrollToSummary`, `headerStatus`), so the memo never skips a
  render. Remove the `memo` in step 1 instead of stabilizing the props: stabilizing would
  add `useCallback` / `useMemo` for a speedup nobody has profiled.
- No test renders the "Deferred Rendering" / "Load now" placeholder, and no
  test covers sidebar drag-resize. Add one each before moving that code.
- Moving code into a hook that App tests mock (`useViewedFiles`, `useDiffComments`,
  `useViewport`, `useFileWatch`) hides it from those tests. App.test.tsx's `useViewedFiles`
  mock returns no progress count, runs no effect, and omits `setFilesViewed` (so no
  App.test test reaches folder Viewed, `toggleFolderReviewed`). "should clear viewed files when
  clearComments flag is true in response" asserts on `mockClearViewedFiles`. So the
  progress count (`viewedFilesInDiffCount`) and the `--clean` viewed-file clear (the
  `hasCleanedRef` effect) stay in App.

## Design

Settled 2026-11-17 (question DF-18, accepted as recommended).

**Composition root, props only.** Each extracted hook returns one object, and App passes it
whole (`<VerdictArea verdict={verdict} …/>`), so a new field in a hook's result does not
edit App. Components take `diffData` as a prop. Add no context:
`review={diffData.reviewContext}` and `capture={diffData.capture}` appear three times each
(on `AgentDeliveryStatus`, `AgentDeliveryAlert` and `ReviewPresenceIndicator`; on
`DiffQuickMenu`, `CaptureDetails` and `DiffViewer`), which does not pay for a context, its provider value
and its hook, and a context hides which components read review identity. If an extraction
needs a long argument list or new refs to carry state across its boundary, it stays in App.

## Target modules

Code as of `d905dec`; sizes approximate.

Absorbed by existing modules:

| Existing module               | Takes                                                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/useAgentUpdates.ts`    | Unread candidates (`liveReviewConversations` through the `useNewReplyPulse` call) and `unreadReviews`; `agentReadContext`, mark-read handlers (`markAllReviewsRepliesRead`, `markThisReviewRepliesRead`), resolve wrapper (`toggleThreadResolvedRef`, `handleToggleThreadResolved`) |
| `hooks/useVerdictFollowUp.ts` | The warning before leaving a page without a verdict (`reviewsNeedVerdict` and its `beforeunload` effect)                                                                                                                                                                            |
| `hooks/useInboxDelivery.ts`   | `codexReview` / `requiresResume` as derived output                                                                                                                                                                                                                                  |

New hooks:

| Hook                     | Takes                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | About |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `useSidebarLayout`       | `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` / `SIDEBAR_DEFAULT_WIDTH`, the sidebar cookie parsers (`clampSidebarWidth` through `getInitialFileTreeOpen`), the `sidebarWidth` state, the `isFileTreeOpen` state and its breakpoint reset (`fileTreeLayoutIsMobile`) (takes `isMobile` from `useViewport`; the breakpoint reset must stay in render, not an effect), `handleMouseDown`, persist effects (`savedSidebarWidthRef`, `savedSidebarOpenRef`), `handleMobileFileSelected` | 95    |
| `useDiffDisplaySettings` | The diff-mode and whitespace cookie parsers (`parseDiffViewMode`, `getInitialDiffViewMode`, `getInitialIgnoreWhitespace`), diffMode / ignoreWhitespace state, `handleDiffModeChange` / `handleIgnoreWhitespaceChange`, mobile-unified effect, edited auto-viewed patterns (`editedAutoViewedPatterns`, `handleAutoViewedPatternsChange`; App keeps the `diffData` fallback), `settingsSaveError` and its `onSettingsSaveError` effect                                           | 65    |
| `useReviewList`          | The review-list state and refs (`recentReviews` through `switchReviewRef`), `loadRecentReviews` and the effect that calls it                                                                                                                                                                                                                                                                                                                                                    | 120   |
| `useLiveReviewEvents`    | Live-event handlers (`handleWatchReload` through `handleReviewsChanged`), `useFileWatch` + retry + `connectedOnce` + `server` + `reconnectServer`                                                                                                                                                                                                                                                                                                                               | 110   |
| `useVerdict`             | `isShipping`, verdict anchor (`approvalControlRef`, `verdictAnchor`, `setVerdictControl`), `stopCelebrationRef`, `verdictClickRef` through `handleVerdict`, follow-up wiring (`codexReview` through the `useVerdictFollowUp` call)                                                                                                                                                                                                                                              | 150   |
| `usePresentedFiles`      | `useExpandedLines` through `displayThreads`, `threadsByFile` through `codeForDraft` (expanded lines, merged chunks, canonical / navigable files, line index, display threads, `threadsByFile`)                                                                                                                                                                                                                                                                                  | 145   |
| `useFileCollapse`        | `collapsedFiles`, `collapsedInitializedRef` / `openedDraftFilesRef` / `pendingSidebarSelectionsRef`, the collapse effects from `previousViewedFilesRef` through the draft-files effect, `handleSidebarFileSelected` through `toggleAllFilesCollapsed` (collapse state and reviewed toggles)                                                                                                                                                                                     | 235   |
| `useLineJumps`           | `pendingLineJump` / `pendingJumpBehavior` / `threadToReveal`, `placeCursorAtComment` through `handleFileOpened`, `handleNavigateToComment` through the `scrollToElement` reveal effect (calls `useCommentLinks`)                                                                                                                                                                                                                                                                | 165   |

New components:

| Component         | Takes                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReviewHeader`    | The `review-chrome` block (the `<header>` and `ReviewQueueBar`) except the verdict JSX; the picker, agent status and Conversation button stay inline in it |
| `VerdictArea`     | `VerdictControl`, `ToastStack`, the alerts, fed by `useVerdict`                                                                                            |
| `FileTreeSidebar` | The "Close file tree" backdrop, the `file-tree-panel` `<aside>` around `FileList`, and the "Drag to resize file list" handle                               |
| `DiffFilePane`    | The `<main>` diff scroll area, with the "Load now" placeholder inline                                                                                      |
| `ReviewDialogs`   | `RevisionDetailModal`; `SettingsModal` through `CommentLinkNotice`                                                                                         |

Stays in App.tsx:

- The diff-loading and review-selection core: `diffData` state, loading / error,
  `selectedRevision` through `activeDiffAbortControllerRef`, the derived selection keys
  (`resolvedSelection` through `reviewScope`), the generation counter
  (`activeCommentsContextRef`), `fetchDiffData` with its refetch and abort effects, the
  revisions fetch (`/api/revisions`), `handleRevisionChange` and popstate. Every hook above reads its output, and it reaches into the
  review list, verdict and live events through refs.
- The page title effect (`pageTitle`), the loading, error and no-data screens, the progress
  count (`viewedFilesInDiffCount`) and the `--clean` viewed-file clear (the `hasCleanedRef`
  effect); see Lore.

The legacy-thread copy is not moved: `p1-20261114-remove-backward-compat.md`
deletes it first.

## Tasks

One commit per step, smallest risk first. A moved hook needs no new test when the listed
App tests pin it; add a `renderHook` test only for behavior no App test reaches. Acceptance
for every step: `pnpm test` passes with the listed tests unchanged in their assertions, and
`pnpm build` passes.

1. Deletions and duplicate removal in place, in their own commits (list below), before any
   move.
2. `useSidebarLayout` + `FileTreeSidebar` (add a drag-resize test first). Pins: App.test
   "Sidebar persistence", "Mobile sidebar auto-close", "sidebar highlight follows the line
   cursor", "Review progress", "change summary placement", "sidebar comment jumps".
3. `useDiffDisplaySettings`. Pins: App.test "Diff Mode Persistence", "Auto-viewed
   patterns", "Settings the browser refuses to keep"; App.conversations.
4. The absorbed moves: unread code into `useAgentUpdates`, `codexReview` /
   `requiresResume` into `useInboxDelivery`, the leave warning into `useVerdictFollowUp`.
   Pins: App.agentUpdates, App.test "Custom tab title", "Ship it delivery";
   App.namedReviews before-leaving tests; useAgentUpdates.test.ts,
   useNewReplyPulse.test.ts, useVerdictFollowUp tests.
5. `useReviewList`. Pins: App.namedReviews rename / delete tests, App.commentLinks,
   App.test "Review navigation", "Retained conversation contexts".
6. `useLiveReviewEvents`, after `p1-20261114-shared-test-helpers.md` task 2 gives
   `useFileWatch` named handlers. Pins: App.reviewOps reconnect tests, App.namedReviews
   watch callbacks, App.test "Heartbeat Connection", "Ship it delivery",
   useFileWatch.test.ts, AgentDeliveryStatus.test.tsx.
7. `useVerdict` + `VerdictArea`. Coordinate with
   `_todo/p2-20261113-queued-verdict-not-shown.md`. Pins: App.test "Ship it", "Approval
   celebration", "Ship it delivery"; App.namedReviews "after a verdict" and the
   before-leaving tests; App.reviewOps "verdict shortcuts"; useVerdictFollowUp,
   useReviewApproval, VerdictControl, ToastStack tests.
8. `usePresentedFiles`. Pins: App.largeFiles, App.conversations, App.commentLinks,
   App.test "Review navigation", mergedChunks, outdatedComments, ignoreWhitespace tests.
9. `useFileCollapse`. Pins: App.test "Initial file collapsing", "Viewed files reload";
   App.largeFiles; useLazyDiffRendering.test.ts.
10. `useLineJumps`. Pins: App.commentLinks, App.test "sidebar comment jumps",
    App.agentUpdates, useCommentLinks.test.ts.
11. `ReviewHeader`. Pins: App.test "Review navigation", "Header display controls";
    App.namedReviews rename / delete; App.reviewOps reconnect tests;
    AgentDeliveryStatus.test.tsx.
12. `DiffFilePane` (add the placeholder test first) and `ReviewDialogs`. Pins: App.test
    "Editor launch", "Diff load errors", App.agentUpdates render count, CommentsListModal
    tests.
13. Split `App.test.tsx` (3,235 lines) along its describe blocks to follow the modules:
    verdict (Ship it, Approval celebration, Ship it delivery), file collapse (Initial file
    collapsing, Viewed files reload), sidebar, settings (Settings refuse, Auto-viewed, Diff
    Mode Persistence, Header display controls), comments (Clear Comments block). The
    describes that pin the core kept in App (Merge-base selection, Revision-aware
    refetching, Review navigation, Retained conversation contexts) stay in `App.test.tsx`.
    Every other describe (Heartbeat Connection, Diff load errors, Editor launch, Review
    progress, Sidebar persistence, Mobile sidebar auto-close, Custom tab title, Committed
    review summaries, change summary placement, sidebar comment jumps) goes with the module
    it pins or stays in `App.test.tsx`. While splitting, fold the repeated
    `vi.clearAllMocks(); mockComments = []` into the top-level `beforeEach`; keep
    `mockFetch(mockDiffResponse)` and `mockConfirm` setup in the describes that have them
    today (7 and 12 of the 17), since adding them elsewhere changes those tests.
    Acceptance: the same `it` names pass across the new files (`pnpm vitest list` before
    and after).

### Deletions and duplication to remove first (step 1: in place, own commits, before any move)

A move then carries less code and reads as a move.

- `loadRecentReviewsRef` (10 uses) exists only because `loadRecentReviews` is
  declared after its callers. Its dependency list is `[]`, and it reads only refs
  declared before `finishVerdict` (`recentReviewsRequestRef`, `selectedRevisionRef`, `reviewIdsRef`,
  `retargetOpsRef`, `switchReviewRef`). Declare it before `finishVerdict`, call it
  directly, and delete the ref.
- Remove `FileList`'s `memo` (its export in FileList.tsx). It never skips a render, because
  `headerStatus` is new JSX on every render, so removing it changes no render.
- Candidate; check before doing it: `approvalControlRef` holds the same element as
  the `verdictAnchor` state. Its only reader is `finishVerdict` (the approval-celebration
  check and its `celebrateApproval` call), which runs
  through `finishVerdictRef` and so sees the latest render's `verdictAnchor`. Passing
  `setVerdictAnchor` as `containerRef` would delete the ref and `setVerdictControl`. The
  difference: the ref reads the element after `finishVerdict`'s awaits, while the closure
  reads it as of the render in which the answer arrived. A review switch remounts
  `VerdictControl` (key `commentsContextKey`) but also fails `sameReview()`. Reasoned, not
  tested.
- The "context still current" check in `toggleFileReviewed` and `toggleFolderReviewed` is
  the negation of `isScrollContextCurrent()`.
- The "open one file" updater (in `handleSidebarFileSelected` and
  `handleNavigateToDraftLine`) and the "open many files" updater (in the
  `previousViewedFilesRef` effect and the `openedDraftFilesRef` effect).
- The three mark-read loops calling `setAgentMessageRead(...)` (in
  `markAllReviewsRepliesRead`, `toggleThreadResolvedRef` and `markThisReviewRepliesRead`)
  differ only in their filter.
- `isOutdated` computed twice (in `normalizedThreads` and `displayThreads`).
- `retryReviewOps().catch(...)` in the `isConnected` effect and in `reconnectServer`. The
  catch in `handleCommentsChanged` shares only the error text: it follows
  `reviewOps.refresh()`, a GET, while `retry()` also flushes queued ops (`refresh` and
  `retry` in useReviewOps.ts). Keep `refresh()` there.
- `createDiffSelection(...)` + three ref / state writes (the `launchSelection` and
  `namedSelection` blocks in `fetchDiffData`); the second redoes the first whenever
  `capture` exists.
- The "same review?" test (in `handleRevisionChange` and the popstate handler
  `restoreReview`).
- `handleRevisionChange({...selection, retained: true})` in `DiffQuickMenu`'s
  `onSelectReview` can pass `openReviewFromTab`.
- `clampSidebarWidth` vs the inline clamp in `handleMouseDown`'s `handleMouseMove`; the
  literals `'200px'` / `'600px'` in the `file-tree-panel` `<aside>`'s `minWidth` /
  `maxWidth` repeat `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH`.
- `diffData?.repositoryId ?? 'default'` in `commentsContextKey`, `reviewScope`,
  `namedScope` and the `repositoryId` constant above `reconnectServer` (`readMarkScope`
  differs on purpose: it is `null` before the diff loads, which keeps `useAgentUpdates`
  storage off); `diffData?.reviewContext?.agentSessionId` re-read in the `useReviewOps`
  call and twice in `reconnectServer` though `agentSessionId` exists above them.
- Header button class (the Settings, About and Conversation buttons) and the
  `role="alert"` span (for `approval.error`, `settingsSaveError` and `reviewOps.alert`).
- The same 7 comment-action callbacks passed to `DiffViewer` and
  `CommentsListModal`. `p3-20261114-diff-chunk-renderers.md` task 7 adds the
  shared `ThreadActionProps` type; it runs after this plan, so use it here only if it
  has landed.
