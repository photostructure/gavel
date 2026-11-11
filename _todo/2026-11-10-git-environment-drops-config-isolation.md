---
title: Capture and unapply Git calls ignore GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM
section: Review capture
---

# Git calls ignore GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM

Placeholder. Not started.

`gitEnvironment` in `src/server/review-capture.ts` drops every `GIT_*` variable except
`GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE`. Tests that stub `GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_SYSTEM` to `/dev/null` (for example `src/cli/unapply.test.ts`,
`src/cli/approval.test.ts`, and `src/server/review-store.integration.test.ts`) therefore
still run capture's and unapply's Git commands with the developer's real global config:
`commit.gpgsign`, `core.autocrlf`, filter drivers, and so on.

Decide whether `gitEnvironment` should keep `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, and
`GIT_CONFIG_NOSYSTEM`: they select config files and do not redirect the repository.

This was noticed while chasing a silent `git stash create` exit 1 in the unapply tests. That
had a different cause: when index entries' stat data is stale but their content is unchanged,
as right after `git apply` rewrites files, `stash create` finds changes before it refreshes
the index and none after, and exits 1 with no output.
