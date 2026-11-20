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

- Deleting one item often leaves another dead: a parameter whose last argument you
  removed, a type or constant only the deleted code used, a test helper only its tests
  used. Delete those in the same batch; that is this plan's purpose, not scope creep.
  Dead code you notice in a file no batch touches goes at the end of the inventory, not
  into the current commit.
- Several items are exported only so a test can reach them. Delete the export and the
  test of the dead code together; keep tests that exercise live behavior through the
  public API.
- `branchToHash` must go from all its places at once: every parameter and argument
  (`rg branchToHash src`: about 6 sites in useViewedFiles.ts and 25 in
  StorageService.ts at `d905dec`), the `undefined` arguments in App.tsx's `useViewedFiles(…)`
  call and in the `record` tuple of its thread-copy effect (`migratedRecordsRef`),
  and the test call sites that pass `undefined` in that slot (StorageService.test.ts,
  `toHaveBeenCalledWith` checks in useViewedFiles.test.ts). With it gone,
  delete the `branchToHash?.has(commitish)` lookup in `normalizeCommitish`, which no longer runs.
- Run the thread-copy item of `p1-20261114-remove-backward-compat.md` task 2 first: it deletes
  App.tsx's thread-copy effect (`migratedRecordsRef`)
  and `getCommentThreads` / `removeCommentThreads`, which also carry `branchToHash`.
- Deleting an always-true guard over an indexed or `Map.get` value
  (`if (lastChunk)` in `expandAllLines` in useExpandedLines.ts; `if (!hash)` and both
  `if (!currentHash)` in `processAutoCollapsedFiles` in useViewedFiles.ts) leaves a `T | undefined`
  type under `noUncheckedIndexedAccess`; each needs a non-null assertion.

## Decision

`StorageService.cleanupOldData` lost its last caller in
c232723, so the `gavel-storage-v1/<repo>/<base>-<target>` context records grow by one per
HEAD commit and range and never expire (a working-tree base normalizes to the current
HEAD hash in `normalizeStorageBase`). The viewed-hash index is one key per repository,
capped at 5,000 entries (`MAX_VIEWED_INDEX_ENTRIES`, enforced in `recordViewedHashes`), so it does not grow.

Accepted as recommended (2026-11-14, BD-1 A): delete `cleanupOldData` rather than call it
on page load. Deleting it changes no behavior; the context records stop growing once
`_todo/p2-20261107-server-only-review-state.md` moves viewed marks to the server. The
rejected option, a fixed expiry on page load, would expire by last write
(`lastModifiedAt`, the field `cleanupOldData` compares, which reads do not refresh); expired marks would come back
from the hash index only for files whose diff had not changed.

## Tasks

Each batch is one commit. Acceptance for every batch: `pnpm build`, `pnpm check` and
`pnpm test` pass, and `rg` for each deleted symbol finds nothing.

### Client hooks and services

- `useExpandedLines`: returned `getHiddenLinesBefore` / `getHiddenLinesAfter` (used only inside the hook); returned
  `expandedState` (read only by tests, but the three reset tests in
  useExpandedLines.test.ts, "clears expanded state and refetches content when the revision
  changes", "clears expanded state and refetches content when the diff identity changes" and
  "does not request unavailable blob data for stdin diffs", check live reset behavior through it: give them
  another observable first); `if (lastChunk)` in `expandAllLines` (always true).
