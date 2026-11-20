---
title: The file watcher's ignore check hides Git errors behind a wrong comment
priority: p3
section: Server
---

# The file watcher's ignore check hides Git errors behind a wrong comment

Placeholder. Not started.

`isGitignored` in `src/server/file-watcher.ts` wraps
`git.checkIgnore` in a `catch` that returns `false`, with the comment "checkIgnore throws an
error when no files are ignored". That is wrong: simple-git returns `[]` when `git check-ignore`
exits 1 with empty stderr, which the blob-reads fix (`p3-20261115-blob-reads-git-dir-and-ignored-files.md`)
relies on. The `catch` therefore only ever swallows real failures, such as exit 128 for a path
inside a submodule's checkout, and treats those paths as not ignored.

Decide what a failed check should mean for a watch event before removing the `catch`: letting
it propagate may reject inside the async watcher callback (the `subscribe` callback in `setupWatchers` awaits
`isGitignored` with no surrounding `try`) on a submodule path; that consequence is reasoned, not
run. Then fix the comment and the handling
together, test-first.
