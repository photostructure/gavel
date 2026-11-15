---
title: Stop a stale dev tab from adding its review to, or shutting down, the next dev server
priority: p3
section: Server
---

# Stale dev tab reconnects to the next dev server

Seen on 2026-11-13 while running `pnpm run dev <sha>` several times in a row, with each run's tab left open at `http://localhost:5173/`. Each run got the same API port, so Vite proxied the old tabs to the new server. Two effects showed up in the server's JSONL output:

1. A leftover tab created a review for its old selection on the new server. Running `pnpm run dev 553cabd` logged a second `review.summary`, for review `aee2d199` with selection `565bb44` → `15cb7dc`, ten seconds after start. That selection came from the previous run's tab. The same thing happened once before, with review `61a807f7`.
2. A server started without `--keep-alive` exited on its own 1.4 seconds after start, logging `Client disconnected, shutting down server...` 68 ms after the stale tab's `review.summary`. [server.ts](../src/server/server.ts) shuts down 100 ms after the last live tab disconnects, if no tab has reconnected by then. The likely cause is that every tab reloaded at once (because Vite restarted, or because the client saw a new server ID) and none reconnected within 100 ms. This explanation was not reproduced or measured.

At the time, another session had uncommitted edits to `src/client/utils/liveConnection.ts` and `src/client/hooks/useFileWatch.ts`, and `pnpm run dev` served them. The maintainer chose to reproduce this after those edits land (two dev runs back to back in the built-in browser, first tab left open), and to fix whatever still happens test-first.
