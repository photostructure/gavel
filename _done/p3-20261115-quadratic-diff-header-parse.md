---
title: Parsing a long diff --git header takes quadratic time on the event loop
priority: p3
section: Diff parsing
---

# Parsing a long diff --git header takes quadratic time on the event loop

Complete. Base commit `47c5959`.

## Problem

When a `diff --git` header did not split into two segments, `parseDiffHeaderPaths` in
`src/server/git-diff.ts` tried every ` a/`-style boundary and decoded both halves with
`decodeGitPath` each time. `parseFileBlock` parses the header of every file block, so
`POST /api/reviews`, `POST /api/reviews/:name/capture`, every `/api/diff?review=` request, and
`GitDiffParser.parseDiff` for commits all paid this cost for any diff of such a path.

Measured with the old code, `parseStdinDiff` on one metadata-only header whose path is `d a/`
repeated n times plus `f`: 2 KB 115 ms, 4 KB 404 ms, 8 KB 1.64 s, 16 KB 6.52 s.

## Outcome

The parser now tests two boundaries, left to right: the space at `(raw.length - 3) / 2`, where
the old path has an empty prefix (`git diff --src-prefix=` or `diff.srcPrefix=`), and the middle
space at `(raw.length - 1) / 2`. A boundary is skipped when its index is not an integer or the
space is not followed by `a/`, `b/`, `c/`, `i/` or `w/`, as before. Measured after the change on
the same input: 2 KB 2.7 ms, 16 KB 9.6 ms, 160 KB 56 ms.

Tests in `src/server/git-diff.metadata.test.ts`:

- "decodes a header path once per side when it holds 10 / 1000 " a/" boundaries" counts
  `decodeGitPath` calls instead of timing the parse, so CPU load cannot fail it. The old code made
  22 and 2002 calls; the new code makes 2.
- "renders a metadata-only mode change from a diff with an empty source prefix" pins the header
  real Git writes for `--src-prefix= --dst-prefix=b/`, which a midpoint-only check dropped.

## Decisions

- Testing fixed boundaries was chosen over comparing raw substrings before decoding. Git writes
  identical old and new paths with the same quoting, and `decodeGitPath` strips a 2-character
  prefix from the new half and either 0 or 2 characters from the old half, so only those two
  spaces can split the header into halves that decode equal. A raw comparison would reach the
  same boundaries with a loop and its own prefix stripping. A differential run of the old and new
  parsers on 500,000 generated Git-shaped headers (unquoted and quoted paths, spaces, `"`, `\`,
  tabs, non-ASCII, embedded ` a/`, ` b/`, ` w/`, renames, and the prefix pairs `a/ b/`, `c/ w/`,
  `i/ w/`, `c/ i/`, `a/ a/`, `'' b/`, `'' w/`, `'' ''`, `a/ ''`, `b/ a/`) found no difference in
  `parseDiffHeaderPaths` or `parseStdinDiff` output.
- Results still change for a header whose two halves escape the same path differently, such as
  `diff --git a/my\ file b/my file`: the old code yielded `my file`, the new code yields no header
  path. Git does not write unquoted escapes, so such a header reaches the parser only from a
  hand-edited imported patch or capture.

## Review

`coding:second-opinion`, one batch (`src/server/git-diff.ts`,
`src/server/git-diff.metadata.test.ts`), 2 passes: Codex LAND, Claude LAND. No findings were
vetoed.
