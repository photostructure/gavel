# Addressing a running server

Companion commands default to `localhost`. When the server listens only on a
specific interface, select that interface explicitly:

```sh
gavel comment snapshot --host 10.1.1.24 --port 4966
gavel comment reply --host 10.1.1.24 --port 4966 < /tmp/reply.json
gavel wait --host 10.1.1.24 --port 4966
```

Use the actual host and API port from `server.ready.url` or the equivalent background launch URL. `--host`
is available on every `comment` command, `wait`, and named-review `create` and `update`. Use
the gavel launcher prescribed by the checkout's instructions. An explicit
host changes the connection destination; it does not rebind or restart the server.
These companion commands use HTTP. IPv6 hosts may be supplied with or without
brackets. Do not put a URL scheme, credentials or path in `--host`.

Message IDs, exact revision cursors, capture guards and explicit delivery receipts
work the same way regardless of the chosen interface. A server bound to a LAN
address is not inherently inaccessible to an agent; use its actual address rather
than falling back to a chat-only reply.

## HTTPS and remote browsers

The browser's [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText)
requires a secure context. Localhost is treated as trustworthy for local development;
a remote HTTP address such as `http://10.1.1.24:4966` generally is not. gavel tries a
legacy copy fallback, but trusted HTTPS is the reliable setup for remote browsers.
Browser permissions can still prevent copying.

Start the built gavel server on the machine containing the repository:

```sh
gavel . --host localhost --port 4966 --no-open --keep-alive
```

Use the actual port printed at startup if 4966 is occupied. From a source checkout,
run `pnpm build`, then use `node dist/cli/index.js` in place of `gavel`.
Proxy this server, which serves both the UI and `/api`, at the root of one HTTPS
origin. The development server (`pnpm dev`, usually port 5173) can embed a localhost
API address for event streams, so it is not the target for these recipes.

The proxy must stream Server-Sent Events (SSE) on `/api/watch` and `/api/heartbeat`
without buffering or caching. `--keep-alive` prevents a dropped browser connection
from ending the review. gavel has no built-in login: anyone who can reach the
service can access the review and its enabled actions. Use an authenticated proxy
for private repositories; HTTPS alone does not restrict access.

### Cloudflare Tunnel (`cloudflared`)

For ongoing remote reviews, use a [named Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/)
with a hostname such as `review.example.com`, routed to service type HTTP at
`localhost:4966`. Configure a Cloudflare Access policy for the intended reviewers
before exposing private code, and open the resulting HTTPS hostname. Keep `/api/*`
uncached and confirm live updates using the checks below.

For a temporary preview, an installed `cloudflared` can create a Quick Tunnel:

```sh
cloudflared tunnel --url http://localhost:4966
```

Open the HTTPS URL printed by the command. However, [Quick Tunnels do not support
SSE](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), which
gavel uses for live updates. They are unsuitable for the full conversation workflow:
a page loading and Copy working do not establish that replies or approval changes
will update live. The URL is public unless access restrictions are configured.

### localtunnel

With [localtunnel](https://github.com/localtunnel/localtunnel), run a second process:

```sh
pnpm dlx localtunnel --port 4966 --local-host localhost
```

Open its printed HTTPS URL. This exposes the review through a third-party service;
use non-sensitive diffs for a public preview. Verify streaming replies and updates
before relying on a hosted tunnel for a review. Stop the tunnel when finished.

### local-ip.sh on a LAN

[local-ip.sh](https://local-ip.sh/) provides DNS names for IP addresses. For example,
`10-1-1-24.local-ip.sh` resolves to `10.1.1.24`. The reviewing device must be able to
reach that address; this does not create a tunnel or turn gavel's HTTP server into
an HTTPS server.

Run a TLS reverse proxy on the repository machine. For example, with Caddy installed,
use this `Caddyfile`, replacing the address with that machine's LAN IP:

```caddyfile
https://10-1-1-24.local-ip.sh:8443 {
    tls internal
    reverse_proxy localhost:4966
}
```

Run `caddy run --config Caddyfile`, allow the reviewing device to reach port 8443,
and open `https://10-1-1-24.local-ip.sh:8443`. Caddy's `tls internal` uses a local CA;
install and trust its root certificate on each reviewing device before using the
page. Alternatively, configure a certificate trusted by those devices with Caddy's
[`tls` directive](https://caddyserver.com/docs/caddyfile/directives/tls).
[Caddy streams SSE responses](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).

local-ip.sh also publishes a wildcard certificate and its private key. Because that
key is public, use your own certificate for private code. The hostname alone,
or bypassing a certificate warning, is not a substitute for trusted HTTPS.

### Check copying and live conversations

Open the HTTPS page without a certificate warning, click Copy Prompt, and paste
into a text editor. For conversations, start foreground gavel with `--keep-alive`
on the repository machine and retain its JSONL stdout. Submit a comment from the
remote browser, verify it appears in the launch output, then send a
[reply](agent-conversations.md) and confirm it appears without refreshing.
Agent commands still connect to localhost on the repository machine; the browser
can use the HTTPS proxy. They do not acquire remote-host support from the URL.
