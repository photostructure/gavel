---
title: Explain when review listening stops
priority: p4
section: Agent integration
---

# Explain when review listening stops

Closed as superseded (2026-11-15, question DF-10, accepted as recommended). Agents no longer
wait for feedback: Claude Code reviews deliver human verdicts and comments to the session inbox,
and Codex reviews queue them (`src/server/session-inbox.ts`, `src/server/codex-queue.ts`), so
no agent is listening that could time out. The gavel skill also tells agents not to wait ("Zero
idle model turns", `skills/gavel/SKILL.md`). Nothing was implemented. The original note follows.

Matthew suggested waiting five or ten minutes for review feedback, then posting
“I am no longer actively listening; type `go` when you want me to review your
decisions” with the review URL so it is easy to reopen.

Investigate a host-driven timeout and one clear handoff message without polling
or keeping a model active. Preserve the current immediate handback on Codex until
its host can deliver this safely. Decide whether a host can post the message
without inference; account for any final model turn explicitly. Do not promise
listening that the host cannot provide. Coordinate with
[host-enforced limits](p3-20261109-idle-review-token-limits.md).
