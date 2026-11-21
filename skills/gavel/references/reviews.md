# Captures, stacks, and detached servers

Use the launch record's host and API port in every command below.

## Select hunks

To select overlapping hunks, capture once and use that artifact's catalogue IDs.
Captures hold untracked files' contents, so write each one into a new directory from
`mktemp -d`, never a fixed `/tmp` name; `<dir>` is the path it prints:

```sh
mktemp -d
<gavel-command> review capture --pathspec src --output <dir>/capture.json
<gavel-command> --review parser-fix --capture <dir>/capture.json --select '<hunk-id>' --keep-alive
```

Repeat `--select` for files or hunks. IDs belong to the artifact's digest and
repository root; binary and rename-only changes require file IDs.

Split a modified file's hunks only when that file alone exceeds the review
budget: use `--select` for uncommitted work, or a separate patch per part for
committed work.

## Import a patch

Import a patch with `<gavel-command> - --review <name> < <patch>`. Pathspecs and
untracked-file options apply only to native captures. If external clean/process
filters block capture, including in submodules, narrow the paths or explicitly
prepare a patch or capture artifact.

## Stack existing commits

Launch the first SHA with its message and `--keep-alive`; add later commits in
order:

```sh
git diff --full-index <sha>^ <sha> | <gavel-command> review create <name> - --host <host> --port <port>
```

The `-` is required. Each approval covers its own review and permits landing an
existing commit. Split an oversized commit in the stack further.

## Split commits, branches, and PRs

Fetch the PR head if needed and prepare `git diff --full-index <base> <target> --
<paths>` per part. For a branch/PR, use `git merge-base <landing-branch> <target>`
as `<base>` to exclude newer landing commits; include both names of renamed
files. Pipe the first patch to `<gavel-command> - --review <name> --keep-alive`,
later patches to `review create <name> - --host <host> --port <port>`, or use a
detached server. Require every part's snapshot approval; `approval status <sha>`
matches only whole-commit patches.

## Detached servers

`--background` detaches without opening a browser or streaming stdout. Share the
`url` in its `server.background` record, keeping its `#gavel-token=…` fragment;
recover state through snapshots. It cannot read a named patch from stdin: launch
unnamed on `HEAD --background --keep-alive` without `--comment`,
`--commit-message`, or `--why`. Then create the named review from stdin, add
comments and summary, and put the `review` query before the fragment:
`<url origin>/?review=<name>#gavel-token=<token>`. This keeps the bootstrap from
becoming a review tab.

## Refresh a capture

Before `review update <name> --host <host> --port <port> --expected-version <n>`,
read `capture.version` from `comment snapshot --review <name> --host <host> --port <port>`.
Repeat the intended source: `-` for a patch, native
`--pathspec`/`--include-untracked`, or `--capture` with selectors. Update does not
reuse filters; omitting them captures the whole uncommitted tree. Reconcile HTTP
409 before retrying. An identical patch preserves version and approval; a changed
patch advances the version and moves Approve to it.

## Agent identity

**About** identifies the launching agent/session from the environment and, for
Codex, its rollout. Override wrong or missing values with `--agent` and
`--agent-session-id`. The session name comes from the Claude Code transcript or
the Codex session index, read again on each page load so renames show; pass
`--agent-session-name` only to replace it. When that file is missing or a record
has changed shape, About shows the name as "failed to parse" with the cause.
Reused servers retain the launching session's identity.

## Rename, withdraw, delete, or reopen a review

Rename with `review rename <name> <new-name> --host <host> --port <port>`; `reviewId`,
comments, proposal, and verdict stay, but comment links naming the old review stop
resolving. Delete an unwanted review you created with
`review delete <name> --host <host> --port <port>`, freeing its name. Comments
remain in **Conversation** until shutdown, but the saved capture is deleted:
`review unapply`/`review reapply` can no longer find it. Keep reviews you may
still unapply or reapply.

Withdraw a review you shared but no longer want reviewed, such as one a later
review supersedes or one whose approach you abandoned, with
`review withdraw <name> --reason '<why>' --host <host> --port <port>`. Its tab stays,
struck through, and the reason shows at the top of the review, so write it for the
user: say what replaced it or what you will do instead, and link the replacement
tab as `[name](?review=<name>)`. It keeps its comments and any verdict, takes no new
verdict, and an earlier Approve no longer authorizes a commit. Withdrawing again
replaces the reason; nothing reverses a withdrawal, so put revised work in a new
review. Once the user may have seen a review, withdraw it rather than delete it.

Reopening the same named patch or commits restores saved conversations, proposals,
and approval, but review IDs and event cursors change. Snapshot before sending
status, replies, or summaries. `approval status <sha>` also reads saved approval
after server shutdown.
