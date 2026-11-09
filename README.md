<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/gavel-logo-dark.svg">
    <img src="docs/images/gavel-logo.svg" alt="gavel" width="300">
  </picture>
</p>

# @photostructure/gavel

**Your agent writes the code. You give the verdict.**

gavel is a local Git diff viewer for reviewing your coding agent's changes.
Discuss the code in threads beside the diff, then approve each proposed commit
or request revisions. Works with Claude Code and Codex.

<p align="center">
  <a href="https://www.npmjs.com/package/@photostructure/gavel"><img src="https://img.shields.io/npm/v/@photostructure/gavel.svg" alt="npm version"></a>
</p>

![gavel screenshot](docs/images/screenshot.png)

## ⚡ Quick Start

Requires Node.js 22.14 or newer and a Git repository. To view its latest commit:

```sh
npx @photostructure/gavel
```

Or install the `gavel` command:

```sh
npm install -g @photostructure/gavel
```

Connect your coding agent:

```sh
npx skills add photostructure/gavel
```

For Codex, follow the [Codex setup guide](docs/codex-review-integration.md#install-the-codex-entry-point)
to install its version of the skill. Then ask your agent:

> Open your changes in gavel for my review.

To request reviews routinely, add this to `AGENTS.md` or `CLAUDE.md`:

> Request my review through gavel after you change code.

## Review your agent's changes

The agent prepares a change summary, proposed commit message, and reading guide.
Ask questions or request changes beside the code, or use **Conversation** to
discuss the whole review. The agent replies in those threads.

Give each proposed commit a verdict:

- **Approve as-is** permits the agent to commit the reviewed change.
- **Approve after comments** permits it to commit once your feedback is addressed.
- **Not yet** asks for revisions and another review.

The agent must run the required checks before committing. See
[approval modes](docs/approval-modes.md) for details.

### Agent handoff

gavel works with your existing agent; it does not start one. Claude Code can
receive feedback automatically when its host supports background waiting.
Codex ends its turn while you review: use **Conversation → Copy resume prompt**
and paste it into the owning chat to continue. See
[waiting for review](docs/waiting-for-review.md) for host requirements.

## 🚀 Usage

```sh
gavel                  # Latest commit
gavel HEAD~2           # A specific commit
gavel .                # All uncommitted changes
gavel staged           # Staged changes
gavel working          # Unstaged changes
gavel feature main     # Compare branches
gavel . origin/main    # Compare the working tree with remote main
gavel --pr https://github.com/owner/repo/pull/123
git diff --cached | gavel -
```

GitHub PRs require an authenticated GitHub CLI (`gh`).
Use `gavel --help` for all options. See [command-line usage](docs/cli.md) for
named reviews, PR authentication, piped diffs, initial comments, and editor setup.

## HTTPS and remote browsers

You can review from a phone or another computer. gavel has no built-in login;
put it behind an authenticated HTTPS proxy or tunnel before exposing it.
See [remote browser setup](docs/server-addresses.md#https-and-remote-browsers).

## Agent integration

The skills handle review setup and feedback. For custom integrations, see:

- [Conversation protocol and named captures](docs/agent-conversations.md)
- [Waiting for feedback](docs/waiting-for-review.md)
- [Codex setup and handoff](docs/codex-review-integration.md)
- [Approval modes](docs/approval-modes.md)

## Development

```sh
pnpm install
pnpm dev          # Development server
pnpm build        # Production build
pnpm test
pnpm check        # Typecheck and lint
pnpm format       # Check formatting
```

## Built on difit

gavel started as PhotoStructure's fork of [difit](https://github.com/yoshiko-pg/difit),
yoshiko-pg's GitHub-style diff viewer. If gavel is useful to you, please consider
[sponsoring yoshiko-pg](https://github.com/sponsors/yoshiko-pg).

The question marker and explicit thread deletion incorporate
[upstream PR #482](https://github.com/yoshiko-pg/difit/pull/482).

## 📄 License

MIT

The bundled screenshot `public/lgtm.png` comes from
[this video](https://www.youtube.com/watch?v=3TNpOD6bov8). The image belongs to
its respective rights holders and is not covered by this project's MIT license.
