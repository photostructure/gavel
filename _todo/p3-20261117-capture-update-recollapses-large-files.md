---
title: A capture update re-collapses every large file, including one the reviewer loaded
priority: p3
section: Web UI
---

# A capture update re-collapses large files

Placeholder. Not started.

`largeFilesKey` (`src/client/App.tsx`) includes the capture version, so
when the agent runs `gavel review update` on the open review, every file over the large-diff
limit collapses again, including one the reviewer opened with **Load diff**. A reviewer reading
inside such a file loses their place. Found by reading the code during the scroll-position fix
(`p1-20261112-review-update-scrolls-to-top.md`); not reproduced in a browser.

Decide whether a file the reviewer loaded should stay open across a new capture of the same
review, then fix test-first.
