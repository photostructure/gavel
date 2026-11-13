---
title: Report it when comment add skips a thread whose ID was deleted
section: Server and CLI
---

# Report it when comment add skips a thread whose ID was deleted

Placeholder; the cause on the server is not yet traced.

`gavel comment add` answered `{"success":true,"count":1,"warnings":[]}` for a
thread whose ID had been removed with `gavel comment delete` earlier in the
same server run, yet the thread never appeared in `gavel comment snapshot` or
the page. An agent fixing a guide comment by deleting and re-adding it under
the same ID gets no sign that the new thread was dropped, and links to that ID
stay broken.

Seen on 2026-11-13 on a running named review (`no-close`): `comment delete
noclose-copy`, then `comment add` with `"id":"noclose-copy"` on the same file
and line. Re-adding under a new ID worked.

The add should either create the thread or say why it did not, through the
`warnings` field or an error.
