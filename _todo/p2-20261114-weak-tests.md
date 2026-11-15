---
title: Tests that pass without checking what their names claim
priority: p2
section: Tests
---

# TPP: Weak and vacuous tests

Found by reading during the 2026-11-14 refactor audit (line numbers at `d905dec`).

- `repositoryIsolation.integration.test.ts:136-178` puts its `expect`s inside a
  `setTimeout` that runs after the test returns, so the test asserts nothing. `:183` is
  `it.skip` with the comment "async timing issues". Await the condition instead of
  sleeping, and unskip.
- `useKeyboardNavigation.test.tsx:1252` presses `r`, not Shift+R. `:1567` and `:1600`
  assert on `onToggleReviewed`, which j and r never call. `:658` and `:1475` assert only
  `not.toBeNull()`.
- `CommentsListModal.test.tsx:65` passes `mockRemoveThread` as `onToggleThreadResolved`;
  rename the mock or pass the right one.

Acceptance per test: break the behavior it names in a scratch worktree and confirm the
test fails, then restore.
