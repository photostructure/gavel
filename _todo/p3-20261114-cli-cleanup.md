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
logic inline ("Simulate the logic from index.ts", line 154), so it tests copies. The
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

- `index.ts` runs `void program.parseAsync()` when it loads (index.ts:573), so tests
  cannot import it in-process. Only `index.integration.test.ts` tests its real behavior
  ("actual CLI launch protocol", "named review stdin sources"); it compiles all of `src`
  with tsc in `beforeAll` (57-112).
- `wait.ts` builds its URL and token by hand (47-56) on purpose: it reports a bad host
  or token before the try block. `pending.ts:81-87` does it by hand because tests inject
  `fetch`. Leave both as they are.
- `conversation.ts:39` and `review.ts:260` set `process.exitCode` so buffered JSON
  drains; `comment.ts` calls `process.exit(1)` instead (see the defect TPP).
- Simplicity: each companion command keeps its own messages and status handling. Share
  a helper only for code that is identical, such as the integer parser, the
  `startServer` fields and the handshake. When a helper would need a message, fallback
  or hint parameter per command, leave the copies.

## Tasks

1. **Move the program into `src/cli/program.ts`** exporting `createProgram()`; `index.ts`
   keeps only `void createProgram().parseAsync()`. `index.ts` must stay the entry point:
   `package.json` `bin` and `main`, the `dev:cli` and `start` scripts, `scripts/dev.js:54`,
   `scripts/host-wait-e2e/run.sh:12`, `scripts/measure-performance.js:73`,
   `scripts/release-package.mjs:98` (asserts `bin.gavel === './dist/cli/index.js'`) and
   `index.integration.test.ts:88` all point at `dist/cli/index.js`. Rewrite
   `index.test.ts` against the real program, deleting tests the integration test already
   covers. Acceptance: `index.test.ts` imports `./program.js`; `rg "Simulate"
   src/cli/index.test.ts` finds nothing; `pnpm test cli/index` passes.
2. **Companion plumbing in `src/cli/server-url.ts`.**
   - One `parseIntegerInRange` replacing `parseServerPort` (server-url.ts:6-11) and
     `integerInRange` (conversation.ts:11-17, review.ts:112-124); the five `--port`
     declarations that call `integerInRange(value, 1, 65535)` (conversation.ts:48, 98,
     131, 157; review.ts:145) use it. `wait.ts`'s `collectPort` (25-30) also accumulates
     repeated `--port` options into an array (used at 174 and 203; `wait.test.ts:183`
     subscribes to several ports), so keep it as an accumulator around the parser:
     `[...ports, parseIntegerInRange(value, 1, 65535)]`.
   - One `reportServerError(error, host?, port?)`, printing `error.message` for an
     `Error` and `String(error)` otherwise instead of a per-command fallback, replacing
     conversation.ts:31-42,
     review.ts:249-262 and comment.ts:22-31; `host` and `port` are optional because
     `review capture` (295) and `unapply` / `reapply` (435) talk to no server (comment.ts's `process.exit` is a defect; see
     `p2-20261114-comment-cli-hangs.md`).
   - Leave the non-OK response readers apart: `checkResponse` adds a 404 hint
     (conversation.ts:23-27), `readResponse` builds a 409 message (review.ts:233-244),
     and comment.ts falls back to per-command text and maps a 404 "Thread not found" to
     `notFound` (comment.ts:191-200). Leave the JSON argument readers apart too: after
     task 3 there are two (conversation.ts and comment.ts:33-48), and they differ on
     empty stdin.
   - The default timeout in `serverFetch` lands with
     `p2-20261114-comment-cli-hangs.md`, which owns its test.
     Pins: server-url, comment, conversation (50, 97), review (627-680), wait (183, 298,
     397), pending tests. "Cannot connect to gavel server" is asserted at comment.test.ts:268,
     305, 520, conversation.test.ts:367, review.test.ts:631; "Expected an integer from 1 to
     65535" at comment.test.ts:38, conversation.test.ts:97, review.test.ts:656,
     wait.test.ts:403.
3. **Loop over `summary`, `status`, `reply`** in conversation.ts (91-176), as
   comment.ts:134 already does for resolve, reopen, delete.
4. **index.ts action.** Build the shared `startServer` options once (about 16 fields
   repeat across 378-400, 421-441, 492-516), and the background handshake once
   (identical at 402-406, 443-449, 518-524). Leave each branch's console messages: they
   differ (keep-alive in two branches; clean-slate, opening-browser and Ctrl+C in one
   each; the empty-diff note in two), so an `announce()` would take a flag per
   difference. Use
   `isWorkingTreeTarget` for `isSpecialArg` (44-46) and `review.ts`'s `collect` for the
   three inline list parsers (147, 171, 177). `--port` uses `parseIntegerInRange`
   (today `parseInt` with no check, index.ts:141, so `--port abc` passes `NaN`; that is
   a behavior change, its own commit). Pins: index.integration.test.ts.
5. **review.ts** duplicates: "Provide a unified diff…" (179/410) and "No diff content…"
   (197/412) are identical pairs. "Stdin is a pipe or file…" (192/422) shares only its
   first sentence: `review create` advises `--pathspec` / `--include-untracked`,
   `unapply` / `reapply` advise redirecting stdin to use the saved capture. Leave it.
   Leave `readResponse` (225-247) and `checkResponse` (conversation.ts:19-29) apart too:
   one handles 409 conflicts, the other adds a 404 hint.
6. **Move git revision helpers out of the CLI.** `shortHash`, `createCommitRangeString`,
   `validateDiffArguments` and the commit-ish validators (cli/utils.ts:63-226, without the CLI-only
   `parseCommentOptions` at 175) are used
   by `server/git-diff.ts:6`, so a server module depends on a CLI module. Move them to
   `src/utils/`. Use `node:` imports (cli/utils.ts:1, background.ts:1). Pins:
   utils.test.ts, git-diff.test.ts.
7. **github.ts.** `createRightSidePosition` (146-176) and `createLeftSidePosition`
   (178-212) are mirror images: one function taking the diff side and the two line
   values, which the caller reads (`thread.line` / `thread.startLine` or
   `thread.originalLine` / `thread.originalStartLine`), not field-name strings. It
   derives the warning's field name from the side, and it absorbs the one-line
   `createSingleLinePosition` and `createMultiLinePosition` (133-144).
   Pins: github.test.ts.
