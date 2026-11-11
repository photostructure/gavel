# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Why this change** in **Change summary** now shows its text as Markdown, so links in it work and an agent can start its tour there.
- Links in comment bodies now move around gavel: `#thread=<id>` jumps to a comment, `#file=<path>&line=40-52&side=old` to a file or its lines, and `?review=<name>#…` to a place in another named review. Back returns to the comment the link was in, the page URL keeps the place, and a link gavel cannot follow says why at the bottom of the page. A jump to a line or comment in a file already on the page scrolls smoothly, unless your system asks for reduced motion, and brings a linked comment to the top third of the screen; a jump into a file that has not rendered yet, or to a file's header, is instant, because files render as the view reaches them. The linked comment glows blue during the jump, throbs once when it arrives, and fades; following a link in an agent's comment marks that comment read. The gavel skills tell agents to link reading-guide comments into a tour on long reviews. See [links in comments](docs/cli.md#links-in-comments).
- The comment count beside a file in **Files changed** now shows a blue dot on its comment icon while the file has unread agent replies, and its tooltip says how many.

### Changed

- **Why this change** and the proposed commit message in **Change summary** are now read-only, and **Save summary** and **Discard draft** are gone. **Change summary** now sits at the top of the diff instead of under the header and no longer collapses: its fields size to their text and scroll away with the diff instead of scrolling inside a box, and once **Change summary** has a rationale or message, **Files changed** lists **Change summary** first so you can jump back to it. To change either one, ask the agent in a comment; it replies in the thread and writes the new proposal with `gavel comment summary`. `POST /api/review-summary` is gone (`GET` remains), so `review.summary` events always have agent origin and `gavel wait` no longer finishes on one.
- **Not yet** is now **Reject**, in violet instead of red on its verdict button, review tabs, and the **All reviews** button (deuteranopia mode keeps it orange). A rejected review stays rejected until you clear it: a recapture, a summary edit, or a changed `staged`, `working`, or `.` diff no longer returns it to **Needs a verdict**. The gavel skills tell the agent to stop, ask you what to do instead, and ask whether to revert, saying what a revert would undo. The approval JSON in `/api/approval`, `comment snapshot`, `review.approval` events, and `gavel approval status` now carries one `verdict` field (`as-is`, `after-comments`, or `reject`, absent when there is none) in place of `approved`, `requested`, `mode`, and `notYet`; `review.approval` events and `gavel approval status` also lose their top-level `approved`, and `gavel approval status` loses its top-level `name` (read `selection.reviewName`). `PUT /api/approval` sets a verdict and `DELETE /api/approval` clears it; `POST /api/approval`, `/api/approval/conditional`, and `/api/approval/not-yet` are gone. Reviews saved by earlier versions restore without a verdict; their old `approved` and `mode` fields stay in the saved approval, and gavel ignores them.
- `review create` and `review update` now exit with an error when stdin is a pipe, socket, or file and none of `-`, `--capture`, `--pathspec`, or `--include-untracked` was given, instead of ignoring the piped patch and capturing the uncommitted tree. To capture the uncommitted tree from a script that leaves stdin open, redirect stdin from `/dev/null`.
- Each browser tab now keeps one WebSocket, `/api/live`, for live updates and presence, in place of the `/api/watch` and `/api/heartbeat` event streams and `POST /api/presence`. Browsers allow about six connections per server, so a third gavel tab on one server used to stay on **Loading diff...**; six tabs now load. A tab that loses its connection reconnects up to five times, but only to the same server. Proxies in front of gavel must now pass WebSocket upgrades on `/api/live`.
- The gavel skills now tell agents to pass a short `--title` on every launch, so open servers can be told apart in the browser, and `--help` describes the option that way.
- **Approve after comments** is now one recorded verdict: the agent acts on all the current comments and commits as soon as you choose it. Only you can clear it; new comments, recaptures, and message edits leave it in place. `gavel comment address`, `gavel schema address`, and the approval's `conditions` and `baselineCapture` fields are gone.
- **Approve after comments** is now yellow with a comment-bubble icon instead of orange with a check mark, and it no longer counts pending comments or changes on its own.
- The review tabs no longer collapse into a menu when they don't fit. They keep their full size on one row that scrolls sideways with the mouse wheel, a trackpad, or a swipe, and an **All reviews** button at the end of the row always lists every review. A stacked bar along the button's bottom edge shows how many reviews have each verdict, in each verdict's color, with the counts in its tooltip, in place of the "2 of 3 need a verdict" text. With the deuteranopia color-vision setting, **Approve after comments** marks are violet so they differ from **Reject**. Opening a review whose tab is out of view scrolls it in with the review before it at the left edge; clicking a visible tab leaves the row where it is.
- Replace the obsolete “LGTM” label with approval and verdict terminology in the documentation, summary panel, CLI help, and human-readable server output; keep the CLI aliases compatible.
- File headers and comment thread headers now share one disclosure behavior: clicking anywhere on the row expands or collapses it, whether or not the file is marked **Viewed**, with a tooltip and pointer cursor across the row and no hover highlight. The buttons in the row keep their own actions, and dragging to select text leaves it as it is. Alt+click on a file row applies to every file, like the chevron.
- The copy-path, **Expand all lines**, and **Viewed** buttons in a file header now take clicks that land just outside them, and **Viewed** takes clicks out to the header's right edge, so a near miss no longer collapses the file.
- **Copy Prompt**, **Copy All Prompt**, `/api/comments-output`, and the comments printed at server shutdown now mark each thread, comment, and reply with XML-style tags instead of plain label lines and `=====` separators. Comment bodies are not escaped, so the output is not valid XML. Anything parsing the old text needs updating. With more than one review on the server, **Copy Prompt** also names the open review's tab, so a pasted thread says which review it came from. **Copy Prompt** and **Copy All Prompt** also give the repository's directory and the launching agent's session ID, and tell the agent to ask before continuing if the diff isn't its own, so a prompt pasted into the wrong window is easier to catch.
- **Shortcuts** and **Star on GitHub** moved from the bottom of the file list to **About**, where they are also available on mobile.
- **Keyboard Shortcuts** now takes keyboard focus when it opens and returns it when it closes.
- **About** now shows the running Gavel version, or says it is a development build inside a yellow-and-black hazard stripe. A development build made with `pnpm build` also shows the HEAD commit it was built from and a sha256 of the uncommitted changes then (`git diff HEAD` plus untracked files), or **None** when the tree was clean; the Vite dev server shows neither. `node dev/build-info.js` prints both values for the current checkout, to tell whether a running build still matches it.
- Green text and icons in the dark theme, such as a file's added-lines count, **Reopen**, and the comment resolve check mark, are brighter so they are easier to read.
- The **Viewed** button now follows Gavel's theme setting instead of the operating system's color scheme.
- The countdown notice under the verdict buttons now has buttons the size of the verdict buttons and a bar along its bottom edge that drains as the time runs out.
- **Conversation** now covers every review on the server. The unread badge, now blue, counts agent replies from all of them, and **Unread** lists them grouped under each review's name. With two or more reviews, an **All reviews** pill lists every thread, and **Mark this review read** and **Mark all reviews read** replace **Mark all read**. A thread from another review shows read controls only; clicking it opens that review with the thread focused, where you can reply. The **All** pill is now **This review**. Read marks are now saved per repository rather than per review, so replies you already read show as unread once more.
- A new agent reply briefly pulses the unread count on **Conversation**, the browser tab's title starts with the unread count, and a review tab with unread replies shows a blue dot.
- The jump-to-unread dot now appears only on collapsed threads, because an expanded thread shows each reply's own read control.
- Sending a reply to a thread, including **Agreed**, **Still unclear**, or **Disagree**, marks its agent replies read.
- In the unified view, dragging a comment selection across a row that has no line number on the selection's side no longer pulls the other side's number into the range.
- Dragging on line numbers now selects a range and opens a comment form for it, as dragging the comment button does. The form's title names the lines, and pointing at a saved comment tints the lines it covers.

### Documentation

- Condense the shared gavel and Claude development skills, with focused references for feedback snapshots and waiting. Seek review approval by default, put the zero-idle-turn requirement first, and use about 300 weighted changed lines as a review-size guide without a fixed file-count ceiling, with tabs and summaries that refer to each other.
- Require feature changes to update the affected README, documentation, and agent skills in the same change.
- Replace outdated architecture and testing inventories with current contributor guides; trim repeated workflow and UI details from integration docs while retaining protocol and recovery requirements.
- Shorten the README to setup, the review workflow, and common commands; move CLI examples and remote-browser setup into focused guides and remove UI minutiae.
- Remove the PR Checks badge from the README because it does not report the status of the current `main` branch or published package.
- Rewrite the README introduction and setup around the gavel walkthrough, explaining reading guides, comment intents, per-commit verdicts, and the Claude Code and Codex feedback workflows.
- Keep the README logo visible on npm's dark theme by outlining it with a white halo.

## [6.0.0] - 2026-11-08

### Added in the PhotoStructure fork

- Save each review's comments, progress, proposal and approval under `.git/gavel`, and restore them when a restarted server opens the same named review and patch, or the same commits. `gavel approval status <commit>` reports a commit's saved approvals without a server. A server starting up deletes saved reviews untouched for 7 days.
- Find unread agent replies in Conversation with visible filter pills, per-reply read/unread controls, Mark all read, and jumps into resolved or outdated threads. Visibility and panel close never mark replies read.
- Answer an agent reply with one click: **👍 Agreed**, **❓ Still unclear**, and **👎 Disagree** post ordinary replies beside **Write a reply...**.
- Report browser visibility and agent-listener presence; offer a resume prompt for agents that cannot receive idle notifications.
- Stop `gavel wait` with exit 4 when every selected review is unattended, after recovering existing human work.
- Show the launching agent and its session's name and ID under **About**. The agent comes from `$CLAUDE_CODE_ENTRYPOINT`, the Codex thread's rollout, or `$AI_AGENT`, and the ID from `$CLAUDE_CODE_SESSION_ID` or `$CODEX_THREAD_ID`, unless `--agent` or `--agent-session-id` overrides them; `--agent-session-name` sets the name.
- Add comments to a named review on a reused server with `gavel comment add --review <name>`.
- Show a row of review tabs under the header when a review on the server carries a named capture or a proposed commit message, unless it is the only such review and it is open. A commit message the server copied from a browsed commit is not a proposal: the review's summary carries `fromCommit: true` in `comment snapshot` and the review gets no tab, and an unnamed `.`, `staged`, or `working` review left behind when a commit moves HEAD gets no tab either. Each tab names one review, in creation order, with a ✓ (approved), ✕ (**Not yet**), or ○ (no verdict) mark in its verdict button's color, which also colors the open tab's top border; the row counts how many still need a verdict. Picking a tab replaces the browser's history entry, so Back does not step between reviews. When the tabs don't fit on one row, they collapse into a menu on the open review's tab. The **Change summary** panel now stays open or closed across reviews and reloads, so stepping through a stack doesn't collapse it each time. Reviews used to be reachable only from **Recent reviews** in the review picker's menu, where reviewers missed them. The gavel skills now tell agents to open stacked commits as one named review per commit, in commit order, and give the user one link.

- Decline a review with **Not yet**, beside the approval buttons; it turns red on hover and once chosen. The server records `approval.notYet: true` with `approved: false` through `POST /api/approval/not-yet` (HTTP 404 on older servers) and clears it when the agent recaptures or changes the summary, or when a `staged`, `working`, or `.` diff changes. Closing the window used to be the only way to decline.
- After a verdict, show a notice under the verdict buttons that counts down 10 seconds, then opens the next review without one, or closes the tab once every review has one, with **Switch now** or **Close now** to skip the wait and **Cancel** to stop it; when the browser keeps the tab open, say it can be closed. A review that arrives during the countdown takes it over. While a review lacks a verdict, its tab pulses after a verdict elsewhere, and leaving the page brings up the browser's leave-site dialog.
- Discover launch events and agent JSON requests/responses through `gavel schema` and command help.
- Wait silently for human activity across review servers with `gavel wait`; recover queued messages without implicit delivery receipts.
- Print the desktop user's idle time with `gavel idle` on Linux (KDE on X11, GNOME), macOS, and Windows, so agents can hold a review until the user is back.
- Restore the conversation event endpoint with cursor replay of the latest 256 events per server process.

### Changed in the PhotoStructure fork

- Rename the project from difit to gavel, because speech-to-text could not transcribe "difit" in dictated prompts. The npm package is `@photostructure/gavel`, the command is `gavel`, and the repository is [photostructure/gavel](https://github.com/photostructure/gavel); the header and browser tab show the gavel mark. Nothing carries over from difit: there is no `difit` command, `DIFIT_EDITOR`, `DIFIT_EDITOR_COMMAND`, `DIFIT_EDITOR_ARGS`, and `DIFIT_CONFIG_DIR` are now `GAVEL_EDITOR`, `GAVEL_EDITOR_COMMAND`, `GAVEL_EDITOR_ARGS`, and `GAVEL_CONFIG_DIR`, the user config moves from `~/.difit/config.json` to `~/.gavel/config.json`, saved reviews start fresh under `.git/gavel`, and browser settings, viewed marks, unread marks, unsent drafts, and the **Change summary** panel's open state start fresh. Set auto-viewed patterns again in **Settings**. The skills are now `gavel` and `gavel-dev`.
- Bind approval of a `staged`, `working`, or `.` review to the diff the reviewer saw: `POST /api/approval` requires the `diffDigest` from `/api/diff` and returns HTTP 409 when the diff has changed, and a later change to the diff revokes an as-is approval when `comment snapshot` or `GET /api/approval` reads it. The legacy `POST /api/ship-it` route now refuses these reviews with HTTP 409.
- Keep the proposed commit message and rationale when a commit moves HEAD under a `staged` or `.` review, unless that commit has the proposed message. The new review used to start with an empty summary.
- Bundle JetBrains Mono, IBM Plex Mono, and Ubuntu Mono for **Settings** → **Font Family**, so each choice renders the same whether or not the font is installed, and add **Browser default** for the monospace font set in the browser. JetBrains Mono replaces **System Font** as the default. **System Font**, **Menlo**, **SF Mono**, and **Fira Code** are removed; a saved choice of one of them falls back to JetBrains Mono.
- Bind an OS-assigned port with `--port 0` and report it in `server.ready`; reject non-numeric ports instead of falling back to 4966.
- Open thread reply forms from **Write a reply...** again. Escape or a click elsewhere closes an empty form; a draft stays open until **Cancel** discards it. Every comment form has **Cancel** at the opposite end of the row from **Send** (**Save** when editing a comment), and after it in tab order.
- Emit JSON Lines from the foreground launch process by default, with `--jsonl` and a `--no-jsonl` human-output opt-out.
- Include server readiness, comment progress, and thread changes in launch output; require explicit Delivered receipts.
- Remove the separate `comment watch` command; retain snapshot recovery and companion commands.
- Require `--no-jsonl --no-conversation` together to disable conversations; `--no-conversation` alone now exits with an error.
- Route startup and disconnect diagnostics to stderr in both output modes; `--no-jsonl` uses human-readable comment and approval output on stdout.
- Rename the header's **Repository** button to **About**.
- Play approval celebrations at double speed and stop any still running at 3 seconds; they used to run 3.4 to 6.5 seconds.
- Drop the files-viewed count (such as "0/8") from the header; the file tree still shows it. The header used to show it while the file tree was closed.
- Move to the next unviewed file when `v` marks a file viewed; `v` on a viewed file un-marks it and stays put. Shift+V now toggles viewed without moving. Shift+V used to mark viewed and move on, and `v` used to toggle in place. With no keyboard cursor and the pointer outside every file, Shift+V now does nothing, like `v`; it used to act on the last cursor position.
- Replace the approval split button with **Approve as-is**, **Approve after comments**, and **Not yet** buttons from 1280px wide. **Approve after comments** used to sit behind the split button's arrow. Clicking the chosen button again clears the verdict, as **Clear verdict** does in the narrow-screen menu; **Revoke approval** is gone. Clicking **Approved as-is** used to send the same approval again.
- Stop two ✨ emoji from rising beside the files-viewed status when the last file is marked **Viewed**; **All files viewed** and the full progress bar still mark completion.
- Highlight the file at the top of the diff in **Files changed** as the diff scrolls. The highlight used to mark the keyboard cursor's file, and stayed on it after the diff scrolled away.
- Open **Settings** from its own gear button instead of from **View**, and drop **View**'s light/dark switch, which duplicated **Settings** → **Theme**. Below 1024px wide, **View**, **Settings**, **About**, and **Conversation** show only their icons, so the header fits one row on an iPad in portrait.
- Keep UI settings (appearance, Split/Unified, file tree width and visibility) in a cookie in each browser instead of `~/.gavel/config.json`, so an iPad and a desktop keep separate font sizes and themes. Cookies ignore the port, so settings still survive gavel starting on a new port. Auto-viewed patterns stay in `~/.gavel/config.json`, shared by every browser, and save through `PUT /api/auto-viewed-patterns`; `GET /api/user-settings` and `PUT /api/user-settings` are removed. A browser that refuses the cookie shows an error in the header instead of losing settings changes silently.
- Stop loading the diff when `~/.gavel/config.json` is not valid JSON or does not hold an object, and name the file on the page; such a file used to be ignored. Diff load errors now show the server's message instead of "Failed to fetch diff data" when it sends one.
- Below 1024px wide, show only icons on the review picker; its menu names the comparison. Below 1280px wide, the verdict buttons become one menu that shows the current verdict. Below 768px, drop the logo from the header and move the unread-reply count onto the corner of **Conversation**, so the header fits one row on a 375px-wide phone; it wraps when **Refresh**, an error, or the capture-update notice joins it.
- On phones and tablets in either orientation (any device whose main pointer is a touch screen), and in windows 500px tall or less, slide the header, review tabs, and **Change summary** out of view while the diff scrolls down, and bring them back on scroll up or when keyboard focus moves into them; file headers also use less padding. On an iPhone in landscape these rows and Safari's toolbars left about a third of the screen for diff lines.
- Turn off font ligatures in code text, so JetBrains Mono shows `=>`, `!==`, and `>=` as the characters in the file.
- While any review on the server asks for approval (it has a named capture or a proposed commit message, approved or not), the header shows the open review's name in place of the review picker, and the review tabs switch reviews; this covers every `--review` launch and every launch with `--commit-message`. Picking another comparison created reviews the tabs had no place for. A **Detailed...** dialog that was already open closes. Otherwise, when gavel is launched for an explicit commit-ish (`gavel HEAD~1`, `gavel .`), the review picker offers only that diff and **Recent reviews**: **Quick Diffs**, **Previous commit**, **Pick Commit...**, **Detailed...**, and commit and branch search are gone, so a review opened for approval can't switch to a diff nobody proposed. **Launched diff** returns to the launch's resolved commits. A bare `gavel` keeps the full picker. `GET /api/revisions` reports the launch as `launch`.
- **Diff Preview** now shows a Markdown frontmatter block that is not a YAML key/value mapping (a syntax error, a scalar, a sequence, or an empty or comment-only block) when the diff starts at the top of the file, even when it did not change. The lines render as Markdown: `---` delimiters appear as horizontal rules, a YAML line directly above the closing `---` becomes a heading, and comment lines become headings. It used to hide the block.
- In **Conversation**, Escape in a reply or an edit that holds text closes the panel and keeps any unsent text, as it does for a line draft listed under **Unsent drafts**. Escape used to leave a reply and the panel open, and discard an edit's changes.
- Escape no longer discards unsent text anywhere; only **Cancel** or Send does. In the diff, Escape in a line comment or an edit with unsaved changes keeps the form open, as it already did for a reply, and Escape in an edit you have not changed closes it; Escape used to discard a line comment's or an edit's text. In **Conversation**, Escape in the general comment form closes the panel and keeps its text for the next open; it used to discard it.

### Removed in the PhotoStructure fork

- Remove the bundled VS Code extension (`packages/vscode`). It was set up to publish under upstream's Marketplace publisher, which this project cannot publish under.
- Remove the project site and its static live demo (`src/site`, `pnpm dev:site`, `pnpm build:site`, `pnpm export:site-data`, and the Pages workflow). The demo could not show an agent answering comments; [the walkthrough on photostructure.com](https://photostructure.com/coding/gavel/) replaces the site.

### Fixed in the PhotoStructure fork

- Keep unsent text in a line comment, a reply, or an edit through a reload, a page crash, a development-server hot update, or a switch to another review tab: each draft is saved in the tab's sessionStorage per review and its form reopens with the text, expanding the context around its line and opening its file even if the file is marked viewed. A draft whose line the diff no longer shows appears at the top of its file. **Conversation** lists every unsent draft under **Unsent drafts**, including drafts on files no longer in the diff, with a pencil badge on the button that counts them; the list is taken when the panel opens. Opening a second line comment in the same hunk no longer closes the first one and discards its text.
- Show an edit inside Markdown frontmatter that is not a YAML key/value mapping in **Diff Preview**: a YAML syntax error, a scalar such as `title New`, a sequence, or a blank or comment-only block. The preview used to strip the frontmatter lines anyway, so the edit appeared in neither the frontmatter table nor the preview; it now keeps the lines and shows no table.
- Size the app shell, the loading and error screens, and the **Settings** dialog with `dvh` instead of `100vh`. iOS and iPadOS Safari resolve `100vh` to the height with the toolbar collapsed, so while the toolbar showed, the last lines of the diff sat under it until another swipe scrolled the page. The page no longer scrolls, so Safari's toolbar stays visible.

## [5.1.0] - 2026-10-29

### Added in the PhotoStructure fork

- Review-wide conversations alongside inline threads, with drafts retained while navigating code.
- Immediate JSON comment events, exact-thread agent replies, and Delivered, Read, Thinking, Replying, Replied, and Noted progress.
- One Comment / Change request / Question control with explanatory tooltips and selection styling for light and dark themes.
- Retained resolved discussions that can be reopened, with explicit deletion kept separate.
- Repository and server information in the file tree, plus repository and port identity in the browser title.
- Reversible LGTM approval that stays visible and can be revoked.

### Changed in the PhotoStructure fork

- Distribute the fork as `@photostructure/difit`, retaining the `difit` command.
- Enable conversations and LGTM by default, with `--no-conversation` and `--no-lgtm` opt-outs.
- Shorten the agent skill instructions and document the live conversation protocol.
- Prepare releases through signed tags, package acceptance checks, and staged npm publication with human approval.

## [5.0.12] - 2026-08-29

### Changed

- Make bundled skills explicit opt-in and document server reuse with `--keep-alive` / `--background` and `difit comment` (#463)

### Fixed

- Keep newlines between highlighted lines in multi-line code blocks in comment bodies (#462)
- Don't report `origin/main` as the default branch in repositories with no remote (#459)

### Thanks

- [@finnmglas](https://github.com/finnmglas) for fixing the default branch detection in repos with no remote (#459)

## [5.0.11] - 2026-08-09

### Added

- Include diff context in comment text output when copying prompts (#455)

### Thanks

- [@l0stplains](https://github.com/l0stplains) for including diff context in comment text output (#455)

## [5.0.10] - 2026-08-08

### Fixed

- Ensure the `--background` parent process exits while the detached server stays alive (#451)
- Show child paths when a diff path is both a file and a directory prefix (#453)

### Thanks

- [@rafaelsteil](https://github.com/rafaelsteil) for fixing detached background server startup (#451)
- [@shimpeiws](https://github.com/shimpeiws) for fixing hidden child paths in the file tree (#453)

## [5.0.9] - 2026-08-05

### Added

- Persist UI settings (appearance, diff view mode, sidebar state) to `~/.difit/config.json` so they survive across ports (#431)
- Show an always-visible inline reply box on comment threads, GitHub-style (#437)
- Add a search box to the revision selector and quick menu dropdowns (#438)
- Allow collapsing comment threads into a single line (#439)
- Render YAML frontmatter as a key/value table in markdown Full Preview and as a Before/After diff table in Diff Preview (#442)
- Add Groovy language support (.groovy, .gvy, .gy, .gsh, .gradle) (#449)

### Fixed

- Keep `/api/diff` selection state intact when diff parsing fails, so one invalid ref no longer breaks subsequent requests until restart (#440)

### Thanks

- [@kiakiraki](https://github.com/kiakiraki) for fixing the /api/diff selection state bug (#440)
- [@woo-cie](https://github.com/woo-cie) for the YAML frontmatter preview (#442)
- [@ngng628](https://github.com/ngng628) for adding Groovy language support (#449)

## [5.0.8] - 2026-07-11

### Added

- Add GDScript syntax highlighting (#434)
- Add Shift-click range comments in unified and side-by-side diff views (#435)

### Changed

- Update dependencies (#433)

### Fixed

- Correct comment form click handling
- Support plain unified diffs from stdin (#436)

### Thanks

- [@ihalilacalm](https://github.com/ihalilacalm) for adding GDScript syntax highlighting (#434)
- [@ramram1048](https://github.com/ramram1048) for adding Shift-click range comments (#435)

## [5.0.7] - 2026-07-07

### Added

- Render comment bodies as markdown (GFM) with syntax-highlighted code blocks and diff-colored ```diff blocks (#430)
- Add `difit comment resolve <threadIds...>` CLI verb (alias: `remove`) backed by a new `DELETE /api/comments/:threadId` endpoint, so agents can resolve or remove comment threads without re-posting the full thread set (#428)

### Changed

- Replace the browser confirm() dialog for resolve/delete with an inline confirm/cancel UI inside the comment card (#429)
- Bundle difit into the VS Code extension so it no longer requires a global difit install; `difit.executablePath` remains as an opt-in escape hatch (#423)

### Fixed

- Correct SKILL.md wording: staging -> staged (#427)

### Thanks

- [@moeyashi](https://github.com/moeyashi) for correcting the SKILL.md wording (#427)

## [5.0.6] - 2026-07-04

### Added

- Add ability to mark an entire folder as reviewed from the file tree (#421)
- Improve keyboard file navigation: highlight the focused file, add Shift+V to mark viewed and jump to the next unviewed file, and more (#420)

## [5.0.5] - 2026-07-04

### Fixed

- Anchor unified-mode selection overlay to td for Safari (#416)
- Keep collapsed file stationary when marking viewed with header visible (#417)
- Commit drag selection on mouse release anywhere, not only on the comment button (#418)

### Changed

- Update dependencies (#411 #412 #413 #414)

### Thanks

- [@ei-sugimoto](https://github.com/ei-sugimoto) for anchoring the unified-mode selection overlay to td for Safari (#416)

## [5.0.4] - 2026-06-29

### Added

- Add Svelte syntax highlighting support (#409)

### Thanks

- [@tsukasaI](https://github.com/tsukasaI) for adding Svelte syntax highlighting support (#409)

## [5.0.3] - 2026-06-28

### Changed

- Correct the Go lock file example from go.mod to go.sum (#403)
- Update dependencies (#385 #386 #387 #388 #389 #390 #391 #393 #394 #395 #396 #397 #398 #399 #400 #401 #404 #405 #406)

### Fixed

- Exclude site data from the npm package (#408)

### Thanks

- [@tsukasaI](https://github.com/tsukasaI) for correcting the Go lock file example (#403)

## [5.0.2] - 2026-06-03

### Added

- Add an Outdated badge for comments whose saved code snapshot no longer matches the current diff (#383)
- Add automatic whole-file syntax highlighting for .vue, .astro, .svelte file types (#381)

### Changed

- Rename the file change badge from Changed to Updated (#382)
- Update dependencies (#365 #366 #367 #368 #369 #370 #371 #373 #374 #375 #376 #377)

### Fixed

- Keep concurrent comment writes from being lost or hidden (#384)
- Preserve comment code snapshots for lines that start with `+` or `-` and for blank lines (#383)

### Thanks

- [@moeyashi](https://github.com/moeyashi) for adding automatic whole-file syntax highlighting for component file types (#381)
- [@takumi12311123](https://github.com/takumi12311123) for adding stale comment detection and updating file change badge wording (#382 #383)
- [@matthoneycutt-sm](https://github.com/matthoneycutt-sm) for improving concurrent comment synchronization (#384)

## [5.0.1] - 2026-05-17

### Added

- Add Vue file syntax highlighting (#362)

### Changed

- Persist diff view mode (#364)
- Update dependencies (#359 #360 #361)

### Removed

- Remove diff mode CLI option (#364)

### Thanks

- [@moeyashi](https://github.com/moeyashi) for adding Vue file syntax highlighting (#362)

## [5.0.0] - 2026-05-13

### Changed

- Update dependencies (#354 #355 #357)

### Removed

- Remove TUI mode and related code (#346)

### Fixed

- Preserve imported comments after clean (#358)
- Pin pnpm mise backend (#352)

## [4.0.7] - 2026-05-10

### Added

- Add viewed-file carryover when file diffs are unchanged and flag changed files (#336)
- Show total diff line counts in the file sidebar (#347)

### Thanks

- [@jzjones](https://github.com/jzjones) for preserving viewed-file state across unchanged diffs (#336)

## [4.0.6] - 2026-05-10

### Added

- Add comment session synchronization and restore CLI comment support (#330)
- Support more editors with custom commands and arguments (#333)
- Add support for gitattributes generated files (#342)
- Add GitHub Pages deployment for the site (#331)

### Changed

- Update dependencies (#332 #337 #338 #339 #340 #341)

### Removed

- Remove scroll animations when moving between files (#335 #343)

### Thanks

- [@tctony](https://github.com/tctony) for supporting more editor commands and arguments (#333)
- [@okunokentaro](https://github.com/okunokentaro) for honoring reduce-motion preferences in diff scroll animations (#335)

## [4.0.5] - 2026-04-29

### Added

- Add Clojure language support (#324)

### Changed

- Document Nix and Haskell language support
- Update dependencies (#325 #326 #327 #328)

### Fixed

- Hide notebook full preview until content loads (#329)
- Disable Safari sidebar sticky headers for performance (#323)

### Thanks

- [@nsyee](https://github.com/nsyee) for adding Clojure language support (#324)

## [4.0.4] - 2026-04-25

### Added

- Add syntax highlighting for Nix and Haskell (#310)

### Changed

- Update dependencies (#295 #296 #297 #298 #299 #307 #309 #315 #316 #317 #318 #319)

### Removed

- Remove obsolete Claude instructions

### Fixed

- Accept implicit git revision suffixes (#303)
- Use direct commit comparisons for diffs (#306)
- Fix reviewed directory styling in the file tree (#320)
- Fix auto theme syntax colors (#322)
- Improve file list sidebar rendering performance

### Thanks

- [@d-xo](https://github.com/d-xo) for adding Nix and Haskell syntax highlighting (#310)

## [4.0.3] - 2026-04-06

### Added

- Add merge-base diff selection mode across CLI and web flows (#293)

### Changed

- Update dependencies (#290)

### Fixed

- Fix stale revision diff state when switching comparisons (#294)

## [4.0.2] - 2026-04-02

### Deprecated

- Deprecate TUI startup and show a warning before launch (#288)

### Changed

- Update dependencies (#287 #282 #285 #279 #280)

### Fixed

- Add table styling for markdown diff preview (#281)
- Avoid `crypto.randomUUID` for comment ids (#284)
- Fix clipboard copying on insecure contexts (#286)

### Thanks

- [@harunonsystem](https://github.com/harunonsystem) for improving markdown table styling (#281)

## [4.0.1] - 2026-03-28

### Added

- Add `--context` flag to control how many context lines difit shows around each change (#273)
- Add `origin/<default>...Uncommitted` quick diff preset

### Thanks

- [@moritzwilksch](https://github.com/moritzwilksch) for adding the `--context` flag (#273)

## [4.0.0] - 2026-03-27

### Added

- Add threaded diff comments (#249)
- Import startup review comments for difit reviews (#269)
- Import unresolved GitHub PR review threads into PR diffs (#270)
- Add difit-review skill for shared and local review workflows (#274)

### Changed

- Update dependencies (#272)

### Fixed

- Collapse auto-viewed files after initial load
- Preserve fenced code blocks in markdown diff preview (#275)
- Fix code scanning alerts (#271 #276 #277)

## [3.1.18] - 2026-03-25

### Added

- Add auto-viewed file patterns (#265)

### Changed

- Refactor settings modal into appearance and system sections (#263)
- Improve development startup logging and hide internal server output (#257)
- Align CI workflows for Renovate auto-merge and merge queue checks (#262)
- Update dependencies (#264 #260 #259 #258)

### Fixed

- Fix commit-ish parsing for branch refs with revision suffixes (#266)

## [3.1.17] - 2026-03-18

### Added

- Add support for protanopia and deuteranopia color modes (#250)
- Add comment authors and badges

### Changed

- Update dependencies (#253 #254 #252 #251 #255)

### Fixed

- Keep `vite` attached to active difit server
- Stabilize keyboard benchmark workflow
- Refine release skill dependency aggregation

### Thanks

- [@MasashiSalvador57f](https://github.com/MasashiSalvador57f) for implementing support for protanopia and deuteranopia color modes (#250)

## [3.1.16] - 2026-03-13

### Added

- Add Elixir language support (`.ex`, `.exs`, `.heex`) (#244)
- Add Mermaid support for markdown diffs (#247)

### Changed

- Update dependencies (#240 #241 #242 #243)

### Fixed

- Decode literal UTF-8 characters correctly in git paths (#245)

### Thanks

- [@YuheiNakasaka](https://github.com/YuheiNakasaka) for fixing UTF-8 decoding in git paths (#245)
- [@fuelen](https://github.com/fuelen) for adding Elixir language support (#244)

## [3.1.15] - 2026-03-09

### Changed

- Update all development dependencies (#235)
- Update knip to v5.84.0 (#234)

### Fixed

- Clear resolved comments from stdout output

## [3.1.14] - 2026-03-04

### Added

- Add Zed support for open-in-editor

### Changed

- Update pnpm to v10.30.0 (#233)
- Update all dependencies (#231)
- Update all development dependencies (#230)

## [3.1.13] - 2026-03-02

### Changed

- Auto-close sidebar on mobile file selection (#229)
- Show mobile file tree on the right side
- Persist sidebar open state

### Thanks

- [@yasunogithub](https://github.com/yasunogithub) for auto-close sidebar behavior on mobile file selection (#229)

## [3.1.12] - 2026-02-28

### Added

- Add VS Code extension package

### Changed

- Improve diff startup performance and lazy rendering path (#225)
- Run format hook on every commit

### Fixed

- Remove `--patch` from `gh pr diff` to restore correct files changed counts (#227)

### Thanks

- [@yasunogithub](https://github.com/yasunogithub) for diff startup and lazy rendering improvements (#225)
- [@takumi12311123](https://github.com/takumi12311123) for fixing `gh pr diff` files changed counts (#227)

## [3.1.11] - 2026-02-25

### Added

- Add `-v` as alias for `--version` in CLI

### Changed

- Update dependencies (#220, #221, #222, #223)
- Replace biome with oxfmt
- Improve development logs to show only Vite URL
- clarify no-comment shutdown behavior in skill script

### Fixed

- Hide open-in-editor actions when unavailable and skip no-op row actions without filename

## [3.1.10] - 2026-02-20

### Added

- Add `--keep-alive` flag to prevent auto-shutdown on disconnect (#217)
- Replace prettier/eslint to biome/oxlint (#218)
- docs(readme): add agent invocation section

### Changed

- Use gh pr diff --patch for PR review input (#219)
- chore(deps): update dependencies (#213, #214, #215, #216)

### Thanks

- [@dschatzle](https://github.com/dschatzle) for `--keep-alive` flag for PR #217

## [3.1.9] - 2026-02-16

### Added

- Add difit skill example file
- Create difit-dev skill and agent config

### Changed

- Improve sidebar default width
- Simplify README example

### Fixed

- Preserve leading whitespace in word-level diff (#212)
- Make stdin detection intent-aware in non-tty
- Delegate stdin and arg parsing to CLI
- Fix pre-commit knip glob

### Thanks

- [@matsuyoshi30](https://github.com/matsuyoshi30) for fixing leading whitespace in word-level diff (#212)

## [3.1.8] - 2026-02-13

### Added

- Add GitHub-style suggestion blocks and suggestion insertion button for code review comments (#199)
- Add Codex environment and release skill

### Changed

- Update dependencies (#209)
- Add knip cleanup tooling and integrate it into hooks (#202)
- Add a quick diff preset for `HEAD` option and trim quick diff presets

### Fixed

- Align split-right comment card with comment form layout
- Remove unused shell mode dependency from dev spawns and streamline development start flow

### Thanks

- [@takumi0706](https://github.com/takumi0706) for adding GitHub-style suggestion blocks for code review comments #199

## [3.1.7] - 2026-02-11

### Changed

- Update dependencies (#205 #206 #209)
- Default markdown and notebook view to code diff

## [3.1.6] - 2026-02-09

### Added

- Add previous commit quick preset

### Changed

- Update dependencies (#201 #203)

### Fixed

- Keep iframe scroll changes inside diff container
- Prefetch markdown full preview before showing tab

## [3.1.5] - 2026-02-05

### Added

- Mobile View Support (#200)

### Fixed

- Handle mjs/cjs/mts/cts syntax

## [3.1.4] - 2026-02-04

### Added

- Quick diff menu with commit picker and detail modal (#198)

## [3.1.3] - 2026-02-04

### Added

- Jupyter notebook viewer (#192)
- Open-in-editor actions in diff viewer (#196)
- Persist sidebar width

### Changed

- Rename diff mode labels to split/unified (#195)
- Update dependencies (#190 #191 #193 #194)

## [3.1.2] - 2026-02-01

### Added

- Markdown full preview support
- Enhance markdown preview
- Add markdown all-syntax sample

## [3.1.1] - 2026-01-31

### Added

- Add markdown diff viewer (#187)

### Changed

- Update Prettier trailing comma setting to `all`
- make diff viewers pluggable
- Remove unnecessary chunk header props from comments

## [3.1.0] - 2026-01-31

### Added

- Export hidden lines in diff view (#176)

### Fixed

- Performance improvement for diff viewer rerenders

### Thanks

- [@GarrickZ2](https://github.com/GarrickZ2) for supporting hidden line expansion in diffs #176

## [3.0.9] - 2026-01-30

### Fixed

- Restore scroll-to-top on sticky folder click

## [3.0.8] - 2026-01-29

### Changed

- Performance improvement for sticky directory headers in file tree

## [3.0.7] - 2026-01-29

### Added

- Add sticky directory headers in file tree (#185)

### Thanks

- [@harunonsystem](https://github.com/harunonsystem) for adding sticky directory headers in file tree #185

## [3.0.6] - 2026-01-28

### Added

- Add Perl syntax highlighting support (#182)

### Changed

- Update dependencies #178 #179 #180 #181

### Thanks

- [@sakamossan](https://github.com/sakamossan) for adding Perl syntax highlighting support #182

## [3.0.5] - 2026-01-22

### Added

- Apply color-scheme CSS property for native browser UI dark mode (#172)

### Changed

- Update dependency happy-dom to v20.1.0 (#173)
- Update dependency vite to v7.3.1 (#171)

### Thanks

- [@y-hiraoka](https://github.com/y-hiraoka) for applying color-scheme CSS property for native browser UI dark mode #172

## [3.0.4] - 2026-01-21

### Changed

- Update dependency globals to v17 (#170)
- Update all dev dependencies (#169)
- Swap expand/collapse icon in sidebar

### Added

- Add --include-untracked flag for non-interactive mode (#168)

### Thanks

- [@koh-sh](https://github.com/koh-sh) for adding --include-untracked flag for non-interactive mode #168

## [3.0.3] - 2026-01-19

### Fixed

- Support git worktree in file watcher (#167)

### Thanks

- [@t14i](https://github.com/t14i) for supporting git worktree in file watcher #167

## [3.0.2] - 2026-01-16

### Added

- Revision selector for dynamic base/target selection (#165)

### Changed

- Update Claude release command workflow

## [3.0.1] - 2026-01-16

### Added

- Collapse/expand all button to Files Changed sidebar
- Independent file collapse state with Alt+Click support (#164)
  - Decouple collapse state from viewed state
  - Alt+Click to collapse/expand all files
  - Smooth scroll when marking file as viewed

## [3.0.0] - 2026-01-16

### Added

- Auto-collapse deleted files in diff view (#146)
- Support for launching difit from repository subfolders (#153)

### Fixed

- Working diff isolation bugs with comments and view status (#149)

### Thanks

- [@tsukasaI](https://github.com/tsukasaI) for auto-collapse deleted files feature #146
- [@GarrickZ2](https://github.com/GarrickZ2) for fixing working diff isolation bugs #149
- [@jonashaag](https://github.com/jonashaag) for adding support for launching from repo subfolders #153

## [2.2.7] - 2025-12-21

### Added

- Terraform/HCL syntax highlighting support (#145)

### Thanks

- [@tsukasaI](https://github.com/tsukasaI) for adding Terraform/HCL syntax highlighting support #145

## [2.2.6] - 2025-12-19

### Added

- Automatically collapse generated files in diff view (#136)

### Fixed

- Filter comments by side to prevent duplication and incorrect positioning (#137)
- Comment form now opens on correct side (old/new) in both inline and side-by-side modes

### Thanks

- [@tsukasaI](https://github.com/tsukasaI) for implementing auto-collapse for generated files #136
- [@GarrickZ2](https://github.com/GarrickZ2) for fixing comment side filtering #137

## [2.2.5] - 2025-12-08

### Added

- Word-level diff highlighting showing changed words with darker background (#126)

### Changed

- Enable ESLint React Hooks new rules with immutability and set-state-in-effect checks (#132)
- Update major dependencies (#130)

### Thanks

- [@gehnmaisoda](https://github.com/gehnmaisoda) for adding word-level diff highlighting #126

## [2.2.4] - 2025-11-28

### Changed

- Bump vitest to v4 (#112)
- Remove unused dracula deps (#111)

### Fixed

- Display modifier key on platforms other than macOS (#121)
- Increase code font size to match UI font size
- Dependencies updates

### Thanks

- [@yoshi-taka](https://github.com/yoshi-taka) for bumping vitest to v4 #112 and removing unused dracula deps #111
- [@syohex](https://github.com/syohex) for fixing modifier key display #121

## [2.2.3] - 2025-10-22

### Added

- Renovate bot configuration for automated dependency updates (#98)

### Changed

- Persist diff view mode setting after page refresh (#106)

### Thanks

- [@MtDeity](https://github.com/MtDeity) for persisting diff view mode after refresh #106

## [2.2.2] - 2025-09-18

### Added

- SECURITY.md for security vulnerability reporting guidelines

### Changed

- Use optional chaining for key checks in localStorage (#90)
- Refactored GitHub Actions workflows for improved maintainability (#93)
  - Extract common CI steps to reusable workflow
  - Pin GitHub Actions to specific SHAs for security
  - Performance workflow limited to src changes only

### Fixed

- Make --clean flag properly reset viewed files counter (#92)
- Normalize git diff paths and handle various edge cases (#96)
  - Robust git path decoding for binary and complex file names
  - Fixed false rename detection for new files
  - Properly handle alternate diff prefixes (c/, w/, etc.)
  - Correct comment line markers with spaces in paths

### Thanks

- [@emcd](https://github.com/emcd) for fixing --clean flag behavior #92
- [@noritaka1166](https://github.com/noritaka1166) for localStorage refactoring #90

## [2.2.1] - 2025-08-24

### Added

- Support for Svelte syntax highlighting (#85)

### Changed

- Replace uuid package with native crypto.randomUUID for better performance (#82)

### Fixed

- Comment line numbers now display correctly in server output (#87)
- '.' keyboard shortcut no longer triggers when modifier keys are pressed (#86)

### Thanks

- [@basyura](https://github.com/basyura) for fixing '.' shortcut with modifier keys #86
- [@KraXen72](https://github.com/KraXen72) for adding Svelte syntax highlighting support #85
- [@noritaka1166](https://github.com/noritaka1166) for replacing uuid package with crypto.randomUUID #82

## [2.2.0] - 2025-08-03

### Changed

- Comment storage now saves with diff context (baseCommitish and targetCommitish) to prevent comments from appearing in wrong diff ranges (#78)
- Viewed state persistence now includes file diff content hash to detect changes between reviews (#78)
- Keyboard shortcut for refresh changed from 'r' to 'Shift+R'

### Thanks

- [@noritaka1166](https://github.com/noritaka1166) for removing unused imports and variables #77

## [2.1.2] - 2025-07-30

### Added

- Highlight selected file in the file list when a line is selected in diff view
- Keyboard shortcuts to jump to first/last file with `{` (`Shift+[`) and `}` (`Shift+]`)
- Performance testing infrastructure with GitHub Actions workflow

### Changed

- Restored row selection on mouse click functionality
- Automatic row deselection when clicking outside selected row
- Automatic close of empty comment forms when clicking outside
- Keyboard shortcut 'v' for toggling viewed state (previously 'r')
- Keyboard shortcut 'r' for refresh when changes are detected

### Fixed

- Enable watch mode for dot argument with comparison
- Support for stdin in dev.js script
- Syntax highlighting disappearing on hover by passing filename prop
- Performance degradation with large diffs (81.7% reduction in keyboard navigation latency)

### Thanks

- [@haya14busa](https://github.com/haya14busa) for performance improvements #72, syntax highlighting fix #74, and watch mode fix #73

## [2.1.1] - 2025-07-28

### Added

- Keyboard shortcuts help to footer
- Added screenshot to all README
- Added protobuf support to README

### Changed

- Changed Reload button to Refresh with updated icon

## [2.1.0] - 2025-07-28

### Added

- Comment list view with keyboard navigation (#64)
  - View all comments in one place with Shift+L
  - Navigate comments with j/k, jump with Enter, delete with d
  - Scope-based keyboard shortcuts management
  - Shift+D to delete all comments
- Stdin support for reading unified diffs (#58)
  - Automatically detect piped input
  - Support explicit stdin mode with '-' argument
  - Enable workflows like `git diff | npx difit`
- Hot reload feature with file watching (#61)
  - Automatic diff updates when files change
  - Manual refresh button
  - SSE-based real-time updates
- Word highlighting in diff viewer like Gerrit (#62)
  - Highlight all occurrences of hovered word
  - Theme-aware styling
  - Case-insensitive matching
- Protobuf (.proto) syntax highlighting support

### Changed

- Default port changed from 3000 to 4966
- Refactored code to use optional chaining (#59)

### Fixed

- Cmd+Enter shortcut for updating comments (#67)
- Last comment not output when closing window (#63)
- Empty files handling in keyboard navigation (#60)
- Script hanging when browser tab is closed (#65)
- Support for two commitish arguments in dev script (#65)
- Fix validation for @ symbol as Git HEAD alias (#57)
- Row selection on mouse click disabled - only keyboard navigation moves cursor

### Thanks

- [@haya14busa](https://github.com/haya14busa) for @ symbol support #57, stdin support #58, word highlighting #62, comment list view #64, and bug fixes #60 #63 #65
- [@noritaka1166](https://github.com/noritaka1166) for optional chaining refactor #59
- [@yukukotani](https://github.com/yukukotani) for hot reload feature with file watching #61
- [@tsukasaI](https://github.com/tsukasaI) for Cmd+Enter comment update shortcut #67

## [2.0.11] - 2025-07-21

### Added

- Gerrit-style keyboard navigation with comprehensive shortcuts (#54)
  - j/k for line navigation, ]/[ for file navigation
  - n/p for chunk navigation, N/P for comment navigation
  - h/l or arrow keys for side switching in side-by-side view
  - r for toggling review state, c for creating comments
  - ? for help modal, . for center navigation
  - Shift+C to copy all comments prompt
  - Mouse click to focus on lines
  - Visual cursor indicators and smart scrolling
  - Skip collapsed files during navigation
- Multi-language README support with Japanese, Chinese, and Korean translations (#56)
- --clean option documentation to README

### Fixed

- GitHub Enterprise Server authentication error messages now explain that tokens must be generated on the specific Enterprise instance

### Removed

- Unused dependency (#53)

### Thanks

- [@haya14busa](https://github.com/haya14busa) for implementing Gerrit-style keyboard navigation #54
- [@noritaka1166](https://github.com/noritaka1166) for removing unused dependency #53

## [2.0.10] - 2025-07-20

### Added

- `--clean` flag to clear existing comments on startup and Button menu for cleanup all prompts
- GitHub Enterprise support for --pr option
- C# syntax highlighting support

### Removed

- Unused props from Checkbox and DiffViewer components

### Thanks

- [@hatayama](https://github.com/hatayama) for adding C# syntax highlighting support #52
- [@haya14busa](https://github.com/haya14busa) for adding --clean flag to clear existing comments on startup #51
- [@noritaka1166](https://github.com/noritaka1166) for removing unused props from Checkbox and DiffViewer components #49

## [2.0.9] - 2025-07-17

### Changed

- Replace full line click with dedicated comment button on line numbers for commenting
- Make code area selectable for text copying
- Simplify ESLint config by extracting shared rules and plugins to reduce duplication

### Fixed

- Fix issue where same line numbers in old/new sides both show comment forms
- Resolve ESLint warnings across the codebase with proper type handling

## [2.0.8] - 2025-07-15

### Changed

- Improved type definitions and removed unnecessary casts (#48)
- HP bar style progress display

### Fixed

- Replaced deprecated GitHub icon with new GitHubIcon component (#47)

### Thanks

- [@noritaka1166](https://github.com/noritaka1166) for improving type definitions #48
- [@noritaka1166](https://github.com/noritaka1166) for replacing deprecated GitHub icon #47

## [2.0.7] - 2025-07-14

### Added

- Display progress of reviewed files in client (#45)
- FUNDING.yml for GitHub Sponsors

### Changed

- Refactored code to fix some ESLint warnings (#46)

### Thanks

- [@noritaka1166](https://github.com/noritaka1166) for adding progress display feature #45
- [@noritaka1166](https://github.com/noritaka1166) for fixing ESLint warnings #46

## [2.0.6] - 2025-07-12

### Changed

- Keyboard accessibility improvements for Checkbox component (#42)
- Refactored code to use optional chaining (#41)
- Refactored test code to remove redundant return (#44)

### Fixed

- Fixed file tree display to prevent collapsing root node when showing nested folders

### Thanks

- [@noritaka1166](https://github.com/noritaka1166) for keyboard accessibility improvements #42
- [@noritaka1166](https://github.com/noritaka1166) for optional chaining refactor #41
- [@noritaka1166](https://github.com/noritaka1166) for test code refactor #44

## [2.0.5] - 2025-07-11

### Added

- Dart language support (#40)

### Changed

- Removed unused @eslint/eslintrc dependency (#39)

### Thanks

- [@tsukasaI](https://github.com/tsukasaI) for adding Dart language support #40
- [@noritaka1166](https://github.com/noritaka1166) for removing unused @eslint/eslintrc dependency #39

## [2.0.4] - 2025-07-10

### Added

- Collapsible file tree section (#37)

### Changed

- Simplified loop iteration and removed unnecessary type assertions (#38)
- Smooth CSS transitions for sidebar toggle animations

### Thanks

- [@seesaw-monster](https://github.com/seesaw-monster) for adding collapsible file tree section #37
- [@noritaka1166](https://github.com/noritaka1166) for refactoring loop iteration #38

## [2.0.3] - 2025-07-10

### Changed

- Migrate to ESLint Flat Config with TypeScript support
- File status display now shows line edits as modified (only new files as added, deleted files as deleted)
- Default host changed from 127.0.0.1 to localhost

### Fixed

- Git branch name validation now follows proper git check-ref-format rules

## [2.0.2] - 2025-07-09

### Added

- Multi-line comment support for diff viewer with proper display formatting (#34)

### Changed

- Improve comment UI with resolve button and simplified tooltips
- Improve icons throughout the interface
- Add GitHub link to sidebar footer
- Change logo color for softer appearance

### Fixed

- Fix branch name validation to allow @ character

### Thanks

- [@uzimaru0000](https://github.com/uzimaru0000) for adding multi-line comment support #34

## [2.0.1] - 2025-07-09

### Added

- vim script syntax highlighting support (#32)

### Changed

- Prettier formatting with experimentalTernaries option enabled
- Prettier configuration updated to use oxc plugin

### Thanks

- [@konojunya](https://github.com/konojunya) for adding vim script syntax highlighting support #32

## [2.0.0] - 2025-07-09

### Changed

- Rename to difit (#33)

## [1.1.12] - 2025-07-06

### Added

- Solidity syntax highlighting support (#31)

### Thanks

- [@maguroid](https://github.com/maguroid) for adding Solidity syntax highlighting support #31

## [1.1.11] - 2025-07-06

### Added

- Image diff display support for inline and side-by-side layouts (#30)

### Fixed

- Git diff header parsing now works correctly with diff.noprefix=true (#29)

### Thanks

- [@tsumuchan](https://github.com/tsumuchan) for fixing git diff header parsing #29

## [1.1.10] - 2025-07-03

### Added

- Untracked file detection with CLI prompt (#6)
- --host option to configure server bind address (#13)
- Comprehensive CLI and server integration tests (#27)

### Changed

- UI misc
  - Remove comment badges from directories in left pane
  - Visual feedback for file path copy button
  - Visible border on top of file header in right pane
  - Directory path collapsing in left pane

### Fixed

- Diff display issue when non-default git diff tool is set (#24)
- Server URL to reflect --host option (#25)
- Remove unnecessary default value in help (#22)
- Mode option now working

### Thanks

- [@umiyosh](https://github.com/umiyosh) for fixing diff display issue #24
- [@mitsuru](https://github.com/mitsuru) for fixing server URL to reflect --host option #25
- [@no-yan](https://github.com/no-yan) for adding untracked file detection with CLI prompt #6
- [@yicrotkd](https://github.com/yicrotkd) for adding --host option to configure server bind address #13
- [@kawarimidoll](https://github.com/kawarimidoll) for removing unnecessary default value in help #22

## [1.1.9] - 2025-07-02

### Added

- Customizable appearance settings to Web UI with font size, font family, theme selection, and syntax highlighting options (#16)

### Changed

- Skip browser auto-launch when no differences are found, displaying informative CLI message instead

### Fixed

- Comment areas now use full width in inline mode for improved readability

## [1.1.8] - 2025-07-01

### Fixed

- Fixed port fallback behavior to prevent displaying `localhost:undefined` when the initial port is in use

### Thanks

- [@arayaryoma](https://github.com/arayaryoma) for fixing port fallback behavior #15

## [1.1.7] - 2025-07-01

### Added

- Scala syntax highlighting support

### Fixed

- Fixed error when specifying a specific commit hash that prevented the application from starting
  - Now correctly validates commit formats like `abc123^` and `abc123~1`
  - Resolves "Invalid base commit-ish format" error when using commit^ syntax

### Thanks

- [@rfkm](https://github.com/rfkm) for adding Scala syntax highlighting support #14

## [1.1.6] - 2025-07-01

### Added

- GitHub PR URL support with `--pr <url>` option
  - `npx difit --pr https://github.com/owner/repo/pull/123`

### Changed

- README.md features section simplified for better readability

### Fixed

- Fixed error when using `working` as target argument that was incorrectly causing validation failures

## [1.1.5] - 2025-07-01

### Added

- MIT License
- Line-type specific comment positioning
  - Delete lines: comments positioned on left half
  - Add lines: comments positioned on right half
  - Unchanged lines: comments positioned full width

### Changed

- Comment display format simplified to file:line (removed timestamp)

## [1.1.4] - 2025-07-01

### Fixed

- Fix frontend display to correctly split on three dots (...) instead of two dots (..)
- Fix git diff arguments to use resolvedCommit string instead of individual commitish values

## [1.1.3] - 2025-07-01

### Changed

- Git commit comparison now uses three dots (...) instead of two dots (..) for better range comparison

### Fixed

- Node.js requirement updated to 21+ with ES2022 support
  - fixed: https://github.com/yoshiko-pg/difit/issues/10

## [1.1.2] - 2025-07-01

### Added

- Comment export feature on process termination (#9)
- /release command for automated release workflow
- CI workflow for pull requests

### Changed

- Package dependencies updated
- Improved lint configuration
- Enhanced pre-commit hooks setup

## [1.1.1] - 2025-06-30

### Added

- Compare-with option support

### Thanks

- [@unvalley](https://github.com/unvalley) for removing undefined `staging` option documentation #7
- [@yu7400ki](https://github.com/yu7400ki) for improving build scripts in package.json #3

## [1.1.0] - 2025-06-30

### Added

- TUI (Terminal User Interface) mode

### Thanks

- [@mizchi](https://github.com/mizchi) for TUI implementation #2

## [1.0.8] - 2025-06-30

### Added

- Dynamic syntax highlighting for additional languages - bash, ruby, java, php, sql

## [1.0.7] - 2025-06-30

### Fixed

- Use version from package.json

### Thanks

- [@no-yan](https://github.com/no-yan) for version handling improvement #1

## [1.0.6] - 2025-06-30

### Added

- Automatic server shutdown when browser tab is closed

## [1.0.5] - 2025-06-30

### Added

- `.` argument to show HEAD vs working directory diff

## [1.0.4] - 2025-06-30

### Changed

- Show commit hash range in short format

## [1.0.3] - 2025-06-30

### Changed

- Simplify comment prompt format to file:line format

### Fixed

- Fix folder name truncation in file tree

## [1.0.2] - 2025-06-30

### Changed

- Use custom favicon

## [1.0.1] - 2025-06-30

### Changed

- Auto-collapse lock files by default

## [1.0.0] - 2025-06-30

### Added

- First stable release 🌱

[6.0.0]: https://github.com/photostructure/gavel/releases/tag/v6.0.0
[5.1.0]: https://github.com/photostructure/difit/releases/tag/v5.1.0
[5.0.12]: https://github.com/yoshiko-pg/difit/compare/v5.0.11...v5.0.12
[5.0.11]: https://github.com/yoshiko-pg/difit/compare/v5.0.10...v5.0.11
[5.0.10]: https://github.com/yoshiko-pg/difit/compare/v5.0.9...v5.0.10
[5.0.9]: https://github.com/yoshiko-pg/difit/compare/v5.0.8...v5.0.9
[5.0.8]: https://github.com/yoshiko-pg/difit/compare/v5.0.7...v5.0.8
[5.0.7]: https://github.com/yoshiko-pg/difit/compare/v5.0.6...v5.0.7
[5.0.6]: https://github.com/yoshiko-pg/difit/compare/v5.0.5...v5.0.6
[5.0.5]: https://github.com/yoshiko-pg/difit/compare/v5.0.4...v5.0.5
[5.0.4]: https://github.com/yoshiko-pg/difit/compare/v5.0.3...v5.0.4
[5.0.3]: https://github.com/yoshiko-pg/difit/compare/v5.0.2...v5.0.3
[5.0.2]: https://github.com/yoshiko-pg/difit/compare/v5.0.1...v5.0.2
[5.0.1]: https://github.com/yoshiko-pg/difit/compare/v5.0.0...v5.0.1
[5.0.0]: https://github.com/yoshiko-pg/difit/compare/v4.0.7...v5.0.0
[4.0.7]: https://github.com/yoshiko-pg/difit/compare/v4.0.6...v4.0.7
[4.0.6]: https://github.com/yoshiko-pg/difit/compare/v4.0.5...v4.0.6
[4.0.5]: https://github.com/yoshiko-pg/difit/compare/v4.0.4...v4.0.5
[4.0.4]: https://github.com/yoshiko-pg/difit/compare/v4.0.3...v4.0.4
[4.0.3]: https://github.com/yoshiko-pg/difit/compare/v4.0.2...v4.0.3
[4.0.2]: https://github.com/yoshiko-pg/difit/compare/v4.0.1...v4.0.2
[4.0.1]: https://github.com/yoshiko-pg/difit/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/yoshiko-pg/difit/compare/v3.1.18...v4.0.0
[3.1.18]: https://github.com/yoshiko-pg/difit/compare/v3.1.17...v3.1.18
[3.1.17]: https://github.com/yoshiko-pg/difit/compare/v3.1.16...v3.1.17
[3.1.16]: https://github.com/yoshiko-pg/difit/compare/v3.1.15...v3.1.16
[3.1.15]: https://github.com/yoshiko-pg/difit/compare/v3.1.14...v3.1.15
[3.1.14]: https://github.com/yoshiko-pg/difit/compare/v3.1.13...v3.1.14
[3.1.13]: https://github.com/yoshiko-pg/difit/compare/v3.1.12...v3.1.13
[3.1.12]: https://github.com/yoshiko-pg/difit/compare/v3.1.11...v3.1.12
[3.1.11]: https://github.com/yoshiko-pg/difit/compare/v3.1.10...v3.1.11
[3.1.10]: https://github.com/yoshiko-pg/difit/compare/v3.1.9...v3.1.10
[3.1.9]: https://github.com/yoshiko-pg/difit/compare/v3.1.8...v3.1.9
[3.1.8]: https://github.com/yoshiko-pg/difit/compare/v3.1.7...v3.1.8
[3.1.7]: https://github.com/yoshiko-pg/difit/compare/v3.1.6...v3.1.7
[3.1.6]: https://github.com/yoshiko-pg/difit/compare/v3.1.5...v3.1.6
[3.1.5]: https://github.com/yoshiko-pg/difit/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/yoshiko-pg/difit/compare/v3.1.3...v3.1.4
[3.1.3]: https://github.com/yoshiko-pg/difit/compare/v3.1.2...v3.1.3
[3.1.2]: https://github.com/yoshiko-pg/difit/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/yoshiko-pg/difit/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/yoshiko-pg/difit/compare/v3.0.9...v3.1.0
[3.0.9]: https://github.com/yoshiko-pg/difit/compare/v3.0.8...v3.0.9
[3.0.8]: https://github.com/yoshiko-pg/difit/compare/v3.0.7...v3.0.8
[3.0.7]: https://github.com/yoshiko-pg/difit/compare/v3.0.6...v3.0.7
[3.0.6]: https://github.com/yoshiko-pg/difit/compare/v3.0.5...v3.0.6
[3.0.5]: https://github.com/yoshiko-pg/difit/compare/v3.0.4...v3.0.5
[3.0.4]: https://github.com/yoshiko-pg/difit/compare/v3.0.3...v3.0.4
[3.0.3]: https://github.com/yoshiko-pg/difit/compare/v3.0.2...v3.0.3
[3.0.2]: https://github.com/yoshiko-pg/difit/compare/v3.0.1...v3.0.2
[3.0.1]: https://github.com/yoshiko-pg/difit/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/yoshiko-pg/difit/compare/v2.2.7...v3.0.0
[2.2.7]: https://github.com/yoshiko-pg/difit/compare/v2.2.6...v2.2.7
[2.2.6]: https://github.com/yoshiko-pg/difit/compare/v2.2.5...v2.2.6
[2.2.5]: https://github.com/yoshiko-pg/difit/compare/v2.2.4...v2.2.5
[2.2.4]: https://github.com/yoshiko-pg/difit/compare/v2.2.3...v2.2.4
[2.2.3]: https://github.com/yoshiko-pg/difit/compare/v2.2.2...v2.2.3
[2.2.2]: https://github.com/yoshiko-pg/difit/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/yoshiko-pg/difit/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/yoshiko-pg/difit/compare/v2.1.2...v2.2.0
[2.1.2]: https://github.com/yoshiko-pg/difit/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/yoshiko-pg/difit/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/yoshiko-pg/difit/compare/v2.0.11...v2.1.0
[2.0.11]: https://github.com/yoshiko-pg/difit/compare/v2.0.10...v2.0.11
[2.0.10]: https://github.com/yoshiko-pg/difit/compare/v2.0.9...v2.0.10
[2.0.9]: https://github.com/yoshiko-pg/difit/compare/v2.0.8...v2.0.9
[2.0.8]: https://github.com/yoshiko-pg/difit/compare/v2.0.7...v2.0.8
[2.0.7]: https://github.com/yoshiko-pg/difit/compare/v2.0.6...v2.0.7
[2.0.6]: https://github.com/yoshiko-pg/difit/compare/v2.0.5...v2.0.6
[2.0.5]: https://github.com/yoshiko-pg/difit/compare/v2.0.4...v2.0.5
[2.0.4]: https://github.com/yoshiko-pg/difit/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/yoshiko-pg/difit/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/yoshiko-pg/difit/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/yoshiko-pg/difit/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/yoshiko-pg/difit/compare/v1.1.12...v2.0.0
[1.1.12]: https://github.com/yoshiko-pg/difit/compare/v1.1.11...v1.1.12
[1.1.11]: https://github.com/yoshiko-pg/difit/compare/v1.1.10...v1.1.11
[1.1.10]: https://github.com/yoshiko-pg/difit/compare/v1.1.9...v1.1.10
[1.1.9]: https://github.com/yoshiko-pg/difit/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/yoshiko-pg/difit/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/yoshiko-pg/difit/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/yoshiko-pg/difit/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/yoshiko-pg/difit/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/yoshiko-pg/difit/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/yoshiko-pg/difit/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/yoshiko-pg/difit/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/yoshiko-pg/difit/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/yoshiko-pg/difit/compare/v1.0.8...v1.1.0
[1.0.8]: https://github.com/yoshiko-pg/difit/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/yoshiko-pg/difit/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/yoshiko-pg/difit/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/yoshiko-pg/difit/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/yoshiko-pg/difit/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/yoshiko-pg/difit/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/yoshiko-pg/difit/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/yoshiko-pg/difit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/yoshiko-pg/difit/releases/tag/v1.0.0
