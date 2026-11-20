---
title: gitHeaderPaths in review-capture.ts still decodes at every header boundary
priority: p3
section: Review capture
---

# gitHeaderPaths in review-capture.ts still decodes at every header boundary

Placeholder. Not started.

`p3-20261115-quadratic-diff-header-parse.md` made `parseDiffHeaderPaths` in `src/server/git-diff.ts`
test only the two boundaries Git can write. `gitHeaderPaths` in
`src/server/review-capture.ts`, which `capturePatch` and
`validateCapture` use on every capture a token holder posts, still decodes both halves at every
` a/`-style boundary. A second-opinion reviewer of that change measured one header at 4 KB in
2.3 ms, 32 KB in 9.4 ms and 320 KB in 533 ms: much cheaper per boundary than the old parser, but
growing faster than linearly.

Fix direction: apply the same two-boundary test in `gitHeaderPaths`, or call the git-diff.ts
parser, test-first with a test that counts decode calls rather than
timing.
