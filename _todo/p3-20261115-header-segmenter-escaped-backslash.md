---
title: A mode-only change to a file whose name ends in a backslash drops out of the diff
priority: p3
section: Diff parsing
---

# A mode-only change to a file whose name ends in a backslash drops out of the diff

Placeholder. Not started.

The `diff --git` header segmenter in `parseDiffHeaderPaths` (`src/server/git-diff.ts`)
treats a quote preceded by a backslash as escaped (`char === '"' && prevChar !== '\\'`). Git
writes a file named `x\` as `"a/x\\" "b/x\\"`, where the closing quote follows an escaped
backslash, so the segmenter stays inside the quotes and the header does not split into two
segments. A mode-only change to that file then has no `---`/`+++` paths to fall back on and
drops out of the parse. A second-opinion reviewer reproduced this with real Git during the
quadratic-header fix; it happens at `47c5959` too.

Fix direction: track escapes by counting consecutive backslashes (or by consuming `\` plus the
next character) instead of looking only at the previous character, test-first with a real-Git
fixture for `x\`.
