---
title: The refresh button says "New commits available" for a working-tree change
priority: p4
section: Web UI
---

# Refresh button names the wrong kind of change

Placeholder. Not started.

Reviewing the working tree (`gavel . --keep-alive`) and creating a new file in it highlighted
the refresh button with the tooltip "New commits available - Click to refresh". No commit was
made. `ReloadButton.tsx` picks that text when the watcher reports `changeType: 'commit'`, so the
watcher (or whatever sets `changeType`) classified a working-tree file change as a commit. Seen
in headless Chromium on 2026-11-16; the classification code is not traced.

Fix test-first: a working-tree file change reports `file`, and the tooltip says "File changes
detected".
