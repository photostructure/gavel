---
title: Working-tree blob reads serve .git/ and ignored files to any token holder
priority: p3
section: Server
---

# Working-tree blob reads serve .git/ and ignored files to any token holder

Complete.

`getBlobContent` in `src/server/git-diff.ts` read any file whose resolved path lay inside the
repository root when `ref` was `.` or `working`, so `/api/blob/<path>?ref=.` served
`.git/config` (including remote URLs with embedded credentials) and ignored files such as
`.env`, and `/api/line-count/<path>?newRef=.` reported their line counts. A leaked token (see
`p2-20261115-access-token-leaks.md`) could escalate from reading the repository to pushing
with those credentials.

Decision (2026-11-15, question 7D-3, accepted as recommended): reject paths with a leading
`.git/` segment and ignored files on working-tree reads. Cost: one `git check-ignore` per
working-tree blob read, and Markdown images that point at ignored files stop loading. Reads at
other refs (`?ref=<rev>`) stay as they are: those objects are inside the repository.

## Outcome

- On working-tree reads, `getBlobContent` resolves the request with `fs.realpathSync.native`,
  takes the path relative to the real repository root, and throws
  `File path outside repository` when its first segment is `.git` (case-insensitive) or when
  `git check-ignore` reports it as ignored. `/api/blob` answers 404 and `/api/line-count`
  reports 0, as for a path outside the repository. `server.ts` did not change.
- Because the check runs on the resolved path, `./.git/config`, `docs/../.git/config`, a
  symlink into `.git`, and a symlink to an ignored file are refused too. Tracked files,
  including force-added files under ignored patterns, are still served.
- `fs.realpathSync.native` replaced `fs.realpathSync`: on Windows the JS realpath keeps 8.3
  short names, so `GIT~1/config` and `ENV~1` got past both checks (measured with Node on
  Windows 11; the native call returns `.git\config` and `.env`).
- Tests: `src/server/git-diff.integration.test.ts` runs the checks against a real repository;
  `src/server/git-diff.test.ts` pins the 8.3 short-name case with a mocked native realpath.

## Not verified

- A case-insensitive volume (macOS default, NTFS) was not available: `.GIT/config` was tested
  with a real `.GIT` directory on case-sensitive ext4, and the Windows 8.3 case through a mock
  plus a manual Node probe on Windows 11.

## Limits

- Files inside an initialized submodule's checkout are now refused on working-tree reads,
  because the parent repository's `git check-ignore` exits 128 ("is in submodule"). Diffs show
  a submodule as one entry (`--submodule=short`), so only Markdown links from the
  superproject into a submodule hit this. Decision (2026-11-17, question DF-12, accepted as
  recommended): keep refusing them, as shipped. Rejected: running `check-ignore` from the file's directory, which lets a nested
  non-submodule repository inside an ignored directory (`vendor/dep` under an ignored
  `vendor/`) report its files as not ignored; passing `--no-index`, which serves submodule
  files but refuses force-added tracked files under ignored patterns.
- Only the first segment is checked, as decided, so a nested non-submodule repository's
  metadata (`vendor/lib/.git/config`, when `vendor/lib` is not ignored) is still served. Git
  refuses to track any path with a `.git` segment, so testing every segment would refuse no
  reviewable file.

Base commit: `47c5959`.
