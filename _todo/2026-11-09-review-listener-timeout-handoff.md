---
title: Explain when review listening stops
section: Agent integration
---

# Explain when review listening stops

Placeholder; no timeout or automatic message is implemented.

Matthew suggested waiting five or ten minutes for review feedback, then posting
“I am no longer actively listening; type `go` when you want me to review your
decisions” with the review URL so it is easy to reopen.

Investigate a host-driven timeout and one clear handoff message without polling
or keeping a model active. Preserve the current immediate handback on Codex until
its host can deliver this safely. Decide whether a host can post the message
without inference; account for any final model turn explicitly. Do not promise
listening that the host cannot provide. Coordinate with
[host-enforced limits](2026-11-09-enforce-idle-review-token-limits.md).
