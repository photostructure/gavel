# Testing

Tests live beside the code as `*.test.ts` or `*.test.tsx`. Vitest uses
`happy-dom` by default; shared setup is in `vitest.setup.ts`.

## Run tests

```sh
pnpm test
pnpm test:watch
pnpm exec vitest run src/cli/wait.test.ts
pnpm exec vitest run src/client/components/VerdictControl.test.tsx
```

Run the tests that cover a change during development. Before a pull request, run
`pnpm check`, `pnpm format`, `pnpm test`, and `pnpm build`. The reusable
[CI workflow](../.github/workflows/ci.yml) also checks unused code with knip and
installs and invokes the packed CLI on Linux, macOS, and Windows.

## Where to look

| Area                               | Starting points                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CLI arguments and process behavior | `src/cli/index.test.ts`, `src/cli/index.integration.test.ts`                                                                              |
| GitHub PR imports                  | `src/cli/github.test.ts`                                                                                                                  |
| Waiting and revision guards        | `src/cli/wait.test.ts`, `src/cli/conversation.test.ts`                                                                                    |
| Git diffs and named captures       | `src/server/git-diff.test.ts`, `src/server/review-capture.test.ts`, `src/server/named-reviews.integration.test.ts`                        |
| HTTP endpoints                     | `src/server/server.test.ts`                                                                                                               |
| Approval and persistence           | `src/server/conversation-approval.test.ts`, `src/server/live-approval.integration.test.ts`, `src/server/review-store.integration.test.ts` |
| Browser interactions               | `src/client/App*.test.tsx`, component and hook tests under `src/client/`                                                                  |

## Write a regression test

- Reproduce the observable failure, then assert the expected behavior. Avoid
  tests that merely repeat the implementation.
- Use Testing Library for UI interactions and await asynchronous assertions.
- Mock dependencies in focused unit tests. For Git and CLI integration tests,
  use temporary repositories and real subprocesses, as in
  `src/cli/index.integration.test.ts`.
- Keep fixture Git configuration and environment separate from the developer's
  repository. Never stage or commit in the working checkout from a test.
- Give server tests an isolated review-store directory and an available loopback
  port. See the setup in `src/server/server.test.ts`.
- Close servers, event streams, watchers, and child processes, and remove owned
  temporary directories in teardown. Do not delete another test run's outputs.

Rendering fixtures under `docs/syntax-sample/` are test data, not prose to reformat.
Use `pnpm perf:*` scripts for parser or rendering performance measurements.
