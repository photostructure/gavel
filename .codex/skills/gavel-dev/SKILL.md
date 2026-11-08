---
name: gavel-dev
description: Request human review of changes in this repository through gavel, using the Codex workflow that ends the turn during human review.
metadata:
  internal: true
---

# Gavel development reviews in Codex

Read [the Codex gavel skill](../gavel/SKILL.md) and follow its scoped capture,
feedback, approval, and handoff workflow. Use the repository's prescribed launcher:
`/home/mrm/.local/bin/difit`. This source-build launcher is shared with Matthew;
never substitute another install. For stacked commits, follow that skill's rule
of one named review per commit on one server, in commit order, with one link.

For routine human review, use a detached `--background` server or reuse an
existing server. Share the URL, record pending work, and end the turn. Resume
with a snapshot when Matthew sends feedback or **Copy resume prompt**.
Do not run a waiter, inspect an unchanged server, or keep a subagent alive while
Matthew reviews. Do not read the Claude skill to choose a Codex waiting mechanism.

Use `pnpm run dev` only when the requested task needs the Vite development loop.
It starts a foreground CLI/Vite process tree and does not support `--background`.
A process handle alone is not a delivery path into an idle Codex chat. Do not
start a development server merely to wait for review or stop an existing server
to switch workflows. If a requested development workflow cannot survive handing
back, report that limitation without starting a polling or keep-alive turn loop.
