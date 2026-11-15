---
title: Replace repeated client components and helpers with one shared copy each
priority: p3
section: Refactor
---

# TPP: Shared client UI pieces and helpers

## Summary

The client writes the same pieces in several files: three react-markdown component maps,
five modal shells, eight copy-to-clipboard buttons, two revision-menu lists, 17 `/api`
fetch call sites with five error styles, line-range helpers, and repeated string-literal
unions. Each task below replaces one cluster with one shared copy. Tasks are independent
and each is its own commit. Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1.

- [x] Clusters located (below, at `d905dec`)
- [ ] Tasks done, one commit each
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- Tasks that edit `App.tsx` (3, 5, 7, 9) go after or into `p1-20261114-split-app-tsx.md`.
  Task 5 also edits `server.ts:1225`; it goes after `p2-20261114-split-server-ts.md`.
- `p3-20261114-diff-chunk-renderers.md` tasks 4 and 7 touch the same lines as tasks 6
  and 7 here (`lastLineOf` at SideBySideDiffChunk.tsx:255-257; `'left' | 'right'` in
  DiffChunk and SideBySideDiffChunk); do them in one place.
- The unmerged Codex worktree `comment-link-range-fix` (commit 94d5f58, "fix(comment-links):
  limit range jumps to their destination") edits `hooks/useCommentLinks.ts`, which task 6
  edits; it adds one more inline last-line site there.

## Tasks

Acceptance for each: the listed tests pass unchanged, `pnpm build` and `pnpm check` pass.

1. **One react-markdown component factory.** `getMarkdownComponents` in
   MarkdownDiffViewer.tsx:213-338 and NotebookDiffViewer.tsx:591-706, and
   `getCommentMarkdownComponents` in CommentBodyRenderer.tsx:97-264, share the safe-link
   `a`, `img`, the `pre` language parse and inline `code`. Add
   `createMarkdownComponents({classes, syntaxTheme, renderFence, renderLink?})` in a new
   `components/markdownComponents.tsx` (`utils/markdownUtils.ts` is `.ts` and cannot hold
   JSX). Keep each surface's sizes (`text-base` / `text-sm` / `text-xs`, heading margins,
   the `headingStyles` arrays) as parameters; they differ on purpose. The comment
   surface's `a` is not the shared safe link: it routes gavel links through
   `links.follow`, rewrites them with `links.linkHref`, stops propagation to the card,
   and keeps modified clicks (CommentBodyRenderer.tsx:140-175), while the preview `a`
   only applies `isSafeUrl`, which rejects `?review=…`. Keep it as a `renderLink`
   override; pins CommentBodyRenderer.test.tsx:201-267. Also share
   `getBlockStyle` (Markdown 340-351) = `getCellBorderStyle` (Notebook 533-544),
   `isDeletionLine` / `isContextLine`, `isFetchableRef`, and the preview-mode guard and
   tabs (Markdown 847-867, Notebook 1188-1208) as a `usePreviewMode(hasFullPreview)` hook
   in `viewers/PreviewModeTabs.tsx`. Pins: MarkdownDiffViewer, NotebookDiffViewer,
   CommentBodyRenderer tests. No test pins heading or text classes; add one per surface
   first.
2. **Modal shell hooks.** The navigation-scope toggle (HelpModal.tsx:17-30,
   SettingsModal.tsx:143-157, AboutPanel.tsx:80-112, CommentsListModal.tsx:308-322,
   RevisionDetailModal.tsx:37-47), focus return on close (HelpModal 33-43, SettingsModal
   126-136, AboutPanel 83-113, CommentsListModal 169-176), Tab wrap (AboutPanel 91-104,
   SettingsModal 242-265, CommentsListModal 392-425) and Escape. Add
   `useNavigationScopeDisabled`, `useDialogFocus` next to `hooks/useSlideOver.ts`, and a
   `wrapTabFocus(event, panel)` in `utils/domUtils.ts`. The three Tab-wrap focusable
   selectors differ (About `'button, summary, a[href]'`; Settings adds form controls and
   `[tabindex]`; Conversation also excludes `[hidden]` ancestors and unchecked radios);
   the Conversation one is the most complete. HelpModal already toggles the scope, moves and returns focus, and closes
   on Escape, so the hooks there are a move; only Tab wrap or `role="dialog"` would add
   behavior. RevisionDetailModal's scope toggle (37-47) is also a move; adding its missing
   `role="dialog"`, focus move, or Escape, or changing About's selector, adds behavior:
   separate commits, ask first.
   Pins: HelpModal.test.tsx:47-59, CommentsListModal.unread.test.tsx:252-256,
   SettingsModal, AboutPanel, RevisionDetailModal tests.
