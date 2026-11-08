---
title: Show every conflicted file in an unstaged review, with its conflict hunks
section: Git integration
---

# Conflicted files in an unstaged review

Placeholder. Not started.

A file with content conflicts appears in an unstaged review under its own path, with no hunks (`diff --cc` in `parseUnifiedDiff`, `src/server/git-diff.ts`). Two gaps remain.

A modify/delete conflict is missing from the review. Git writes `* Unmerged path dm.txt` for it instead of a `diff --cc` block, and the parser splits only on `diff --git` and `diff --cc`. With that conflict as the only change, `parseDiff` returns no files and the page reports no changes while the merge is unresolved (reproduced with a real `UD` conflict on 2026-11-08). That line carries the path unquoted even with `core.quotePath=true`, so a non-UTF-8 name cannot get its quoted form from it.

The combined `@@@` hunks of a content conflict are not rendered. That needs a combined-diff parser and a viewer change.
