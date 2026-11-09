---
title: Remove the unused legacy comment prompt formatters
section: Comments
---

# Unused legacy comment prompt formatters

`formatCommentPrompt` and `formatAllCommentsPrompt` in `src/utils/commentFormatting.ts` had no production callers: only `formatAllCommentsPrompt` called `formatCommentPrompt`, and only `src/utils/commentFormatting.test.ts` called either. Copy Prompt, Copy All Prompt, and `formatCommentsOutput` all go through the thread formatters, so these two still emitted the old plain-text format with `=====` separators.

Both functions and their tests are deleted. No helper lost its last caller: `formatCommentLocation` and `formatCommentContent` are still used by `formatCommentThreadPrompt`.

## Lore

- Two of the deleted tests were the only coverage of `formatCommentContent` keeping text before a suggestion and leaving out `ORIGINAL:` when there is no code snapshot. Those cases now call `formatCommentThreadPrompt`, under `suggestion blocks` in `src/utils/commentFormatting.test.ts`.
