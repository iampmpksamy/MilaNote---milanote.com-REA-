# Putting Noteboard behind HTTPS

Noteboard listens on one HTTP port (8765 by default) and never takes 80/443.

| Way | File |
| --- | --- |
| Cloudflare Tunnel (your existing one) | no file here — see `../installer` "Connection steps" or `noteboard-platform/docs/HOMELAB_EDITION.md` §6 |
| Your own Nginx / Nginx Proxy Manager | `reverse-proxy.conf` |
| Direct HTTPS with automatic certificates (only if 80/443 are free) | `Caddyfile.direct-https` |
| Tailscale | `tailscale serve --bg --https=443 http://127.0.0.1:8765` |

Whatever sits in front must pass `Host`, `X-Forwarded-For`, `X-Forwarded-Proto` and the WebSocket
`Upgrade`/`Connection` headers, allow uploads up to `MAX_UPLOAD_MB`, and have a private address (so
Noteboard trusts its forwarded headers; see `TRUSTED_PROXIES`). Then set the public address to the
HTTPS address in `/admin → Settings`.

The gateway's own configuration (inside the `noteboard-gateway` image) is in
`noteboard-platform/apps/web/gateway/`.
