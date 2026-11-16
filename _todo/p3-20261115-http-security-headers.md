---
title: The server sends no HTTP security headers
priority: p3
section: Server
---

# The server sends no HTTP security headers

Placeholder. Not started.

`src/server/server.ts` sets no `Content-Security-Policy`, `X-Content-Type-Options`,
`frame-ancestors`/`X-Frame-Options`, or `Referrer-Policy` on the UI, the static assets, or
`/api`, and Express still sends `X-Powered-By: Express`. No exploit depends on this alone; it
leaves nothing to contain a script that reaches the gavel origin, where the localStorage token
authorizes every API call.

Fix direction:

- `/api/blob`: `Content-Security-Policy: sandbox; default-src 'none'` and
  `X-Content-Type-Options: nosniff`. This also closes the 2026-11-15 Codex security report's
  finding that a repository SVG opened in its own tab (from the token-bearing `/api/blob` URL)
  runs script on the gavel origin. No plan here records that finding yet;
  `p4-20261112-svg-rendered-source-views.md` covers only SVGs shown in `<img>`.
- UI: a CSP with `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, and an
  `img-src` that still allows the remote Markdown images the UI loads today (or decide to stop
  loading them; see `p3-20261115-markdown-off-origin-urls.md`). Check Mermaid's inline styles
  and the theme bootstrap script against it.
- Everywhere: `Referrer-Policy: no-referrer`, and `app.disable('x-powered-by')`.
