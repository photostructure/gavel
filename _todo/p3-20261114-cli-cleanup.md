---
title: Share the CLI companion commands' server plumbing and make index.ts testable
priority: p3
section: CLI
---

# TPP: CLI cleanup

## Summary

The companion commands (`comment`, `conversation`, `review`, `wait`, `pending`) each
parse `--port`, report connection failures, read error bodies and read JSON from an
argument or stdin in their own way. `src/cli/index.test.ts` (1,162 lines) never imports
`index.ts`: it builds 22 of its own `new Command()` programs and re-implements index.ts
logic inline ("Simulate the logic from index.ts", in the `CLI argument processing` tests), so it tests copies. The
`index.ts` action calls `startServer` three times with about 15 identical fields. Part
of `p1-20261114-refactor-arc.md`.

## Current phase

Next: task 1. Run task 3 before task 2: after the loop, conversation.ts reads JSON in
one place.

- [x] Inventory (below, at `d905dec`)
- [ ] `createProgram()` and a real index.ts unit test
- [ ] Companion plumbing shared
- [ ] Reviewed

## Required reading

- `AGENTS.md` (`Changelog:` trailer for anything an agent can see), `docs/cli.md`,
  `p1-20261114-refactor-arc.md`
- `_todo/p2-20261114-comment-cli-hangs.md` owns the default timeout in `serverFetch`
  and the fix for comment.ts's `process.exit`. Land it before task 2, as its own
  commits.

## Lore

- `index.ts` runs `void program.parseAsync()` when it loads, so tests
  cannot import it in-process. Only `index.integration.test.ts` tests its real behavior
  ("actual CLI launch protocol", "named review stdin sources"); it compiles all of `src`
  with tsc in its top-level `beforeAll`, through its `compile` helper.
- `wait.ts` builds its URL and token by hand (in `request`) on purpose: it reports a bad host
  or token before the try block. `pending.ts`'s `collectPending` does it by hand because tests inject
  `fetch`. Leave both as they are.
- The `reportError` functions in `conversation.ts` and `review.ts` set `process.exitCode` so buffered JSON
  drains; `comment.ts` calls `process.exit(1)` instead (see the defect TPP).
- Simplicity: each companion command keeps its own messages and status handling. Share
  a helper only for code that is identical, such as the integer parser, the
  `startServer` fields and the handshake. When a helper would need a message, fallback
  or hint parameter per command, leave the copies.

## Tasks

1. **Move the program into `src/cli/program.ts`** exporting `createProgram()`; `index.ts`
   keeps only `void createProgram().parseAsync()`. `index.ts` must stay the entry point:
   `package.json` `bin` and `main`, the `dev:cli` and `start` scripts, `startCliProcess` in `scripts/dev.js`,
   the `GAVEL` array in `scripts/host-wait-e2e/run.sh`, `startGavelServer` in `scripts/measure-performance.js`,
   `verify()` in `scripts/release-package.mjs` (asserts `bin.gavel === './dist/cli/index.js'`) and
   the top-level `beforeAll` in `index.integration.test.ts` all point at `dist/cli/index.js`. Rewrite
   `index.test.ts` against the real program, deleting tests the integration test already
   covers. Acceptance: `index.test.ts` imports `./program.js`; `rg "Simulate"
   src/cli/index.test.ts` finds nothing; `pnpm test cli/index` passes.
