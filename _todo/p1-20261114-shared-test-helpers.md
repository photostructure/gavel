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
- [ ] `useFileWatch` named handlers, its `__mocks__` file, and `renderApp`
- [ ] `server.test.ts` mocks moved to a shared module
- [ ] Component test render helpers
- [ ] Reviewed

## Required reading

- `AGENTS.md`, `p1-20261114-refactor-arc.md`
- `src/server/test-access-token.ts` and `src/client/utils/liveConnection.testing.ts`
  (existing test-only modules in `src/`)
- `_todo/p3-20261110-git-env-config-isolation.md` (same Git environment
  question as task 1)
- `p1-20261114-agent-updates-render-count-flake.md` (how the render-count tests in
  `App.agentUpdates.test.tsx` wait for the initial load)

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
  (its `vi.mock('./hooks/…')` factories) and uses `mockFetch` from vitest.setup.ts. The others use
  the real hooks behind a per-file fake server. Do not force one strategy on both in
  this plan.
- The `git()` copies differ in three ways: `core.hooksPath` (`devNull`, a
  `disabled-hooks` directory, or `--no-verify` instead), whether `GIT_*` variables are
  stripped (inline filter or `vi.stubEnv` in `beforeEach`), and whether
  `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` are set. The helper settles one variant.
  `withoutGitEnvironment` already exists in src/cli/index.integration.test.ts.
- `server.test.ts` sets `process.env.VITEST_SERVER_TEST`, but the
  `if (!process.env.VITEST_SERVER_TEST)` check in vitest.setup.ts reads it before the test
  file runs, and server.test.ts's `globalThis.fetch = fetch` overwrites `globalThis.fetch` anyway.
  Delete that `process.env.VITEST_SERVER_TEST = 'true'` assignment, and make that
  `if (!process.env.VITEST_SERVER_TEST)` block in vitest.setup.ts assign `global.fetch = vi.fn()`
  unconditionally; `pnpm test` must still pass. Nothing else sets `VITEST_SERVER_TEST`
  (`rg VITEST_SERVER_TEST`).
- `App.namedReviews.test.tsx` handles `PUT` / `DELETE /api/approval` in its fake router.
  No client code sends those; verdicts go through `review-ops`. Delete them
  (the `init?.method === 'PUT'` and `'DELETE'` branches of its `/api/approval` route) when
  task 2 converts that file.
- Step 14 of the App split will need `App.test.tsx`'s `useDiffComments` /
  `useViewedFiles` / `useViewport` mocks (its `vi.mock('./hooks/…')` factories) in each new
  file. That split decides how, once its file list is known. This plan does not build a fake server
  for it.

## Tasks

1. **Server fixture repo and request helper.** Add `createFixtureRepo()` returning
   `{root, git, cleanup}`, `requestJson(running, path, {body, method, status})`, and a
   `lineThread(id)` factory in `src/server/test-access-token.ts`, renamed to
   `src/server/test-server.ts` in the same commit. It already wraps `startServer` and
   `fetch` for tests; 8 files import it. Replace the copies in review-ops, named-reviews,
   review-store, live-approval, committed-summary and session-inbox integration tests,
   approval.test.ts, unapply.test.ts, review-capture.test.ts (the `git` helper in its
   "read-only working tree captures" block plus the inline `git('-C', …, 'init')` calls in
   its submodule tests), git-client.test.ts, git-diff.capture.test.ts,
   git-diff.metadata.test.ts, and index.integration.test.ts. `rg "startsWith\('GIT_'\)"
   src --glob '*.test.*'` lists the environment-stripping copies. The inline inits in
   review-capture.test.ts create nested repos inside the fixture tree
   (`git('-C', module, 'init')`); they use the helper's `git`, not `createFixtureRepo()`.
   Acceptance: each listed suite passes unchanged in its assertions;
   `rg "user.email=gavel@example.com" src --glob '*.test.*'` finds nothing (the helper is
   not a `*.test.*` file).
