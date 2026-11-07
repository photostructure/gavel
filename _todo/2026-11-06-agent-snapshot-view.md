---
title: Give agents the review state they need without a jq filter
section: Agent CLI
---

# Agents filter `comment snapshot` through a long jq program

Placeholder. Not started.

## Problem

`skills/difit/SKILL.md` tells agents to pipe `comment snapshot` through a
one-line jq program of 839 characters, because the raw snapshot carries
every thread and code snapshot and floods the agent's context. The filter
derives what an agent acts on:

- each review's capture `version` and `patchDigest`;
- its approval, with the conditions not yet addressed;
- its commit message, `fromCommit`, and summary version;
- every user message that is neither `replied` nor `noted`, with its cursor,
  anchor, code, intent, body, and whether the reviewer resolved the thread
  after the message's last edit (`confirmed`).

A second jq program reads one thread when a message continues an earlier
exchange. Agents copy both by hand, every change to the snapshot shape has to
be mirrored in the skills, and a malformed copy fails only at run time.

## To decide

- Whether this is a flag on `comment snapshot` (such as `--pending`) or its own
  command, and whether the full snapshot stays the default.
- How to read one thread (`--thread <id>`) without the rest.
- Whether `confirmed` is computed by the server, since it compares
  `resolution.updatedAt` with the message's `updatedAt`.
- Updating `skills/difit/SKILL.md`, `.codex/skills/difit/SKILL.md`, and
  `docs/agent-conversations.md` to use it, and adding the shape to `schema`.
