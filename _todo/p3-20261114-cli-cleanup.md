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

Next: task 1.

- [x] Inventory (below, at `d905dec`)
- [ ] `createProgram()` and a real index.ts unit test
- [ ] Companion plumbing shared
- [ ] Reviewed

## Required reading

- `AGENTS.md` (`Changelog:` trailer for anything an agent can see), `docs/cli.md`,
  `p1-20261114-refactor-arc.md`
- `_todo/p2-20261114-comment-cli-hangs.md`: two behavior fixes in
  `comment.ts` that this plan's task 2 makes easy. Land them as their own commits.

## Lore

- `index.ts` runs `void program.parseAsync()` when it loads (index.ts:573), so tests
  cannot import it in-process. Only `index.integration.test.ts` tests its real behavior
  ("actual CLI launch protocol", "named review stdin sources"); it compiles all of `src`
  with tsc in `beforeAll` (57-112).
- `wait.ts` builds its URL and token by hand (47-56) on purpose: it reports a bad host
  or token before the try block. `pending.ts:81-87` does it by hand because tests inject
  `fetch`. A `serverFetch` that accepts a URL and a fetch function covers both.
- `conversation.ts:39` and `review.ts:260` set `process.exitCode` so buffered JSON
  drains; `comment.ts` calls `process.exit(1)` instead (see the defect TPP).

## Tasks

1. **Move the program into `src/cli/program.ts`** exporting `createProgram()`; `index.ts`
   keeps only `void createProgram().parseAsync()`. `index.ts` must stay the entry point:
   `package.json` `bin` and `main`, the `dev:cli` and `start` scripts, `scripts/dev.js:54`,
   `scripts/host-wait-e2e/run.sh:22`, `scripts/measure-performance.js:73`,
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
   - One `reportServerError(error, fallback, host?, port?)` replacing conversation.ts:31-42,
     review.ts:249-262 and comment.ts:22-31; `host` and `port` are optional because
     `review capture` (295) and `unapply` / `reapply` (435) talk to no server (comment.ts's `process.exit` is a defect; see
     `p2-20261114-comment-cli-hangs.md`).
   - One `readServerError(response)` for the non-OK paths at conversation.ts:21,
     review.ts:233-235, comment.ts:81, 115, 191. `wait.ts:57` and `pending.ts:88` parse
     the body on success too; they branch on `response.ok` first and use the helper only
     in the error branch.
   - One `readJsonArgument` for conversation.ts:101-105, 134-138, 160-164 and
     comment.ts:33-48. They differ on empty stdin: comment.ts says "No comment JSON
     received from stdin" (43-45), conversation's `JSON.parse` throws a SyntaxError.
     Keep each message (a parameter), or ask before choosing one.
   - A default 30 s timeout inside `serverFetch` (9 call sites pass
     `AbortSignal.timeout(30000)` today). Test it by stubbing `AbortSignal.timeout` (assert it is called with `30000`, return a
     controller's signal), making the mocked `fetch` reject when that signal aborts,
     aborting it, and asserting the command ends through its error path. Do not use fake
     timers: they do not fire `AbortSignal.timeout`.
     Pins: server-url, comment, conversation (50, 97), review (627-680), wait (183, 298,
     397), pending tests. "Cannot connect to gavel server" is asserted at comment.test.ts:268,
     305, 520, conversation.test.ts:367, review.test.ts:631; "Expected an integer from 1 to
     65535" at comment.test.ts:38, conversation.test.ts:97, review.test.ts:656,
     wait.test.ts:403.
3. **Loop over `summary`, `status`, `reply`** in conversation.ts (91-176), as
   comment.ts:134 already does for resolve, reopen, delete.
4. **index.ts action.** Build the shared `startServer` options once and add one
   `announce()` helper for the three launch branches (378-545). Use
   `isWorkingTreeTarget` for `isSpecialArg` (44-46) and `review.ts`'s `collect` for the
   three inline list parsers (147, 171, 177). `--port` uses `parseIntegerInRange`
   (today `parseInt` with no check, index.ts:141, so `--port abc` passes `NaN`; that is
   a behavior change, its own commit). Pins: index.integration.test.ts.
5. **review.ts** duplicates: "Provide a unified diff…" (179/410) and "No diff content…"
   (197/412) are identical pairs. "Stdin is a pipe or file…" (192/422) shares only its
   first sentence: `review create` advises `--pathspec` / `--include-untracked`,
   `unapply` / `reapply` advise redirecting stdin to use the saved capture. Share the
   first sentence at most. Also `readResponse` (225-247) vs `checkResponse`
   (conversation.ts:19-29).
6. **Move git revision helpers out of the CLI.** `shortHash`, `createCommitRangeString`,
   `validateDiffArguments` and the commit-ish validators (cli/utils.ts:63-226, without the CLI-only
   `parseCommentOptions` at 175) are used
   by `server/git-diff.ts:6`, so a server module depends on a CLI module. Move them to
   `src/utils/`. Use `node:` imports (cli/utils.ts:1, background.ts:1). Pins:
   utils.test.ts, git-diff.test.ts.
7. **github.ts.** `createRightSidePosition` (146-176) and `createLeftSidePosition`
   (178-212) are mirror images: one function taking the side and the line field names.
   Pins: github.test.ts.
