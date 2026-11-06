---
title: Show frontmatter edits that leave the parsed data unchanged
section: Markdown viewer
---

# Diff Preview hides frontmatter edits that do not change the parsed data

Placeholder. Not started.

## Problem

`MarkdownDiffPreview` (`src/client/viewers/MarkdownDiffViewer.tsx`, the
`frontmatterView` memo) strips both sides' frontmatter lines whenever both
parse as key/value mappings and the diff starts at the top of the file. The
table appears only when some key's value differs, and then lists every key. An
edit that changes the YAML text but not the parsed data, such as a comment,
quoting (`title: Old` to `title: "Old"`), or key order, appears in neither the
table nor the preview.

Found on 2026-11-05 while fixing Diff Preview for frontmatter that is not a
key/value mapping. It predates that fix.

## To decide

- Keep the raw lines when the frontmatter lines changed but the table has no
  changed entries, or show a note in the table instead.
- The mixed case: a comment changes in the same edit as a value. The table
  appears and both sides are stripped, so the comment edit is still hidden
  even when the first option is taken.

## Acceptance

A Diff Preview regression test where only a frontmatter comment changes shows
that change.
