# Command-line usage

Run `gavel --help` for options, or `gavel <command> --help`
for a subcommand. These examples assume gavel is installed and the current
working directory is the repository to review.

## Named reviews

A named review freezes selected uncommitted changes while you review them.
Repeat `--pathspec` for Git path filters and exclusions; add `--include-untracked`
when needed:

```sh
gavel --review parser-fix --pathspec src --pathspec ':(exclude)src/generated/**' --keep-alive
```

For capture selection, updates, and saved reviews, see the
[conversation protocol](agent-conversations.md#named-captures-for-uncommitted-work).
For verdicts, see [approval modes](approval-modes.md).

To tell servers apart in the browser, pass a short `--title`, such as
`--title 'parser recovery'`. Browsers only show the first 10-20 characters. The title
belongs to the server, so every review tab on that server shares it.

## GitHub pull requests

```bash
gavel --pr https://github.com/owner/repo/pull/123
```

`--pr` mode fetches patches by running `gh pr diff <url>`.
It also imports unresolved inline review threads from the PR so they appear as startup comments in gavel.

Authentication is handled by GitHub CLI:

1. **Login once** (recommended): `gh auth login`
2. **Token-based auth** (CI/non-interactive): set `GH_TOKEN` or `GITHUB_TOKEN`

### GitHub Enterprise Server

For Enterprise Server PRs, authenticate GitHub CLI against your Enterprise host:

1. `gh auth login --hostname YOUR-ENTERPRISE-SERVER`
2. Or set `GH_ENTERPRISE_TOKEN` or `GITHUB_ENTERPRISE_TOKEN`.

## Piped diffs

Pass a unified diff on stdin:

```sh
git diff --cached | gavel -
gavel - < changes.patch
```

`-` explicitly selects stdin. Without a positional argument, `--pr`, or `--review`,
gavel also accepts piped input automatically. `--review` reads stdin only with an explicit `-`.
An explicit Git target or `--pr` takes priority over automatic stdin detection.

## Initial comments

Seed a thread when launching gavel:

```bash
gavel --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":10},"body":"The background for this change is..."}'
```

`--comment` accepts a JSON object or array and can be repeated:

- `thread`: create a new thread at the specified diff position
- `reply`: add a reply to the latest existing thread at the same diff position

If the same comment already exists, gavel skips importing it.

## Open in editor

Set `GAVEL_EDITOR` before starting gavel. It accepts `vscode` (default), `cursor`, `zed`, `textmate`, `bbedit`, `emacs`,
`macvim`, `sublime`, `nova`, `custom`, or `none`. If `GAVEL_EDITOR` is unset,
gavel checks `EDITOR` for one of these preset names. Use `none` to hide the
button. Open in editor is unavailable for stdin diffs.

```sh
GAVEL_EDITOR=cursor gavel .
GAVEL_EDITOR=custom GAVEL_EDITOR_COMMAND=emacsclient \
  GAVEL_EDITOR_ARGS='--no-wait +%line %file' gavel .
```

For `custom`, set both `GAVEL_EDITOR_COMMAND` and `GAVEL_EDITOR_ARGS`. The
template must pass `%file` or `%file:%line` as a separate argument; `%line` is replaced with the
selected line. `%file` becomes the absolute repository file path. Arguments are
passed directly to the executable without a shell. Restart gavel to change the
editor.
Use the full URL printed by gavel when opening a review manually; its fragment
authorizes editor launches for that server session.
