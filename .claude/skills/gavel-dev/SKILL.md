---
name: gavel-dev
description: Request human review of this repository's changes through a built gavel UI. Use for an explicit gavel/viewer request or standing gavel-review instruction; reserve Vite for the agent's own UI checks.
metadata:
  internal: true
---

# Gavel development reviews in Claude Code

Read [the gavel skill](../../../skills/gavel/SKILL.md) and follow its scope,
grouping, comments, feedback, approval, and waiting workflow. This supplement
defines how to serve reviews while developing gavel itself.

## Serve a built UI

Human reviews must use built assets. A Vite page reloads whenever another session
edits `src/client`, which can interrupt review and lose unsent comments.
Choose the launcher before building: use the user's prescribed executable,
otherwise `node dist/cli/index.js`. Resolve symlinks to identify which checkout's
assets it serves; changing directories does not redirect a fixed launcher.

When the launcher can serve an isolated build and other sessions are editing,
build in a detached worktree at HEAD. Apply this session's uncommitted changes
there before building. If a prescribed launcher is fixed to another checkout,
or to this checkout while other sessions are editing it, skip the build:
use its existing built assets and tell the user which
checkout supplies them. This may proceed for diff review; if the review requires
new UI behavior absent from that build, stop and report the build limitation.
Otherwise run `pnpm build` in the chosen checkout before opening human review.
Report build failures as failures, not as the user being away.

Launch from the reviewed Git root, with the shared skill's targets and flags:
use a supplied patch for isolated uncommitted work or the SHA for committed work.
Use the same launcher for companion commands. Share `server.ready.launchUrl`, or
the detached server's `server.background.url`, including its editor-session fragment.

Run `review create` and `review update` from the server's worktree: captures are
bound to the repository root. Provide `- < <patch>` for each additional patch
review; with neither `-` nor a redirect, creation captures that worktree's
uncommitted tree.
Make authorized source fixes in the owning checkout and refresh the review from
the server's worktree. Committed work already on `main` uses `--no-lgtm`; commits
not yet on `main` may still be approved for landing under the shared scope rules.

## Check the UI during development

Use `pnpm run dev <target> [base] --no-open` only for your own UI checks in Claude's
browser pane, with no extra `--` separator. It starts a foreground process tree
and does not support `--background`; retain its handle.

Companion commands use the API port from `server.ready`, not the Vite port.
The API URL serves a development placeholder. Use the Vite UI origin printed on
stderr, preserving the query and editor-session fragment from `launchUrl` when
composing a URL.

For human review, follow the shared skill's host-capability check before waiting.
A foreground process handle alone does not provide delivery into an idle chat.
