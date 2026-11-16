---
title: Markdown URL checks let protocol-relative and upper-case external links through
priority: p3
section: Markdown rendering
---

# Markdown URL checks let protocol-relative and upper-case external links through

Placeholder. Not started.

- `isSafeUrl` (`src/client/utils/markdownUtils.ts`) matches `//evil.example/x` with its
  relative-path branch `\.{0,2}\/`, so a protocol-relative link or image passes as relative.
- `isExternal` is a case-sensitive `startsWith('http')` in `CommentBodyRenderer.tsx`,
  `MarkdownDiffViewer.tsx`, and `NotebookDiffViewer.tsx`, so `HTTPS://…` and `//host` links
  open in the gavel tab itself without `target` or `rel=noreferrer`.
- Mermaid `click A href "https://…" _blank` also navigates the gavel tab under
  `securityLevel: 'strict'`.
- Remote images in comments, PR comments, repository Markdown, and notebooks load
  automatically, and without a Referrer-Policy the image host receives the gavel origin, which
  names the tunnel hostname when one is used.

No token leaves the origin in any of these cases. Fix direction:

- In `isSafeUrl`, drop the bare `|\/` alternative (`\.{0,2}\/` already matches `/`) and refuse a
  second slash or backslash after the first: `\.{0,2}\/(?![\/\\])`. Changing only the
  relative branch leaves `//evil.example/x` matching the bare alternative.
- Test `isExternal` case-insensitively.
- After Mermaid renders (`src/client/components/MermaidDiagram.tsx`), give each SVG `<a>` with
  an off-origin href `target="_blank"` and `rel="noreferrer"`.
- Set `Referrer-Policy: no-referrer` (see `p3-20261115-http-security-headers.md`).
