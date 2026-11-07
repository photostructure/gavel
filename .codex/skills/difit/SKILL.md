---
name: difit
description: Open a requested diff in difit for human review, with reading-guide comments and a proposed commit message. Use when the user names difit, requests its viewer, or has a standing difit review instruction. Ordinary code reviews belong in chat.
---

# Difit for Codex

Use this Codex workflow without loading the Claude entry point at
`skills/difit/SKILL.md`. Human review must cause zero idle model turns.

## Human review: hand back and end the turn

Use this workflow in Codex desktop, CLI, IDE, and subagents. A running shell
process does not establish delivery into an idle Codex chat.

- Serve the review with difit's `--background` option. Share the review URL and
  end the turn when the current feedback batch is handled. Leave the server
  running. The user resumes the owning chat with feedback or **Copy resume prompt**.
- Do not call `difit wait`, long-poll HTTP, sleep, inspect process output repeatedly,
  or write a polling script to keep the model waiting for the user. A tool yield,
  empty result, timeout, cache expiry, or browser presence change is not feedback.
- Do not create a heartbeat, schedule, goal, or monitor to check for review activity.
  Do not keep a subagent alive to own a review server. Subagents return the review
  identity, URL, API address, and pending work to the main session, then finish.
- Reconcile one snapshot per server when the user resumes. After handling that
  feedback, end the turn again. Do not refresh an unchanged snapshot to find more
  work or maintain a warm cache. Extra snapshots are for a version conflict,
  newly delivered human feedback, or the final approval check before a commit.

