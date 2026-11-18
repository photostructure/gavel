---
title: Tests that pass without checking what their names claim
priority: p2
section: Tests
---

# TPP: Weak and vacuous tests

Found by reading during the 2026-11-14 refactor audit. Finished against base commit
`47c5959`; only test files changed.

## Outcome

Each repaired test was checked by breaking the behavior its name describes in the
production code, confirming the test failed, and restoring the code. Each deleted test
was checked by breaking its behavior and confirming a remaining test failed.

`repositoryIsolation.integration.test.ts`:

- "should isolate auto-marked generated files between repositories" asserted inside a
  `setTimeout` that ran after the test returned. It now renders repository 1, awaits its
  auto-mark with `waitFor`, then renders repository 2 and awaits its auto-mark, and
  asserts each repository's viewed set holds only its own lock file. Rendering them one
  after the other lets repository 2 read what repository 1 saved if storage ignored
  `repositoryId`, which is the break the test catches.
- "should maintain separate view counts for different repositories" (`it.skip`) was
  deleted: its assertions repeat "should isolate viewed files between different
  repositories".

`useKeyboardNavigation.test.tsx`:

- Repaired to assert exact cursor positions: n (two presses, the second skipping
  file1.js's unchanged lines into file2.js), p, and `.` (the line nearest the scroll
  container's center).
- "should not trigger refresh when onRefresh is not provided" pressed `r`, which has no
  binding. It now presses Shift+R and asserts the keyboard promise resolves; a handler
  that throws rejects it.
- The two "Input Field Handling" tests asserted on `onToggleReviewed` after j and r,
  which never call it. They now type `jv` into the field with a hovered file, and assert
  the field holds the text, the cursor stays null, and `onToggleReviewed` is not called.
- Deleted, because remaining tests assert the same key exactly: "should navigate to next
  file with ] key" (both "Cursor Memory" tests assert `]` moves from file 0 to file 1),
  "should navigate to next comment with Shift+N" and "should navigate to previous comment
  with Shift+P" (the two old-side/new-side comment tests assert exact positions for both
  keys).
- "should use navigation scope for hotkeys", not listed in the audit, asserted only that
  the initial cursor is null. It now renders under a provider whose only active scope is
  `modal`, presses j, and asserts the cursor stays null; removing `scopes: 'navigation'`
  from the hook's options makes it fail.

`CommentsListModal.test.tsx`: `mockRemoveThread` is renamed `mockToggleThreadResolved`,
and the one test that also passed it as `onRemoveThread` now passes `vi.fn()` there.

## Not done

"should not trigger refresh when onRefresh is not provided" still names an outcome
nobody can observe (there is no callback to trigger); "should ignore shift+r when
onRefresh is not provided" would name the outcome.
