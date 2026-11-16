---
title: The host wait check fails whenever the agent follows the gavel skill
priority: p3
section: Testing
---

# The host wait check fails whenever the agent follows the gavel skill

Placeholder. Not started.

`scripts/host-wait-e2e/run.sh` tells a real Claude Code session to follow
`skills/gavel/SKILL.md`, then fails setup unless a `gavel wait` process is running for
the review's port (`waiter_running || fail "no gavel wait is running ..."`, run.sh:268).
The skill's "Wait for feedback" section forbids `gavel wait`: Claude Code reviews get
feedback through the session inbox instead. So `tui` and `desktop` runs fail at setup
when the agent does what it is told, and the check can no longer show whether a host
wakes the agent once per human event. `selftest` mode, which runs no model, still
exercises `gavel wait` directly.

Found by a second-opinion reviewer during the 2026-11-15 docs cleanup; the setup
condition was read in the script, not run.

Fix direction: measure inbox delivery instead of a waiter process (model calls per
human event, and no model calls while idle), or drop the `tui` and `desktop` modes.
