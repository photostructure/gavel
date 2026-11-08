---
title: Read native Git diff metadata from raw NUL-delimited records
section: Git integration
---

# Native Git diff metadata

For repository-backed comparisons, obtain file identity, status, modes and object IDs through `git diff --raw -z` rather than inferring them from patch headers. Keep the documented patch parser for hunks and imported stdin/PR patches, where the original repository may be unavailable. Preserve copy/rename detection choices and capture consistency when combining metadata with patch content. Resolve the named-review capture design before implementation: `src/server/review-capture.ts` creates repository-backed artifacts that currently retain patch text and render through `parseStdinDiff`; decide whether to persist raw metadata with corresponding schema/digest changes or retain the patch-parser path for those artifacts.

Raw records provide explicit fields and unquoted NUL-delimited paths, avoiding dependence on display quoting. Before adopting this path, verify identical results under `LANG` / `LC_ALL` variations (`C` and available UTF-8 locales), including spaces, tabs, newlines, Unicode, renames, copies, modes, binary changes and submodules. Define handling of filenames that are not valid UTF-8 rather than silently corrupting them.

Copy status travels through the shared types and UI as `copied`, so copies are no longer presented as renames, and both labels are tested.

Context: Matthew requested this follow-up while reviewing the metadata-only path fix (`4335456`, `fix(git-diff): preserve paths in metadata-only patches`). That correction and `src/server/git-diff.metadata.test.ts` remain independently useful for imported patches. This plan records a future migration.

Reference: [Git raw output format](https://git-scm.com/docs/git-diff#_raw_output_format).

## Outcome

Done as narrowed (accepted as recommended, 5D-9 A and 5D-10 A). Gaps left for later: `2026-11-08-conflicted-files-in-the-review.md`.

- [x] Red, then green against real git: `pnpm vitest run src/server/git-diff.metadata.test.ts src/server/git-diff.capture.test.ts`
- [x] Reviewed with `coding:second-opinion`: LAND on base `f3e74c3`. Codex and Claude on the server batch; Codex skipped on the client batch (front-end; the maintainer's standing instruction).

## Decision: raw migration deferred

Do not migrate to `git diff --raw -z` until a feature needs modes or object IDs. Capture schema and digests stay as they are, and named-review captures stay on the patch parser.

Evidence: a read-only run over ten repositories, 1,955 commits and 26,615 file records found 0 path, status or oldPath mismatches on default config between `parseDiff` output and raw records. `git diff --raw -z` output is byte-identical under `C`, `C.utf8` and `en_US.utf8`, including tab, newline and invalid-UTF-8 names.

The patch parser's actual gaps were fixed in place, without raw records: repository comparisons pin `--src-prefix=a/ --dst-prefix=b/ --submodule=short` and `core.quotePath=true`; copies have their own `copied` status; a type change is one entry; the `/dev/null` tests compare exactly; and a name that is not valid UTF-8 keeps Git's quoted form as `path` with a `hasNonUtf8Path` flag. The user's rename-detection config is still honored.
