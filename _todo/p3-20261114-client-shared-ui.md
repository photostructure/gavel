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
unions. Each task shares the parts that are identical today and leaves the parts where
callers differ. When a shared copy would need a parameter or override per caller
difference, the duplication stays. Tasks are independent
and each is its own commit. Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1.

- [x] Clusters located (below, at `d905dec`)
- [ ] Tasks done, one commit each
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- Tasks that edit `App.tsx` (7) go after or into `p1-20261114-split-app-tsx.md`.
  Task 5 also edits the `/api/line-count` route in `server.ts`; it goes after
  `p2-20261114-split-server-ts.md`.
- `p3-20261114-diff-chunk-renderers.md` task 7 touches the same declarations as task 7
  here (`'left' | 'right'` in DiffChunk, SideBySideDiffChunk and `viewers/types.ts`); do
  them in one place.
- The unmerged Codex worktree `comment-link-range-fix` (commit 94d5f58, "fix(comment-links):
  limit range jumps to their destination") edits `hooks/useCommentLinks.ts`, which task 6
  edits; it adds one more inline last-line site there.

## Lore

- Simplicity: share only code that is identical across callers today. If a shared
  helper needs a parameter, option or override for a caller difference, leave the
  copies. Prefer reusing an existing component (`CopyResumePrompt`) to writing a new
  one. A task that would add more lines than it removes is dropped, with a note saying
  why.

## Tasks

Acceptance for each: the listed tests pass unchanged, `pnpm build` and `pnpm check` pass.

1. **Shared react-markdown entries.** `getMarkdownComponents` in
   MarkdownDiffViewer.tsx and NotebookDiffViewer.tsx, and
   `getCommentMarkdownComponents` in CommentBodyRenderer.tsx, repeat some entries.
   In a new `components/markdownComponents.tsx` (`utils/markdownUtils.ts` is `.ts` and
   cannot hold JSX), share only the entries that are identical today, as plain
   components: `img`, identical in all three maps; `a`, `li`, `blockquote` and `hr`,
   identical in the Markdown and Notebook maps; and a `parseFence(children)` returning
   `{ codeText, language }` for the five lines that open each `pre`. Each map keeps its
   own headings, `p`, `ul`, `ol`, `pre`, `code` and table entries, whose class strings
   differ in every map; Markdown alone also has `thead` / `tbody` / `tr` and a
   `markdown-preview-code` class. The comment map keeps its own `a`: it routes gavel
   links through `links.follow`, rewrites them with `links.linkHref`, stops propagation
   to the card, and keeps modified clicks (the `a` entry in `getCommentMarkdownComponents`),
   while the preview `a` only applies `isSafeUrl`, which rejects `?review=…`; pins the
   `gavel links` tests in CommentBodyRenderer.test.tsx. Also share
   `getBlockStyle` (MarkdownDiffViewer) = `getCellBorderStyle` (NotebookDiffViewer),
   `isDeletionLine` / `isContextLine`, `isFetchableRef`, and the preview-mode guard and
   tabs (the `hasFullPreview` memo, the effect that leaves `'full-preview'` without it, and
   `<PreviewModeTabs>` in `MarkdownDiffViewer` and `NotebookDiffViewer`) as a
   `usePreviewMode(hasFullPreview)` hook
   in `viewers/PreviewModeTabs.tsx`. Pins: MarkdownDiffViewer, NotebookDiffViewer,
   CommentBodyRenderer tests.
2. **Navigation-scope hook.** The navigation-scope toggle (the
   `disableScope('navigation')` effects in HelpModal, SettingsModal, AboutPanel,
   CommentsListModal and RevisionDetailModal), focus return on close (the `previous.focus`
   effects in HelpModal, SettingsModal, AboutPanel and CommentsListModal), Tab wrap
   (AboutPanel's `onKey` handler, and the Tab branch of the `onKeyDown` handlers in
   SettingsModal and CommentsListModal) and Escape repeat across the modals.
   Add `useNavigationScopeDisabled(isOpen)` next to `hooks/useSlideOver.ts` for the three
   identical effects (in HelpModal, SettingsModal and RevisionDetailModal); in each it is
   a move. CommentsListModal also switches its own `comments-list` scope (the
   `enableScope('comments-list')` effect) and keeps its effect. Leave focus return, Tab
   wrap and Escape in each modal: focus return differs (HelpModal passes
   `preventScroll: true`, SettingsModal's does not); the three Tab-wrap focusable
   selectors differ (About `'button, summary, a[href]'`; Settings adds form controls and
   `[tabindex]`; Conversation also excludes `[hidden]` ancestors and unchecked radios);
   Escape is one `useHotkeys` line. Adding RevisionDetailModal's missing
   `role="dialog"`, focus move, or Escape adds behavior: separate commits, ask first.
   Pins: HelpModal.test.tsx's "takes focus from the button that opened About, and returns
   it on close", CommentsListModal.unread.test.tsx's "keeps Tab focus inside Conversation
   and restores the opener on close", SettingsModal, AboutPanel, RevisionDetailModal tests.
3. **Copy feedback.** Two kinds of copy button exist today. `CopyResumePrompt` in
   AgentDeliveryStatus.tsx and the copy buttons in `ReviewPresenceIndicator` and
   `AccessTokenGate` never reset: they show
   "…copied" until unmount and "Copy failed; try again" on rejection. The file-path,
   About, Copy reply, Copy prompt and Copy All Prompt buttons already share `useCopy`
   (src/client/hooks/useCopy.ts), which resets after 2000 ms and shows a failure on the
   control and in the `CopyFailedNotice` toast. Export the
   existing `CopyResumePrompt` (AgentDeliveryStatus.tsx) and render it in
   ReviewPresenceIndicator in place of its inline copy, which has the same state,
   handler and labels. The two differ only in `title` (AgentDeliveryStatus has one) and in
   classes (`shrink-0 text-xs` against `justify-center`). Use the AgentDeliveryStatus
   markup for both, as its own commit, since the presence button gains a tooltip. Leave
   AccessTokenGate alone (its labels differ), and the `useCopy` buttons too. Leave
   `copyPrompt` in `useVerdictFollowUp.ts` alone; it is a phase machine.
4. **Revision menu parts.** `getItemClasses` is identical in DiffQuickMenu.tsx
   and RevisionSelector.tsx. The commit and branch button bodies and the empty
   state match except for their actions: DiffQuickMenu passes `createDiffSelection(...)`,
   RevisionSelector passes `shortHash` and sets `disabled` (the `filteredCommits.map`,
   `filteredBranches.map` and `hasNoMatches` blocks in each). Share `getItemClasses`, which
   is byte-identical. Inside DiffQuickMenu, render the duplicated commit button (in
   `filteredCommits.map` and in the commit submenu's `options.commits.map`) from one local
   function. Leave the lists, search box (the "Filter branches and commits" input), trigger
   chip (the `refs.setReference` button) and `matchesQuery` in each file: a
   `CommitBranchList` would take select handlers, active and disabled predicates, the
   heading text ('Commits' in DiffQuickMenu against 'Recent Commits' in RevisionSelector)
   and DiffQuickMenu's branch `title`. Leave the four floating-ui `size` middlewares, which
   set different things: width in DiffQuickMenu.tsx's two `useFloating` calls (the menu and
   the `commitRefs` submenu), width and height in HeaderMenu.tsx's `useFloating`, and
   height capped at 400 in RevisionSelector.tsx's `useFloating`. Pins:
   DiffQuickMenu.test.ts, DiffQuickMenu.positioning.test.ts, RevisionSelector.test.tsx,
   RevisionDetailModal.test.tsx.
5. **One blob URL builder and shared response types.** Move `blobUrl(path, source)`
   (useExpandedLines.ts) beside `apiFetch` in `client/utils/accessToken.ts`, and
   use it at the other four blob-URL sites. Add no `apiJson` / `apiText`: the callers
   below use five error styles, so a shared reader would either throw, forcing the three
   null-returning callers to add try/catch, or take an error-style option. Call sites and
   their current error handling: throw `statusText` (`fetchBlob` in MarkdownDiffViewer.tsx,
   `fetchFileContent` and `fetchLineCount` in useExpandedLines.ts); return null
   (`fetchNotebookContent` in NotebookDiffViewer.tsx, `fetchBlobText` in
   useFileLevelTokens.ts, the `/api/generated-status` fetch in useLazyDiffRendering.ts);
   `${status} ${statusText}` (`send` and `refresh` in useReviewOps.ts); server `body.error`
   (`fetchDiffData` in App.tsx); fixed message (`refresh` in useReviewApproval.ts and in
   useReviewSummary.ts, `saveAutoViewedPatterns` in services/autoViewedPatterns.ts).
   Blob URLs built in five places: the local `blobUrl` in ImageDiffViewer.tsx,
   `fetchNotebookContent` in NotebookDiffViewer.tsx, `fetchBlob` in MarkdownDiffViewer.tsx,
   `fetchBlobText` in useFileLevelTokens.ts, `blobUrl` in useExpandedLines.ts.
   ImageDiffViewer's URL feeds an `<img src>`, so it is wrapped in `withAccessTokenQuery`
   and falls back to `HEAD~1` / `HEAD` (its local `blobUrl`); it resolves the fallback and
   wraps the result itself, so `blobUrl` takes no option.
   Declare response types in `src/types`: `LineCountResponse` (the `/api/line-count` route
   in server.ts, `fetchLineCount` in useExpandedLines.ts), the comments-json snapshot
   (`Snapshot` in useReviewOps.ts equals
   `Omit<ReviewOpsResponse,'results'>`), and use `GeneratedStatusResponse`
   (types/diff.ts) in useLazyDiffRendering. `recordInfo` in ImageDiffViewer.tsx never checks
   `response.ok` (defect; same small-defects TPP). Do not merge `useReviewApproval` and
   `useReviewSummary`: their stale-answer rules differ.
6. **Line-range helpers.** `lastLineOf` and `rangeOf` exist in
   LineCommentComposer.tsx (only `lastLineOf` exported). Inline copies: last line
   (`findCommentPosition` and `findSidePosition` in navigation/positionHelpers.ts;
   `getThreadsForLine` in SideBySideDiffChunk.tsx), range (`hideWhitespaceChanges` in
   ignoreWhitespace.ts, `normalizeCommentRanges` in DiffViewer.tsx), first line
   (`compareThreadsByPosition` in CommentsListModal.tsx; `commentIndex` in
   useKeyboardNavigation.ts keys on the first line, which is the Shift+N/P defect in
   `p3-20261114-keyboard-nav-defects.md`, not intended behavior). Move
   `firstLineOf`, `lastLineOf`, `rangeOf` into `src/utils/commentThreads.ts`. Add
   `formatLineRange(line)`, returning `40-52` or `40`, for the two sites that build
   exactly that string (`lineLabel` in CommentThreadCard.tsx, the `label` in
   `ThreadDraftRow` in UnsentDrafts.tsx). Leave the two `describeLines` functions alone:
   the one in hooks/useCommentLinks.ts picks 'Line' or 'Lines', and the one in
   LineCommentComposer.tsx uses an en dash and a side prefix, so no
   visible change needs a decision. Also leave out two sites that are not labels:
   `linkPlaceFragment` in `utils/commentLinks.ts` writes the `line=40-52` URL parameter, which
   `LINE_PATTERN` (`/^(\d+)(?:-(\d+))?$/`, commentLinks.ts) parses back, so it must
   stay an ASCII hyphen; `getLineInfo` in `src/utils/commentFormatting.ts` writes
   `L40-L52` into the agent prompt. Pins: positionHelpers, ignoreWhitespace, commentLinks
   (the round trip in commentLinks.test.ts's "writes a file place that reads back the
   same" test), CommentThreadCard tests.
7. **String-literal unions.** Export and use: `DiffSide` (types/diff.ts) for inline
   `'old' | 'new'` (`capturedFileContent` and its `readVersion` in review-capture.ts;
   `createSingleLinePosition` and `createMultiLinePosition` in cli/github.ts; the local
   `blobUrl` in ImageDiffViewer.tsx; `blobUrl` in useExpandedLines.ts); an
   `ExpandDirection` for `'up' | 'down'` (`ExpandedRange` in types/diff.ts,
   `expandHiddenLines` in viewers/types.ts, `expandLines` in `UseExpandedLinesResult`, the
   `expandLines` callback and `getExpandedCount` in useExpandedLines.ts, the `expandLines`
   prop in DiffViewer.tsx); `CursorPosition['side']` (no new alias name) for
   `'left' | 'right'` (`handleLineClick` in App.tsx, `onLineClick` in viewers/types.ts,
   `switchSide` in useKeyboardNavigation.ts, `onLineClick` in DiffViewer.tsx, `onLineClick`
   and `handleRowClick` in DiffChunk.tsx, `onLineClick` and `ClickedLineTarget` in
   SideBySideDiffChunk.tsx); `ResolvedTheme` and an exported `ThemePreference`
   (appearanceTheme.ts) for `applyTheme` in useAppearanceSettings.ts, the
   `AppearanceSettings.theme` field, `getCurrentTheme` and `handleThemeChange` in
   SettingsModal.tsx, and `getThemesForResolvedTheme`, `isSyntaxThemeForResolvedTheme` and
   `getFallbackSyntaxTheme` in themeLoader.ts.
   Acceptance: `pnpm build`.
8. **Small repeats.**
   - `getFileIcon`: identical in DiffViewerHeader.tsx and FileList.tsx.
   - The yellow button with JS hover (the inline `--color-yellow-btn-*` `style` and
     `onMouseEnter` / `onMouseLeave` handlers in `CommentButton`, `CommentForm`'s submit
     button, and `CommentsDropdown`'s Copy All and "More options" buttons): one
     `.btn-yellow` class with `:hover` in global.css.
   - The rAF scroll handler (`onScroll` and its `cancelAnimationFrame` cleanup effect) in
     useCursorFile.ts and useTopVisibleFile.ts: a `useRafScroll(measure)` hook.
   - The card frame classes (the `border-l-yellow-400` class strings in
     `CommentThreadCard`, `CommentForm` and `ThreadDraftRow` in UnsentDrafts.tsx) and the
     `'User'` author string (`newThread` and `replyToThread` in useDiffComments.ts).
   - `client/utils/autoViewedPatterns.ts` and `client/services/autoViewedPatterns.ts`
     share a basename but hold unrelated code; rename one.

## Leave alone

- The selection-to-query encoders (`commentSessionQueryString` in App.tsx, the `/api/diff`
  query in `fetchDiffData` in App.tsx, `setReviewParams` in
  client/utils/reviewNavigation.ts). They differ: `commentSessionQueryString`
  never sets `retainedReview` and checks `reviewName` by truthiness; `fetchDiffData`
  accepts an undefined selection and skips an empty base or target; `setReviewParams`
  deletes stale keys. One encoder would need an option per difference. The server decoder
  (`getCommentSelectionFromQuery` in server.ts) defaults to the current selection on
  purpose.
- The unread / progress key `JSON.stringify([threadId, messageId])`: owned by
  `p3-20261114-server-modules.md` task 6.
