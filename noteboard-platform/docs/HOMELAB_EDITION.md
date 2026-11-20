# Noteboard Homelab Edition (3.0.0-alpha.6)

The self-hosted server for Noteboard: one Docker Compose application (one CasaOS tile) that holds
everything — web app, API, background worker, MongoDB and Redis. The installation guides are in
[`deploy/`](../../deploy) (CasaOS, Docker Compose, Portainer, reverse proxies, backups, the offline
settings generator). This file explains how it works and why. Status and evidence are in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## 1. Services

```
browser / PWA / future native app ──HTTPS──► Cloudflare Tunnel or your proxy ──HTTP──► host:8765
                                                                                       │
 ┌──────────────────────── network "noteboard-web" (172.31.120.16/28) ──────────────────┼───┐
 │  noteboard-gateway  (nginx, unprivileged, port 8080 → published as 8765)  ◄──────────┘   │
 │     /            → the Angular app (boards, sign-in, /setup, /account, /admin)            │
 │     /api/, /.well-known/noteboard.json → noteboard-api:3000 (WebSocket-ready headers)    │
 │  noteboard-api  (NestJS, Node 26)          noteboard-worker (same image)                 │
 └──────────┬──────────────────────────────────────────┬────────────────────────────────────┘
 ┌──────────┴──── network "noteboard-internal" (172.31.120.0/28, no internet) ───────────────┐
 │  noteboard-mongo (MongoDB 8.0, replica set rs0, key-file auth)   noteboard-redis (Redis 8) │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
 noteboard-init (no network): runs first on every start, then exits.
```

| Image | Built from | Contents |
| --- | --- | --- |
| `ghcr.io/iampmpksamy/noteboard-server` | `apps/api/Dockerfile` | `main.js` (API), `worker.js`, `init.js`, `cli.js` — one esbuild bundle each, Node 26 Alpine, runs as uid 1000 |
| `ghcr.io/iampmpksamy/noteboard-gateway` | `apps/web/Dockerfile` | the built Angular app + nginx config (`apps/web/gateway/`), runs as uid 101 |
| `mongo:8.0.38`, `redis:8.10.3-alpine` | upstream | pinned versions |

Start order (Compose `depends_on` with conditions): init *completed* → MongoDB and Redis *healthy* →
API *healthy* → worker and gateway. Every service has a health check and `restart: unless-stopped`
(init: `no`). Only the gateway publishes a port. No container is privileged, none mounts the Docker
socket, all have `no-new-privileges`; the API and worker also run with a read-only root filesystem and
no Linux capabilities; init keeps only `CHOWN`, `DAC_OVERRIDE` and `FOWNER` to set folder owners.

The two networks use fixed small subnets (configurable) because busy hosts — including the
6DAiNAS homelab — have used up Docker's default address pools.

## 2. Automatic initialisation (idempotent)

1. **init** (root, no network): validates the configuration; refuses database/Redis folders on NFS,
   SMB, FUSE (NTFS-3G, mergerfs), FAT/exFAT or inside the container layer (data would be lost); sets
   owners — database `999:999 0700`, redis `999:1000 0700`, config/uploads/logs `1000 0750`, backups
   `1000 0700`, secrets folder `1000 0711`; creates secrets **only if missing** (32-byte random
   database, Redis and session secrets, a 256-bit encryption key, a 756-byte replica-set key). If the
   database folder has data but the secrets are missing it stops and explains, instead of making new
   passwords that would not open the old database.
2. **MongoDB** starts with `--replSet rs0 --keyFile`, and its own entrypoint creates the root user from
   the secret file on first start.
3. **API** start-up: connects as root only to initiate the replica set if needed and create/re-key the
   `noteboard` database user (readWrite + dbAdmin on its database), then reconnects as that user;
   runs pending **migrations** under a lock (a backup is taken first before any migration marked
   breaking); seeds settings from the environment; prints the one-time setup token while setup is
   open. If the database is newer than the image, it refuses to start rather than damage it.

Everything above runs on every start and changes nothing that is already right.

## 3. First-run setup and recovery

- While no administrator exists, every page leads to `/setup`, which shows the health checks and asks
  for the **setup token** (24 h, random, stored in `config/setup-token.json`, printed in the API log,
  `docker exec noteboard-api node cli.js setup-token [--new]`). Wrong tokens are rate-limited and
  audited. The first request with the right token claims setup atomically; afterwards `/api/v1/setup`
  answers 410 for good and the token file is deleted.
- The wizard then asks the administrator to turn on two-step sign-in (can be postponed; the admin
  panel stays locked until it is on).
