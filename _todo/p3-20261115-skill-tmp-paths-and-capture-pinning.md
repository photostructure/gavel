---
title: Skill pins unapply to the newest capture and writes captures to fixed /tmp names
priority: p3
section: Agent skill
---

# Skill pins unapply to the newest capture and writes captures to fixed /tmp names

Placeholder. Not started.

1. Any token holder can replace a named review's capture with `POST /api/reviews/:name/capture`,
   given the repository root and current version that `/api/diff` and `GET /api/reviews/:name`
   expose. The skill's Reject flow (`skills/gavel/SKILL.md`, moving to
   `skills/gavel/references/reject.md`) has the agent run `review unapply <name> --dry-run` and,
   on the user's yes, `review unapply <name> --patch-digest <patchDigest from the dry run>`,
   which pins whatever capture is newest. In a test, a replaced capture added `curl … | sh` to
   an untouched `Makefile`; the dry-run stat did list `Makefile`. Fix: have the skill pin the
   `patchDigest` from the agent's own `review create` or `review update` output.
2. The skill tells agents to run `review capture … --output /tmp/capture.json` and then
   `--capture /tmp/capture.json`, and earlier docs used `/tmp/gavel-reply.json` and
   `/tmp/gavel-summary.json` (search the shipped `skills/` and `docs/` for `/tmp/`).
   `writeFile(options.output, …)` in `src/cli/review.ts` follows symlinks and does not use
   `wx`, and captures include untracked file contents. Another local user who pre-creates the
   file can read the capture or swap it before `--capture` reads it back, and a planted symlink
   can overwrite a file the operator can write. Linux's `fs.protected_regular` and
   `fs.protected_symlinks` block this on speedy; macOS has neither (not tested on m1). Fix: have
   the skill and docs write each capture into a fresh `mktemp -d` directory. A fixed path
   opened with `wx` would instead fail on an agent's second capture.
