---
title: Give agents the review state they need without a jq filter
section: Agent CLI
---

# Agents read `comment snapshot` without a jq program

The gavel skill told agents to pipe `comment snapshot` through an
1,130-character jq program, and a second one to read one thread. Both are gone:
`skills/gavel/references/feedback.md` now names the raw snapshot fields that mark
a message awaiting an answer, a confirmed thread, and the comments Approve after
comments covers.

A CLI view (`comment snapshot --brief`) that computed those fields was built and
dropped on 2026-11-10 (74-8 A, accepted as recommended). Agents read either shape
equally well, and the raw snapshot's extra size (median 2,655 characters per
saved review in this repository, largest 12,608) costs about 1-3K tokens per read
against a wake's context re-read of 170K tokens or more.

- [x] The skill and its feedback reference read the raw snapshot; no jq remains
      in `skills/gavel` — `grep -rn jq skills/gavel`
