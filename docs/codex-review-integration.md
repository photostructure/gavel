# Codex reviews without idle model turns

Reviewer presence and event subscriptions work independently of the agent host.
The host determines how a real human event reaches its model. Do not put a Codex
model in a loop that checks gavel, shell-job status or browser state.

## Install the Codex entry point

The Codex skill is [`.codex/skills/gavel/SKILL.md`](https://github.com/photostructure/gavel/blob/main/.codex/skills/gavel/SKILL.md).
It keeps the Codex handoff rules separate from the Claude entry point at
`skills/gavel/SKILL.md`. The repository's `gavel-dev` skill uses the same Codex
workflow.

Point the user-level Codex skill, `~/.agents/skills/gavel`, at this checkout's
`.codex/skills/gavel` directory. Keep Claude's `~/.claude/skills/gavel` pointing
directly at `skills/gavel`. A Claude link through `~/.agents/skills/gavel` would
make changing the Codex target change Claude's skill too. Preserve the existing
Claude content when separating those links.

## Codex: end the turn, resume on feedback

Gavel queues human verdicts and comments for the owning Codex chat when
`CODEX_THREAD_ID` identifies it and `codex queue` is available on the server
host. No model turn waits for review. Manual handoff remains available:

1. From the reviewed repository's Git root, launch the source build using
   the gavel launcher prescribed by the checkout's instructions with `--background`.
   Save its API host/port, review ID,
   browser URL, capture/summary versions, and pending message revisions. Use a
   named review when the patch must remain frozen.
2. Send any explicit receipts only after recording the corresponding work. Give
   the reviewer the URL and end the Codex turn. Leave the detached server running.
3. After the last verdict, the tab stays open with **Copy resume prompt and close**.
   If queued feedback has not resumed the chat, the reviewer clicks it and
   pastes the prompt into the owning Codex chat.
   Closing requires a successful copy; a failed copy leaves the tab open for retry.
   **Keep open** dismisses the notice. To resume before the last verdict or after
   dismissing the notice, tap the robot and choose **Copy resume prompt**, on
   desktop or phone. If the review has no owning session,
   use **Conversation → Copy resume prompt** instead. The prompt includes the
   snapshot command and review URL. Codex keeps manual handoff available even
   when a listener is attached: a subscription does not prove delivery into the
   owning chat. Other agents get a **Close tab** button instead, disabled while
   the verdict is still being sent so a failed send can still show the handoff.
4. Codex handles the delivered event batch and its saved pending work within
   the existing authorization. Use `comment snapshot --host <host> --port <actual-port>`
   for a manual resume, missing thread context, or a fresh
   approval check before committing. Preserve exact message revision cursors for receipts
   and replies. Check approval against the current capture and summary.
5. When caught up, Codex ends the turn again. Delivered, Read, Thinking, and
   Replying messages still need reconciliation against saved work; only Queued
   messages are automatically recovered by wait. Do not call a waiter, schedule,
   heartbeat, sleep, or repeated snapshot to keep this model turn active.

Fetch another snapshot for a conflict, newly delivered human feedback, or the
final approval check before committing. Do not turn an empty snapshot, tool
yield, timeout, or cache expiry into another check. Save large snapshots to a
private temporary file and show the model only the selected reviews' metadata,
outstanding human messages, and context needed to answer them. Keep handoffs to
IDs, versions, URLs, pending revisions, and next actions.

Subagents finish after handing those details to the owning main chat. A review
server's process lifetime is not a reason to keep a subagent running. The CLI's
`--background` implementation detaches and unreferences its child process. If
the host imposes a stronger process-lifetime restriction, report it; do not
substitute a model polling loop to preserve the server.

The listener indicator reports a subscription, not an active model or automatic
turn delivery. Browser presence and background processes do not resume Codex.

## Queue delivery

Gavel uses the documented [`codex queue`](https://learn.chatgpt.com/docs/developer-commands#codex-queue)
command with the owning thread UUID and Codex home. Install Codex CLI on the
machine running gavel and keep the owning chat open. The server checks command
support before attempting a queue write. Hosts without a UUID or a usable CLI
retain the manual resume prompt. A named review belongs to the chat that created
it; a review without an owner does not fall back to another chat. Codex and
Claude Code must use separate servers. Do not create Codex reviews on a
Claude-launched server or reuse a Codex server from Claude. Mixed-host servers
are unsupported; the final-verdict handoff uses the launching host identity.

Human verdicts settle for two seconds; comments wait for five seconds of quiet.
Agent replies and receipts never trigger a notification. Sends to a Codex thread
are serialized. Messages name their review IDs and include the same verdicts, comment text,
revision cursors, and captured code context as Claude inbox messages. Codex can
handle that feedback directly; it reads the snapshot for missing thread history
and before committing. Messages up to 16,000 UTF-8 bytes stay inline. For larger
batches, gavel writes the complete feedback to a private local temporary file
and queues one instruction to read it. This avoids command-line argument limits
without splitting feedback across model inputs. The file is written before
queueing, with owner-only access, and retained after delivery attempts and server
shutdown so a delayed chat can read it. The host's temporary-file cleanup may
remove it; use the manual resume prompt if it is missing or inaccessible. This
handoff requires the agent to read files on the gavel host. The CLI receives each
message as one literal argument; gavel does not interpolate it into a shell command.

Claude and Codex use the same header control: a muted crossed-out robot when
unavailable or disconnected, a green robot when delivery is available, a sweep
while delivering, and a green check for five seconds when the browser observes
acceptance. Reduced motion disables the sweep. Tap the robot for details and
**Copy resume prompt**; the phone control occupies only 30 pixels.

**Queued for Codex** in the details confirms that the command saved the
notification. It does not confirm that a turn started or the agent read it.
**Codex delivery unconfirmed** shows the error or missing-acknowledgment
diagnostic, with a red robot and exclamation mark. Gavel does not retry an
attempted write automatically because it may already be saved. The final-verdict
tab stays open for manual handoff.

Validated on Linux with CLI 0.167.1 and desktop runtime 0.167.0-alpha.3.2: plain queue
started turns in idle chats and deferred busy-chat input until the active turn
finished. A closed CLI chat consumed its saved message when manually reopened.
A fully closed desktop app, remote hosts, IDEs, and other versions have not been
validated. Queue capability is checked rather than inferred from a version.

Gavel deliberately omits `--resume`: it requires the correct daemon or remote
server, and can print a warning while still exiting successfully. It does not
start a daemon, use private desktop pipes, install hooks, or run `codex exec resume`
against an already-managed chat. The [app-server protocol](https://learn.chatgpt.com/docs/app-server)
can support a separately configured controller; this integration makes no claim
to control an arbitrary unloaded desktop thread.

## Claude integration

Claude's host-specific waiting instructions live in
[its skill](https://github.com/photostructure/gavel/blob/main/skills/gavel/SKILL.md). Changes to that workflow do not change the
Codex handoff rule. Both workflows preserve explicit comment receipts, approval
guards, and existing review servers.
