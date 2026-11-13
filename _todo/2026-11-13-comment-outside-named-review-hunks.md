---
title: Refuse or place a comment anchored outside a named review's hunks
section: Server and CLI
---

# Refuse or place a comment anchored outside a named review's hunks

Placeholder; the fix is not designed.

A named review shows only its captured hunks, numbered as the patch numbers
them. `--comment` at launch and `gavel comment add --review <name>` both accept
a thread on a line outside every hunk and answer `"success": true` with no
warning. The thread then appears in Conversation, but clicking it cannot open
it in the diff, because the diff has no such line.

Seen on 2026-11-13 with the `no-close` review: an agent placed a guide comment
on `src/client/App.tsx` line 1593, taken from the file after applying the patch
to a newer `main`. The patch numbers that line 1534, inside a hunk covering new
lines 1531–1537, so line 1593 is in no hunk. The reviewer could not open the
comment.

Since `ab253fc`, a named review whose patch names its blobs loads the lines around
its hunks, so a comment outside every hunk opens when its line exists in the captured
file. That makes the example above fail quietly: the captured `App.tsx` has a line
1593, so the comment opens on the wrong line. A comment still cannot open on a line
past the end of the captured file or in a file marked `contextUnavailable`, and gavel
cannot tell a line number taken from a different version of the file.

Decide between refusing such a comment with an error that names the file's hunk
ranges, and accepting it as a review-level comment.
