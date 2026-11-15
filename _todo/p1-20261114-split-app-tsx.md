---
title: Split App.tsx into concern hooks and header, sidebar and dialog components
priority: p1
section: Refactor
---

# TPP: Split App.tsx

## Summary

`App()` (App.tsx:176-2611 at `d905dec`) holds 37 `useState`, 35 `useRef`, 24
`useEffect`, 40 `useCallback` and 24 `useMemo`, then one 540-line JSX tree. One feature
typically edits 4-6 places spread across the file (imports, the state block, a hook call,
the header JSX, a modal's props), so any two features in one concern collide. This plan
moves each concern into its own hook and each JSX region into its own component, so that
App wires hook output into components and a feature edits the files of its concern.
Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: after `p1-20261114-delete-dead-code.md`, `p1-20261114-remove-backward-compat.md` and
`p1-20261114-shared-test-helpers.md` task 2 land, step 1 below.

- [x] Map and conflict analysis (below)
- [ ] Design settled: composition root plus one review-identity context (proposed)
- [ ] Extractions, one commit each, in the order below
- [ ] `App.test.tsx` split along the new modules
- [ ] `docs/structure.md` updated
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `docs/structure.md`, `p1-20261114-refactor-arc.md`
- `p1-20261114-delete-dead-code.md` and `p1-20261114-remove-backward-compat.md`: they
  delete App.tsx code this plan would otherwise move (`branchToHash` arguments,
  `getNamedReviewStorageRef`, the legacy-thread copy at 1736-1765)
- `src/client/App.tsx` in full before step 1; it changes often
- `src/client/contexts/ReviewProviders.tsx`
- `_todo/p2-20261113-queued-verdict-not-shown.md` (plans changes to `handleVerdict`)
- `_todo/p1-20261114-agent-updates-render-count-flake.md`

## Where conflicts come from

Measured over App.tsx history at `d905dec` (hunk start lines per commit; script was in a
scratch directory):

| Region                                       | Last 50 commits touching it |
| -------------------------------------------- | --------------------------- |
| Imports (1-120)                              | 22                          |
| `useState` block (first 80 lines of `App()`) | 12                          |
| Hook and handler body                        | 40                          |
| JSX                                          | 35                          |

Within the JSX, the `<header>` (2086-2292) was touched by 22 of the last 60 commits, the
`CommentsListModal` props by 8, the `DiffViewer` props by 5. Mechanisms seen in sampled
diffs (b963ee6, a4699a2, 99ea7f0, 9d9d6ee, f26016e):

1. One feature edits several distant places: b963ee6 (agent delivery) changed imports,
   the `useInboxDelivery` call, the `useFileWatch` arguments, `useVerdictFollowUp`
   options, the header, the alerts, and `CommentsListModal.headerActions`.
2. Imports are grouped loosely, not sorted, so new imports land next to the same
   neighbors.
3. The `useFileWatch` call takes 7 positional callbacks; its destructuring line rewraps
   whenever a field is added.
4. The header is one flat run of siblings: `VerdictControl`, `ToastStack`, alerts,
   `AgentDeliveryStatus`, the Conversation button, the picker.
5. `finishVerdict` / `handleVerdict` (417-515) and `loadRecentReviews` (1520-1623) are
   single long functions that verdict, review-list and rename features all edit.

## Lore

- Closures call things declared later in `App()`; this works only because the calls
  happen after render: `verdictFollowUp` (used 453, 473; declared 1690), `inboxDelivery`
  (472; 1054), `handleCopyAllComments` (1145; 1852), `handleNavigateToDraftLine` and
  `canShowLinkedLine` (1884-1885; 1909, 1928). An extracted hook must take these as
  arguments or callbacks.
- Eight refs do two different jobs:
  - Refs that break a dependency cycle between future hooks: `fetchDiffDataRef`
    (417/1452), `loadRecentReviewsRef` (228/1620), `switchReviewRef` (234/1673),
    `stopCelebrationRef` (236). Keep them, or replace them with a hook argument.
  - Latest-value refs: `finishVerdictRef` (478), `toggleThreadResolvedRef` (1798),
    `getMergedChunksRef` (832), `retargetOpsRef` (360/367). They keep a callback's
    identity stable or let a deferred callback read the current render's state, so they
    must stay refs inside whichever hook takes them. Replacing `toggleThreadResolvedRef`
    with an argument re-renders the whole diff on every App render (1808-1814, commit
    1ef8304); replacing `finishVerdictRef` makes a verdict answer that arrives after a
    retry run a stale closure (420-421); replacing `getMergedChunksRef` re-runs the
    merged-chunks effect (846-858) whenever `getMergedChunks` changes identity.
- `useDiffDisplaySettings` and `useDiffLoader` would form a cycle at step 12:
  `fetchDiffData` reads `ignoreWhitespace` (1348, 1455-1467), and the auto-viewed
  patterns read `diffData` (517-525, `edited ?? diffData?.autoViewedPatterns ?? []`).
  Keep the server-pattern fallback out of `useDiffDisplaySettings`: it returns
  `editedAutoViewedPatterns` and its handler, and App (or `useViewedFiles`) computes the
  fallback.
- `activeCommentsContextRef` (396-416) is a generation counter mutated during render.
- `DiffViewer` is memoized (components/DiffViewer.tsx:216). Keep it off any context
  whose value changes on read marks or toggles: commit 1ef8304 and the `diffViewerRenders`
  render-count test in App.agentUpdates.test.tsx pin that. That test is flaky under load;
  stabilize it first (`_todo/p1-20261114-agent-updates-render-count-flake.md`), or its
  failures during this work will be ambiguous.
- `FileList` is `memo` (FileList.tsx:216), but App passes it callbacks and JSX recreated
  every render (`handleFileOpened` 1216, `handleFirstCommentOpened` 1205, the inline
  `onScrollToSummary` 2369-2377, `headerStatus` 2350-2364), so the memo never skips a
  render. Reasoned, not profiled. Fix it right after the `FileTreeSidebar` extraction, in
  its own commit: stabilizing those props changes render behavior, so it is not a move.
- No test renders the "Deferred Rendering" / "Load now" placeholder (2490-2506), and no
  test covers sidebar drag-resize. Add one each before moving that code.
- App.test.tsx's `useViewedFiles` mock (62-72) omits `setFilesViewed`, so no App.test
  test reaches folder Viewed (744-771).

## Design (proposed, confirm before step 3)

**Option A (preferred): composition root plus one review-identity context.** Each
concern hook returns the values and stable callbacks its component needs, and App only
passes `useX()` output into `<XArea …/>`. Add one context, in `ReviewProviders`, for the
slowly changing review identity (diffData metadata, resolved selection, `reviewContext`,
capture), so components stop receiving `review={diffData.reviewContext}`-style props.

**Option B: a context per concern.** Fewer props, but every consumer re-renders on any
change in its context, which conflicts with the `DiffViewer` render-count constraint.

## Target modules

Line ranges at `d905dec`; sizes approximate.

Absorbed by existing modules:

| Existing module                | Takes                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `services/userSettings.ts`     | Cookie parsers 133-165                                                                                           |
| `hooks/useAgentUpdates.ts`     | Unread candidates and `unreadReviews` 900-944; `agentReadContext`, mark-read handlers, resolve wrapper 1774-1821 |
| `hooks/useViewedFiles.ts`      | Progress count 552-555; the `--clean` viewed-file clear 1724-1734                                                |
| `hooks/useVerdictFollowUp.ts`  | The warning before leaving a page without a verdict 1706-1722                                                    |
| `hooks/useInboxDelivery.ts`    | `codexReview` / `requiresResume` 1688-1701 as derived output                                                     |
| `contexts/ReviewProviders.tsx` | The review-identity context                                                                                      |

New hooks:

| Hook                     | Takes                                                                                                                                                                                                            | About |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `useSidebarLayout`       | 129-131, 199, 201-209 (takes `isMobile` from `useViewport`; the breakpoint reset must stay in render, not an effect), `handleMouseDown` 1322-1344, persist effects 1490-1509, `handleMobileFileSelected` 809-811 | 80    |
| `useDiffDisplaySettings` | diffMode / ignoreWhitespace 181-182, 804-812, mobile-unified effect 1475-1479, edited auto-viewed patterns from 517-525 (not the server fallback), `settingsSaveError` 186-187                                   | 45    |
| `usePageTitle`           | 1769-1782                                                                                                                                                                                                        | 15    |
| `useReviewList`          | 223-234, `loadRecentReviews` 1520-1623                                                                                                                                                                           | 120   |
| `useLiveReviewEvents`    | Live-event handlers 1009-1061, `useFileWatch` + retry + `connectedOnce` + `server` + `reconnectServer` 1063-1118                                                                                                 | 110   |
| `useVerdict`             | `isShipping`, verdict anchor 188-196, `stopCelebrationRef` 236, 417-515, follow-up wiring 1687-1705                                                                                                              | 150   |
| `usePresentedFiles`      | 814-899, 945-1001 (expanded lines, merged chunks, canonical / navigable files, line index, display threads, `threadsByFile`)                                                                                     | 145   |
| `useFileCollapse`        | 208, 216-218, 557-657, 679-798 (collapse state and reviewed toggles)                                                                                                                                             | 235   |
| `useLineJumps`           | 209-215, 1182-1225, 1878-1990 (calls `useCommentLinks`)                                                                                                                                                          | 165   |
| `useReviewSelection`     | Derived keys in 252-352 (not the appearance, viewport, header, `useTopVisibleFile` and `useDraftCount` calls at 280-294 and 313), generation counter 396-416                                                     | 120   |
| `useDiffLoader`          | `diffData` state 177-180, loading / error, `selectedRevision` 237-251, `fetchDiffData` 1337-1473, revisions fetch 1501-1518, `handleRevisionChange` + popstate 1625-1678                                         | 230   |

New components:

| Component                                                                                                                                     | Takes                |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `AppStatusScreen`                                                                                                                             | 2039-2063            |
| `DeferredFilePlaceholder`                                                                                                                     | 2490-2506            |
| `ReviewHeader`, split into `VerdictArea` (2244-2291), `AgentStatus` (2127-2132), `ReviewPicker` (2135-2171), `ConversationButton` (2206-2243) | 2078-2302            |
| `FileTreeSidebar`                                                                                                                             | 2316-2404            |
| `DiffFilePane`                                                                                                                                | 2406-2511            |
| `ReviewDialogs`                                                                                                                               | 2303-2314, 2514-2607 |

The legacy-thread copy (1736-1765) is not moved: `p1-20261114-remove-backward-compat.md`
deletes it first.

## Tasks

One commit per step, smallest risk first. Each new hook gets a `renderHook` test next to
it. Acceptance for every step: `pnpm test` passes with the listed tests unchanged in
their assertions, and `pnpm build` passes.

1. Module-level moves (the cookie parsers 133-165; `getNamedReviewStorageRef` is gone
   by then). Pins: App.test "Diff Mode Persistence", "Sidebar persistence".
2. `AppStatusScreen`, `DeferredFilePlaceholder` (add the placeholder test first). Pins:
   App.test "Diff load errors".
3. `useSidebarLayout` + `FileTreeSidebar` (add a drag-resize test first). Pins: App.test
   "Sidebar persistence", "Mobile sidebar auto-close", "sidebar highlight follows the line
   cursor", "Review progress", "change summary placement", "sidebar comment jumps".
4. `useDiffDisplaySettings`. Pins: App.test "Diff Mode Persistence", "Auto-viewed
   patterns", "Settings the browser refuses to keep"; App.conversations.
5. Unread and title code into `useAgentUpdates` + `usePageTitle`. Pins:
   App.agentUpdates, App.test "Custom tab title", useAgentUpdates.test.ts,
   useNewReplyPulse.test.ts.
6. `useReviewList` + `ReviewPicker`. Pins: App.namedReviews rename / delete tests,
   App.commentLinks, App.test "Review navigation", "Retained conversation contexts".
7. `useLiveReviewEvents` + `AgentStatus`. Pins: App.reviewOps reconnect tests,
   App.namedReviews watch callbacks, App.test "Heartbeat Connection", "Ship it delivery",
   useFileWatch.test.ts, AgentDeliveryStatus.test.tsx.
8. `useVerdict` + `VerdictArea`. Coordinate with
   `_todo/p2-20261113-queued-verdict-not-shown.md`. Pins: App.test "Ship it", "Approval
   celebration", "Ship it delivery"; App.namedReviews "after a verdict" and the
   before-leaving tests; App.reviewOps "verdict shortcuts"; useVerdictFollowUp,
   useReviewApproval, VerdictControl, ToastStack tests.
9. `usePresentedFiles`. Pins: App.largeFiles, App.conversations, App.commentLinks,
   App.test "Review navigation", mergedChunks, outdatedComments, ignoreWhitespace tests.
10. `useFileCollapse`. Pins: App.test "Initial file collapsing", "Viewed files reload";
    App.largeFiles; useLazyDiffRendering.test.ts.
11. `useLineJumps`. Pins: App.commentLinks, App.test "sidebar comment jumps",
    App.agentUpdates, useCommentLinks.test.ts.
12. `useReviewSelection` + `useDiffLoader`. Highest risk: every other hook consumes
    their output and the ref cycles meet here. Pins: App.test "Merge-base selection",
    "Revision-aware refetching", "Diff load errors", "Review navigation", "Retained
    conversation contexts"; App.namedReviews popstate; App.conversations;
    reviewNavigation.test.ts.
13. `DiffFilePane` and `ReviewDialogs`. Pins: App.test "Editor launch", App.agentUpdates
    render count, CommentsListModal tests.
14. Split `App.test.tsx` (3,235 lines) along its describe blocks to follow the modules:
    verdict (Ship it, Approval celebration, Ship it delivery), file collapse (Initial file
    collapsing, Viewed files reload), sidebar, revisions (Merge-base, Revision-aware
    refetching, Review navigation, Retained contexts), settings (Settings refuse,
    Auto-viewed, Diff Mode Persistence, Header display controls), comments (Clear
    Comments block). Every other describe (Heartbeat Connection, Diff load errors, Editor
    launch, Review progress, Sidebar persistence, Mobile sidebar auto-close, Custom tab
    title, Committed review summaries, change summary placement, sidebar comment jumps)
    goes with the module it pins or stays in `App.test.tsx`. While splitting, fold the
    repeated `vi.clearAllMocks(); mockComments = []` into the top-level `beforeEach`; keep
    `mockFetch(mockDiffResponse)` and `mockConfirm` setup in the describes that have them
    today (7 and 12 of the 17), since adding them elsewhere changes those tests.
    Acceptance: the same `it` names pass across the new files (`pnpm vitest list` before
    and after).

### Duplication to remove while moving (same commits, trivial)

- The "context still current" check at 706-710 and 751-755 is the negation of
  `isScrollContextCurrent()` (658-663).
- The "open one file" updater (682-687, 1917-1922) and the "open many files" updater
  (566-570, 652-656).
- The three mark-read loops calling `setAgentMessageRead(...)` (1792-1794, 1801-1805,
  1816-1820) differ only in their filter.
- `isOutdated` computed twice (882-884, 894-896).
- `retryReviewOps().catch(...)` at 1090-1092 and 1115-1117. The catch at 1025 shares only
  the error text: it follows `reviewOps.refresh()`, a GET, while `retry()` also flushes
  queued ops (useReviewOps.ts:189-223). Keep `refresh()` there.
- `createDiffSelection(...)` + three ref / state writes (1406-1418, 1420-1430); the
  second redoes the first whenever `capture` exists.
- The "same review?" test (1630-1634, 1658-1663).
- `handleRevisionChange({...selection, retained: true})` at 2144-2146 can pass
  `openReviewFromTab` (1676).
- `clampSidebarWidth` (153-154) vs the inline clamp at 1320-1323; the literals
  `'200px'` / `'600px'` at 2341-2342 repeat `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH`.
- `diffData?.repositoryId ?? 'default'` at 302, 350, 363, 1112 (922 differs on purpose:
  it is `null` before the diff loads, which keeps `useAgentUpdates` storage off);
  `diffData?.reviewContext?.agentSessionId` re-read at 357, 1114, 1118 though
  `agentSessionId` exists at 346.
- Header button class (2177, 2190, 2223) and the `role="alert"` span (2272, 2277, 2288).
- The same 7 comment-action callbacks passed to `DiffViewer` (2456-2463) and
  `CommentsListModal` (2598-2604). `p3-20261114-diff-chunk-renderers.md` task 7 adds the
  shared `ThreadActionProps` type; it runs after this plan, so use it here only if it
  has landed.
