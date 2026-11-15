---
title: Share the App, server and Git test fixtures that each test file copies
priority: p1
section: Tests
---

# TPP: Shared test helpers

## Summary

Seven `App.*.test.tsx` files each mock `useFileWatch`, render `<App>` inside a
`HotkeysProvider` and stub `WebSocket`; six of them route `/api/*` in their own fake
server (App.test.tsx uses `mockFetch` instead). Six
server integration tests and several CLI tests each define the same `git()` and
`request()` helpers, with three argument orders. `server.test.ts` (4,461 lines) holds a
`git-diff.js` mock that every split-out file would need. The App and server splits
(`p1-20261114-split-app-tsx.md`, `p2-20261114-split-server-ts.md`) need these helpers
before they move test blocks. Part of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1.

- [ ] Server fixture repo and request helper
- [ ] `useFileWatch` named-handler signature and shared App test harness
- [ ] `server.test.ts` mocks moved to a shared module
- [ ] Component test render helpers
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `docs/test.md`, `p1-20261114-refactor-arc.md`
- `src/server/test-access-token.ts` and `src/client/utils/liveConnection.testing.ts`
  (existing test-only modules in `src/`)
- `_todo/p3-20261110-git-env-config-isolation.md` (same Git environment
  question as task 1)
- `_todo/p1-20261114-agent-updates-render-count-flake.md` (stabilize before touching
  `App.agentUpdates.test.tsx`)

## Lore

