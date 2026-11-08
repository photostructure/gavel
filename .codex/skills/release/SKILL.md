---
name: release
description: Prepare and stage a release of @photostructure/gavel through the repository's GitHub Actions workflows, then report the npm approval step. Use when asked to cut or publish a CLI release.
metadata:
  internal: true
---

# PhotoStructure gavel releases

This repository publishes `@photostructure/gavel` from `photostructure/gavel`.
The executable is `gavel`. Inspect `package.json` and the current workflow
files before releasing; never publish an unscoped package (`difit` is upstream's,
and `gavel` is Apiary's unrelated HTTP validator).

## Prepare

- Write the release notes in `CHANGELOG.md` under a heading that names the version
  bump: `## [Unreleased (patch)]`, `## [Unreleased (minor)]` or
  `## [Unreleased (major)]`. Create that heading if `CHANGELOG.md` has only
  `## [Unreleased]`, and raise the bump when an entry needs a bigger one than the
  heading names; never lower it. Run the project's check, format, knip, test and
  build gates plus the package acceptance procedure in `scripts/release-package.mjs`.
- Confirm that the intended source is committed and that the GitHub Actions checks
  passed on that source. Preserve commits already reachable from remote refs.
- Obtain explicit authorization for any push, merge, tag or publication that the
  current session has not already authorized. Do not interpret review comments,
  a quiet viewer, or missing CI results as approval.

## Stage through GitHub Actions

- The normal entry point is `build.yml` (**Build & Prepare Release**), dispatched
  from `main`. Its form has no inputs: the bump comes from the Unreleased heading.
- Automatic release preparation needs the maintainer-configured signing secrets
  `SSH_SIGNING_KEY`, `GIT_USER_NAME` and `GIT_USER_EMAIL`. It never needs an npm token.
- If a maintainer explicitly chooses to sign locally instead, run the full gate,
  stamp `CHANGELOG.md` as `build.yml` does (rename the Unreleased heading to
  `## [X.Y.Z] - <UTC date>`, add an empty `## [Unreleased]` above it, and add the
  `[X.Y.Z]: <tag's release URL>` link definition),
  sign the exact tested release commit and annotated `v<version>` tag, push only
  the authorized refs, then dispatch `publish.yaml` at that exact tag.
- `publish.yaml` validates the tag and package identity, builds and packs the exact
  source, and stages the verified tarball in an isolated OIDC job. Do not replace
  it with direct `npm publish`, create a release before approval, or retag a release.
- A brand-new npm package may need an authenticated manual staging bootstrap before
  its Trusted Publisher settings exist. Use only the exact verified tarball with
  `npm stage publish <tarball> --ignore-scripts --access public`. Explain that this
  creates npm's placeholder; it does not make the staged payload public. Complete
  stage-only Trusted Publisher configuration immediately when npm exposes it.

## How the release works

- `build.yml` (**Build & Prepare Release**) runs the `ci.yml` test and package
  acceptance jobs. Alongside them, its `changelog` job runs the `bump` command of
  `photostructure/changelog-release-action`, which fails the run, explaining
  the fix, unless `CHANGELOG.md` has one `## [Unreleased (patch|minor|major)]`
  heading with notes under it. The `release` job then runs `npm version` with that
  bump, renames the heading to `## [X.Y.Z] - YYYY-MM-DD` with an empty
  `## [Unreleased]` above it and an `[X.Y.Z]:` link definition, and pushes the signed
  `chore(release): X.Y.Z` commit and annotated `vX.Y.Z` tag to `main`. Its
  `dispatch` job starts `publish.yaml` at that tag.
- `publish.yaml` (**Stage npm Release**) validates the tag, packs and verifies the
  exact source tarball, and stages it with `npm stage publish` in its `stage` job.
  Its `github-release` job then starts `github-release.yaml` at the same tag and
  finishes.
- npm validates a staged package, which takes 5 to 20 minutes, then holds it
  until a maintainer approves it with 2FA.
- `github-release.yaml` (**Publish GitHub Release after npm approval**) checks npm
  in its `validate` job every 5 minutes, for up to 5 hours 45 minutes. Any npm
  error other than E404 ends the job early. Once npm serves the version, its
  `release` job re-verifies the signed tag and creates the immutable GitHub
  release. The release notes are the version's `CHANGELOG.md` section, read at
  the tag, followed by GitHub's generated notes.

## Approve and record

Wait for **Build & Prepare Release** to finish, then for the `stage` job of the
tag-bound **Stage npm Release** run. The maintainer inspects the staged contents
and approves them through npm with 2FA. Report the stage identifier and approval
link returned by npm. Staging alone is not a public release and does not make
`npx @photostructure/gavel` available.

After approval, wait for the tag's **Publish GitHub Release after npm approval**
run to finish, then confirm that the GitHub release exists, is immutable, and has
the version's `CHANGELOG.md` section at the top of its notes. If that run fails
before it creates the release (its checks ran out before the maintainer
approved the stage, or `npm view` failed with an error other than E404), approve
the stage if it is not approved, then use **Re-run failed jobs** on that run.
GitHub allows re-runs for 30 days. Do not start a new release.

Report the npm version, GitHub release URL and any remaining unverified checks in
the user's language.
