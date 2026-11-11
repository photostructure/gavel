---
title: Push review verdicts and comments into the owning Claude Code session
section: Agent integration
---

# Push review verdicts and comments into the owning Claude Code session

Matthew reported that agents regularly miss his gavel approvals, and he ends up
typing "approved, commit" in chat. On 2026-11-10 a review of ten Claude Code
sessions found the click reached no listener in eight of them:

- `gavel wait` exits 4 when no tab is connected, and `references/waiting.md`
  says to arm only after the reviewer connects. Reviews launched with
  `--no-open` are never connected at handoff, so agents hand back with "send a
  message here". One v4 approval sat unseen for 87 minutes; another for 28.
- An armed waiter exited 4 when the tab count briefly fell to 0; Matthew
  approved 6 minutes later with nothing listening.
- Agents killed their own waiter during a server restart and did not re-arm.
- When Matthew's next chat message was about something else, nothing made the
  agent read the review, so an approval was found 13.7 minutes later by chance.

Matthew chose (2026-11-10, question 74-1 A) push delivery through the session's
cross-session inbox socket, with a prompt hook as the fallback. He also asked
that the UI's "not delivered" state offer a working **Copy resume prompt**.

## Design

Claude Code exports `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`
and `CLAUDE_CODE_SESSION_ID` to Bash commands and hooks. A process may connect,
send `{"type":"auth","token":…}` and then
`{"type":"user","from":"gavel","session_id":…,"message":{"content":…}}`, one
JSON object per line. Claude Code drops a line whose `session_id` does not match
the receiving session, and an idle session starts a turn with the message.

1. **Owner.** Each review records the session that created it: the launching
   process's environment for the launch review and reviews the browser opens, or
   the environment `review create` sends. The token stays in server memory; it is
   never saved under `.git/gavel`, logged, or returned by an API.
2. **Send.** Only human-origin `review.approval`, `comment.created` and
   `comment.updated` events schedule a send to the review's owner. Proposal
   edits do not: the read-only proposal change, landing separately on main,
   removes the browser's edit route. Agent-origin events never do. A verdict sends
   after a 2-second settle; comments alone send after 5 seconds without further human
   activity on that owner's reviews. One message covers every review of that
   owner with undelivered activity: a state line per review, then only the
   human events no message has carried yet (74-12 A: a review's full state was
   7,409 characters where the one new event was 936).
3. **Delivery state.** The server records, per review, whether the latest human
   activity was sent, failed (with the error), or has no owner inbox. A status
   icon left of the review name in the header shows it (74-17; moved from beside
   the logo so it does not read as part of it), with Copy resume prompt beside it
   when needed. The Conversation panel's listener label remains for servers
   older than the inbox and for reviews no session owns; on phones, which have
   no room for the icon, it is the only Copy resume prompt for those reviews.
4. **Fallback.** The server writes `<runtime-dir>/gavel/sessions/<session-id>/<host>_<port>.json`.
   `gavel pending`, run from `UserPromptSubmit` and `SessionStart` hooks, reads the
   files for its session, re-attaches the session's current socket and token
   (they change when the session restarts), and prints the events whose send
   failed. It prints nothing otherwise.
5. **Authority.** The message only says that something happened. The skill
   keeps the rule that a fresh snapshot's approval, not the message, is commit
   approval.

Hosts without the inbox variables, Codex included, keep the existing hand-back.

## Tasks

- [x] The skill reads `comment snapshot` directly; its jq filters are gone. A
      filtered "brief" view was built and dropped (Matthew, 2026-11-10, 74-8 A,
      accepted as recommended): the raw snapshot was 4x larger on these reviews,
      but that is 1-3K tokens per read against a wake's 170K+ context re-read.
- [x] Inbox notifier: owners, scheduling, sending, delivery state; launch and
      `review create` record the owner; attach accepts requests from this machine
      only — `vitest run src/server/session-inbox`
