---
title: Complete HTTP security headers
priority: p3
section: Server
---

# Complete HTTP security headers

Partially complete. Repository blob isolation landed in `06aa96a`; UI and shared
response headers remain.

## Completed

- `/api/blob` sends `Content-Security-Policy: sandbox; default-src 'none'; style-src
  'unsafe-inline'; img-src data:` and `X-Content-Type-Options: nosniff`. Directly opened
  repository documents cannot execute scripts or access the review origin; image previews
  retain inline styles and embedded data images. External resources are blocked.
- Regression: `src/server/server.test.ts`, `sandboxes untrusted blob documents` covers SVG
  and HTML-named blobs. Matthew passed the SVG play test in Firefox and Chrome.

## Remaining

The UI and other responses still lack the headers below, and Express still sends
`X-Powered-By: Express`. This leaves no document policy to contain a script that reaches
the UI origin, where the localStorage token authorizes API calls.

- UI: a CSP with `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, and an
  `img-src` that still allows the remote Markdown images the UI loads today (or decide to stop
  loading them; see the remote-image bullet below). Check Mermaid's inline styles and the theme
  bootstrap script against it.
- Everywhere: `Referrer-Policy: no-referrer`, and `app.disable('x-powered-by')`.
- Remote images in comments, PR comments, repository Markdown, and notebooks load as soon as
  the view renders. With no Referrer-Policy, each image host receives the gavel origin in the
  `Referer` header, and that origin names the tunnel hostname when gavel runs behind a tunnel.
  `Referrer-Policy: no-referrer` stops that leak; the maintainer still has to decide whether
  remote images keep loading without a click.

The SVG source/rendered-view work remains separate in
`p4-20261112-svg-rendered-source-views.md`.

## Working log

- 2026-11-19, Codex `01a1dd62-e525-76b2-9a1c-00aca968960c`: the archive audit caught this
  placeholder still describing the landed blob policy as unstarted. Updated its status;
  no security implementation changes remain uncommitted from this session.
