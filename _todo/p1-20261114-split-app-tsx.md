---
title: Split App.tsx into concern hooks and header, sidebar and dialog components
priority: p1
section: Refactor
---

# TPP: Split App.tsx

## Summary

`App()` (App.tsx:176-2611 at `d905dec`) holds 37 `useState`, 35 `useRef`, 24
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
- [ ] Design settled: composition root, props only (proposed)
- [ ] Deletions and duplicate removal in place (step 1)
- [ ] Extractions, one commit each, in the order below (steps 2-12)
- [ ] `App.test.tsx` split along the new modules (step 13)
- [ ] `docs/structure.md` updated
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `docs/structure.md`, `p1-20261114-refactor-arc.md`
- `p1-20261114-delete-dead-code.md` and `p1-20261114-remove-backward-compat.md`: they
  delete App.tsx code this plan would otherwise move (`branchToHash` arguments,
  `getNamedReviewStorageRef`, the legacy-thread copy at 1736-1765)
- `src/client/App.tsx` in full before step 1; it changes often
- `_todo/p2-20261113-queued-verdict-not-shown.md` (plans changes to `handleVerdict`)
- `_todo/p1-20261114-agent-updates-render-count-flake.md`

## Where conflicts come from

Touches, measured over App.tsx history at `d905dec` (hunk start lines per commit; script was
in a scratch directory):

| Region                                       | Last 50 commits touching it |
| -------------------------------------------- | --------------------------- |
| Imports (1-120)                              | 22                          |
| `useState` block (first 80 lines of `App()`) | 12                          |
| Hook and handler body                        | 40                          |
| JSX                                          | 35                          |

Within the JSX, the `<header>` (2086-2292) was touched by 22 of the last 60 commits, the
`CommentsListModal` props by 8, the `DiffViewer` props by 5.

Touches are not conflicts. Replaying each pair of consecutive App.tsx commits as parallel
branches (B's change applied to A's parent with a 3-way `git merge-file`) over the last 60
commits (`903707b..d905dec`) gave 13 conflicting pairs:

- 8 were two features in one concern: review tabs (eb9d8a3/bc5978f), agent replies
  (2aa3972/14ff928), change summary (0d52609/ff4ede5), verdict delivery (aa4458f/b963ee6),
  sidebar highlight (6aa3e68/a5e015d), verdict follow-up (aa32f66/8d0008d), and two edits
  to the root shell (ed26f9d/c5b9ac6, c5b9ac6/17574e1). No split prevents these.
- 2 were different concerns that a split separates: the picker edit against hide-header,
  which wrapped and re-indented the header (bc5978f/ed26f9d), and popstate code at 1672
  next to the verdict follow-up at 1687 (8d0008d/6701adb).
- 2 shared one line or one prop list: the derived key at 343 (dd6f723/ff78460) and the
  `DiffViewer` props at 2486 (ab253fc/a012e38). Moving the code does not change these.
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
4. `finishVerdict` / `handleVerdict` (417-515) and `loadRecentReviews` (1520-1623) are
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
  happen after render: `verdictFollowUp` (used 453, 473; declared 1690), `inboxDelivery`
  (472; 1054), `handleCopyAllComments` (1145; 1852), `handleNavigateToDraftLine` and
  `canShowLinkedLine` (1884-1885; 1909, 1928). An extracted hook must take these as
  arguments or callbacks.
