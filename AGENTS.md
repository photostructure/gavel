# Repository Guidelines

## Project Structure & Module Organization

The TypeScript sources live under `src`, split by runtime: `src/cli` handles command parsing and Git integration, `src/server` hosts the Express diff service, `src/client` renders the React web UI, and shared helpers sit in `src/utils` and `src/types`. Unit and integration tests live next to the code they cover as `*.test.ts` or `*.test.tsx`, and fixtures under `docs/` support screenshots and copy decks. Built artifacts land in `dist/` after `pnpm build`; do not edit them manually. Static assets for the UI reside in `public/`, while automation scripts live in `scripts/`.

## Build, Test, and Development Commands

- `pnpm install` — install workspace dependencies (Node ≥22.14.0; use `mise` to stay aligned).
- `pnpm dev` — run the local development loop (boots the CLI server and UI with hot reload).
- `pnpm build` — generate the CLI bundle and production web assets via TypeScript project references and Vite.
- `pnpm test` / `pnpm test:watch` — execute the Vitest suite once or in watch mode.
- `pnpm check` and `pnpm format` — run oxlint type-aware checks and check oxfmt formatting before you commit; `pnpm check:fix` and `pnpm format:fix` apply the fixes.
- `make preflight` (or `pnpm run preflight`) — the full pre-release check: update dependencies and pinned GitHub Actions, format, lint (oxlint and knip), build, and test.

## Coding Style & Naming Conventions

The codebase uses strict TypeScript (`tsconfig.strictest`) and 2-space indentation; avoid `any` and prefer explicit types. Import types with `import type` and keep module order consistent; oxlint enforces unused imports/variables and type-aware safety rules. React components live under `src/client`; use PascalCase filenames for components, kebab-case for utilities, and co-locate UI-specific helpers when practical. Run `pnpm format:fix` before submitting to apply oxfmt formatting.

## Testing Guidelines

Vitest with the `happy-dom` environment drives unit and integration coverage, and React work should lean on Testing Library helpers. Place new tests alongside the implementation using the `name.test.ts[x]` pattern and prefer descriptive `describe` blocks tied to features. Ensure asynchronous flows await their assertions and cover both CLI (`src/cli`) and server (`src/server`) branches when they change; use `pnpm test --runInBand` if watchers behave flakily in CI.

## Commit & Pull Request Guidelines

Git history mixes lightweight descriptions with Conventional Commit prefixes—follow the pattern where it clarifies intent: `fix: guard empty diff (#123)` or `feat(cli): add --port flag`. Keep commits focused, include context in the body, and reference issues with `#id` when relevant. Before opening a PR, ensure `pnpm check`, `pnpm test`, and `pnpm build` succeed locally. PRs should outline motivation, implementation notes, manual verification steps, and UI changes (attach refreshed `docs/images` assets or screenshots for web updates).

Do not edit `CHANGELOG.md` in feature or fix commits: every worktree adds lines at the top of its Unreleased section, so their merges conflict. Before a release, the [prerelease skill](.claude/skills/prerelease/SKILL.md) writes that section from the commits since the last tag and picks the version bump.

End the message of each commit that changes something users see (the CLI, server output, web UI, user docs, or the shipped `skills/gavel/` skill) with a `Changelog:` trailer on one line. It holds a suggested entry: one or two sentences, in the present tense, saying what a user can now do or what changed for them. Omit it for tests, CI, refactors, and TPPs. When a change breaks an existing caller, such as a removed or renamed command, flag, endpoint, or JSON field, put `!` just before the subject's colon, as in `feat(review.ts)!:`, and say in the trailer what the caller must change.

```text
feat(review.ts): rename and delete named reviews on a running server

Agents restarted the server to rename a review, which dropped every review's comments.

Changelog: `gavel review rename <name> <new-name>` and `gavel review delete <name>` rename or remove a named review without restarting the server.
```

When adding or changing a feature, update any affected README, documentation, and agent skills in the same change.

## Reviews After Approval

Never recapture a review the user approved, or ask them to approve it again. Changes made after an approval, such as a replay onto a newer `main` or a fix, go in a new review that holds only the diff the user has not seen; for a replay, that is the conflict resolutions. Second-opinion passes after an approval also cover only that diff, and only the batches it touches. When two review rounds patch the same kind of defect, stop and ask whether the design is wrong before writing a third patch.

## Tooling & Environment

Use `pnpm` for dependency management (avoid mixing with `npm` or `yarn`) and rely on the `mise.toml` pinned versions for local reproducibility. When performance is a concern, run `pnpm perf:*` scripts to benchmark diff rendering before merging significant parser or rendering changes.

## Upstream PRs and Issues

Before examining or adopting upstream changes, read [UPSTREAM.md](UPSTREAM.md).
Use its version markers to identify new or changed items, and revisit decisions
when fork changes invalidate their reasons. Record each examined item's decision,
fork resolution, upstream marker, review date, fork baseline, and implementation
or verification evidence. Keep detailed comparisons in dated review records.
