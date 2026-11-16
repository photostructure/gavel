---
title: Refuse a comment anchored outside a named review's hunks
priority: p2
section: Server and CLI
---

# Refuse a comment anchored outside a named review's hunks

Done. Base commit `47c5959`.

## Problem

A named review shows only its captured hunks, numbered as the patch numbers them.
`--comment` at launch and `gavel comment add --review <name>` accepted a thread on a line
outside every hunk and answered `"success": true` with no warning. On 2026-11-13 an
agent placed a guide comment on `src/client/App.tsx` line 1593 of the `no-close` review,
taken from the file after applying the patch to a newer `main`; the patch numbers that
line 1534, inside a hunk covering new lines 1531–1537. The reviewer could not open it.
Since `ab253fc` a named review whose patch names its blobs loads the lines around its
hunks, so such a comment opens on whatever line the captured file has there instead.

## Decision

The maintainer chose (2026-11-15, question DF-6, accepted as recommended) to refuse a
line comment anchored outside every hunk of a named review's captured file, with an
error that names that file's hunk ranges on the side the comment names, rather than
accept it as a review-level comment. The refusal covers every line outside a captured
hunk, including lines the expanded context shows.

## Outcome

- `commentsOutsideHunks` in `src/utils/commentImports.ts` returns the refusal for thread
  imports outside every hunk of their file on the side they name, or `undefined`. A
  range must lie inside one hunk. It reads the hunks of every captured record with the
  comment's path, since a type change (a file turned into a symlink) captures a deletion
  and an addition for one path. A file the review lacks, or a side with no lines in any
  hunk, is refused too. The error lists every refused comment in one message.
- `src/server/server.ts` calls it in two places: in `startServer` right after the named
  review is created, so `--comment` exits 1 before the server listens (and
  `--background` passes the child's stderr on), and in `POST /api/comment-imports`,
  which answers 400 with the refusal as `error` and adds nothing. The POST check uses the
  selected review, so `gavel comment add` without `--review` is checked too when the
  viewer's current review is named. `src/cli/index.ts` is unchanged.
- The whole import is refused, matching how a malformed entry already refuses the
  batch; refusals are errors, not entries in `warnings`, so an agent cannot read the
  result as success.
- Docs: `docs/cli.md` (Initial comments), `skills/gavel/SKILL.md` (Guide the reader),
  the `CommentImportRequest` description in `gavel schema import`, and the `--review`
  help of `gavel comment add`.

## Decisions taken by the implementer

- Reply imports are not checked: they attach to an existing thread at that position,
  and an unmatched reply is already skipped with a warning.
- Threads restored from a saved review or added through the browser are not checked.

## Review

`coding:second-opinion`: LAND from Codex and Claude after two passes. One accepted
finding (the type-change case above); no vetoes.
