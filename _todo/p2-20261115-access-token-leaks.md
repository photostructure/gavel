---
title: Reduce accidental disclosure of the per-user access token
priority: p2
section: Access token
---

# Reduce accidental disclosure of the per-user access token

Implementation not started. The accepted local-workstation limitations are documented in
`docs/remote-review.md`.

One token in `~/.gavel/access-token` opens every gavel server the user runs and never rotates,
so a leaked token exposes all of them until that file is deleted and every running server is
restarted: a server keeps the token it started with in memory (`startServer` in
`src/server/server.ts`), so deleting the file only changes the token for later launches.

Decision (2026-11-15, question 7D-2, accepted as recommended): keep the shared per-user token
and close each leak, rather than switching to per-server tokens.

Scope decision (2026-11-15, Matthew): gavel does not need to defend against other OS users
on the local workstation. Take simple fixes where practical; document the remaining local
exposure rather than adding machinery for it. Keep the shared per-user token. Accidental
disclosure through copied review URLs and links in untrusted review content remains in scope.

## Planned fixes

1. Another local user can listen on `[::1]:<port>` and capture the launch link. Without
   `--host`, `listen(port, 'localhost')` binds only `127.0.0.1` on Debian/Ubuntu hosts whose
   `/etc/hosts` maps `::1` to `ip6-localhost`, but the launch URL says `http://localhost:P`
   (`startServerWithFallback` in `src/server/server.ts`), and Chrome connects to `::1` first.
   gavel's IPv4 bind still succeeds, so it never falls back to another port. The port is a
   hash of the repository path (`firstPort`) and is visible in `/proc/net/tcp`. Reproduced with
   headless Chrome 157: the squatter's page read the token, which then fetched `.env` from the
   real server. Firefox connected to `127.0.0.1`. Cheap correction: normalize the default and
   explicit `localhost` bind to `127.0.0.1`, and put `127.0.0.1` in `url` and `launchUrl`;
   the same applies to the `0.0.0.0` → `localhost` display substitution. Preserve explicit
   LAN addresses. Update launch-link examples in the docs. This fixes an address mismatch;
   it does not establish isolation from other local users.
2. The token stays in the address bar and every history entry: `getAccessToken`
   (`src/client/utils/accessToken.ts`) never strips the fragment, and `withLinkPlace`
   (`src/client/utils/commentLinks.ts`) copies the token into each fragment it pushes, so a
   copied page URL hands out the token. Fix: `history.replaceState` without `gavel-token` once
   the token is stored, and stop `withLinkPlace` carrying it.
3. Any Markdown link to `#gavel-token=X`, or any website navigating to
   `http://localhost:P/#gavel-token=X`, replaces the stored token: `getAccessToken` writes any
   fragment token to localStorage on every call, and the `hashchange` listener only makes the
   page re-read it. The next request gets a 401 and the page shows the access screen.
   Availability only. Fix: render Markdown hrefs whose fragment names `gavel-token` as text.
   Reading a fragment token stays, because opening a new launch link in an open tab relies on
   it; a website's top-level navigation can still log the tab out, which costs reopening the
   launch link.

## Accepted local-workstation limitations

- `open(launchUrl)` passes the token-bearing URL to `xdg-open` (macOS: `open`). Where process
  arguments are visible to other OS users, those users may read the token. A newly launched
  browser may retain it in its arguments for its lifetime. Defer the proposed private HTML
  redirect file: its permissions, cleanup, and browser-launch lifecycle are not justified by
  the local-user threat in scope.
- After a server exits, its open tab retries the live WebSocket five times with
  `?gavel-token=` (`src/client/utils/liveConnection.ts`), so a process that binds the freed
  port receives the token (traced in code, not run). Stripping the page fragment does not fix
  this, because the client also reads the token from localStorage.
- The browser retains the token in localStorage for that origin. A replacement server at
  the same origin can serve JavaScript that reads it when the reviewer reloads the page.

These limits are documented alongside the token and remote-review guidance in `docs/remote-review.md`:
the token controls network access to gavel; it does not isolate a review from other OS users
on the same workstation. A leaked token remains valid for running servers until they are
stopped, even if the token file is deleted.

## Acceptance checks

- Default and explicit-localhost launches advertise the literal loopback address; explicit
  LAN hosts retain their address.
- Consuming a launch token removes only `gavel-token` from the address bar. Review selection,
  file/thread location, and ordinary anchors still work. Subsequent review navigation does
  not copy the token into history entries.
- A legitimate new launch link still updates an already open tab's token. Token-bearing
  Markdown links render as text in comments, Markdown previews, and notebook Markdown cells;
  ordinary links still work.
- Walk Matthew through the changed URL and preview behavior before proposing its commit.
