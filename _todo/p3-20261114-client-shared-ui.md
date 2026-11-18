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
  Task 5 also edits `server.ts:1225`; it goes after `p2-20261114-split-server-ts.md`.
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
   MarkdownDiffViewer.tsx:213-338 and NotebookDiffViewer.tsx:591-706, and
   `getCommentMarkdownComponents` in CommentBodyRenderer.tsx:97-264, repeat some entries.
   In a new `components/markdownComponents.tsx` (`utils/markdownUtils.ts` is `.ts` and
   cannot hold JSX), share only the entries that are identical today, as plain
   components: `img`, identical in all three maps; `a`, `li`, `blockquote` and `hr`,
   identical in the Markdown and Notebook maps; and a `parseFence(children)` returning
   `{ codeText, language }` for the five lines that open each `pre`. Each map keeps its
   own headings, `p`, `ul`, `ol`, `pre`, `code` and table entries, whose class strings
   differ in every map; Markdown alone also has `thead` / `tbody` / `tr` and a
   `markdown-preview-code` class. The comment map keeps its own `a`: it routes gavel
   links through `links.follow`, rewrites them with `links.linkHref`, stops propagation
   to the card, and keeps modified clicks (CommentBodyRenderer.tsx:140-175), while the
   preview `a` only applies `isSafeUrl`, which rejects `?review=…`; pins
   CommentBodyRenderer.test.tsx:201-267. Also share
   `getBlockStyle` (Markdown 340-351) = `getCellBorderStyle` (Notebook 533-544),
   `isDeletionLine` / `isContextLine`, `isFetchableRef`, and the preview-mode guard and
   tabs (Markdown 847-867, Notebook 1188-1208) as a `usePreviewMode(hasFullPreview)` hook
   in `viewers/PreviewModeTabs.tsx`. Pins: MarkdownDiffViewer, NotebookDiffViewer,
   CommentBodyRenderer tests.
2. **Navigation-scope hook.** The navigation-scope toggle (HelpModal.tsx:17-30,
   SettingsModal.tsx:143-157, AboutPanel.tsx:80-112, CommentsListModal.tsx:308-322,
   RevisionDetailModal.tsx:37-47), focus return on close (HelpModal 33-43, SettingsModal
   126-136, AboutPanel 83-113, CommentsListModal 169-176), Tab wrap (AboutPanel 91-104,
   SettingsModal 242-265, CommentsListModal 392-425) and Escape repeat across the modals.
   Add `useNavigationScopeDisabled(isOpen)` next to `hooks/useSlideOver.ts` for the three
   identical effects (HelpModal.tsx:16-29, SettingsModal.tsx:143-157,
   RevisionDetailModal.tsx:38-47); in each it is a move. CommentsListModal also switches
   its own `comments-list` scope (308-322) and keeps its effect. Leave focus return, Tab
   wrap and Escape in each modal: focus return differs (HelpModal passes
   `preventScroll: true`, SettingsModal 126-136 does not); the three Tab-wrap focusable
   selectors differ (About `'button, summary, a[href]'`; Settings adds form controls and
   `[tabindex]`; Conversation also excludes `[hidden]` ancestors and unchecked radios);
   Escape is one `useHotkeys` line. Adding RevisionDetailModal's missing
   `role="dialog"`, focus move, or Escape adds behavior: separate commits, ask first.
   Pins: HelpModal.test.tsx:47-59, CommentsListModal.unread.test.tsx:252-256,
   SettingsModal, AboutPanel, RevisionDetailModal tests.
3. **Copy feedback.** Two kinds of copy button exist today. AgentDeliveryStatus.tsx:82-104,
   ReviewPresenceIndicator.tsx:21-63 and AccessTokenGate.tsx:24-48 never reset: they show
   "…copied" until unmount and "Copy failed; try again" on rejection.
   CommentThreadCard.tsx:170-180 and 412-475, DiffViewerHeader.tsx:84 and 137-141, and
   App.tsx:188 and 1862-1864 reset after 2000 ms and have no error label. Export the
   existing `CopyResumePrompt` (AgentDeliveryStatus.tsx:74-106) and render it in
   ReviewPresenceIndicator in place of its inline copy (21-63), which has the same state,
   handler and labels. The two differ only in `title` (AgentDeliveryStatus has one) and in
   classes (`shrink-0 text-xs` against `justify-center`). Use the AgentDeliveryStatus
   markup for both, as its own commit, since the presence button gains a tooltip. Leave
   AccessTokenGate alone (its labels differ), and the timed buttons too: their missing
   timer clear (DiffViewerHeader, App) is fixed in place, see
   `p2-20261114-small-audit-defects.md`. Leave
   `useVerdictFollowUp.ts:144-156` alone; it is a phase machine.
