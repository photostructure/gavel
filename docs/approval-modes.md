# Approval modes

The verdict buttons have three actions. **Approve as-is** approves the displayed
patch. **Approve after comments are addressed** authorizes the fixes and answers
needed for the recorded feedback, subject to the existing review and commit rules.
**Not yet** says the displayed patch is not ready: revise it, then ask again.
None of them authorizes a push, publication, or unrelated changes.

Approval snapshots and `review.approval` events carry the mode:

- `mode: "as-is"`: `approved: true` means the reviewed patch is approved.
- `mode: "after-comments", requested: true`: conditional permission is recorded.
  `conditions` identifies every included user message by thread, message, and exact
  revision cursor. Already-resolved threads are excluded. `approved` remains false
  until every condition has completion evidence or the reviewer confirms it by
  resolving its thread.
- `approved: false, notYet: true`: the reviewer chose **Not yet** for the displayed
  capture or diff. Read the comments, revise, and recapture or re-propose; that clears
  `notYet`, and the review waits for a new verdict. A changed summary, a changed
  `staged`, `working`, or `.` diff, or revocation also clears it. New comments keep it.
- `approved: false` without `requested: true` or `notYet: true`: there is no verdict.

The nested `approval` object on approval events has the same fields as snapshots.
Conditional requests use `POST /api/approval/conditional`; an older server returns
404 instead of silently treating them as as-is approval. **Not yet** uses
`POST /api/approval/not-yet` with `approved: false` for the same reason: an older
server returns 404 instead of treating it as revocation. It carries the displayed
`captureVersion` and `patchDigest`, or the `diffDigest`, like approval, and returns
HTTP 409 when they are stale; it does not check `summaryVersion`. The browser checks
`conditionalSupported` before offering the action. The existing top-level
`approved` boolean remains a commit-readiness signal, so
older agents cannot mistake pending conditional permission for completed approval.

## Completing conditional approval

1. Read `comment snapshot` and save the conditional approval, its comment revisions,
   and its original `baselineCapture`, when present. Reconcile all outstanding
   feedback, including messages already Delivered or Read.
2. Address the recorded feedback within the approved scope. Answer questions in
   their threads. A reply, Noted receipt, or seen-message indicator does not certify
   a requested change is complete. If a request cannot be completed or its meaning
   is disputed, explain the problem and leave approval pending.
3. Run the required checks and independent review. For a named review, recapture
   the final patch before certifying completion. Compare it against the baseline
   and ensure the changes implement only the approved feedback. The server records
   agent attestations; it cannot judge the correctness or scope of source changes.
4. Skip conditions already confirmed by the reviewer. Certify each remaining
   condition with `gavel comment address --host <host> --port <port>`.
   Use the checkout's prescribed gavel launcher. Supply JSON on stdin:

   ```json
   {
     "reviewId": "from-snapshot",
     "approvalCursor": "from-current-approval",
     "threadId": "from-condition",
     "messageId": "from-condition",
     "cursor": "exact-comment-revision-from-condition",
     "outcome": "fixed",
     "evidence": "Explain the fix and the checks that verified it."
   }
   ```

   First post a revision-aware reply for a fix or answer; the server requires its
   Replied receipt before accepting completion. Change requests require `fixed`;
   questions require `answered`. Ordinary
   comments may use `acknowledged` when no action or answer is needed. An agent
   acknowledgement cannot waive a change request or question. Each response
   includes the updated `approval`; use its new cursor for the next condition.
   HTTP 409 requires a fresh snapshot and reconciliation, without blind retries.

5. Immediately before committing, read a fresh snapshot. Require `approved: true`
   and matching final capture/digest and summary versions when present. Honor the
   user's saved commit message and all existing repository checks. Conditional
   permission does not authorize extra changes made in a shared working tree.

Completion evidence stays separate from thread resolution. Addressing a comment
does not resolve or delete it. Keep the existing rule to resolve/delete only on
request.

New or edited human feedback, deletion, a reopened thread, or a changed summary
revokes approval. Resolving a thread as the reviewer confirms its included
conditions and decreases the pending count without fabricating agent receipts.
Reconcile still-Queued messages in resolved threads against that confirmation;
report Noted explicitly rather than restarting work the reviewer has closed.
Repeated approval of the same mode is idempotent, including while pending.
A changed named capture revokes as-is approval. Conditional permission with
recorded comments survives a capture update, retaining its baseline and conditions,
but agent completion attestations are cleared and must be made against the final
capture. Reviewer confirmations persist while their threads remain resolved;
when all conditions are reviewer-confirmed, approval stays ready across captures
within the approved scope. With no recorded conditions, capture updates revoke
approval as usual.
A `staged`, `working`, or `.` review records the digest of the diff the reviewer
approved. A different current diff, such as more staged hunks, revokes as-is
approval and conditional approval with no recorded conditions. `comment snapshot`
and `GET /api/approval` check the current diff before they report approval.
Conditional permission with recorded comments covers the agent's follow-up
changes, so a changed diff does not revoke it.
A restarted server that opens the same review restores its approval
([saved reviews](agent-conversations.md#saved-reviews)). Presence and browser
closure never grant approval.

Use `gavel schema approval` and `gavel schema address` for request schemas.