2. **Companion plumbing in `src/cli/server-url.ts`.**
   - One `parseIntegerInRange` replacing `parseServerPort` (server-url.ts) and
     `integerInRange` (conversation.ts, review.ts); the five `--port`
     declarations that call `integerInRange(value, 1, 65535)` (conversation.ts's `snapshot`,
     `summary`, `status` and `reply` commands; review.ts's `addServerOptions`) use it. `wait.ts`'s `collectPort` also accumulates
     repeated `--port` options into an array (used by the `--port` option and the `wait` action; `wait.test.ts`'s
     "waits on several ports and aborts the other subscription after one produces activity" test
     subscribes to several ports), so keep it as an accumulator around the parser:
     `[...ports, parseIntegerInRange(value, 1, 65535)]`.
   - One `reportServerError(error, host?, port?)`, printing `error.message` for an
     `Error` and `String(error)` otherwise instead of a per-command fallback, replacing
     `reportError` in conversation.ts and
     review.ts and `handleCommandError` in comment.ts; `host` and `port` are optional because
     `review capture` and `unapply` / `reapply` talk to no server (comment.ts's `process.exit` is a defect; see
     `p2-20261114-comment-cli-hangs.md`).
   - Leave the non-OK response readers apart: `checkResponse` adds a 404 hint
     (conversation.ts), `readResponse` builds a 409 message (review.ts),
     and comment.ts falls back to per-command text and maps a 404 "Thread not found" to
     `notFound` (in the `resolve` / `reopen` / `delete` loop of `createCommentCommand`). Leave the JSON argument readers apart too: after
     task 3 there are two (conversation.ts and comment.ts's `parseCommentAddInput`), and they differ on
     empty stdin.
   - The default timeout in `serverFetch` lands with
     `p2-20261114-comment-cli-hangs.md`, which owns its test.
     Pins: server-url, comment, conversation ("identifies the attempted interface when a
     connection fails", "requires a valid TCP port for %s"), review ("reports the port of an
     unreachable server" through "requires a positive safe integer expected version"), wait
     ("waits on several ports and aborts the other subscription after one produces activity",
     "reports a malformed --host as a usage error, not a dead server", "rejects invalid port
     %s"), pending tests. "Cannot connect to gavel server" is asserted in comment.test.ts's
     three "handles connection error" tests (`add`, `get`, `resolve`), conversation.test.ts's
     "identifies the unreachable server for %s" and review.test.ts's "reports the port of an
     unreachable server"; "Expected an integer from 1 to 65535" in comment.test.ts's "rejects
     bad ports before connecting for %s", conversation.test.ts's "requires a valid TCP port
     for %s", review.test.ts's "requires valid port integers for %s" and wait.test.ts's
     "rejects invalid port %s".
3. **Loop over `summary`, `status`, `reply`** in conversation.ts's `addConversationCommands`, as
   comment.ts's `for (const action of ['resolve', 'reopen', 'delete'])` loop already does for resolve, reopen, delete.
4. **index.ts action.** Build the shared `startServer` options once (about 16 fields
   repeat across the three `startServer` calls: the `--review`, stdin-diff and commit-ish
   branches), and the background handshake once
   (identical after each of those calls: `emitServerHandshake` and the `if (backgroundMode)` block). Leave each branch's console messages: they
   differ (keep-alive in two branches; clean-slate, opening-browser and Ctrl+C in one
   each; the empty-diff note in two), so an `announce()` would take a flag per
   difference. Use
   `isWorkingTreeTarget` for `isSpecialArg` and `review.ts`'s `collect` for the
   three inline list parsers (of `--comment`, `--pathspec` and `--select`). `--port` uses `parseIntegerInRange`
   (today `parseInt` with no check, so `--port abc` passes `NaN`; that is
   a behavior change, its own commit). Pins: index.integration.test.ts.
5. **review.ts** duplicates: "Provide a unified diff…" and "No diff content…"
   are identical pairs (in `resolveCommandReview` and the `unapply` / `reapply` action). "Stdin is a pipe or file…" shares only its
   first sentence: `review create` advises `--pathspec` / `--include-untracked`,
   `unapply` / `reapply` advise redirecting stdin to use the saved capture. Leave it.
   Leave `readResponse` and `checkResponse` (conversation.ts) apart too:
   one handles 409 conflicts, the other adds a 404 hint.
6. **Move git revision helpers out of the CLI.** `shortHash`, `createCommitRangeString`,
   `validateDiffArguments` and the commit-ish validators (cli/utils.ts, from `validateCommitish` through `validateDiffArguments`, without the CLI-only
   `parseCommentOptions`) are used
   by `server/git-diff.ts`'s import from `../cli/utils.js`, so a server module depends on a CLI module. Move them to
   `src/utils/`. Use `node:` imports (the `child_process` imports in cli/utils.ts and background.ts). Pins:
   utils.test.ts, git-diff.test.ts.
7. **github.ts.** `createRightSidePosition` and `createLeftSidePosition`
   are mirror images: one function taking the diff side and the two line
   values, which the caller reads (`thread.line` / `thread.startLine` or
   `thread.originalLine` / `thread.originalStartLine`), not field-name strings. It
   derives the warning's field name from the side, and it absorbs the one-line
   `createSingleLinePosition` and `createMultiLinePosition`.
   Pins: github.test.ts.
