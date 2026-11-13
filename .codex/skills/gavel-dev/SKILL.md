---
name: gavel-dev
description: Request human review of changes in this repository through gavel, using the Codex workflow that ends the turn during human review.
metadata:
  internal: true
---

# Gavel development reviews in Codex

Follow [the Codex gavel skill](../gavel/SKILL.md) for scope, grouping, feedback,
approval, and handoff. Do not load the Claude skill to choose a waiting mechanism.
Use the prescribed launcher, or `node dist/cli/index.js` from the Git root if none
is prescribed. Never substitute an install.

The launcher serves its checkout's existing `dist/`. To verify the build, run
`node dev/build-info.js` there and `grep -lF <value> dist/client/assets/index-*.js`
for both `commit` and `diffHash`; both must match. If `diffHash` is `null`, verify
**About → Uncommitted changes: None**; **Built from commit** shows the commit.
These values cover Vite's input; `pnpm build` compiles `dist/cli` first, but a lone
`vite build` leaves `dist/cli` unchecked.

For routine review, reuse a server or launch with `--background`. Share its URL,
record pending work, and end the turn. Handle delivered events or read the named
large-batch feedback file on resume. Snapshot for missing context, manual resume,
or the final approval check. Queue acceptance does not prove the chat resumed;
keep manual recovery available. Never wait, inspect an unchanged server, or keep
a subagent alive during human review.

Use `pnpm run dev` only when the task needs Vite's development loop. It starts a
foreground CLI/Vite tree and cannot use `--background`; a process handle is not
delivery into an idle chat. Do not start it merely to wait or stop an existing
server to switch workflows. If the requested development workflow cannot survive
handback, report that limitation without polling or keeping a turn alive.
