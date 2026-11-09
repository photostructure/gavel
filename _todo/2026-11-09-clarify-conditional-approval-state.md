---
title: Clarify permission to address approval conditions
section: Review protocol
---

# Clarify permission to address approval conditions

Placeholder; protocol fields remain unchanged.

Matthew found `requested: true` unclear in the “Approve after comments” state.
It records the reviewer's conditional authorization, while `approved: false`
still blocks committing until the conditions are satisfied. “Requested” obscures
who authorized what and can be mistaken for an agent's request for approval.

Explore a clearer name or explicit state representation across protocol, UI,
skills, and saved reviews. Preserve the distinction between authorization to
address comments and permission to commit, including revocation and restoration.
Start from [approval modes](../docs/approval-modes.md) and
[conversation state](../src/server/conversation.ts); plan compatibility before
renaming persisted or public fields.
