---
title: Close the paths that leak the per-user access token
priority: p2
section: Access token
---

# Close the paths that leak the per-user access token

Placeholder. Not started.

One token in `~/.gavel/access-token` opens every gavel server the user runs and never rotates,
so each leak below exposes all of them until that file is deleted and every running server is
restarted: a server keeps the token it started with in memory (`startServer` in
`src/server/server.ts`), so deleting the file only changes the token for later launches.

Decision (2026-11-15, question 7D-2, accepted as recommended): keep the shared per-user token
and close each leak, rather than switching to per-server tokens.

1. Another local user can listen on `[::1]:<port>` and capture the launch link. Without
   `--host`, `listen(port, 'localhost')` binds only `127.0.0.1` on Debian/Ubuntu hosts whose
   `/etc/hosts` maps `::1` to `ip6-localhost`, but the launch URL says `http://localhost:P`
   (`startServerWithFallback` in `src/server/server.ts`), and Chrome connects to `::1` first.
   gavel's IPv4 bind still succeeds, so it never falls back to another port. The port is a
   hash of the repository path (`firstPort`) and is visible in `/proc/net/tcp`. Reproduced with
   headless Chrome 157: the squatter's page read the token, which then fetched `.env` from the
   real server. Firefox connected to `127.0.0.1`. Fix: listen on `127.0.0.1` and put
   `127.0.0.1` in `url` and `launchUrl`; the same applies to the `0.0.0.0` → `localhost`
   display substitution. Update `docs/` text that says the launch link names `localhost`.
2. `open(launchUrl)` runs `xdg-open http://localhost:P/#gavel-token=T` (macOS: `open`), and
   `/proc/<pid>/cmdline` is world-readable when `/proc` lacks `hidepid`. When that call starts
   the browser, the browser's argv keeps the token for its lifetime. Fix: open a 0600 local
   HTML file that redirects to the launch URL, as Jupyter does, instead of passing the token on
   a command line.
3. The token stays in the address bar and every history entry: `getAccessToken`
   (`src/client/utils/accessToken.ts`) never strips the fragment, and `withLinkPlace`
   (`src/client/utils/commentLinks.ts`) copies the token into each fragment it pushes, so a
   copied page URL hands out the token. Fix: `history.replaceState` without `gavel-token` once
   the token is stored, and stop `withLinkPlace` carrying it.
4. Any Markdown link to `#gavel-token=X`, or any website navigating to
   `http://localhost:P/#gavel-token=X`, replaces the stored token: `getAccessToken` writes any
   fragment token to localStorage on every call, and the `hashchange` listener only makes the
   page re-read it. The next request gets a 401 and the page shows the access screen.
   Availability only. Fix: render Markdown hrefs whose fragment names `gavel-token` as text.
   Reading a fragment token stays, because opening a new launch link in an open tab relies on
   it; a website's top-level navigation can still log the tab out, which costs reopening the
   launch link.

Not covered here: after a server exits, its open tab retries the live WebSocket five times
with `?gavel-token=` (`src/client/utils/liveConnection.ts`), so a process that binds the freed
port receives the token (traced in code, not run).
