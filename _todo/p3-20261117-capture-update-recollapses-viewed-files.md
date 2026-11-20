---
title: A capture update re-collapses files the reviewer marked viewed
priority: p3
section: Web UI
---

# A capture update re-collapses viewed files

Placeholder. Not started.

`commentsCaptureKey` (`src/client/App.tsx`) changes with every capture
version, and the reset it triggers re-collapses viewed files when the agent runs
`gavel review update` on the open review. A reviewer who had expanded a viewed file to read it
loses their place. Found by reading the code during the scroll-position fix
(`p1-20261112-review-update-scrolls-to-top.md`); not reproduced in a browser.

Decide whether the viewed-file collapse should run again for a new capture of the same review,
then fix test-first.
