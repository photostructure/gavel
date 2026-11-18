---
title: The all-uncommitted (.) review leaves out unmerged paths during a merge
priority: p3
section: Git integration
---

# The `.` review leaves out unmerged paths

Placeholder. Not started.

During an unresolved merge, the `.` target ("all uncommitted changes", `git diff <base>` in
`src/server/git-diff.ts`) runs a diff that writes no `* Unmerged path` line. In a play-test repo
with a modify/delete conflict (`ud.txt` modified on our side and deleted on theirs), `.` listed
neither `ud.txt`, which matches `HEAD`, nor any sign it is conflicted; `du.txt` appeared only as a
new file. With the unmerged-path change from `p3-20261108-conflicted-files-in-review.md`
(approved, not yet on `main`), the `working` and `staged` targets list both. Checked in headless
Chromium on 2026-11-16.

Fix direction: add the paths `git diff --name-only --diff-filter=U` reports to the `.` review (run it
without the base argument: with `HEAD` it prints nothing),
with no hunks, as the other targets show them. Decision 2026-11-16 (question DF-17, accepted as
recommended): a plan of its own, not part of the unmerged-path change.