- **Recovery** (deliberate, needs shell access to the Docker host):
  `docker exec noteboard-api node cli.js recover-admin --email you@example.com [--disable-mfa]` prints
  a single-use 2-hour password link, unlocks and re-activates the account and signs it out everywhere.
  It is audited.

## 4. Accounts and security

| Topic | Implementation |
| --- | --- |
| Passwords | argon2id (Node's built-in `crypto.argon2`, m=19 MiB, t=2, p=1; scrypt N=2¹⁷ fallback); 10–256 characters; not the e-mail address |
| Sessions | random 256-bit cookie, stored as SHA-256; `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix on HTTPS; 30 days sliding; list and revoke in `/account`; password change signs out other devices |
| CSRF | random cookie echoed in `X-CSRF-Token` on every change, plus an `Origin` check (public address or the address used) |
| Brute force | per-IP and per-e-mail limits in Redis; 10 wrong passwords lock the account for 15 minutes; limits on setup, registration, resets, MFA codes |
| Two-step sign-in | TOTP (RFC 6238, verified against the RFC vectors), codes can't be replayed, 10 single-use recovery codes; secret encrypted with AES-256-GCM. **Required for administrators** (`ADMIN_MFA_REQUIRED=true`) |
| Registration | `invite` (default), `approval`, `open`, `closed`. Invitations: single-use, 1–14 days, optionally bound to an e-mail address. No permanent tokens anywhere |
| Without e-mail | the administrator creates accounts (set-password link) or invitations and copies the links; reset links for anyone from `/admin`; users change their own password; no e-mail check blocks admin-created accounts |
| With e-mail | invitation and reset links can be mailed; `/forgot`; self-registered accounts confirm their address (48 h link) |
| Roles | `super_admin` (everything), `admin` (accounts, invitations, audit, health), `user`. Only the super admin changes roles, settings, branding, backups; nobody can demote themselves or suspend themselves |
| Privacy | every board/picture query is scoped to the signed-in user's workspace. Administrators get counts (boards, cards, picture bytes) — **no route returns another person's boards or pictures**. Tested |
| Uploads | content sniffed (pictures: PNG, JPEG, GIF, WebP, BMP, ICO — no SVG; audio: MP3, M4A, Ogg, WAV, FLAC, WebM; video: MP4/MOV, WebM), limits `MAX_UPLOAD_MB` (pictures, default 25) and `MAX_MEDIA_MB` (audio/video, default 100 — Cloudflare refuses larger requests), large bodies accepted only from signed-in sessions, video served with HTTP ranges, per-account quota, stored under server-made names, served with `Content-Security-Policy: sandbox` and `nosniff` |
| Links | `javascript:`, `data:` and other unsafe schemes in link cards are blanked on save |
| Headers | CSP (`script-src 'self'`, no inline script), `frame-ancestors 'none'`, `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy same-origin`, COOP; API answers `Cache-Control: no-store` |
| Proxies | `TRUSTED_PROXIES` (default: loopback and private ranges) decides whose `X-Forwarded-*` are believed; the `Secure` cookie follows the forwarded protocol (`COOKIE_SECURE=auto`) |
| Secrets | never in the images, the compose files, the API or the admin panel (SMTP password shown as "saved"); backups contain the encryption key and are owner-only (0600) |
| Audit | sign-ins, failures, setup, MFA, invitations, account changes, settings, branding, backups, exports, imports, console recovery |

Note: inside the containers the app runs as uid 1000, which is usually the first user on the host,
so that user can read `config/secrets`. On a single-administrator homelab that user normally also
controls Docker; keep it that way.

## 5. Data

MongoDB database `noteboard`: `users`, `sessions` (TTL), `tokens` (TTL), `workspaces` (one per
account: revision, root, trash, import records, preferences, usage counters), `boards` (one document
per board, the same JSON as the desktop `boards.json` board, plus a hash so unchanged boards aren't
rewritten), `assets` (picture records; files under `uploads/<workspace>/<random>`), `settings`,
`audit`, `backups`, `meta` (schema version, migration history and lock).

Saving: the web app sends the whole store with the revision it loaded; the API checks it in a
transaction and writes only changed boards. A save from an outdated window gets **409** and the page
says so ("Reload") instead of overwriting newer work. The header shows **Saved to server / Saving to
server… / Not saved to server**.

Bringing data in (nothing is ever overwritten; each import becomes a new board under Home):
- **Desktop `boards.json`** (+ pictures): Settings → Privacy & data, with the dry-run report,
  validation and "already imported" duplicate detection from Milestone 1, now saving to the server.
- **Boards kept in this browser** (local mode / Milestone 1): Account → "Copy into my account";
  picture names get a prefix so they can't collide.
- **Export**: Account → Download export: `boards.json` (desktop format), `prefs.json`, `images/`.

## 6. Connection modes

| | Mode A — Cloudflare Tunnel | Mode B — own proxy / static IP | Mode C — LAN / Tailscale |
| --- | --- | --- | --- |
| Public address | `https://notes.6dainas.cloud` | `https://notes.example.com` | `http://10.0.0.2:8765` or `https://<host>.<tailnet>.ts.net` |
| What forwards | your existing cloudflared (no new tunnel, no API token) | Nginx / Caddy / NPM (`deploy/nginx/`) | nothing, or `tailscale serve` |
| Bind | `0.0.0.0:8765` (or `127.0.0.1` when cloudflared runs on the same host) | `127.0.0.1:8765` if the proxy is local | `0.0.0.0:8765` |

HTTPS, `Secure` cookies, WebSockets (headers passed), upload limits and correct links work the same in
all three. Plain HTTP on the LAN is meant for the first setup and trusted networks; use HTTPS for daily
use and for installing the PWA. Ports 80/443 are never taken by Noteboard.

For Mode A on the 6DAiNAS host (locally managed tunnel `homelab.6dainas.cloud`):
add `- hostname: notes.6dainas.cloud` / `service: http://localhost:8765` above the final
`http_status:404` rule in `/etc/cloudflared/6dainas.cloud/homelab.6dainas.cloud-config.yml`, run
`cloudflared tunnel route dns homelab.6dainas.cloud notes.6dainas.cloud`, restart cloudflared. Add a
Cloudflare cache rule "bypass" for `notes.6dainas.cloud/api/*` (the API already sends `no-store`).

## 7. PWA and future native apps

- `manifest.webmanifest`, original icons (`tools/make_icons.py`), and `sw.js`, registered only over
  HTTPS (or localhost) when a server is present. The worker caches the app shell and hashed files only;
  it never caches `/api/` (boards, pictures, sessions).
- **Discovery** for clients: `GET /.well-known/noteboard.json` and `GET /api/v1/discovery` →
  `product`, `apiVersion` (1), `minClientApiVersion`, `serverVersion`, app name, public address,
  setup/registration state, features (e-mail, MFA, upload limit), admin path. The web app shows a
  "needs a newer version" banner when `minClientApiVersion` is above its own.
- The future Tauri (Windows) and Capacitor (Android, iOS/iPadOS) apps will ask for the server address
  (e.g. `https://notes.6dainas.cloud`), check discovery, and use the same API — no central Noteboard
  cloud. The shared `StorageAdapter` (`ServerStorage` in `apps/web/src/app/server/api.ts`) is the piece
  they reuse. **No native app was built in this milestone.**

## 8. Backups

See [`deploy/backup/README.md`](../../deploy/backup/README.md). In short: the worker writes
`noteboard-backup-<UTC time>-<kind>.tar.gz` (every collection as Extended JSON, all uploads, the keys,
a manifest) daily at `BACKUP_TIME` in `TZ`, and on demand from `/admin → Backups`; retention keeps the
newest per day/ISO week/month (7/4/6 by default) and the last 10 manual; restoring is a console
command with `--confirm`, refuses to overwrite an instance that has accounts unless `--replace`
(which takes a pre-restore backup first), and is designed to be tried in a separate test instance.

## 9. Upgrades

Change the image tags (CasaOS: app settings; Compose: `.env` or the file) and recreate. Data folders
are untouched; migrations run at start under a lock; a breaking migration takes a backup first.
**Rollback:** older images refuse a database whose schema is newer; to go back, restore the backup
made before the upgrade into the older version. Schema 1 is the first server release, so there are no
older server versions to roll back to yet.

**Upgrading to 3.0.0-alpha.6 (new card kinds):** only the image tags need to change. New settings
have safe defaults: `MAX_MEDIA_MB=100` (audio/video size), `MAP_PROVIDER=osm` (map cards fetch map
pictures and place search from OpenStreetMap **through this server**, which therefore needs outbound
internet; `MAP_PROVIDER=off` turns maps off — see MAPS.md). The gateway keeps an older
`NB_MAX_UPLOAD_MB` working and uses the larger of the picture and audio/video limits. The legacy
desktop app 2.x can't read boards containing the new card kinds.

## 10. Limits of this release

- Saving is whole-store with revision check; changes from two windows or devices are merged
  (OFFLINE_SYNC.md). Real-time collaboration is a future milestone.
- Backups are logical (Extended JSON); very large databases take longer than `mongodump` would.
- S3 storage uses a built-in minimal SigV4 client; it was **not** tested against a real S3 service.
- ARM64 images are not built (not validated).
