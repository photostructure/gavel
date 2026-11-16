---
title: review unapply and reapply delete .rej files outside the worktree
priority: p3
section: Review capture
---

# review unapply and reapply delete .rej files outside the worktree

Placeholder. Not started.

`revertCapture` in `src/cli/unapply.ts` takes paths from `git apply --numstat -z` and, when any
hunk was rejected, runs `rmSync(join(root, `${path}.rej`), { force: true })` for every path.
`--numstat` does not validate paths, and when a target file is missing,
`git apply --check --reject` reports `error: <path>: No such file or directory` and exits 0, so
the path-safety refusal git applies to existing files never runs.

Repro: with `outside/v.rej` present next to the repository and `outside/v` absent, pipe a patch
for `../outside/v` to `gavel review reapply <name> -`; the result has `"written": true` and
`v.rej` is gone. A tracked symlink `lnk -> ../outside` and a patch path `lnk/w` delete
`outside/w.rej` through `review unapply`. Patches come from the operator's pipe or from a saved
capture, which any token holder can replace (see
`p3-20261115-skill-tmp-paths-and-capture-pinning.md`).

Fix direction: delete only the `.rej` files git reports writing (its
`Applying patch <path> with N reject...` lines), or require each `.rej` file's resolved parent
directory to lie inside the resolved root.
