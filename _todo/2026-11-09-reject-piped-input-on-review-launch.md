---
title: Reject piped input when a named review launch omits the stdin marker
section: CLI
---

# Reject piped input when a named review launch omits the stdin marker

`git diff | gavel --review name` has the hazard that `review create` and
`review update` no longer have: without `-`, the launch ignores the pipe and
captures the uncommitted tree. Traced from `readFromStdin` in
[index.ts](../src/cli/index.ts), and documented in [cli.md](../docs/cli.md); not
run. `gavel review capture` also ignores stdin, but it has no `-` argument and
only prints a capture.

The fstat rule in `resolveCommandReview` ([review.ts](../src/cli/review.ts))
probably applies unchanged. `--pathspec` and `--include-untracked` must keep
working under an open pipe, as the integration test `starts a native named
review from a subdirectory while stdin stays an open pipe` requires.
