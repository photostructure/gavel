---
title: Skill pins unapply to the newest capture and writes captures to fixed /tmp names
priority: p3
section: Agent skill
---

# Skill pins unapply to the newest capture and writes captures to fixed /tmp names

Complete. Base commit `47c5959`.

## Problem

1. Any token holder can replace a named review's capture with `POST /api/reviews/:name/capture`.
   The Reject steps (`skills/gavel/references/reject.md`) had the agent run
   `review unapply <name> --dry-run` and then `review unapply <name> --patch-digest <patchDigest
   from the dry run>`. Without `--patch-digest`, `findSavedCapture` in `src/cli/unapply.ts` reads
   the newest saved capture, so a replaced capture's hunks were the ones reversed.
   `docs/cli.md` gave the same steps.
2. `skills/gavel/SKILL.md` wrote `review capture --output /tmp/capture.json` and read it back
   with `--capture /tmp/capture.json`. Captures include untracked files' contents, and another
   local user could pre-create that fixed path.

## Outcome

- The Reject steps in `skills/gavel/references/reject.md` (and its byte-identical copy in
  `.codex/skills/gavel/references/reject.md`) and `docs/cli.md` now pin unapply, its dry run,
  and reapply to the digest of the capture the agent last sent. That digest is
  `capture.patchDigest` in the foreground launch's `server.ready` record, or the top-level
  `patchDigest` that `review create` and `review update` print. The built CLI confirmed both
  fields on a temporary repository, and confirmed that `unapply --dry-run` without
  `--patch-digest` reports the newest capture while `--patch-digest <older digest>` selects the
  older one. The sentence about ambiguous names is gone: with a digest always passed,
  `findSavedCapture` never lists candidates.
- `skills/gavel/SKILL.md` now writes each capture artifact into a fresh `mktemp -d` directory.
  No other shipped skill or doc used a fixed `/tmp` name.
- `src/cli/review.ts` stays as is: `writeFile(options.output, …)` still follows symlinks and does
  not use `wx`. Under the maintainer's 2026-11-15 scope decision (gavel does not defend against
  other OS users on the workstation; take simple fixes, document the rest), the skill change
  removes the shared fixed path and the code is not changed.
- The Reject steps also tell an agent that no longer has its own launch or create/update
  output not to unapply, and to say so and ask how to revert.

## Follow-ups

- `p3-20261115-unapply-help-digest-source.md`: the `--patch-digest` help text in
  `src/cli/review.ts` still says to take the digest from a dry run. Not edited here because
  another session has uncommitted edits to that file.

## Review

Final verdict: LAND from both the Codex and the Claude reviewer through `coding:second-opinion`,
on the diff against `47c5959`. No findings were vetoed.
