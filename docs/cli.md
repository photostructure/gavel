# Command-line usage

Run `gavel --help` for options, or `gavel <command> --help` for a subcommand's
options and JSON payloads. These examples assume the current working
directory is the repository to review.

## Named reviews

A named review freezes selected uncommitted changes while you review them.
Repeat `--pathspec` for Git path filters and exclusions; add `--include-untracked`
when needed:

```sh
gavel --review parser-fix --pathspec src --pathspec ':(exclude)src/generated/**' --keep-alive
```

`gavel review --help` lists the commands that add, update, rename, delete, and undo
named reviews. A server saves each review's comments, proposal, and verdict under
`<git-common-dir>/gavel/`, and a later server that opens the same name and patch
restores them.

To tell servers apart in the browser, pass a short `--title`, such as
`--title 'parser recovery'`. Browsers only show the first 10-20 characters. The title
belongs to the server, so every review tab on that server shares it.

### Undo a named review's change

`gavel review unapply <name>` reverses a named review's captured patch in the working
tree, for example after a Reject, and `gavel review reapply <name>` puts it back. Both
read the saved capture, so no server needs to run. Run a dry run first, then pass the
digest it printed:

```sh
gavel review unapply parser-fix --dry-run
gavel review unapply parser-fix --patch-digest <patchDigest>
gavel review reapply parser-fix --patch-digest <patchDigest>
```

Before writing, both save a stash of every tracked file, other sessions' edits
included, listed in `git stash list` as `gavel review unapply <name> <digest>` or
`gavel review reapply <name> <digest>`. Unapply refuses while any of the capture's
paths are staged. When another edit sits next to a hunk, unapply's fallback matches
only the hunk's own lines, so it can pick an identical line nearby, such as a blank
line or a lone `}`; the stash holds the files as they were. Hunks either command
cannot place are listed under `rejected` and left alone.
`gavel review unapply --help` describes the output.

### Rename or delete a named review

`gavel review rename <name> <new-name> --port <port>` keeps the review's comments,
proposal, and verdict. `gavel review delete <name> --port <port>` removes its tab; its
comments stay in **Conversation**, marked "(deleted)", until the server stops. A delete
also removes the saved capture that unapply and reapply read, so undo a change before
deleting its review.

### Stop finished servers

```sh
pkill -USR2 -x gavel-server
```

This stops every gavel server whose review tabs all have a verdict, and every
`--no-lgtm` server with a review tab. Other servers keep running, and foreground ones
print why to stderr, such as `gavel server stays up: review "parser-fix" has no
verdict`. A server with no tab keeps running, such as a detached server before its
agent adds a review. Windows has no SIGUSR2.

## GitHub pull requests

```bash
gavel --pr https://github.com/owner/repo/pull/123
```

`--pr` runs `gh pr diff <url>` and imports the PR's unresolved inline review threads
as comments. Authenticate GitHub CLI once with `gh auth login` (add
`--hostname <host>` for GitHub Enterprise Server), or set `GH_TOKEN` or
`GITHUB_TOKEN` (`GH_ENTERPRISE_TOKEN` or `GITHUB_ENTERPRISE_TOKEN` for Enterprise
Server).

## Piped diffs

```sh
git diff --cached | gavel -
gavel - < changes.patch
```

`-` selects stdin. With no Git target, `--pr`, or `--review`, gavel also reads piped
input without `-`. `--review`, `review create`, and `review update` read stdin only
with `-`. `review create` and `review update` exit with an error when stdin is a pipe,
socket, or file and they have no `-`, `--capture`, `--pathspec`, or `--include-untracked`, so a piped
patch is never replaced by a capture of the uncommitted tree. To capture the
uncommitted tree from a script that leaves stdin open, redirect stdin from
`/dev/null`.

## Initial comments

```bash
gavel --comment '{"type":"thread","filePath":"src/example.ts","position":{"side":"new","line":10},"body":"The background for this change is..."}'
```

`--comment` takes a JSON object or array and can be repeated. A `thread` starts a
thread at its diff position; a `reply` answers the latest thread at that position.
A comment that already exists is skipped. `gavel schema import` describes the JSON.

### Links in comments

Comment bodies are Markdown. A link whose URL is a fragment naming `thread`, `file`,
`line`, or `side`, or a query naming `review`, moves around gavel instead of leaving
the page, so an agent can write a reading tour: a "Start here" comment that links to
the next stop, with side links to the code it explains. The **Why this change** text
(`--why`) renders the same links, so it can hold the tour's first link.

| Link                                          | Goes to                                                       |
| --------------------------------------------- | ------------------------------------------------------------- |
| `[next](#thread=tour-2)`                      | the thread with ID `tour-2` in the same review                |
| `[parser](#file=src/parse.ts)`                | the file's header                                             |
| `[parser](#file=src/parse.ts&line=40-52)`     | lines 40-52 of the new side; add `&side=old` for the old side |
| `[API half](?review=api-split)`               | the named review `api-split`                                  |
| `[API half](?review=api-split#thread=tour-1)` | a thread, file, or line in that review                        |

Set a thread's ID when importing it (`"id":"api-split-tour-2"`), so a comment can link
to a thread posted later, and prefix IDs with the review name: gavel assumes they are
unique across a server's reviews. Back returns to where you were when you followed
the link. When
gavel cannot follow a link, a toast says why. Link only to lines inside a file's hunks
when the patch is plain unified (no Git blob IDs) or the repository lacks the file's
old version, as for a pull request whose base was never fetched. Percent-encode
spaces (`%20`), `&`, `#`, `+`, and `%` in file paths and thread IDs.

## Open in editor

Set `GAVEL_EDITOR` before starting gavel: `vscode` (default), `cursor`, `zed`,
`textmate`, `bbedit`, `emacs`, `macvim`, `sublime`, `nova`, `custom`, or `none` to hide
the button. When it is unset, gavel checks `EDITOR` for one of these names. The
button opens the working-tree file, which can differ from a named review's capture,
and is unavailable for stdin diffs.

```sh
GAVEL_EDITOR=cursor gavel .
GAVEL_EDITOR=custom GAVEL_EDITOR_COMMAND=emacsclient \
  GAVEL_EDITOR_ARGS='--no-wait +%line %file' gavel .
```

For `custom`, set both `GAVEL_EDITOR_COMMAND` and `GAVEL_EDITOR_ARGS`. Pass `%file`
(the absolute path) or `%file:%line` as its own argument; `%line` is the selected
line. gavel runs the command without a shell. Restart gavel to change the editor.
