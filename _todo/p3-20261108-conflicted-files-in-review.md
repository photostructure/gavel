---
title: Show the conflict hunks of a conflicted file in an unstaged review
priority: p3
section: Git integration
---

# Conflict hunks in an unstaged review

## Done

Every conflicted file appears in an unstaged review under its own path. A content conflict comes from Git's `diff --cc` block, with no hunks. A conflict Git cannot show as a combined diff, such as modify/delete (`UD` or `DU` in `git status`), comes from Git's `* Unmerged path <path>` line, which `parseUnifiedDiff` in `src/server/git-diff.ts` now splits on as well. Once the surviving file of a `UD` conflict is edited or removed, Git follows that line with the file's diff against our side, and that diff takes the line's place, so the path still appears once. A staged review lists every unmerged path the same way, because `git diff --cached` writes that line for each of them.

Git writes the path in that line unquoted whatever `core.quotePath` says, so a name that is not valid UTF-8 shows replacement characters instead of the quoted form other entries get (and, once its `UD` file is edited, appears twice: once under each form), and a name containing a newline keeps only its first line.

Each of these entries carries `conflicted: true` on its `DiffFile`: the `* Unmerged path` entry, the diff that takes its place (including a type change folded from a deletion and an addition), and a `diff --cc` block. Git keeps no stage-0 index entry for an unmerged path, so `git show :<path>` and `git rev-parse <commit>:<path>` fail for it and print `fatal:` to the terminal running gavel. For a conflicted file the page therefore makes no request that reads it by Git ref: `fileCanExpandHiddenLines` in `src/client/viewers/registry.ts` returns false (no line-count prefetch, no context expansion), `getViewerForFile` returns the text viewer instead of the image, Markdown or notebook viewer, `DiffViewer` turns off whole-file highlighting, and `useLazyDiffRendering` skips the generated-status request. A conflicted image, Markdown file or notebook therefore shows in the text view, with whatever hunks Git wrote.

Skipping generated status loses one case: a conflicted file in a `working` review whose generated-file header is in its content, not its path, is not marked generated, although the server would read that file from disk without Git.

The parser change and the request fix were reviewed against base `47c5959`: Codex LAND (server files), Claude LAND (all files; Codex skipped the client files under the no-Codex-for-front-end rule), with no vetoed findings.

## Remaining work (not started)

A conflicted file has no visible mark: the page shows it like any other modified file, with no hunks for a content conflict. A badge driven by `conflicted` would tell the reviewer why.

The combined `@@@` hunks of a content conflict are not rendered. `parseChunks` matches only two-way `@@ -a,b +c,d @@` headers, so a `diff --cc` block yields no chunks. Rendering them needs a combined-diff parser (one old-side column per parent) and a viewer change to show those columns.
