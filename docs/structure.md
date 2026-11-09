# Codebase structure

gavel has a Node.js CLI, an Express server, and a React client. Shared types
define the diff and conversation contracts.

| Path                                                          | Responsibility                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/cli/index.ts`                                            | Parse options, select Git/PR/stdin input, and launch the server |
| `src/cli/github.ts`                                           | Fetch PR patches and unresolved review threads through `gh`     |
| `src/cli/review.ts`                                           | Capture, create, and update named reviews                       |
| `src/cli/conversation.ts`, `src/cli/wait.ts`                  | Send agent replies and receipts; wait for human events          |
| `src/cli/schema.ts`                                           | Expose JSON schemas for the protocol                            |
| `src/server/server.ts`                                        | Serve the UI, HTTP APIs, and event connections                  |
| `src/server/git-diff.ts`                                      | Read and parse Git diffs                                        |
| `src/server/review-capture.ts`, `src/server/named-reviews.ts` | Capture immutable patches and manage their versions             |
| `src/server/conversation.ts`                                  | Manage threads, message revisions, progress, and approval       |
| `src/server/review-store.ts`                                  | Persist reviews in the Git common directory                     |
| `src/client/`                                                 | React UI, hooks, diff viewers, and browser state                |
| `src/types/`, `src/utils/`                                    | Shared contracts and helpers                                    |
| `public/`                                                     | Static assets                                                   |

## Review flow

1. The CLI resolves the requested input and starts the server. PR mode invokes
   `gh pr diff <url>` and imports unresolved review threads.
2. The client requests the diff and review state through `/api`. Named reviews
   hold a fixed patch until an explicit capture update.
3. Human comments become conversation events. Agent companion commands send
   replies, progress receipts, and updated proposals to the same review.
4. The server streams updates to browsers and exposes events to agent consumers.
   The agent host controls whether feedback can resume an idle model.
5. Conversation-enabled servers save eligible reviews under
   `<git-common-dir>/gavel/`; see [saved reviews](agent-conversations.md#saved-reviews)
   for restoration, locking, and expiry.

For command examples, see [CLI usage](cli.md). The
[conversation protocol](agent-conversations.md), [approval modes](approval-modes.md),
and [waiting guide](waiting-for-review.md) define the integration behavior.

## Build and development

`pnpm dev` runs the CLI server and Vite development server. `pnpm build` compiles
the Node.js code with TypeScript and builds the client with Vite:

```text
dist/
├── cli/       # package.json exposes dist/cli/index.js as gavel
├── server/
├── types/
├── utils/
└── client/    # Vite output served in production
```

Use the versions in `package.json` and `mise.toml` rather than a separate
dependency inventory. See [testing](test.md) for checks and fixture conventions.

## Network access

gavel has no built-in login. Binding it to a reachable interface exposes the
review and its enabled actions. Use an authenticated HTTPS proxy for remote
reviewers; see [server addresses](server-addresses.md).
