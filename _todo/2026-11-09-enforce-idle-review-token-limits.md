---
title: Enforce idle-review token limits outside the model
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

Start from [the Codex integration guide](../docs/codex-review-integration.md),
[waiting behavior](../docs/waiting-for-review.md), and the existing
[host wait check](../scripts/host-wait-e2e/README.md), which measures actual model
calls. Extend that evidence to repeated failures and recovery loops before
claiming a host prevents idle token use. No live-model test is scheduled by this plan.
