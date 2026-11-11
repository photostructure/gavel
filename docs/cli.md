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

`review create` and `review update` read stdin only with an explicit `-`. Without `-`, `--capture`,
`--pathspec`, or `--include-untracked`, they exit with an error when stdin is a pipe, socket, or file,
so a piped patch can't be replaced by a capture of the uncommitted tree. To capture the uncommitted
tree from a script that leaves stdin open, redirect stdin from `/dev/null`.

## Initial comments

Seed a thread when launching gavel:

```bash
gavel --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":10},"body":"The background for this change is..."}'
```

`--comment` accepts a JSON object or array and can be repeated:

- `thread`: create a new thread at the specified diff position
- `reply`: add a reply to the latest existing thread at the same diff position

If the same comment already exists, gavel skips importing it.

### Links in comments

Comment bodies are Markdown. A link whose URL is a fragment naming `thread`, `file`,
`line`, or `side`, or a query naming `review`, moves around gavel instead of leaving
the page, so an agent can write a reading tour: a "Start here" comment that links to
the next stop, with side links to the code it explains.

| Link                                          | Goes to                                                       |
| --------------------------------------------- | ------------------------------------------------------------- |
| `[next](#thread=tour-2)`                      | the thread with ID `tour-2` in the same review                |
| `[parser](#file=src/parse.ts)`                | the file's header                                             |
| `[parser](#file=src/parse.ts&line=40-52)`     | lines 40-52 of the new side; add `&side=old` for the old side |
| `[API half](?review=api-split)`               | the named review `api-split`                                  |
| `[API half](?review=api-split#thread=tour-1)` | a thread, file, or line in that review                        |

The **Why this change** text in **Change summary** (`--why`) renders the same links, so
it can hold the tour's first link.

Set a thread's ID when importing it (`"id":"api-split-tour-2"`), so a comment can link
to a thread posted later. Gavel assumes thread IDs are unique across a server's
reviews, so prefix them with the review name. A link in another review's comment,
shown in **Conversation**, points into that comment's review.

Each jump adds a browser history entry, so Back returns to the comment the link was
in, and the page URL keeps the place. For a link in another review's comment, Back
returns to the review you were reading instead. When gavel cannot follow a link (no
such thread, file, or named review, or a line the diff cannot show), it says why at
the bottom of the page. A named review holds only its captured hunks, so link only
to lines inside them. A line past the end of a file is not detected: the view waits
at the top of the file. The cursor lands on the last line of a range, where a
comment on that range shows. Percent-encode spaces (`%20`), `&`, `#`, `+`, and `%`
in file paths and thread IDs.

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
