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

## HTTPS and remote browsers

Use trusted HTTPS for remote browsers: clipboard access requires a secure
context. Localhost qualifies; a remote HTTP address generally does not.

Start the built gavel server on the machine containing the repository:

```sh
gavel . --host localhost --port 4966 --no-open --keep-alive
```

Use the actual port printed at startup if 4966 is occupied. From a source checkout,
run `pnpm build`, then use `node dist/cli/index.js` in place of `gavel`.
Proxy this server, which serves both the UI and `/api`, at the root of one HTTPS
origin. The development server (`pnpm dev`, usually port 5173) can embed a localhost
API address for its live connection, so it is not the target for these recipes.

The proxy must pass WebSocket upgrades on `/api/live`, which carries each tab's live
updates and presence, and must not cache `/api/*`. `--keep-alive` prevents a dropped browser connection
from ending the review. Without the access token from the launch link, a browser
sees only an access screen and `/api/*` answers 401, but the token is a shared
secret, not a login: anyone holding a launch link can access the review and its
enabled actions. Image and video requests and the `/api/live` upgrade carry the
token in their query string, so keep the proxy from logging query strings. Use
an authenticated proxy for private repositories; HTTPS alone does not restrict
access.

The launch link names `localhost`, so a reviewing device opens the proxy's origin
instead, keeping the launch link's query and `#gavel-token=…` fragment: for
`http://localhost:4966/?review=parser-fix#gavel-token=<token>`, open
`https://review.example.com/?review=parser-fix#gavel-token=<token>`. The token is
also in `~/.gavel/access-token` on the repository machine. That browser then
remembers the token for the proxy's origin.

### Cloudflare Tunnel (`cloudflared`)

For ongoing remote reviews, use a [named Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/)
with a hostname such as `review.example.com`, routed to service type HTTP at
`localhost:4966`. Configure a Cloudflare Access policy for the intended reviewers
before exposing private code, and open the resulting HTTPS hostname with the launch
link's query and token fragment, as above. Keep `/api/*`
uncached and confirm live updates using the checks below.

[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
have not been checked with gavel's WebSocket connection.

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
and open `https://10-1-1-24.local-ip.sh:8443/#gavel-token=<token>`, adding the launch
link's query if it has one. Caddy's `tls internal` uses a local CA;
install and trust its root certificate on each reviewing device before using the
page. Alternatively, configure a certificate trusted by those devices with Caddy's
[`tls` directive](https://caddyserver.com/docs/caddyfile/directives/tls).
[Caddy passes WebSocket connections through](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming).

local-ip.sh also publishes a wildcard certificate and its private key. Because that
key is public, use your own certificate for private code. The hostname alone,
or bypassing a certificate warning, is not a substitute for trusted HTTPS.

### Check copying and live conversations

Open the HTTPS page without a certificate warning, adding the token fragment on
the first visit. Choose Copy prompt from a comment's ⋯ menu, and paste into a text editor. For conversations, start foreground gavel with `--keep-alive`
on the repository machine and retain its JSONL stdout. Submit a comment from the
remote browser, verify it appears in the launch output, then send a
[reply](agent-conversations.md) and confirm it appears without refreshing.
Agent commands still connect to localhost on the repository machine; the browser
can use the HTTPS proxy. They do not acquire remote-host support from the URL.