3. **Copy feedback.** Two kinds of copy button exist today. AgentDeliveryStatus.tsx:82-104,
   ReviewPresenceIndicator.tsx:21-63 and AccessTokenGate.tsx:24-48 never reset: they show
   "…copied" until unmount and "Copy failed; try again" on rejection.
   CommentThreadCard.tsx:170-180 and 412-475, DiffViewerHeader.tsx:84 and 137-141, and
   App.tsx:188 and 1862-1864 reset after 2000 ms and have no error label. Add a
   `useCopiedFlag({resetMs?})` with no reset by default and an optional error flag, that
   clears its timer on unmount and on a repeat click; each button keeps its current
   behavior. The existing tests assert the label right after the click without advancing
   timers (AgentDeliveryStatus.test.tsx:369, AccessTokenGate.test.tsx:57), so they would
   not notice a wrong `resetMs`; add a timer-advance assertion per kind first. A
   `CopyResumePromptButton` for AgentDeliveryStatus and ReviewPresenceIndicator (same
   labels) takes `className` and `title`, since the two buttons differ in those. The two
   timed buttons that never clear their timer (DiffViewerHeader, App) are a defect: see
   `p2-20261114-small-audit-defects.md`. Leave
   `useVerdictFollowUp.ts:144-156` alone; it is a phase machine.
4. **Revision menu parts.** `getItemClasses` is identical in DiffQuickMenu.tsx:403-419
   and RevisionSelector.tsx:157-173. The commit and branch button bodies and the empty
   state match except for their actions: DiffQuickMenu passes `createDiffSelection(...)`,
   RevisionSelector passes `shortHash` and sets `disabled` (DiffQuickMenu 573-628,
   RevisionSelector 251-301); a shared list takes those as props. Also shared: the search box (479-494,
   208-223), the trigger chip (449-493, 194-226) and `matchesQuery`. The commit button
   is also duplicated inside DiffQuickMenu (573-593, 699-717). Add
   `components/RevisionMenuParts.tsx` with a `CommitBranchList`. The floating-ui `size`
   middleware is written four times (DiffQuickMenu.tsx:163, 199, HeaderMenu.tsx:47,
   RevisionSelector.tsx:59). Pins:
   DiffQuickMenu.test.ts, DiffQuickMenu.positioning.test.ts, RevisionSelector.test.tsx,
   RevisionDetailModal.test.tsx.
5. **One client API module.** Add `apiJson<T>`, `apiText` and `blobUrl(path, source)`
   (moved from useExpandedLines.ts:62-70) beside `apiFetch` in
   `client/utils/accessToken.ts` (rename to `api.ts` optional). Call sites and their
   current error handling: throw `statusText` (MarkdownDiffViewer.tsx:760,
   useExpandedLines.ts:76, 101); return null (NotebookDiffViewer.tsx:488,
   useFileLevelTokens.ts:28, useLazyDiffRendering.ts:326); `${status} ${statusText}`
   (useReviewOps.ts:133, 193); server `body.error` (App.tsx:1368); fixed message
   (useReviewApproval.ts:28, useReviewSummary.ts:30, services/autoViewedPatterns.ts:24).
   Keep each caller's null-versus-throw choice; only the plumbing is shared. Blob URLs
   built in five places: ImageDiffViewer.tsx:137, NotebookDiffViewer.tsx:487,
   MarkdownDiffViewer.tsx:757-758, useFileLevelTokens.ts:25-26, useExpandedLines.ts:62.
   ImageDiffViewer's URL feeds an `<img src>`, so it is wrapped in `withAccessTokenQuery`
   and falls back to `HEAD~1` / `HEAD` (133-138); `blobUrl` must keep both for it.
   Declare response types in `src/types`: `LineCountResponse` (server.ts:1225,
   useExpandedLines.ts:89, 103), the comments-json snapshot (useReviewOps.ts:30-34 equals
   `Omit<ReviewOpsResponse,'results'>`), and use `GeneratedStatusResponse`
   (types/diff.ts:99) in useLazyDiffRendering. `ImageDiffViewer.tsx:64` never checks
   `response.ok` (defect; same small-defects TPP). Do not merge `useReviewApproval` and
   `useReviewSummary`: their stale-answer rules differ.
