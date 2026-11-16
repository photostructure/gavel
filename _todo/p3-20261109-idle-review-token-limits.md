---
title: Enforce idle-review token limits outside the model
priority: p3
section: Agent integration
---

# Enforce idle-review token limits outside the model

Placeholder. Deferred from the skill rewrite; no runtime guard is implemented.

Matthew reported several thousand dollars of API usage over two days from agents
looping during review. The skills now prohibit idle model turns and bound recovery,
but instructions cannot stop a host or agent that ignores them.

Investigate which supported hosts can enforce event-driven resumption and stop
repeated turns without new human feedback. Determine where the enforcement must
live before proposing a spending cap or implying that gavel can control billing.
Keep human-feedback handling resumable after a guard stops an agent.

Start from "Wait for feedback" in `skills/gavel/SKILL.md`, "Human review: end the
turn" in `.codex/skills/gavel/SKILL.md`, `gavel wait --help`, and the existing
[host wait check](../scripts/host-wait-e2e/README.md), which tests `gavel wait`
without a model and measures no model calls. Nothing in the repository
measures a host's idle token use, so do not claim a host prevents it. No live-model
test is scheduled by this plan.
