---
title: Delete dead code that knip cannot see
priority: p1
section: Refactor
---

# TPP: Delete dead code

## Summary

`knip` passes, but it counts test imports as use and cannot see unused returned-object
fields, class methods, interface members, unreachable branches, or CSS. The audit at
`d905dec` found the items below. Deleting them changes no behavior and shrinks the files
the splits will move. Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: client hooks and services batch.

- [x] Inventory (below; each item checked by grep for readers)
- [ ] Deleted, batch by batch
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`

## Lore

- Several items are exported only so a test can reach them. Delete the export and the
  test of the dead code together; keep tests that exercise live behavior through the
  public API.
- `branchToHash` must go from all its places at once: every parameter and argument
  (`rg branchToHash src`: about 6 sites in useViewedFiles.ts and 25 in
  StorageService.ts at `d905dec`), the `undefined` arguments at App.tsx:539 and :1745,
  and the test call sites that pass `undefined` in that slot (StorageService.test.ts,
  `toHaveBeenCalledWith` checks in useViewedFiles.test.ts). With it gone,
  `normalizeCommitish` 72-78 is unreachable.
- Run the thread-copy item of `p1-20261114-remove-backward-compat.md` task 2 first: it deletes App.tsx:1736-1765
  and `getCommentThreads` / `removeCommentThreads`, which also carry `branchToHash`.
- Deleting an always-true guard over an indexed or `Map.get` value
  (useExpandedLines.ts:440, useViewedFiles.ts:157, 183, 202) leaves a `T | undefined`
  type under `noUncheckedIndexedAccess`; each needs a non-null assertion.

## Decision

`StorageService.cleanupOldData` (StorageService.ts:468-502) lost its last caller in
c232723, so the `gavel-storage-v1/<repo>/<base>-<target>` context records grow by one per
HEAD commit and range and never expire (a working-tree base normalizes to the current
HEAD hash, StorageService.ts:170-171). The viewed-hash index is one key per repository,
capped at 5,000 entries (`MAX_VIEWED_INDEX_ENTRIES`, 14, 415-419), so it does not grow.

Accepted as recommended (2026-11-14, BD-1 A): delete `cleanupOldData` rather than call it
on page load. Deleting it changes no behavior; the context records stop growing once
`_todo/p2-20261107-server-only-review-state.md` moves viewed marks to the server. The
rejected option, a fixed expiry on page load, would expire by last write
(`lastModifiedAt`, 487-493, which reads do not refresh); expired marks would come back
from the hash index only for files whose diff had not changed.

## Tasks

Each batch is one commit. Acceptance for every batch: `pnpm build`, `pnpm check` and
`pnpm test` pass, and `rg` for each deleted symbol finds nothing.

### Client hooks and services

- `useExpandedLines`: `lastUpdatedFilePath` (136, 155, 262, 801, no reader); returned
  `getHiddenLinesBefore` / `getHiddenLinesAfter` (used only inside the hook); returned
  `expandedState` (read only by tests, but the three reset tests at
  useExpandedLines.test.ts:213, 280, 308 check live reset behavior through it: give them
  another observable first); `if (lastChunk)` at 440 (always true).
- `useViewedFiles`: `isFileContentChanged` (304-313) and returned `getViewedFileRecord`
  (also remove their mocks at App.test.tsx:68-69)
  (never used in production); `if (!cancelled)` at 206, 208, 224 (the code after the only
  `await` is synchronous); hash guards at 104-106, 157, 183, 202 (`generateDiffHash`
  catches every error).
- `StorageService`: `cleanupOldData` (468-502, see Decision) and `getStorageSize` (507, no caller); write-only fields `createdAt` and
  `baseCommitish` / `targetCommitish` / `baseMode` (219-221); the ignored
  `lastModifiedAt` arguments at 423 and 449; `normalizeStorageTarget` (183-189) equals
  `normalizeCommitish` and its `_baseCommitish` is unused. `branchToHash` (see Lore).
- `utils/wordDetection.ts` `detectWords` (only its test uses it); `isValidWord` if it
  has no other reader.

### Keyboard navigation

- `hooks/keyboardNavigation/scrollUtils.ts:51-58`: `isBottomHidden` repeats the
  expression `isVisible` already ruled out, so the branch reduces to `return false`
  (checked).
- `keyboardNavigation/types.ts`: `isModalOpen` (52, no reader). The `ViewMode` alias (70)
  has three importers (navigationCore.ts:10, navigationFilters.ts:5,
  utils/navigation/domHelpers.ts:2); replacing it means switching them to
  `DiffViewMode`. `NavigationResult.scrollTarget` is live (navigationCore.ts:118 sets it,
  useKeyboardNavigation.ts:96-100 scrolls to it); keep it.
- `keyboardNavigation/index.ts`: a barrel used outside the hook only for the
  `CursorPosition` type. Redirect its imports (including `createNavigationFilters` and
  `createScrollToElement` at useKeyboardNavigation.ts:9-18) to `types.ts`,
  `navigationFilters.ts` and `scrollUtils.ts`, then delete it.

### Components and viewers

- `DiffChunk.tsx`: `getCommentLayout`'s switch (181-188) and the ternaries at 383-392,
  418-427 (`mode` is always `'unified'` past the split-mode return at 274).
- `CommentThreadCard.tsx`: `ThreadMessageItemProps.onClick` (65, 148, 269; never passed).
- `SettingsModal.tsx`: the `isOpen` prop. App mounts the modal only when open
  (App.tsx:2514-2516), so 130, 140, 147-150, 225 are unreachable.
- `NotebookDiffViewer.tsx`: `PreviewState.source` (set at 1027, 1053, 1073, 1093, never
  read); the early return at 852-854 (958-963 already filters those cells, so
  `buildDiffLines` runs twice per code cell).
- `ImageDiffViewer.tsx:180` `if (!isModified) return null` (124-127 cover all statuses).
- `TextDiffViewer.tsx:154` `id="chunk-…"` (no consumer found; confirm with a repo-wide
  `rg "chunk-"` first).

### Server and shared

- `generated-file-check.ts`: result fields `reason` and `matchedPattern` (3-4, set at
  275-276, 301-302, 319-320; only `.isGenerated` is read).
- `file-watcher.ts`: the negation branch of `shouldIgnoreEvent` (185-188; no pattern in
  `MODE_WATCH_CONFIGS` starts with `!`); the empty `constructor() {}` (65).
- `utils/commentImports.ts`: `mergeCommentThreads` always returns `warnings: []` (482)
  and its caller reads only `.threads`.
- `cli/review.ts:51` `export { validateReviewName }` (imported only by its test; the
  test can import from `utils/review-name.ts`).
- `server.ts`: `createCommentSessionKey` (211-213), a one-line alias of
  `getDiffSelectionKey`; the `NODE_ENV === 'production' ||` clause of `isProduction`
  (2308-2309), implied by the `!== 'development'` clause; the duplicate `reviewStore ?`
  check at 416.

### CSS (`src/client/styles/global.css`)

- `.review-menu [role="checkbox"]` (154-156, matches nothing).
- The selectors at 249-251 (subsumed by 252).
- `--color-diff-neutral-bg` (191) and its copies at appearanceTheme.ts:32, 64.
- `-webkit-user-select` (165; autoprefixer adds it).
- `interpolate-size` (231-234): probably dead. Check in headless Chromium before
  deleting; happy-dom does not apply this CSS, so no unit test can tell.
