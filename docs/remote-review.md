# Remote review

To review from a phone or another computer, put gavel behind an HTTPS proxy or
tunnel on the machine that holds the repository.

## What the access token protects

Every request for review data needs the access token from the launch link
(`#gavel-token=…`, also kept in `~/.gavel/access-token`, or `$GAVEL_CONFIG_DIR/access-token`
when that is set). Without it, a browser sees an
access screen and `/api` answers 401. The token is 128 random bits, all of your gavel
servers share it, and it lasts until you delete that file and restart them. Anyone who
gets a launch link, say from a chat log, a screenshot, or shell history, can read and act
on every review you serve until then. To limit who can reach gavel at all, add an
authenticated proxy such as Cloudflare Access or Tailscale.

The token controls network access; gavel does not isolate reviews from other OS users
on the same workstation. Those users may be able to read a browser launch URL in process
arguments. After a server stops, another local process can reuse its port and receive a
token from an open tab's retries, or read the origin's browser storage after a reload.
Deleting the token file does not revoke the copy held by a running server: stop every
server when rotating it.
The same OS-account boundary applies to Windows named pipes: an SMB client with pipe-write
permission can reach the control pipe. Possessing the gavel token alone does not grant that
OS permission.

## What the proxy must do

- Serve HTTPS. The token travels in the `X-Gavel-Token` header of every API request
  and in the query string of image, video, and `/api/live` requests, so plain HTTP
  exposes it to the network.
- Proxy the built server, which serves both the UI and `/api`, at the root of one
  origin. The `pnpm dev` server is not a target.
- Pass WebSocket upgrades on `/api/live`, which carries live updates and presence.
- Not cache `/api/*`, and not log query strings.

Start the server on the repository machine with `--keep-alive`, so a dropped browser
connection does not end the review:

```sh
gavel . --no-open --keep-alive
```

gavel picks its own port between 10081 and 32767, hashed from the repository and the
agent session that launched it, or from the repository alone when you start it from a
terminal, and takes the next free port when that one is busy. Point the proxy at the
port in the launch link it prints. A restart for the same repository and session
usually gets the same port, but another agent session gets another port, so check each
new launch link: every gavel server accepts the same token, so a proxy left on an old
port serves that server's review without an error.

Open the proxy's origin with the launch link's query and token fragment: for
`http://127.0.0.1:<port>/?review=parser-fix#gavel-token=<token>`, open
`https://review.example.com/?review=parser-fix#gavel-token=<token>`. The browser
remembers the token for that origin. Agent commands keep talking to 127.0.0.1 on the
repository machine.

Run agent-owned `gavel review create` and `gavel pending` on the repository machine.
They assign feedback to an agent session through a local socket. Review access over HTTP,
including through a loopback proxy, cannot name an agent chat or inbox.

## Cloudflare Tunnel

Create a [named Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/)
with a hostname such as `review.example.com`, routed to service type HTTP at
`127.0.0.1:<port>`. Add a Cloudflare Access policy for your reviewers to put a login in
front of the token. [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
have not been checked with gavel's WebSocket connection.

## Caddy on a LAN

[local-ip.sh](https://local-ip.sh/) gives each IP address a DNS name, such as
`10-1-1-24.local-ip.sh` for `10.1.1.24`. With [Caddy](https://caddyserver.com/)
installed on the repository machine, use this `Caddyfile` with that machine's LAN IP
and gavel's port:

```caddyfile
https://10-1-1-24.local-ip.sh:8443 {
    tls internal
    reverse_proxy 127.0.0.1:<port>
}
```

Run `caddy run --config Caddyfile` and allow the reviewing device to reach port 8443.
`tls internal` uses Caddy's local CA, so install and trust its root certificate on each
reviewing device, or configure a certificate they already trust with Caddy's
[`tls` directive](https://caddyserver.com/docs/caddyfile/directives/tls).
local-ip.sh also publishes a wildcard certificate, but its private key is public, so it
does not keep the token private.

## Check the setup

Open the HTTPS page with no certificate warning, adding the token fragment on the first
visit. Choose **Copy prompt** from a comment's ⋯ menu and paste it into a text editor.
Add a comment from the remote browser, and confirm that the agent's reply appears
without a refresh.

SVG previews remain images. Opening a repository SVG directly uses an isolated document
with scripts and external resources blocked; inline styles and embedded data images remain
available.
