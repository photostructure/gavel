---
title: Remove the redundant requested approval field
section: Review protocol
---

# Remove the redundant requested approval field

Placeholder. Not started.

Matthew found `requested: true` unclear on an **Approve after comments** verdict,
where it can be mistaken for an agent's request for approval. On a server with
conversations, both approval verdicts now record `approved: true` and
`requested: true` together, so the field no longer carries separate information.

Remove `requested` from the protocol, UI, skills, and saved reviews, or fold it into
[one verdict field](2026-11-07-approval-verdict-field.md), which proposes replacing
the same flags. Start from [approval modes](../docs/approval-modes.md) and
[conversation state](../src/server/conversation.ts). Plan compatibility before
removing a persisted or public field.
