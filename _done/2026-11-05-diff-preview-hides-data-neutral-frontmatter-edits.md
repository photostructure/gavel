---
title: Show frontmatter edits that leave the parsed data unchanged
section: Markdown viewer
---

# Diff Preview hides frontmatter edits that do not change the parsed data

Fixed. Raw frontmatter is hidden only when the table accounts for every changed line (`tableAccountsForFrontmatterEdit` in `src/client/utils/frontmatterDiff.ts`). Otherwise all raw lines stay beside the table as literal lines with add/delete colors. Accepted as recommended on 2026-11-08, including two pinned limits: an inline comment on a changed line and an indented comment inside a changed key stay hidden.

- [x] Red, then green: `pnpm vitest run src/client/utils/frontmatterDiff.test.ts src/client/viewers/MarkdownDiffViewer.test.tsx`
- [x] Reviewed with `coding:second-opinion`: LAND on base `f3e74c3`. Codex skipped (front-end; the maintainer's standing instruction).

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
