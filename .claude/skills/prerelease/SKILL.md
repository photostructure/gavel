---
name: prerelease
description: Write the `## [Unreleased (patch|minor|major)]` section of CHANGELOG.md from the commits since the last release tag, and choose the version bump. Use before a release, or when asked to draft or refresh the changelog.
metadata:
  internal: true
---

# Draft gavel's release notes

Feature and fix commits do not edit `CHANGELOG.md`; their messages carry a
suggested entry in a `Changelog:` trailer (see [AGENTS.md](../../../AGENTS.md)).
This skill turns those into the release notes, as step 1 of
[RELEASE.md](../../../RELEASE.md). It edits only the top Unreleased section of
`CHANGELOG.md`, and never commits, tags, or pushes. Rerunning it is safe: it
rebuilds the section from the same sources.

Readers skim release notes. A short section that names every change a user
would notice beats a complete one nobody reads.

## 1. Collect the changes

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
LAST=$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 --match 'v[0-9]*' HEAD)
git -C "$PROJECT_ROOT" log "$LAST"..HEAD --no-merges --reverse --format='%h %s%n%b%n---'
git -C "$PROJECT_ROOT" diff "$LAST"..HEAD -- package.json
```

Use these sources, most trusted first:

1. `Changelog:` trailers.
2. Entries already under the `## [Unreleased…]` heading, written by hand before
   this skill existed or by an earlier run.
3. The subject and body of `feat`, `fix`, and `perf` commits that have no
   trailer. Read the commit's diff when the message does not say what a user
   sees.
4. TPPs added to `_done/` since `$LAST`, for the problem a user had.

Users see the CLI, the server's HTTP and JSON output, the web UI, the `docs/`
pages and README, and the shipped skill in `skills/gavel/`. Leave out tests, CI,
refactors, TPPs, formatting, and dependency bumps that change nothing users see.
Leave out a bug that a commit after `$LAST` introduced and a later one fixed: it
never shipped. When in doubt, leave it out.

## 2. Write the entries

- Write one entry per change a user would notice. Merge commits that changed
  the same thing, and describe what ships at HEAD: a feature added and later
  renamed is one entry under its final name.
- Keep each entry to one or two sentences, about 40 words at most. Say what a
  user can now do, or what changed and what they must do about it. Leave out
  implementation detail, test results, and how the change evolved during the
  cycle; link to the page in `docs/` that explains more.
- Write in the present tense: "`gavel review rename <name> <new-name>` renames
  a named review on a running server and keeps its comments."
- Put UI labels in **bold** as the page shows them, and commands, flags,
  endpoints, and JSON fields in `code`.
- Start an entry that forces a major bump with `**Breaking:**`, and say what an
  existing caller must change.

Use these sections, in this order, and omit empty ones: `### Added`,
`### Changed`, `### Removed`, `### Fixed`. A change a working caller could
observe, such as a new error, a flipped default, or different output, goes
under Changed, not Fixed. A change to user docs that is not part of another
entry goes under Changed; drop the `### Documentation` section older notes used.

## 3. Choose the bump

- **major**: an existing user's script, hook, or integration stops working until
  they change it. That covers a removed or renamed command, flag, HTTP endpoint,
  JSON field, or event; a changed JSON shape or exit code; a higher
  `engines.node` minimum in `package.json`; and any commit whose subject has `!`
  just before the colon, as in `feat(conversation.ts)!:`, or whose body has a
  `BREAKING CHANGE:` footer.
- **minor**: a new command, flag, field, event, or UI feature, or any other
  change a working caller could observe.
- **patch**: everything else, such as fixes that restore documented behavior
  and documentation corrections.

Take the largest bump any entry needs. If the existing heading names a larger
bump, keep it, and say in your report why you would lower it.

## 4. Edit CHANGELOG.md

Replace the top `## [Unreleased]` or `## [Unreleased (…)]` heading, and
everything under it up to the next `## [` heading, with the new section:

```markdown
## [Unreleased (minor)]

### Added

- `gavel review rename <name> <new-name>` renames a named review on a running server and keeps its comments.
```

Leave released sections as they are. Format only the changelog, because other
sessions may have unformatted edits in the same checkout:

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
"$PROJECT_ROOT/node_modules/.bin/oxfmt" --write "$PROJECT_ROOT/CHANGELOG.md"
git -C "$PROJECT_ROOT" diff -- CHANGELOG.md
```

Confirm the diff touches only the Unreleased section, and reread that section
as a whole to remove repeats.

## 5. Report

Report the bump and the entries that forced it, then in one line each: changes
you left out that a reader might expect, commits you could not classify, and
trailers you rewrote substantially. The maintainer reviews the rest in the
diff.
