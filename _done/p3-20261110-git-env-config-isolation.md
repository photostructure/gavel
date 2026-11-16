---
title: Capture and unapply Git calls ignore GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM
priority: p3
section: Review capture
---

# Git calls ignore GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM

`gitEnvironment` in `src/server/review-capture.ts` dropped every `GIT_*` variable except
`GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE`, so tests that point `GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_SYSTEM` at `/dev/null` still ran capture's and unapply's Git commands with the
developer's real global config (`commit.gpgsign`, `core.autocrlf`, filter drivers).

## Decision

The maintainer decided (2026-11-15, accepted as recommended) that `gitEnvironment` keeps
`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, and `GIT_CONFIG_NOSYSTEM`: they select config files
and do not redirect the repository.

## Outcome

- `src/server/git-client.ts` exports `REPOSITORY_ENVIRONMENT` and a new
  `CONFIG_FILE_ENVIRONMENT`. `createGitClient` passes both lists to simple-git's
  `allowEnvironment`, because its comment requires simple-git calls to agree with direct
  `git` calls. Checked directly: with only `GIT_DIR` allowed, simple-git ignores an alias in
  the `GIT_CONFIG_GLOBAL` file; with `GIT_CONFIG_GLOBAL` allowed, it honors it.
- `review-capture.ts` imports both lists instead of declaring its own copy of the repository
  list. The config variables are not in the repository list, so path resolution and the
  submodule environment scrub still apply only to repository selection.
- Test: `review-capture.test.ts` sets `GIT_CONFIG_GLOBAL` to a file with `diff.context = 0` and
  asserts the captured patch has a zero-context hunk. It failed at base 47c5959.