4. **Revision menu parts.** `getItemClasses` is identical in DiffQuickMenu.tsx:403-419
   and RevisionSelector.tsx:157-173. The commit and branch button bodies and the empty
   state match except for their actions: DiffQuickMenu passes `createDiffSelection(...)`,
   RevisionSelector passes `shortHash` and sets `disabled` (DiffQuickMenu 573-628,
   RevisionSelector 251-301). Share `getItemClasses`, which is byte-identical. Inside
   DiffQuickMenu, render the duplicated commit button (573-593, 699-717) from one local
   function. Leave the lists, search box (479-494, 208-223), trigger chip (449-493,
   194-226) and `matchesQuery` in each file: a `CommitBranchList` would take select
   handlers, active and disabled predicates, the heading text ('Commits' at
   DiffQuickMenu:570 against 'Recent Commits' at RevisionSelector:249) and DiffQuickMenu's
   branch `title`. Leave the four floating-ui `size` middlewares, which set different
   things: width at DiffQuickMenu.tsx:163 and 199, width and height at HeaderMenu.tsx:47,
   and height capped at 400 at RevisionSelector.tsx:59. Pins:
   DiffQuickMenu.test.ts, DiffQuickMenu.positioning.test.ts, RevisionSelector.test.tsx,
   RevisionDetailModal.test.tsx.
5. **One blob URL builder and shared response types.** Move `blobUrl(path, source)`
   (useExpandedLines.ts:60-68) beside `apiFetch` in `client/utils/accessToken.ts`, and
   use it at the other four blob-URL sites. Add no `apiJson` / `apiText`: the callers
   below use five error styles, so a shared reader would either throw, forcing the three
   null-returning callers to add try/catch, or take an error-style option. Call sites and
   their current error handling: throw `statusText` (MarkdownDiffViewer.tsx:760,
   useExpandedLines.ts:74, 99); return null (NotebookDiffViewer.tsx:488,
   useFileLevelTokens.ts:28, useLazyDiffRendering.ts:326); `${status} ${statusText}`
   (useReviewOps.ts:133, 193); server `body.error` (App.tsx:1368); fixed message
   (useReviewApproval.ts:28, useReviewSummary.ts:30, services/autoViewedPatterns.ts:24).
   Blob URLs built in five places: ImageDiffViewer.tsx:137, NotebookDiffViewer.tsx:487,
   MarkdownDiffViewer.tsx:757-758, useFileLevelTokens.ts:25-26, useExpandedLines.ts:60.
   ImageDiffViewer's URL feeds an `<img src>`, so it is wrapped in `withAccessTokenQuery`
   and falls back to `HEAD~1` / `HEAD` (133-138); it resolves the fallback and wraps the
   result itself, so `blobUrl` takes no option.
   Declare response types in `src/types`: `LineCountResponse` (server.ts:1225,
   useExpandedLines.ts:87, 101), the comments-json snapshot (useReviewOps.ts:30-34 equals
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
   `firstLineOf`, `lastLineOf`, `rangeOf` into `src/utils/commentThreads.ts`. Add
   `formatLineRange(line)`, returning `40-52` or `40`, for the two sites that build
   exactly that string (CommentThreadCard.tsx:457-459, UnsentDrafts.tsx:174). Leave the
   two `describeLines` functions alone: hooks/useCommentLinks.ts:45-49 picks 'Line' or
   'Lines', and LineCommentComposer.tsx:48 uses an en dash and a side prefix, so no
   visible change needs a decision. Also leave out two sites that are not labels: `utils/commentLinks.ts:99` writes the `line=40-52` URL parameter, which
   `LINE_PATTERN` (`/^(\d+)(?:-(\d+))?$/`, commentLinks.ts:22) parses back, so it must
   stay an ASCII hyphen; `src/utils/commentFormatting.ts:6` writes `L40-L52` into the
   agent prompt. Pins: positionHelpers, ignoreWhitespace, commentLinks (the round trip at
   commentLinks.test.ts:113-120), CommentThreadCard tests.
7. **String-literal unions.** Export and use: `DiffSide` (types/diff.ts:36) for inline
   `'old' | 'new'` (review-capture.ts:603, 612; cli/github.ts:133, 138;
   ImageDiffViewer.tsx:133; useExpandedLines.ts:62); an `ExpandDirection` for
   `'up' | 'down'` (types/diff.ts:296, viewers/types.ts:35, useExpandedLines.ts:42, 259,
   529, DiffViewer.tsx:74); `CursorPosition['side']` (no new alias name) for
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
   - The card frame classes (CommentThreadCard.tsx:558, CommentForm.tsx:142,
     UnsentDrafts.tsx:176) and the `'User'` author string (useDiffComments.ts:73, 123).
   - `client/utils/autoViewedPatterns.ts` and `client/services/autoViewedPatterns.ts`
     share a basename but hold unrelated code; rename one.

## Leave alone

- The selection-to-query encoders (App.tsx:316-333, App.tsx:1347-1360,
  `setReviewParams` in client/utils/reviewNavigation.ts:93-108). They differ: 316-333
  never sets `retainedReview` and checks `reviewName` by truthiness; 1347-1360 accepts an
  undefined selection and skips an empty base or target; `setReviewParams` deletes stale
  keys. One encoder would need an option per difference. The server decoder
  (server.ts:732-755) defaults to the current selection on purpose.
- The unread / progress key `JSON.stringify([threadId, messageId])`: owned by
  `p3-20261114-server-modules.md` task 6.
