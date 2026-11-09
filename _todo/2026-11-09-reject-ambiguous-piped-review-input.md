---
title: Prevent omitted stdin markers from capturing the wrong diff
section: CLI
---

# Prevent omitted stdin markers from capturing the wrong diff

Placeholder; CLI behavior remains unchanged.

Matthew called the required `-` in `git diff ... | gavel review create name -`
a footgun. Omitting it silently captures the uncommitted tree instead of the
piped patch. The same hazard affects `review update`; it can include another
session's work or drop originally included untracked files.

Investigate rejecting ambiguous piped input with an actionable error, or safely
recognizing it. Preserve intentional native captures and avoid blocking on stdin
in noninteractive hosts. Start from [review.ts](../src/cli/review.ts). Verification
must distinguish piped patches, empty pipes, redirected stdin, and native capture
options without sending requests to an existing review server.
