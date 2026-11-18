---
title: Show bidi control markers in Markdown and notebook previews and the change summary
priority: p3
section: Diff rendering
---

# Bidi markers in previews and the change summary

Placeholder. Not started; run after `p4-20261115-bidi-controls-in-diff.md` lands.

That plan marks Unicode bidi controls in diff code, file names and comment text
(`renderBidiText` and `rehypeBidiControls` in `src/client/utils/bidiControls.tsx`). These still
render the characters raw, so they can reorder the text around them:

- Markdown and notebook preview prose (`MarkdownDiffViewer.tsx`, `NotebookDiffViewer.tsx`).
- Changed fences in the Markdown preview (the `{line.content || ' '}` lines and the
  `fenced-code` block); unchanged fences go through Prism and are covered.
- Notebook raw cells (`<pre>{content}</pre>`).
- The change summary's commit message (`ReviewSummaryPanel.tsx`), which a `--pr` contributor
  controls, which is why this plan is p3.

Native `title` and `aria-label` attributes cannot hold markers. Decision 2026-11-17 (question
DF-14, accepted as recommended): a plan of its own, after the bidi change lands.
