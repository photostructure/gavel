---
title: Queue human review activity for the owning Codex chat
section: Agent integration
---

# Queue human review activity for the owning Codex chat

Completed 2026-11-12. All eight human review parts are approved. This record
lands with the approved implementation; no event-delivery work remains in scope.
The earlier manual handoff landed in `3733a8e`.

## Contract

Gavel captures the owning UUID and Codex home from the launching environment or
named-review creator. It reuses human-event batching from Claude's inbox work
(`15c79fb`), with serialized Codex sends. Agent activity never wakes another agent.
Messages name scoped review IDs and include verdicts, human comment text,
revision cursors, and captured code context. Matthew explicitly requested this
parity with Claude delivery so the agent need not fetch already-delivered text.
Codex queue accepts that text as one literal argument, never shell code. Messages
up to 16,000 UTF-8 bytes stay inline. Larger batches are written completely to a
private local temporary file before one notification asks Codex to read it.
Retain the file after queue attempts and server shutdown for delayed consumers;
OS temporary-file cleanup can remove it. Manual resume recovers missing files.
Read missing thread context and fresh approval from the snapshot.

A successful queue acknowledgment means saved input, not a running turn or read
receipt. Missing/unsupported CLI fails before attempting a write. Any ambiguous
write outcome is retained as `uncertain` with its diagnostic, not automatically
retried. Queue acceptance is a distinct `queued` status, never a read receipt. The
snapshot retains unfinished human feedback for manual recovery. Both queue states
keep Copy resume prompt available; the final-verdict tab remains open.

Use plain queue. Do not start a daemon, use private desktop pipes, install hooks,
or start a second controller with `codex exec resume`. Hooks can recover pending
work at lifecycle events but do not establish an external idle wake mechanism.
App-server turn/start requires the owning connection; no public discovery contract
for arbitrary desktop ownership was confirmed. CODEX_APP_TOOLS_PIPE_PATH is not
an established inbox contract. No credentials or private pipe protocol were read.

## Evidence and limits

Verified 2026-11-12 with CLI **0.167.1**, desktop runtime
**0.167.0-alpha.3.2**, and existing `/home/mrm/.codex` home:

| Test                                      | Result                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Desktop idle, plain queue                 | New turn returned exact requested acknowledgment.                               |
| Desktop busy during 20-second command     | One subsequent turn handled queued input after command completion.              |
| CLI idle (`--no-daemon`), plain queue     | New TUI turn returned exact acknowledgment.                                     |
| CLI busy during 20-second command         | Queued input ran after the current turn.                                        |
| CLI closed, queue --resume, no daemon     | Exit 0 with warning; message consumed on manual reopen.                         |
| Explicit nonexistent --remote endpoint    | Exit 1 before queue acknowledgment.                                             |
| Desktop loaded, queue --resume, no daemon | Warning despite actual delivery; do not treat warning as proof nothing arrived. |

Fully closed desktop UI, remote hosts, IDEs, and other versions remain unverified.
No existing daemon or hook configuration was changed. Test chats were archived.
Local CLI 0.164.0 also exposed queue, but was not tested for actual delivery. Check
capability rather than deriving a minimum supported version from these observations.

## Acceptance

- `src/server/codex-queue.test.ts`: UUID/home validation, literal arguments,
  unsupported CLI, exact-owner acknowledgment, complete Unicode feedback files,
  private permissions, file-write failures, and uncertain-write retention.
- `src/server/session-inbox.test.ts`: human-only ownership, inline human context,
  large payload retention, serialized sends,
  activity arriving during a send, and no automatic resend after queue receipts.
- `src/cli/review.test.ts`: named-review creator identity, independent of parent env.
- `src/client/components/AgentDeliveryStatus.test.tsx`: accurate queue labels and
  manual recovery on desktop/mobile.
- Run CLI typecheck, type-aware oxlint, relevant Vitest suites, and build. Socket
  integration tests require local networking outside the restricted sandbox.
- Live acceptance: a simulated human comment and captured code reach the
  disposable chat, which acknowledges INLINE-CONTEXT-RECEIVED once without
  fetching a snapshot or using tools. For oversized feedback, verify one queue
  message points to a complete readable file rather than multiple queued parts.

## Shared delivery indicator

Claude and Codex use the same 30px robot control: disconnected, available,
delivering, and a five-second transport confirmation. Delivery sweeps a diagonal
band from top-left to bottom-right; reduced motion keeps the band static.
Details and Copy resume prompt sit behind a tap. Confirmation means transport
acceptance, not that the agent has read the message or started a turn.

Receipt timing uses browser-local observation time. Initial snapshots are
history; subsequent receipts flash once. Each review retains its last receipt
through pending/failed states so withdrawing unsent activity cannot replay it.
Compatibility normalization handles earlier source-build queue receipt shapes.
A minor limitation remains: an initial snapshot already pending does not expose
an older receipt's identity. No substantive review findings remain open.

## Verified delivery and UI

- Live inline delivery returned INLINE-CONTEXT-RECEIVED without a tool call or
  snapshot fetch. Matthew also confirmed delivery in “choose a gavel tagline.”
- Installed CLI accepted one 428-byte instruction referencing a complete
  520,068-byte Unicode feedback file. Reading it reproduced the input exactly.
- Desktop model acceptance read a 29,295-byte feedback file and returned
  FILE-CONTEXT-RECEIVED-4c8d, which appeared only in the file. Test chats were
  archived and disposable data removed.
- A 390px browser viewport verified the 30px robot and recovery popover. A real
  component/hook fixture verified queued/sent confirmation, expiry, and pending
  withdrawal. Actual CSS was inspected at five diagonal animation phases and at
  18px, including reduced motion. These checks used IAB; Chrome was unavailable.
- Final verification covers CLI typecheck, repository type-aware oxlint, the
  seven affected Vitest suites, scoped formatting, and the CLI/Vite build.

## Independent review and decisions

Final verdict: LAND from both Codex CLI and Claude CLI on all nine batches.
Transport received four passes, recovery/docs three, the superseded multipart
transport one, file handoff one, shared indicator four, each of three skill
condensation batches two, and the diagonal sweep one. Only new deltas were
reviewed after human approval. Baselines advanced from `c9c70c21` to `fa778261`;
the last human delta capture used `03529358`.

All substantive findings were addressed. Durable decisions:

- Matthew requires separate Claude/Codex servers. The mixed-host runtime
  expansion was excluded; both skills document that constraint.
- Keep legacy queue-receipt normalization: the running article review returned
  the older shape, and rebuilding does not restart a detached server.
- Feedback always includes complete human context. Small batches stay inline;
  large batches use one local file rather than chunked queue messages.
- Queue writes are serialized per thread; ambiguous outcomes are not retried.
- The three skills were condensed from 6,616 to 5,239 words while retaining
  commands, host-specific handoffs, revision receipts, and approval rules.
- Retain `gavel wait` for other harnesses, as Matthew requested. The removal
  proposal was deleted. Hermes/Pi discovery research is separate future work,
  not an outstanding implementation task here.

Human review parts on localhost:4975: `codex-delivery-1-transport`,
`codex-delivery-2-handoff`, `codex-delivery-3-guide`,
`codex-delivery-4-indicator`, `codex-delivery-5a-skills-launch`,
`codex-delivery-5b-skills-feedback`, `codex-delivery-5c-skills-claude`, and
`codex-delivery-6-diagonal-sweep`. Their approved deltas form one commit.
