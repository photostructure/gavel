---
title: Leave resolved threads out of the agent's "awaiting an answer" count
section: Agent conversations
---

# Leave resolved threads out of the agent's "awaiting an answer" count

Placeholder; not yet reproduced end to end.

`awaitingAnswer` in `src/server/session-inbox.ts` counts every message whose
progress is not `replied` or `noted`, across all of a review's threads,
including resolved ones. The inbox message then says "N messages awaiting an
answer", and the gavel skill tells the agent to answer or mark Noted each
pending message. When the reviewer resolves a thread before the agent answers
its comment, the agent is still told to answer it, although resolving means
nothing more is needed there. On Approve, the skill has the agent act only on
unresolved threads, so the count and the instructions disagree.

Resolving sends the agent nothing by itself (only human comments and verdicts
are queued), and that stays: the agent sees resolutions in the snapshot it reads
before acting on a verdict.

Another session had uncommitted changes in `src/server/session-inbox.ts` on
2026-11-12; start after that work lands.
