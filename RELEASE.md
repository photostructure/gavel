# Release procedure

Releases of `@photostructure/gavel` use signed Git tags and npm staged
publishing. The workflow stages an exact package, but a maintainer must approve
that package with two-factor authentication (2FA) before npm makes it public.

Do not create or move a release tag manually. Do not run `npm publish` from a
workstation.

## Prepare the release

1. Run the [prerelease skill](.claude/skills/prerelease/SKILL.md) on `main`
   and commit its `CHANGELOG.md` edit. It writes the release notes from the
   commits since the last tag under a heading that names the version bump:
   `## [Unreleased (patch)]`, `## [Unreleased (minor)]`, or
   `## [Unreleased (major)]`. The release workflow renames it to
   `## [X.Y.Z] - YYYY-MM-DD`, and those notes become the GitHub release notes.
2. Push the completed changes and wait for the ordinary `main` build to pass.
3. Confirm that `main` has not moved to a different commit.

## Stage the package

1. Open **Build & Prepare Release** in GitHub Actions.
2. Select **Run workflow** on `main`.
3. Wait for **Build & Prepare Release** to finish.
4. In the tag-bound **Stage npm Release** workflow, wait for the **stage** job
   to finish. Its **github-release** job then starts **Publish GitHub Release
   after npm approval** at the same tag. Leave that workflow running: it waits
   for your npm approval.

## How the release works

- `build.yml` (**Build & Prepare Release**) reads the version bump from the
  `## [Unreleased (patch|minor|major)]` heading in `CHANGELOG.md` while `ci.yml`
  runs, and fails with instructions if that heading is missing, names no bump,
  or has no notes under it. `ci.yml` lints, tests, builds, packs the package
  the way `publish.yaml` will, and installs and runs the packed CLI on Linux,
  macOS, and Windows. Once both pass, the `release` job bumps the version,
  renames the heading to `## [X.Y.Z] - YYYY-MM-DD` with a new empty
  `## [Unreleased]` above it, adds the version's `[X.Y.Z]: <url>` link
  definition, and pushes a signed release commit and annotated `vX.Y.Z` tag.
  The `dispatch` job then starts `publish.yaml` at that tag.
  [`photostructure/changelog-release-action`](https://github.com/photostructure/changelog-release-action)
  does the `CHANGELOG.md` work and the npm wait below.
- `publish.yaml` (**Stage npm Release**) validates the tag with
  `scripts/release-validate-tag.sh`, builds and packs the tarball with
  `scripts/release-package.mjs`, checks its file list and embedded
  `package.json`, and stages it with `npm stage publish`. npm trusts only this
  workflow file, by name, to stage the package, so renaming it means changing
  the package's trusted-publisher settings on npmjs.com.
- npm validates a staged package, then holds it until a maintainer approves it
  with 2FA.
- `github-release.yaml` (**Publish GitHub Release after npm approval**)
  re-validates the tag, then checks npm every 5 minutes, for up to 5 hours 45
  minutes. Any npm error other than "not found" (E404) ends the job early. Once
  npm serves the version, it checks the published package's version and
  repository URL, and its `gitHead` when npm reports one, re-verifies the
  signed tag, and creates the immutable GitHub release. Its notes are the
  version's `CHANGELOG.md` section, followed by GitHub's generated notes.
  GitHub emails the release to the repository's watchers at that moment, so the
  email always announces a version they can install.

## Approve the npm stage

1. Open **Staged Packages** from the npm user menu.
2. Confirm the package name, version, file list, metadata, and provenance.
3. Confirm that the provenance identifies this repository, `publish.yaml`, the
   release tag, and the signed tag commit.
4. Approve the staged package with 2FA.
5. Confirm that npm lists the version publicly.
6. Wait for **Publish GitHub Release after npm approval** to finish, then
   confirm that the GitHub release exists, is immutable, and has the version's
   `CHANGELOG.md` section at the top of its notes.

## Recover from a failed release

- If `ci.yml` or the `CHANGELOG.md` check fails before the tag, fix `main` and
  start a new release run.
- If the tag push succeeds but the dispatch job fails, rerun only that job or
  start `publish.yaml` manually at the existing signed tag.
- If the `stage` job of **Stage npm Release** succeeds but its
  `github-release` job fails, no **Publish GitHub Release after npm approval**
  run exists. Use **Re-run failed jobs** on the **Stage npm Release** run, or
  start `github-release.yaml` manually at the release tag. Do not stage the
  package again.
- If the tagged workflow is defective, fix `main` and release a new version.
  Never move the existing tag.
- If the staged contents are wrong, reject the stage and release a new version.
  The rejected version's **Publish GitHub Release after npm approval** run then
  runs out of checks and fails without creating a release. Cancel that run, or
  ignore its failure, and do not re-run it.
- In the two cases above, the release commit has already moved the notes under
  `## [X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`, and the next release run fails
  until `## [Unreleased]` names a bump and has notes. Rename that empty heading
  to `## [Unreleased (patch|minor|major)]`, move the unpublished version's notes
  under it, leave a line under `## [X.Y.Z]` saying that version was never
  published, and then start the new release.
- If **Publish GitHub Release after npm approval** fails before it creates the
  release (its checks ran out before you approved the stage, or `npm view`
  failed with an error other than E404), approve the stage if you have not,
  then use **Re-run failed jobs** on that run. GitHub allows re-runs for 30
  days; after that, start `github-release.yaml` manually at the release tag. Do
  not start a new release.
- If npm publishes a bad release, deprecate it or publish a corrected version.
  Never overwrite a published version.
