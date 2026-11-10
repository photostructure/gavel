---
name: gavel-dev
description: Request human review of changes in this repository through gavel, using the Codex workflow that ends the turn during human review.
metadata:
  internal: true
---

# Gavel development reviews in Codex

Read [the Codex gavel skill](../gavel/SKILL.md) and follow its scoped capture,
feedback, approval, and handoff workflow. Use the user's prescribed launcher;
otherwise use `node dist/cli/index.js` from the Git root. Never substitute another
install when a launcher is prescribed. A launcher serves its checkout's existing
`dist/`. To tell whether that build matches the checkout's current tree, run
`node dev/build-info.js` there, then
`grep -lF <value> dist/client/assets/index-*.js` once with its `commit` and once
with its `diffHash`; the build matches only when both print a file. **About**
shows the same values as **Built from commit** and **Uncommitted changes**; check
it when `diffHash` is `null`, which shows as **None**. A match covers what
`vite build` saw; `pnpm build` compiles `dist/cli` just before it, but a lone
`vite build` leaves `dist/cli` unchecked. Split a large change into several reviews by
that skill's size limits and grouping rules. For stacked commits, follow its rule
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