- `useViewedFiles`: `isFileContentChanged` and returned `getViewedFileRecord`
  (also remove their mocks in App.test.tsx's `vi.mock('./hooks/useViewedFiles')`)
  (never used in production); the three `if (!cancelled)` checks at the end of
  `processAutoCollapsedFiles` (the code after the only
  `await` is synchronous); hash guards in `processAutoCollapsedFiles` (the `catch` around
  `generateDiffHash`, `if (!hash)`, and both `if (!currentHash)`; `generateDiffHash`
  catches every error).
- `StorageService`: `cleanupOldData` (see Decision) and `getStorageSize` (no caller); write-only fields `createdAt` and
  `baseCommitish` / `targetCommitish` / `baseMode` (in `saveDiffContextData`); the ignored
  `lastModifiedAt` arguments in `recordViewedHashes` and `removeViewedHashes`. Delete `normalizeStorageTarget`;
  its callers call `normalizeCommitish`, which it duplicates (its `_baseCommitish` is
  unused). `branchToHash` (see Lore).
- One-value version fields (moved here from the compat plan's "leave it" list):
  - The `version === 2` check and its warn-and-return-null in `StorageService.getDiffContextData`,
    plus the `version: 2` writes in `saveDiffContextData` and `saveViewedFiles`.
  - `ViewedHashIndex.version`: the check and the `empty` default in `getViewedHashIndex`, and
    the writes in `recordViewedHashes` and `removeViewedHashes`.
  - `hashVersion` and `VIEWED_HASH_VERSION`: the constant in StorageService.ts; in
    useViewedFiles.ts, the index-entry check in `processAutoCollapsedFiles` and the writes in
    `toggleFileViewed` and `setFilesViewed`; in types/diff.ts, `ViewedHashIndexEntry.hashVersion`,
    `ViewedHashIndex.version` and `DiffContextStorage.version`; the `VIEWED_HASH_VERSION: 1` mocks in
    useViewedFiles.test.ts and
    repositoryIsolation.integration.test.ts. A hash made by a changed algorithm
    already fails the `diffContentHash` comparison, so the version check adds nothing.
  - `format: 1` (`SavedReview.format` in review-store.ts, and the write in server.ts's `saveReview`).
  - config.json `version` (`CONFIG_VERSION` and its write in `writeAutoViewedPatterns`,
    user-config.ts; written, never read).

  Capture `schemaVersion` stays (see the compat plan).

- `utils/wordDetection.ts` `detectWords` (only its test uses it); `isValidWord` if it
  has no other reader.

### Keyboard navigation

- `hooks/keyboardNavigation/scrollUtils.ts`, the visible-element branch of
  `createScrollToElement`: `isBottomHidden` repeats the
  expression `isVisible` already ruled out, so the branch reduces to `return false`
  (checked).
- `keyboardNavigation/types.ts`: `isModalOpen` (no reader). Delete the `ViewMode`
  alias (`export type ViewMode = DiffViewMode;`) and import `DiffViewMode` in its
  three importers (navigationCore.ts, navigationFilters.ts,
  utils/navigation/domHelpers.ts). `NavigationResult.scrollTarget` is live (`findNextMatchingPosition`
  in navigationCore.ts sets it, `createNavigationCommand` in useKeyboardNavigation.ts scrolls to it); keep it.
- `keyboardNavigation/index.ts`: a barrel used outside the hook only for the
  `CursorPosition` type. Redirect its imports (including `createNavigationFilters` and
  `createScrollToElement` in useKeyboardNavigation.ts's `./keyboardNavigation` import) to `types.ts`,
  `navigationFilters.ts` and `scrollUtils.ts`, then delete it.

### Components and viewers

- `DiffChunk.tsx`: `getCommentLayout`'s `switch (line.type)` and the layout ternaries around
  each `CommentThreadCard` and `LineCommentComposer` row (`mode` is always `'unified'` past the
  split-mode `SideBySideDiffChunk` return).
- `CommentThreadCard.tsx`: `ThreadMessageItemProps.onClick` (the prop, its destructuring in
  `ThreadMessageItem`, and the `onClick?.(event)` call; never passed).
- `SettingsModal.tsx`: the `isOpen` prop. App mounts the modal only when open
  (`{isSettingsOpen && <SettingsModal …>}` in App.tsx), so the `if (!isOpen) return;` in the
  focus effect, `enabled: isOpen` on the Escape hotkey, the `else` branch that re-enables the
  `navigation` scope, and `if (!isOpen) return null` are unreachable.
- `NotebookDiffViewer.tsx`: `PreviewState.source` (set by each `setPreviewState` call in
  `loadPreview`, never read); the `isCodeCell && diffLines.length === 0` early return in
  `NotebookDiffPreview` (`diffPreviewCells` already filters those cells, so
  `buildDiffLines` runs twice per code cell).
- `ImageDiffViewer.tsx` `if (!isModified) return null` (the `isDeleted` / `isAdded` /
  `isModified` constants cover all statuses).
- `TextDiffViewer.tsx` `id="chunk-…"` (no consumer found; confirm with a repo-wide
  `rg "chunk-"` first).

### Server and shared

- `generated-file-check.ts`: result fields `reason` and `matchedPattern` (set by the three
  `isGenerated: true` returns in `isGeneratedFile`; only `.isGenerated` is read). `isGeneratedFile` returns a
  boolean. Delete `GeneratedCheckResult` and `PathMatcher.description` (and the
  seven `description` strings in `PATH_MATCHERS`), which only fed `matchedPattern`. Callers in
  git-diff.ts (`parseFileBlock` and the two calls in `getGeneratedStatus`) drop `.isGenerated`.
- `GeneratedStatusResponse` `path`, `ref`, `source` (types/diff.ts; set in server.ts's
  `/api/generated-status` handler and git-diff.ts's `getGeneratedStatus`). The only client reader,
  the `/api/generated-status` fetch in useLazyDiffRendering.ts, reads `isGenerated`, and docs/ and skills/ never
  mention `/api/generated-status`. Return `{ isGenerated }`, and have
  `getGeneratedStatus` return a boolean. Adjust the `getGeneratedStatus` mock in server.test.ts and the
  assertions on `source` in git-diff.test.ts's `getGeneratedStatus` tests (in `Generated file detection`).
- `file-watcher.ts`: the negation branch of `shouldIgnoreEvent` (no pattern in
  `MODE_WATCH_CONFIGS` starts with `!`); the empty `constructor() {}`.
- `utils/commentImports.ts`: `mergeCommentThreads` always returns `warnings: []`
  and its caller reads only `.threads`. Return the thread array; the call in server.ts's
  `POST /api/comments` handler and the tests that call `mergeCommentThreads` in
  commentImports.test.ts drop `.threads`.
- `cli/review.ts` `export { validateReviewName }` (imported only by its test; the
  test can import from `utils/review-name.ts`).
- `server.ts`: `createCommentSessionKey`, a one-line alias of
  `getDiffSelectionKey`; the `NODE_ENV === 'production' ||` clause of `isProduction`,
  implied by the `!== 'development'` clause; the duplicate `reviewStore ?`
  check in the saved-review loader passed to `new Conversation`.

### CSS (`src/client/styles/global.css`)

- `.review-menu [role="checkbox"]` (matches nothing).
- The `.bg-github-bg-primary`, `.bg-github-bg-secondary` and `.bg-github-bg-tertiary` selectors
  in the theme-transition rule (subsumed by `[class*="bg-github"]`).
- `--color-diff-neutral-bg` and its copies in `DARK_THEME_VALUES` and `LIGHT_THEME_VALUES`
  (appearanceTheme.ts).
- `-webkit-user-select` (in the `.split-diff-selection` rule; autoprefixer adds it).
- `interpolate-size` (on `:root`): probably dead. Check in headless Chromium before
  deleting; happy-dom does not apply this CSS, so no unit test can tell.