2. **`useFileWatch` takes a named handler object** instead of 7 positional callbacks
   (the `useFileWatch` signature in hooks/useFileWatch.ts, and its call in `App` in App.tsx).
   Make every handler in the object required and drop the `?.()` on the
   `callbacksRef.current` calls in useFileWatch.ts's `onOpen` and `onMessage` handlers: the
   one caller (`App`) passes all seven. Then add
   `src/client/hooks/__mocks__/useFileWatch.ts` exporting the captured named callbacks and
   a connection setter (see Lore for why it cannot live in `App.testing.tsx`), and
   `src/client/App.testing.tsx` with `renderApp()`. Switch all seven App test files to
   `renderApp()` and the shared `useFileWatch` mock. Each file keeps its own fake server,
   browser stubs and thread factories: their IntersectionObserver stubs behave three
   different ways, only App.namedReviews and App.reviewOps apply review ops and their
   fake servers share almost no state, and the four thread factories have four
   signatures, so a shared version would need options to serve them.
   Acceptance: `pnpm test App useFileWatch` passes; the `__mocks__` file is the only
   mock implementation, and no test passes a factory to `vi.mock('./hooks/useFileWatch')`.
3. **`server.test.ts` setup into shared modules.** Move the `GitDiffParserMock`,
   `parserInstances`, the `review-capture` mock and saved-reviews temp dir, the
   `process.exit` stub and cleanup, `openLive` / `closeLive` / `liveUrl`, `putVerdict`,
   `postAgentSummary`, `startObservedServer`. Add a `start(options)` that registers its own
   cleanup (removes 88 `servers.push` calls). Use `preferredPort: 0` for tests that only need some free port. Keep `getAvailablePort`
   in the shared module, and keep explicit ports, for tests that need a known
   port: those that send requests before `startServer` resolves ("buffers live
   submissions during asynchronous startup until readiness" and "pins readiness to the
   launch review when browser revisions change during startup"), the busy-port test
   ("sends busy-port diagnostics to stderr with jsonl=%s"), the derived-port test that
   omits `preferredPort` ("first tries the port %s hashes to"), and the fallback test
   ("falls back to next port when preferred is occupied"). `start(options)` passes its options to
   `startServer` unchanged and registers cleanup. Move `putVerdict`, `postAgentSummary`,
   `startObservedServer` and `openLive` / `closeLive` / `liveUrl` into the shared module
   when a second split-out file uses one; until then each moves with its describe block.
   Acceptance: `pnpm test server` passes; no test changes its assertions.
4. **Component test render helpers** (independent of the splits; do when convenient,
   but after `p3-20261114-keyboard-nav-defects.md` and
   `p2-20261114-weak-tests.md`, which edit `useKeyboardNavigation.test.tsx`):
   - `useKeyboardNavigation.test.tsx`: a `renderNav(overrides)` for the 48 near-identical
     `renderHook` blocks.
   - `CommentThreadCard.test.tsx`: lift `props` (in its "thread and reply actions" block)
     to module scope; 21 of its 34 renders do not spread it.
   - `DiffChunk.test.tsx`, `DiffQuickMenu.test.ts`, `CommentsListModal.test.tsx`: one
     module-level props object each.
   - `src/client/viewers/viewerProps.testing.ts` for the `DiffViewerBodyProps` builders
     (`createFile`, `mergedChunks` and `createProps` in MarkdownDiffViewer.test.tsx and
     NotebookDiffViewer.test.tsx are byte-identical for 28 lines; `baseProps` in
     ImageDiffViewer.test.tsx; TextDiffViewer.test.tsx).
   - `StorageService.test.ts`'s 40-line `LocalStorageMock`: happy-dom's storage
     replaces it; the "separates direct and merge-base diff contexts" test reads the
     mock's `_keys` and needs changing.

   Acceptance per file: the file passes with the same `it` names. Two-copy duplicates stay
   where they are: `updates(threads)` in the two `CommentsListModal` test files,
   `setMatchMedia`, the `react-hotkeys-hook` mock (sharing a third-party mock across files
   needs a `__mocks__` module), and the CLI `fetchMock` and console spies (their
   `afterEach` blocks differ).