6. **Line-range helpers.** `lastLineOf` and `rangeOf` exist at
   LineCommentComposer.tsx:19-26 (only `lastLineOf` exported). Inline copies: last line
   (navigation/positionHelpers.ts:68-70, 93; SideBySideDiffChunk.tsx:255-257), range
   (ignoreWhitespace.ts:56, DiffViewer.tsx:128), first line (CommentsListModal.tsx:100-101;
   useKeyboardNavigation.ts:62 keys on the first line, which is the Shift+N/P defect in
   `p3-20261114-keyboard-nav-defects.md`, not intended behavior). Move
   `firstLineOf`, `lastLineOf`, `rangeOf` into `src/utils/commentThreads.ts`. Add a
   `formatLineRange` for on-screen labels only: CommentThreadCard.tsx:457-459,
   UnsentDrafts.tsx:174, hooks/useCommentLinks.ts:45-49, and `describeLines`
   (LineCommentComposer.tsx:48). The labels use a hyphen in some places and an en dash in
   `describeLines`; picking one is visible, ask first. Leave out two sites that are not
   labels: `utils/commentLinks.ts:99` writes the `line=40-52` URL parameter, which
   `LINE_PATTERN` (`/^(\d+)(?:-(\d+))?$/`, commentLinks.ts:22) parses back, so it must
   stay an ASCII hyphen; `src/utils/commentFormatting.ts:6` writes `L40-L52` into the
   agent prompt. Pins: positionHelpers, ignoreWhitespace, commentLinks (the round trip at
   commentLinks.test.ts:113-120), CommentThreadCard tests.
7. **String-literal unions.** Export and use: `DiffSide` (types/diff.ts:36) for inline
   `'old' | 'new'` (review-capture.ts:603, 612; cli/github.ts:133, 138;
   ImageDiffViewer.tsx:133; useExpandedLines.ts:64); an `ExpandDirection` for
   `'up' | 'down'` (types/diff.ts:296, viewers/types.ts:35, useExpandedLines.ts:44, 270,
   556, DiffViewer.tsx:74); `CursorPosition['side']` as `NavigationSide` for
   `'left' | 'right'` (App.tsx:1278, viewers/types.ts:68, useKeyboardNavigation.ts:131,
   DiffViewer.tsx:90, DiffChunk.tsx:72, 145, SideBySideDiffChunk.tsx:71, 96);
   `ResolvedTheme` and an exported `ThemePreference` (appearanceTheme.ts:3, 7) for
   useAppearanceSettings.ts:57, SettingsModal.tsx:33, 159, 172, themeLoader.ts:23-29.
   Acceptance: `pnpm build`.
8. **Small repeats.**
   - `getFileIcon`: identical in DiffViewerHeader.tsx:50-63 and FileList.tsx:320-333.
   - The yellow button with JS hover (CommentButton.tsx:16-28, CommentForm.tsx:226-238,
     CommentsDropdown.tsx:63-76, 85-100): one `.btn-yellow` class with `:hover` in
     global.css.
   - The rAF scroll handler in useCursorFile.ts:49-66 and useTopVisibleFile.ts:72-89: a
     `useRafScroll(measure)` hook.
   - Intent labels (CommentThreadCard.tsx:301-305, CommentForm.tsx:134-136), the card
     frame classes (CommentThreadCard.tsx:528, UnsentDrafts.tsx:178), the unread key
     (CommentThreadCard.tsx:85, useAgentUpdates.ts:62), the `'User'` author string
     (CommentThreadCard.tsx:157, useDiffComments.ts:82, 137).
   - `client/utils/autoViewedPatterns.ts` and `client/services/autoViewedPatterns.ts`
     share a basename but hold unrelated code; rename one.
9. **Selection to query string.** Client encoders at App.tsx:316-333, App.tsx:1347-1360
   and `setReviewParams` (client/utils/reviewNavigation.ts:93-108, private). They differ:
   316-333 never sets `retainedReview` and checks `reviewName` by truthiness; 1347-1360
   accepts an undefined selection and skips an empty base or target; `setReviewParams`
   deletes stale keys. Add characterization tests for each caller first, then export a
   `selectionQuery(selection, options)` that covers those differences. The server decoder
   (server.ts:732-755) defaults to the current selection on purpose; leave it.