- `vi.mock` factories are hoisted per file. A factory cannot call a helper exported from
  a module that itself imports the mocked module (directly or through `App`): that fails
  with `ReferenceError: Cannot access '__vi_import_0__' before initialization`, and
  reaching it through `vi.importActual` fails with a circular load. A
  `__mocks__/<name>.ts` next to the module, used through a bare `vi.mock('./hooks/useFileWatch')`,
  works even when `App` is imported first, and the test and the mocked module share one
  instance. Checked in a scratch Vitest 5.0.5 project during review of this plan. This
  also avoids `await import` inside a factory (Matthew's CLAUDE.md forbids it).
- `App.test.tsx` uses a different strategy from the other six App files: it mocks
  `useDiffComments`, `useViewedFiles` and `useViewport` with module-level `let` state
  (App.test.tsx:33-72) and uses `mockFetch` from vitest.setup.ts:41-103. The others use
  the real hooks behind a per-file fake server. Do not force one strategy on both in
  this plan.
- The `git()` copies differ in three ways: `core.hooksPath` (`devNull`, a
  `disabled-hooks` directory, or `--no-verify` instead), whether `GIT_*` variables are
  stripped (inline filter or `vi.stubEnv` in `beforeEach`), and whether
  `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` are set. The helper settles one variant.
  `withoutGitEnvironment` already exists at src/cli/index.integration.test.ts:33-37.
- `server.test.ts:13` sets `process.env.VITEST_SERVER_TEST`, but vitest.setup.ts:26
  reads it before the test file runs, and server.test.ts:81 overwrites `globalThis.fetch` anyway.
  Line 13 may do nothing (not confirmed).
- `App.namedReviews.test.tsx` handles `PUT` / `DELETE /api/approval` in its fake router
  (about lines 201-203). No client code sends those; verdicts go through `review-ops`.
  Drop them when that router moves into the shared fake server.

## Tasks

1. **Server fixture repo and request helper.** Add `createFixtureRepo()` returning
   `{root, git, cleanup}`, `requestJson(running, path, {body, method, status})`, and a
   `lineThread(id)` factory, next to `src/server/test-access-token.ts` (or rename that
   file to `test-server.ts`). Replace the copies in review-ops, named-reviews,
   review-store, live-approval, committed-summary and session-inbox integration tests,
   approval.test.ts, unapply.test.ts, review-capture.test.ts (223-236 plus the inline
   inits at 803, 836, 870, 984, 997, 1064), git-client.test.ts, git-diff.capture.test.ts,
   git-diff.metadata.test.ts, and index.integration.test.ts. `rg "startsWith\('GIT_'\)"
   src --glob '*.test.*'` lists the environment-stripping copies. The inline inits in
   review-capture.test.ts create nested repos inside the fixture tree
   (`git('-C', module, 'init')`); they use the helper's `git`, not `createFixtureRepo()`.
   Acceptance: each listed suite passes unchanged in its assertions;
   `rg "user.email=gavel@example.com" src --glob '*.test.*'` finds nothing (the helper is
   not a `*.test.*` file).
2. **`useFileWatch` takes a named handler object** instead of 7 positional callbacks
   (hooks/useFileWatch.ts:20-29, call at App.tsx:1064-1073). Then add
   `src/client/hooks/__mocks__/useFileWatch.ts` exporting the captured named callbacks and
   a connection setter (see Lore for why it cannot live in `App.testing.tsx`), and
   `src/client/App.testing.tsx` with `renderApp()`, `installBrowserStubs({intersection})`,
   a configurable
   `fakeReviewServer(overrides)` built on `applyReviewOp`, and the thread and capture
   factories (`thread()` in commentLinks:47 and conversations:19, `createMockThread` in
   App.test:119, `generalThread` in reviewOps:80). Convert the six non-`App.test.tsx`
   files; convert `App.test.tsx`'s render wrapper and watch mock only.
   Acceptance: `pnpm test App useFileWatch` passes; the `__mocks__` file is the only
   mock implementation, and no test passes a factory to `vi.mock('./hooks/useFileWatch')`.
3. **`server.test.ts` setup into shared modules.** Move the `GitDiffParserMock`
   (122-185), `parserInstances`, the `review-capture` mock and saved-reviews temp dir
   (108-120), the `process.exit` stub and cleanup (643-667), `openLive` / `closeLive` /
   `liveUrl` (187-210), `putVerdict`, `postAgentSummary`, `startObservedServer`. Add a
   `start(options)` that registers its own cleanup (removes 88 `servers.push` calls). Use
   `preferredPort: 0` for tests that only need some free port. Keep `getAvailablePort`
   (86-104) in the shared module, and keep explicit ports, for tests that need a known
   port: those that send requests before `startServer` resolves ("buffers live
   submissions during asynchronous startup until readiness", 906-928, and the request at
   840-858), the busy-port test (670), the derived-port test that omits `preferredPort`
   (710), and the fallback test (1019). `start(options)` must accept all three forms.
   Acceptance: `pnpm test server` passes; no test changes its assertions.
4. **Component test render helpers** (independent of the splits; do when convenient,
   but after `p3-20261114-keyboard-nav-defects.md` and
   `p2-20261114-weak-tests.md`, which edit `useKeyboardNavigation.test.tsx`):
   - `useKeyboardNavigation.test.tsx`: a `renderNav(overrides)` for the 48 near-identical
     `renderHook` blocks.
   - `CommentThreadCard.test.tsx`: lift `props` (64-70) to module scope; 21 of its 34
     renders do not spread it.
   - `DiffChunk.test.tsx`, `DiffQuickMenu.test.ts`, `CommentsListModal.test.tsx`: one
     module-level props object each.
   - `src/client/viewers/viewerProps.testing.ts` for the `DiffViewerBodyProps` builders
     (MarkdownDiffViewer.test.tsx:22-62 and NotebookDiffViewer.test.tsx:34-85 are
     byte-identical for 28 lines; ImageDiffViewer.test.tsx:14-28; TextDiffViewer.test.tsx).
   - `CommentsListModal` prop and thread factories (`updates(threads)` is byte-identical
     in the `.allReviews` and `.unread` test files).
   - The `react-hotkeys-hook` mock (CommentsListModal.test.tsx:11-17,
     SettingsModal.test.tsx:8-14, CommentsListModal.drafts.test.tsx:18) and
     `setMatchMedia` (appearanceTheme.test.ts:10-17, MarkdownDiffViewer.test.tsx:230-237).
   - `StorageService.test.ts`'s 40-line `LocalStorageMock` (5-45): happy-dom's storage
     replaces it; line 149 reads the mock's `_keys` and needs changing.
   - CLI: `fetchMock` + console spies in conversation.test.ts:14-27 and wait.test.ts:26-40.
     Acceptance per file: the file passes with the same `it` names.
