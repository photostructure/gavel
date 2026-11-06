---
title: Keep unparsed frontmatter visible in Markdown Diff Preview
section: Markdown viewer
---

# Diff Preview hides the edits in frontmatter it cannot parse

Placeholder. Not started.

## Problem

`MarkdownDiffPreview` (`src/client/viewers/MarkdownDiffViewer.tsx`, the
`frontmatterView` memo) strips the frontmatter lines from both preview sides
with `getFrontmatterLines()` whenever the diff starts at the top of the file.
It does this even when `extractFrontmatter()` returned `data: null` because the
YAML did not parse. The structured table is built only from `data`, so for a
block with a YAML syntax error or an unsupported tag, an edit inside the block
appears nowhere: not in the table and not in the preview.

Seen on 2026-11-05 during the js-yaml 5 update review: with a `!!set` tag the
parser did not support yet, changing `title: Old` to `title: New` showed only
the body. The `!!set` case is fixed, but any frontmatter that fails to parse
still behaves this way.

## To decide

- Strip a side's frontmatter lines only when that side's frontmatter parsed,
  or show the raw block when either side failed to parse.
- How an added or deleted file with unparsable frontmatter should render.

## Acceptance

A Diff Preview regression test where the frontmatter has a YAML syntax error
and the edit changes a line inside it shows that change.
