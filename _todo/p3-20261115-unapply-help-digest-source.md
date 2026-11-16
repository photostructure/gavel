---
title: unapply and reapply help still says to take --patch-digest from a dry run
priority: p3
section: CLI
---

# unapply and reapply help still says to take --patch-digest from a dry run

Placeholder. Not started.

`gavel review unapply --help` and `gavel review reapply --help` describe `--patch-digest` as
"use the saved capture with this digest, as printed by --dry-run" (`src/cli/review.ts`, the
`--patch-digest` option in the unapply/reapply loop), and say to pass it "When several saved
reviews share the name". A dry run without `--patch-digest` reports the newest saved capture,
which any token holder can replace with `POST /api/reviews/:name/capture`.
`p3-20261115-skill-tmp-paths-and-capture-pinning.md` changed the skill and `docs/cli.md` to
pin the digest from the agent's own `server.ready` (`capture.patchDigest`) or
`review create`/`review update` (`patchDigest`) output; the help text was left because another
session had uncommitted edits to `src/cli/review.ts`.

Fix: say the digest comes from the launch's `server.ready` record or the `review create` or
`review update` output, and that without the flag the newest saved capture is used.