- Refs do two different jobs:
  - Refs that cross a kept boundary, because the callee stays in App and is declared
    later: `fetchDiffDataRef` (417/1452; `fetchDiffData` stays in App, and `useVerdict` and
    `useLiveReviewEvents` call it), `switchReviewRef` (234/1673; `useReviewList` calls
    `handleRevisionChange`, which stays in App), and `stopCelebrationRef` (236; `useVerdict`
    owns it and returns a stop function, which `handleRevisionChange` calls at 1638). Pass
    these as hook arguments. `loadRecentReviewsRef` goes in step 1.
  - Latest-value refs: `finishVerdictRef` (478), `toggleThreadResolvedRef` (1798),
    `getMergedChunksRef` (832), `retargetOpsRef` (360/367). They keep a callback's
    identity stable or let a deferred callback read the current render's state, so they
    must stay refs inside whichever hook takes them. Replacing `toggleThreadResolvedRef`
    with an argument re-renders the whole diff on every App render (1808-1814, commit
    1ef8304); replacing `finishVerdictRef` makes a verdict answer that arrives after a
    retry run a stale closure (420-421); replacing `getMergedChunksRef` re-runs the
    merged-chunks effect (846-858) whenever `getMergedChunks` changes identity.
- `activeCommentsContextRef` (396-416) is a generation counter mutated during render. It
  stays in App with review selection; `useVerdict` takes the generation it reads.
- `DiffViewer` is memoized (components/DiffViewer.tsx:216). Keep it off any context
  whose value changes on read marks or toggles: commit 1ef8304 and the `diffViewerRenders`
  render-count test in App.agentUpdates.test.tsx pin that. That test is flaky under load;
  stabilize it first (`_todo/p1-20261114-agent-updates-render-count-flake.md`), or its
  failures during this work will be ambiguous.
- `FileList` is `memo` (FileList.tsx:216), but App passes it callbacks and JSX recreated
  every render (`handleFileOpened` 1216, `handleFirstCommentOpened` 1205, the inline
  `onScrollToSummary` 2369-2377, `headerStatus` 2350-2364), so the memo never skips a
  render. Remove the `memo` in step 1 instead of stabilizing the props: stabilizing would
  add `useCallback` / `useMemo` for a speedup nobody has profiled.
- No test renders the "Deferred Rendering" / "Load now" placeholder (2490-2506), and no
  test covers sidebar drag-resize. Add one each before moving that code.
- Moving code into a hook that App tests mock (`useViewedFiles`, `useDiffComments`,
  `useViewport`, `useFileWatch`) hides it from those tests. App.test.tsx's `useViewedFiles`
  mock (62-72) returns no progress count, runs no effect, and omits `setFilesViewed` (so no
  App.test test reaches folder Viewed, 744-771). "should clear viewed files when
  clearComments flag is true in response" asserts on `mockClearViewedFiles`. So the
  progress count (552-555) and the `--clean` viewed-file clear (1724-1734) stay in App.

## Design (proposed, confirm before step 2)

**Composition root, props only.** Each extracted hook returns one object, and App passes it
whole (`<VerdictArea verdict={verdict} …/>`), so a new field in a hook's result does not
edit App. Components take `diffData` as a prop. Add no context:
`review={diffData.reviewContext}` and `capture={diffData.capture}` appear three times each
(2131, 2285, 2566; 2142, 2166, 2468), which does not pay for a context, its provider value
and its hook, and a context hides which components read review identity. If an extraction
needs a long argument list or new refs to carry state across its boundary, it stays in App.

## Target modules

Line ranges at `d905dec`; sizes approximate.

Absorbed by existing modules:

| Existing module               | Takes                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `hooks/useAgentUpdates.ts`    | Unread candidates and `unreadReviews` 900-944; `agentReadContext`, mark-read handlers, resolve wrapper 1774-1821 |
| `hooks/useVerdictFollowUp.ts` | The warning before leaving a page without a verdict 1706-1722                                                    |
| `hooks/useInboxDelivery.ts`   | `codexReview` / `requiresResume` 1688-1701 as derived output                                                     |

New hooks:

