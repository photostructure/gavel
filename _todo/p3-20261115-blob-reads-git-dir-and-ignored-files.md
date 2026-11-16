---
title: Working-tree blob reads serve .git/ and ignored files to any token holder
priority: p3
section: Server
---

# Working-tree blob reads serve .git/ and ignored files to any token holder

Placeholder. Not started.

`getBlobContent` in `src/server/git-diff.ts` reads any file whose resolved path lies inside the
repository root when `ref` is `.` or `working`, so `/api/blob/<path>?ref=.` serves files
outside the review on any server not fed from stdin, and `/api/line-count/<path>?newRef=.`
reports their line counts. In a test `/api/blob` returned `.git/config`, including a remote
URL with embedded credentials, and an ignored `.env`. A leaked token (see `p2-20261115-access-token-leaks.md`) could therefore escalate from
reading the repository to pushing with the credentials in `.git/config`.

Decision (2026-11-15, question 7D-3, accepted as recommended): reject paths with a leading
`.git/` segment and ignored files on working-tree reads. Cost: one `git check-ignore` per
working-tree blob read, and Markdown images that point at ignored files stop loading. Reads at
other refs (`?ref=<rev>`) stay as they are: those objects are inside the repository.

Apply the `.git` check to the first segment of the resolved path relative to the real
repository root, which `getBlobContent` already computes, and compare it case-insensitively.
The request path is not enough: `parseRepositoryRelativePath` passes `./.git/config`
unchanged, macOS's default case-insensitive volume would serve `.GIT/config` (not tested on
m1), and `git check-ignore` reports neither as ignored.