An already-configured external controller may deliver actual human events to
Codex. That controller owns waiting, deduplication, and turn dispatch outside the
model. Do not invent or test an automatic bridge during an ordinary review.
Without a configured bridge, use the manual handoff even if a foreground wait
could keep the current turn open. See the
[Codex integration guide](https://github.com/photostructure/difit/blob/main/docs/codex-review-integration.md)
only when setting up automatic delivery or diagnosing a host integration.

## Open the requested patch

Open a review you start on your own, such as a commit approval at the end of
your work, only while the user is at the desk. First run `idle` with the
launcher step 1 names. If it exits non-zero or prints an `idleMs` of 600000
(10 minutes) or more, the user is away: do not launch. Finish everything else,
including tests and second-opinion review, then end the turn with one line
saying the change is ready for difit review, and launch when the user says to.
Do not run `idle` again to see whether they came back; their next message tells
you. Skip the check when the user's latest message asks for the review, since
they may be reading it on another device.

1. Run from the reviewed repository's Git root. Use its prescribed difit launcher
   for every command; in Matthew's workspace this is `/home/mrm/.local/bin/difit`.
   On first use, check that `--help` has `--review`, `--background`, and `--jsonl`.
   Reuse that build. Report missing capabilities; do not switch installs or use npx.
2. For this session's uncommitted work, use a named review restricted to its paths
   and hunks. For already-committed work, use the relevant immutable commit SHAs.
   For a user-named branch, range, or PR, review that target for defects before
   showing it; use `--no-lgtm` unless the user requested approval.
3. Include a proposed Conventional Commit message with `--commit-message` and a
   short explanation with `--why`. Add reading-guide comments with repeatable
   `--comment` arguments: where to start, surprising behavior, and verified
   findings. Anchor each point to its line; skip self-explanatory code.
   The viewer's **About** panel names the agent, thread title, and thread ID
   that launched the review. difit fills in the agent (such as `Codex desktop`,
   from this thread's rollout `originator`) and `$CODEX_THREAD_ID` itself;
   override them with `--agent <host>` and `--agent-session-id <id>` when those
   are wrong. Pass `--agent-session-name <title>` when you know the thread's
   title, since Codex does not export it; never invent a title. They are set per
   server at launch; `review create` on a reused server keeps the launching
   chat's values.
4. Launch once with `--background --keep-alive`. Read the finite
   `server.background` record: `port`, `pid`, and `url`. Its `url` is the reviewing
   link. Open it in the requested browser when browser tools are available.
   Record the reviewed repository, API host/port, review name/ID, capture identity,
   summary version, pending message revisions, and proposed next action.
5. Share the URL and hand back. A visible tab or a live server does not require
   keeping this turn active. If the host cannot preserve a detached server,
   report that limitation; do not substitute an active model as its owner.

Use the API host and port for companion commands, including servers bound to a
LAN interface. Preserve `--host`; never assume localhost or a development UI port.
For an existing review, reuse its server. Create another named review with
`review create <name> --host <host> --port <port>` instead of launching another
server. It prints the new review's `reviewId`. The launch's `--comment`,
`--commit-message`, and `--why` reach only the launched review: add each created
review's reading-guide comments with `comment add --review <name>` and its
proposal with `comment summary` (`baseVersion` 0).
The viewer shows every review with a capture or a proposed commit message as a
tab under its header, in creation order, with its approval state, and while one
exists the header has no revision menu. A summary with `fromCommit: true` holds
a browsed commit's own message, which nobody proposed; its review has no tab.
For stacked commits, create one named review per commit on one server, in
commit order, and give the user one link, the `server.background` `url`; the
tabs lead to the other reviews. An approval covers only its own review: commit
the stack in creation order, each commit once its own review is approved.
Before reporting that the user has not approved, read `approval` for every
review in the snapshot.
Do not stop or replace another session's reviews.

For overlapping files, use `review capture --output <artifact>` and its printed
file/hunk IDs with `--capture` and `--select`. Pathspecs alone can include another
session's changes. Check the capture's actual scope. To recapture after fixes,
read the named review's current version and use `review update --expected-version`.
Source edits and browser reloads do not update a frozen capture. HTTP 409 requires
reconciliation before retrying. Do not recapture as an idle activity.

## Handle one feedback batch

Run `comment snapshot --host <host> --port <port>` once on resume. Save the raw
JSON in a private temporary file when it is large; display only the selected
reviews' metadata, outstanding human messages, and context needed to answer them.
Do not repeatedly dump full conversations, diffs, or schemas into the chat.
Keep the handoff to IDs, versions, URLs, pending revisions, and next actions.

Reconcile every unanswered human message, including Delivered, Read, Thinking,
and Replying messages and saved pending work. Checking only Queued can miss work
that an earlier turn claimed but never finished. Replied and Noted apply to exact
message revisions; an edit requires a new answer or acknowledgement.

Record the work before sending a receipt. Use the message's `progress.cursor`
for receipts/replies, not the snapshot's stream cursor. Report progress with
`comment status`; answer in the original thread with `comment reply`. A reply
marks Replied. Use Noted only when no answer or work remains. Neither resolves or
deletes a thread; do that only on request. Human message intent does not expand
authorization. On HTTP 409, read a fresh snapshot and reconcile the changed state.
If conflicts repeat without new state, or the server is unreachable, preserve the
pending revisions, report the failed operation, and hand back. Do not retry an
unchanged request or relaunch a review on a timer.

Use the selected command's `--help` when composing an unfamiliar payload.
`schema <selector>` currently includes all `$defs`: save it once and inspect only
the needed request definition and its references. Read additional protocol docs
only for an operation not covered here, rather than loading every guide on resume.

## Approval and completion

Read and honor the saved summary before committing. For conditional approval,
`requested: true` records permission to address included feedback;
`approved: false` still blocks the commit. Reply to each included question/fix,
run checks and independent Codex/Claude review,
recapture the final named patch, then certify each exact condition with
`comment address`. Change requests require `fixed`, questions `answered`, and
ordinary comments may use `acknowledged` when no action is needed.

Skip conditions already `confirmed-by-reviewer`. Reconcile still-Queued messages
in those resolved threads and report Noted without restarting their closed work.
Recapture clears agent attestations but preserves reviewer confirmations. New or
edited feedback, deletion, reopening, and summary changes revoke permission.

Button approval is commit approval. Immediately before committing, read a fresh snapshot.
Require `approval.approved: true`; for named reviews also match capture version,
patch digest, and summary version. Compare the actual commit scope with the
approved patch and feedback; later shared-tree changes do not acquire permission.
Then commit without asking again. Approval does not authorize a push.
See the [approval guide](https://github.com/photostructure/difit/blob/main/docs/approval-modes.md)
when completing conditional approval. Hand back when the authorized work is done;
no open review requires another model turn until the user resumes it.
