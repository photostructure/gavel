# Approval modes

The verdict buttons have three actions. **Approve as-is** approves the displayed
patch. **Approve after comments** tells the agent to act on all the current
comments and then commit. **Not yet** says the displayed patch is not ready:
revise it, then ask again. None of them authorizes a push, publication, or
unrelated changes.

Approval snapshots and `review.approval` events carry the mode:

- `mode: "as-is", approved: true`: the reviewed patch is approved.
- `mode: "after-comments", approved: true`: act on the current comments, then commit.
- `approved: false, notYet: true`: the reviewer chose **Not yet** for the displayed
  capture or diff. Read the comments, revise, and recapture or re-propose; that clears
  `notYet`, and the review waits for a new verdict. A changed summary, a changed
  `staged`, `working`, or `.` diff, or revocation also clears it. New comments keep it.
- `approved: false` without `requested: true` or `notYet: true`: there is no verdict.

The nested `approval` object on approval events has the same fields as snapshots.
**Approve after comments** uses `POST /api/approval/conditional`; an older server
returns 404 instead of silently treating it as as-is approval. **Not yet** uses
`POST /api/approval/not-yet` with `approved: false` for the same reason: an older
server returns 404 instead of treating it as revocation. It carries the displayed
`captureVersion` and `patchDigest`, or the `diffDigest`, like approval, and returns
HTTP 409 when they are stale; it does not check `summaryVersion`. The browser checks
`conditionalSupported` before offering **Approve after comments**.

## Acting on Approve after comments

1. Read every unresolved comment in `comment snapshot`, including ones already
   replied to, plus any feedback the reviewer gave in the session or outside gavel.
2. Act on all of them within the reviewed scope. Answer questions in their threads.
   If a request cannot be done or its meaning is unclear, explain the problem and
   do not commit.
3. Run the required checks and independent review.
4. Immediately before committing, read a fresh snapshot. Stop if the reviewer cleared
   the verdict or chose another, act on any feedback added since, and use the latest
   saved commit message.

Nothing records which comments are done, and the agent certifies nothing to the
server. Addressing a comment does not resolve or delete it. Keep the existing rule
to resolve or delete only on request. Permission does not extend to other changes
in a shared working tree.

## Approval invalidation

**Approve after comments** ends only when the reviewer clears it or chooses another
verdict. New, edited, resolved, or reopened comments leave it in place, and so do
capture updates, diff changes, and summary edits. The approval's `captureVersion`,
`patchDigest`, and `summaryVersion` follow the current capture and summary, so a
commit does not need them to match the capture the reviewer first saw.

**Approve as-is** covers exactly what the reviewer saw. New or edited human feedback,
deletion, a reopened thread, a changed summary, or a changed named capture revokes
it. A `staged`, `working`, or `.` review records the digest of the diff the reviewer
approved, so a different current diff, such as more staged hunks, also revokes it.
`comment snapshot` and `GET /api/approval` check the current diff before they report
approval.

A restarted server that opens the same review restores its approval
([saved reviews](agent-conversations.md#saved-reviews)). Presence and browser
closure never grant approval.

Use `gavel schema approval` for the request schema.
