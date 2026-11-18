---
title: review unapply and reapply delete .rej files outside the worktree
priority: p3
section: Review capture
---

# review unapply and reapply delete .rej files outside the worktree

Done. Base commit `47c5959`.

`revertCapture` in `src/cli/unapply.ts` takes paths from `git apply --numstat -z` and, when any
hunk was rejected, removed `<root>/<path>.rej` for every path. `--numstat` does not validate
paths, and when a target file is missing, `git apply --check --reject` reports
`error: <path>: No such file or directory` and exits 0, so the path-safety refusal git applies
to existing files never runs. A patch for `../outside/v` piped to `gavel review reapply` deleted
`outside/v.rej`, and a patch path `lnk/w` through a tracked symlink `lnk -> ../outside` deleted
`outside/w.rej` through `gavel review unapply`.

## Outcome

Cleanup now removes a `.rej` file only when its parent directory exists and its `realpath`
is the repository root or lies under it. The root comes from `getCaptureRepository`, which
already resolves it with `realpath`. A missing parent directory means there is no `.rej` file
to remove; that happens when `git apply` deletes a directory's last file and removes the
emptied directory.

Of the plan's two fix directions, this is the second. The first, deleting only the `.rej` files
named by git's `Applying patch <path> with N reject...` lines, would depend on parsing git's
human-readable output.

Tests in `src/cli/unapply.test.ts` reproduce both repros (each fails at `47c5959`) and cover
a reapply whose deletion empties a directory while another hunk is rejected (it throws
`ENOENT` without the existence check). The existing tests that assert `shared.txt.rej` is gone
still cover removal inside the worktree.
