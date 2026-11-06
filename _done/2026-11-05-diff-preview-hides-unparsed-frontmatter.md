---
title: Keep unmapped frontmatter visible in Markdown Diff Preview
section: Markdown viewer
---

# Diff Preview hides the edits in frontmatter that is not a key/value mapping

Done: Diff Preview keeps the raw frontmatter lines, with no table, when a side
it needs has a frontmatter block that yields no key/value data.

## Problem

`MarkdownDiffPreview` (`src/client/viewers/MarkdownDiffViewer.tsx`, the
`frontmatterView` memo) stripped the frontmatter lines from both preview sides
with `getFrontmatterLines()` whenever the diff started at the top of the file.
It did this even when `extractFrontmatter()` returned `data: null`, which it
does for a YAML syntax error, an unsupported tag, a top-level scalar (a
missing colon, as in `title New`) or sequence, and a blank or comment-only
block. The structured table is built only from `data`, so an edit inside such a
block appeared nowhere: not in the table and not in the preview. When a mapping
became a scalar, the table marked every key removed and the new line was
stripped. This shipped with frontmatter rendering in b3c94cc (#442), so 5.1.0
has it.

Seen on 2026-11-05 during the js-yaml 5 update review: with a `!!set` tag the
parser did not support yet, changing `title: Old` to `title: New` showed only
the body.

## Fix

A side is unmapped when `getFrontmatterLines()` finds a block and
`extractFrontmatter()` returns `data: null`. When the base (for a modified or
deleted file) or the target (for a modified or added file) is unmapped, the
memo strips nothing and renders no table, so the edit shows as raw changed
lines. This mirrors the existing path for an unavailable side, which also
keeps the raw lines.

Decided by the maintainer (2026-11-05), against a recommendation to keep
stripping them: blank and comment-only blocks follow the same rule. They now
render in Diff Preview even when unchanged, each `---` delimiter as a
horizontal rule and each comment line as a Markdown heading, and a comment edit
inside a comment-only block is visible. This affects pages with an empty
`---`/`---` block, a common Jekyll layout.

Rejected:

- A snapshot table of the side that is a mapping. Next to an unmapped side it
  would show every key as added or removed, which misstates the edit.
- Detecting only syntax errors (`extractFrontmatter()` returning the whole text
  as `content`). Scalars and sequences parse, so their edits stayed hidden.
- Keeping blank and comment-only blocks stripped (see the maintainer's decision
  above). It would also keep a comment edit in such a block hidden.

Tests in `MarkdownDiffViewer.test.tsx` cover target and base syntax errors,
scalars, sequences, a mapping that becomes a scalar, comment-only blocks, and
an added file with a syntax error; each fails against the previous viewer.

Not part of this fix: an edit that leaves both sides' data equal is still
hidden; see `_todo/2026-11-05-diff-preview-hides-data-neutral-frontmatter-edits.md`.
