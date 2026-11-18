---
title: Bidi control characters make the diff show different code from the patch
priority: p4
section: Diff rendering
---

# Bidi control characters make the diff show different code from the patch

Status: complete. Base commit `47c5959`.

## Problem

Patch text containing Unicode bidi controls (U+202A–U+202E, U+2066–U+2069, U+200E, U+200F,
U+061C) rendered reordered, the "Trojan Source" class (CVE-2021-42574). The authors who can
exploit this are PR contributors under `--pr` and a prompt-injected agent.

Repro (escapes written out): a committed line
`if (accessLevel != "user\u202E \u2066// Check if admin\u2069 \u2066") {` displayed in
headless Chromium as `if (accessLevel != "user") { // Check if admin`. A file named
`x\u202Egnp.js` displayed as `xsj.png` in the file list and diff header, a comment thread on
it was labelled `x1:sj.png`, and the same line pasted into a comment body reordered too.

## Decisions

- DF-4 (maintainer, 2026-11-15, accepted as recommended): render each bidi control as a
  visible styled marker reading like `<U+202E>` in code tokens, file names, and comment
  text; no per-file warning banner.
- The marker is a `span.bidi-control` that keeps the character as its text and shows the
  label as `::before` generated content. A selection copy, `textContent`, and comment anchors
  (which read `line.content`, not the DOM) still give the original characters. The span is
  `display: inline-block`, so it is its own bidi paragraph and the character inside cannot
  reorder the text around it.

## Outcome

- `src/client/utils/bidiControls.tsx` holds the character set, `splitBidiControls`,
  `renderBidiText` (React), and `rehypeBidiControls` (a rehype plugin for react-markdown);
  `src/client/styles/global.css` styles `.bidi-control`.
- Code: `PrismSyntaxHighlighter`, `EnhancedPrismSyntaxHighlighter`, and
  `WordLevelDiffHighlighter` mark tokens and word-diff segments, which covers unified and
  split diff lines, suggestions, and fenced code in comments and in unchanged Markdown
  preview fences.
- File names: the file list (file and directory rows), the diff header (path and old path),
  the deferred-rendering placeholder in `App.tsx`, the comment thread label, the unsent
  drafts labels, and the "Link not followed" notice.
- Comment text: `CommentBodyRenderer` runs `rehypeBidiControls` and marks `diff` code blocks.
- Verified in headless Chromium against a built worktree: before the fix the page had no
  markers and showed the reordered text above; after it, 12 markers, the line reads in
  logical order, and Ctrl+C of the line yields the original characters.

## Not covered

- Markdown and notebook preview prose (react-markdown in `MarkdownDiffViewer.tsx` and
  `NotebookDiffViewer.tsx`), changed fences in the Markdown preview
  (`MarkdownDiffViewer.tsx`, the `fenced-code` block lines), and notebook raw cells. These
  were not named by DF-4; a follow-up question to the maintainer.
- The change summary's commit message (`ReviewSummaryPanel.tsx`), which a `--pr`
  contributor controls.
- Native `title` tooltips and `aria-label`s that contain file names: attributes cannot hold
  markers.

## Review

Verdict: LAND. Claude reviewer LAND in one pass; Codex skipped (front-end; maintainer's
standing instruction). No findings were raised, so none were vetoed.