- [x] `gavel pending` and the session registry files; hook configuration
      documented — `vitest run src/cli/pending.test.ts`
- [x] Browser: a status icon left of the review name in the header, with
      **Copy resume prompt** when delivery failed or no session owns the review
      — `vitest run src/client/components/AgentDeliveryStatus.test.tsx src/client/hooks/useInboxDelivery.test.ts`
- [ ] Browser: a notice when the agent's own change revoked a verdict. The
      Reject verdict change it waited for has landed on main.
- [x] Skill, docs, and CHANGELOG; the Claude Code waiter instructions retired
- [x] Delete `skills/gavel/references/waiting.md`, which nothing linked to after
      the waiter instructions were retired (74-4 A, accepted as recommended)
- [x] End-to-end with a human click: an Approve as-is clicked at 04:56:10.585
      UTC on 2026-11-11 was sent at 04:56:12.607 and started a turn in the idle
      session. Each verdict, a cleared verdict, a new comment, an edit, and two
      batched comments arrived the same way.
- [ ] `gavel pending` run from a real `UserPromptSubmit` or `SessionStart` hook
      (74-5: the hooks go into the maintainer's settings after this lands).

## Merge notes

- The header status (commit 2) imports `buildResumePrompt()` from
  `src/client/utils/resumePrompt.ts`, which a Codex session's uncommitted work
  adds. Commit 2 lands after that file does; its tree does not build without it.

## Lore

- `/clear` changes both `CLAUDE_CODE_SESSION_ID` and the inbox socket (74-3,
  measured 2026-11-10 in a desktop-app fork on Claude Code 2.1.317: session
  `561f544f…` became `23ad51b9…`, socket `748850.sock` became `758973.sock`). In
  the desktop app the session's process also exits at `/clear`, so the next send
  fails with ENOENT. Reviews from before `/clear` fall back to Copy resume prompt.
  Not measured in the terminal CLI: if its old socket still accepted
  connections, the message would be dropped for its old session ID while gavel
  recorded it as sent.
- A command typed with `!` gets no inbox variables: on 2026-11-10 a server
  launched that way had neither, and on 2026-11-11 `review create inbox-unowned`
  run with `!` recorded no owner (`/api/inbox` reported `unavailable`).
- The wire format and `session_id` check come from Claude Code 2.1.317's inbox
  handler; the public docs document only the auth line.
- Claude Code 2.1.317 holds a message that declares no permission mode while the
  session bypasses permission prompts and `crossSessionInbound` is unset, unless
  the sender descends from the session's process; `accept` delivers it in every
  mode.
- 2026-11-10: a message sent from a `setsid nohup` grandchild of a Bash command
  (still a descendant of the session's process) reached the running session
  mid-turn, framed as a cross-session message with the warning that peer
  messages are not user approval.
- Claude Code sends no reply on the socket for a user message, so "sent" means
  the inbox accepted the bytes, not that the model read them.
- 2026-11-10, built CLI: a `--background` server launched with a stale socket
  recorded the failed send with its error; `gavel pending` then printed the
  approval and the review showed `sent` via `prompt`.
- A `--background` child installs no signal handlers, so SIGTERM kills it
  without removing its registry file; `gavel pending` removes files whose PID
  has exited.
- Tests run inside Claude Code sessions: `vitest.setup.ts` deletes the inbox
  variables, or servers under test would register with, and message, the session
  running them.
- Background Bash has no time limit in the terminal and desktop app since
  Claude Code 2.1.288 (tools-reference docs); `gavel wait` failed on presence,
  not on host deadlines.

## Solutions rejected

- Fixing only `gavel wait`: it still needs the agent to keep a process alive and
  re-arm after every batch, and dies on session exit or resume.
- An MCP channel: custom channels need `--dangerously-load-development-channels`,
  work only in interactive sessions, and the docs do not cover the desktop app.
