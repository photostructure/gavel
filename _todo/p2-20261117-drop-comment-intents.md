---
title: Drop comment intents from stored comments, the server, and the agent protocol
priority: p2
section: Review server
---

# Drop comment intents

Matthew decided on 2026-11-17 to drop comment intents (Comment, Change request,
Question). In one session's gavel reviews, 7 of the 8 comments sent with the
default "Comment" intent were questions or requests for work, and the agent read
each body to decide what to do, so the label never changed its action. The
comment-icons change removes intents from the page: the comment form has no
intent choice, and no comment shows an intent icon, label, or colour.

What remains reads, stores, or sends a field the page no longer sets: `CommentIntent`
and the legacy `isQuestion` in `src/types/diff.ts`; the `message.edit` op's `intent`
in `src/types/reviewOps.ts` and `src/utils/reviewOps.ts`; the `intent` in conversation
events (`src/types/conversation.ts`, `src/server/conversation.ts`), in inbox messages
(`src/server/session-inbox.ts`), and in `gavel wait` output (`src/cli/wait.ts`); the
schema (`src/cli/schema.ts`); comment formatting and imports
(`src/utils/commentFormatting.ts`, `src/utils/commentImports.ts`); thread-level
`isQuestion`, which predates `intent` (also in `src/utils/commentThreads.ts` and
`src/server/server.ts`; moved here from p1-20261114-remove-backward-compat.md); and
the gavel skill's intent guidance. Saved reviews under the git directory hold `intent`
fields; gavel keeps no compatibility paths, so the read path can ignore them. Removing
`intent` from events and the schema changes what agents receive, so it is a breaking
change for the `Changelog:` trailer.
