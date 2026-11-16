---
title: Parsing a long diff --git header takes quadratic time on the event loop
priority: p3
section: Diff parsing
---

# Parsing a long diff --git header takes quadratic time on the event loop

Placeholder. Not started.

When a `diff --git` header does not split into two segments, `parseDiffHeaderPaths` in
`src/server/git-diff.ts` tries every ` a/`-style boundary and decodes both halves with
`decodeGitPath` each time. Measured `parseStdinDiff` times for one header: 2 KB 125 ms, 4 KB
400 ms, 8 KB 1.6 s, 16 KB 6.3 s; a 160 KB header had not finished after 3 minutes.
`validateCapture` parses the same header in about 1 ms, so `POST /api/reviews` and
`POST /api/reviews/:name/capture` accept it and then block the server, and every
`/api/diff?review=` request parses it again. Commits reach the same parser through
`GitDiffParser.parseDiff`, and Git objects need no checkout, so a file-system path limit does
not bound them: a commit made with `git fast-import` holding a 4,404-byte path produced an
8,824-byte header that took about 2 s to parse. The sources are token holders posting captures
and the authors of commits reviewed with `gavel <commit>` or `--pr`.

Fix direction: identical old and new paths split the header at `(raw.length - 1) / 2`, so test
that boundary only, or compare raw substrings before decoding.
