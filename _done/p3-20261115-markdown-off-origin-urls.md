---
title: Markdown URL checks let protocol-relative and upper-case external links through
priority: p3
section: Markdown rendering
---

# Markdown URL checks let protocol-relative and upper-case external links through

Complete. Base commit `47c5959`.

## What was wrong

- `isSafeUrl` (`src/client/utils/markdownUtils.ts`) accepted `//evil.example/x` through its bare
  `\/` alternative, so a protocol-relative link or image passed as a relative path.
- `isExternal` was a case-sensitive `startsWith('http')` in `CommentBodyRenderer.tsx`,
  `MarkdownDiffViewer.tsx`, and `NotebookDiffViewer.tsx`, so `HTTPS://…` and `//host` links opened
  in the gavel tab without `target` or `rel=noreferrer`.
- Mermaid `click A href "https://…" _blank` also navigated the gavel tab: under
  `securityLevel: 'strict'` Mermaid runs its SVG through DOMPurify, whose hook that keeps `target`
  checks `tagName === "A"` and so misses the lower-case SVG `a`.

No token left the origin in any of these cases.

## Outcome

- `isSafeUrl` now matches `^(https?:|mailto:|#|\.{0,2}\/(?![/\\]))` (case-insensitive, on the
  trimmed URL): the bare `\/` alternative is gone, and a second slash or backslash after the
  first is refused. `//host/x` and `/\host/x` now render as plain text, and such images do not
  load.
- `isExternalUrl` in `markdownUtils.ts` (`/^https?:/i`) replaces the three identical
  `startsWith('http')` copies, so `HTTPS://…` links get `target="_blank"` and `rel="noreferrer"`.
- `MermaidDiagram.tsx` gives every `a` in the rendered SVG whose `href` or `xlink:href` resolves
  to another origin `target="_blank"` and `rel="noreferrer"`. This also covers HTML links inside
  `foreignObject` labels.
- Checked in headless Chromium against a built gavel: the Mermaid link opens a new tab with
  `window.opener === null` and no `Referer`, and the gavel tab stays put.
- Markdown parsing already percent-encodes a backslash or tab in a link destination (`/\host`
  becomes `/%5Chost`, `/<TAB>/host` becomes `/%09/host`), so those never reach the browser as
  protocol-relative URLs; the backslash case of the regex is pinned by the unit tests in
  `markdownUtils.test.ts`.
- The remote-image and Referrer-Policy bullets moved to `p3-20261115-http-security-headers.md`.

## Review

`coding:second-opinion`: Verdict LAND. Claude reviewer LAND; Codex slot missing (skipped for a
front-end batch, per the maintainer's standing instruction). No findings were vetoed.