| Hook                     | Takes                                                                                                                                                                                                                                                | About |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `useSidebarLayout`       | 129-131, the sidebar cookie parsers 153-165, 199, 201-209 (takes `isMobile` from `useViewport`; the breakpoint reset must stay in render, not an effect), `handleMouseDown` 1322-1344, persist effects 1490-1509, `handleMobileFileSelected` 809-811 | 95    |
| `useDiffDisplaySettings` | The diff-mode and whitespace cookie parsers 133-151, diffMode / ignoreWhitespace 181-182, 804-812, mobile-unified effect 1475-1479, edited auto-viewed patterns from 517-525 (App keeps the `diffData` fallback), `settingsSaveError` 186-187        | 65    |
| `useReviewList`          | 223-234, `loadRecentReviews` 1520-1623                                                                                                                                                                                                               | 120   |
| `useLiveReviewEvents`    | Live-event handlers 1009-1061, `useFileWatch` + retry + `connectedOnce` + `server` + `reconnectServer` 1063-1118                                                                                                                                     | 110   |
| `useVerdict`             | `isShipping`, verdict anchor 188-196, `stopCelebrationRef` 236, 417-515, follow-up wiring 1687-1705                                                                                                                                                  | 150   |
| `usePresentedFiles`      | 814-899, 945-1001 (expanded lines, merged chunks, canonical / navigable files, line index, display threads, `threadsByFile`)                                                                                                                         | 145   |
| `useFileCollapse`        | 208, 216-218, 557-657, 679-798 (collapse state and reviewed toggles)                                                                                                                                                                                 | 235   |
| `useLineJumps`           | 209-215, 1182-1225, 1878-1990 (calls `useCommentLinks`)                                                                                                                                                                                              | 165   |

New components:

| Component         | Takes                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `ReviewHeader`    | 2078-2302 except the verdict JSX; the picker, agent status and Conversation button stay inline in it |
| `VerdictArea`     | 2244-2291 (`VerdictControl`, `ToastStack`, the alerts), fed by `useVerdict`                          |
| `FileTreeSidebar` | 2316-2404                                                                                            |
| `DiffFilePane`    | 2406-2511, with the "Load now" placeholder (2490-2506) inline                                        |
| `ReviewDialogs`   | 2303-2314, 2514-2607                                                                                 |

Stays in App.tsx:

- The diff-loading and review-selection core: `diffData` state 177-180, loading / error,
  `selectedRevision` 237-251, the derived selection keys 252-352, the generation counter
  396-416, `fetchDiffData` 1337-1473, the revisions fetch 1501-1518, `handleRevisionChange`
  and popstate 1625-1678. Every hook above reads its output, and it reaches into the
  review list, verdict and live events through refs.
- The page title effect (1769-1782), the loading, error and no-data screens (2039-2063),
  the progress count (552-555) and the `--clean` viewed-file clear (1724-1734); see Lore.

The legacy-thread copy (1736-1765) is not moved: `p1-20261114-remove-backward-compat.md`
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

- `loadRecentReviewsRef` (228; 10 uses) exists only because `loadRecentReviews` (1520) is
  declared after its callers. Its dependency list is `[]` (1618), and it reads only refs
  declared by 360 (`recentReviewsRequestRef`, `selectedRevisionRef`, `reviewIdsRef`,
  `retargetOpsRef`, `switchReviewRef`). Declare it before `finishVerdict` (417), call it
  directly, and delete the ref.
- Remove `FileList`'s `memo` (FileList.tsx:216). It never skips a render, because
  `headerStatus` is new JSX on every render (2350-2364), so removing it changes no render.
- Candidate; check before doing it: `approvalControlRef` (190) holds the same element as
  the `verdictAnchor` state (192). Its only reader is `finishVerdict` (459, 463), which runs
  through `finishVerdictRef` and so sees the latest render's `verdictAnchor`. Passing
  `setVerdictAnchor` as `containerRef` would delete the ref and `setVerdictControl`. The
  difference: the ref reads the element after `finishVerdict`'s awaits, while the closure
  reads it as of the render in which the answer arrived. A review switch remounts
  `VerdictControl` (key `commentsContextKey`) but also fails `sameReview()`. Reasoned, not
  tested.
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
