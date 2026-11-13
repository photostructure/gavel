---
title: Show an SVG both rendered and as a text diff
section: Viewers
---

# TPP: Show an SVG both rendered and as a text diff

Placeholder. Not started.

An SVG is text that renders as an image, and gavel shows only one of the two, depending on
where it is viewed:

- In a live diff, `svg` is in `IMAGE_EXTENSIONS` (`src/client/utils/imageUtils.ts`), so the
  image viewer shows the two rendered versions and no text. A change that does not alter the
  rendering, such as an attribute or a comment, is invisible.
- In a named review, `DiffViewer.tsx` sends a file with hunks to `TextDiffViewer`, because a
  capture holds an SVG as text hunks, not bytes. The rendering is unavailable.

The maintainer asked whether an SVG should be viewable both ways, as Markdown is with its
Diff / Diff Preview / Full Preview tabs (`src/client/viewers/PreviewModeTabs.tsx`). GitHub
renders an SVG by default with a source/rich toggle; VS Code renders it by default.

## Direction

An SVG viewer, or an image-viewer mode for SVG, with a tab for the text diff and a tab for
the rendered old and new versions, in both live diffs and named reviews. Which tab is the
default is open.

In a named review, the rendered versions need whole files. Since `ab253fc`,
`capturedFileContent` in `src/server/review-capture.ts` serves both sides of a captured text
file at `/api/blob/<path>?review=<name>&version=<n>&side=old|new`: the old side is the blob
on the section's `index` line, and the new side is that blob with the section's hunks
applied. A file it cannot rebuild (a plain unified patch, an old blob the repository lacks, a
`--select` that left out an earlier hunk) has `contextUnavailable` set in the diff response.

An SVG can carry script; check how the image viewer's `<img>` already contains that before
adding any inline rendering.
