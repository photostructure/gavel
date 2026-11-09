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

This workflow needs no external controller and starts no model turns while the
human is away. Use it for desktop, CLI, IDE, and subagent reviews unless an
external event controller is already configured:

1. From the reviewed repository's Git root, launch the source build using
   the gavel launcher prescribed by the checkout's instructions with `--background`.
   Save its API host/port, review ID,
   browser URL, capture/summary versions, and pending message revisions. Use a
   named review when the patch must remain frozen.
2. Send any explicit receipts only after recording the corresponding work. Give
   the reviewer the URL and end the Codex turn. Leave the detached server running.
3. After leaving feedback, the reviewer uses **Conversation → Copy resume prompt**
   and pastes it into the owning Codex chat. The button also works when the browser
   cannot determine listener presence. It copies a snapshot command and the
   review URL, with the editor-session fragment removed.
4. Codex reads one `comment snapshot --host <host> --port <actual-port>`, reconciles queued
   messages and its saved pending work, and handles the feedback within the
   existing authorization. Preserve exact message revision cursors for receipts
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

## Automatic integration: a controller owns event delivery

OpenAI's [app-server protocol](https://learn.chatgpt.com/docs/app-server#lifecycle-overview)
documents `initialize`, `thread/resume`, and `turn/start`. A controller that owns
the real app-server connection can keep the model idle and call `turn/start`
when gavel returns a nonempty human-event batch. This is an integration contract,
not a claim that the gavel CLI currently controls an arbitrary desktop chat.

An implementation must:

- Bind an explicit repository, server identity, review and Codex thread. Keep
  process-local review/cursor identities distinct from thread identity.
- Wait in ordinary code, without scheduled model prompts or timed model checks.
  Presence changes, HTTP empty rounds and agent receipts never start a turn.
- Store pending batches and per-port checkpoints before handing off work.
  Deduplicate recovered messages by server/review/thread/message/revision; the
  snapshot deliberately repeats still-Queued messages. Otherwise an unacknowledged
  comment could create an expensive self-sustaining loop.
- Serialize turns per thread and collect feedback arriving while it is busy.
  Treat delivery failures as terminal for automatic invocation; preserve the
  pending batch for explicit recovery instead of retrying model starts blindly.
- On exit 4, stop automatic turn starts. The controller may observe presence in
  ordinary code, but checking for a browser must never require a model turn.
- Keep host approvals and capture guards in effect. Do not infer permission to
  edit, commit or approve from presence or message intent.

Queue/resume commands do not establish that they can deliver into the owning
desktop chat. Verify the owning connection and real event delivery when building
an integration. Do not start `codex exec resume` against an already-managed
desktop chat as a substitute for a configured controller. Ordinary review work
does not include building or probing an automatic bridge.

## Claude integration

Claude's host-specific waiting instructions live in
[its skill](https://github.com/photostructure/gavel/blob/main/skills/gavel/SKILL.md). Changes to that workflow do not change the
Codex handoff rule. Both workflows preserve explicit comment receipts, approval
guards, and existing review servers.
