# Noteboard on CasaOS (one app tile)

Noteboard Homelab Edition installs as **one CasaOS app** that runs six containers together:

| Container | What it does | Published? |
| --- | --- | --- |
| `noteboard-gateway` (main, the tile) | Web app, `/admin`, proxy to the API, security headers | **Yes — the only one** (host port 8765 → 8080) |
| `noteboard-api` | Accounts, boards, pictures, admin API | No |
| `noteboard-worker` | Scheduled backups and retention | No |
| `noteboard-mongo` | MongoDB 8.0 (single-node replica set, key-file auth) | No (internal network, no internet) |
| `noteboard-redis` | Redis 8 (password, append-only file) | No (internal network, no internet) |
| `noteboard-init` | Runs once per start: checks folders, sets owners, creates secrets, then exits | No (no network at all) |

Nothing else has to be installed: no separate database app, identity server, file server or mail server.
No container is privileged and none gets the Docker socket.

## Before installing

1. Optional: open `deploy/installer/index.html` in a browser (works offline; sends nothing) to choose
   the app name, public address, port, data folder, time zone, registration mode, e-mail, S3 and
   backups. It produces the CasaOS YAML. The ready-made `docker-compose.yml` in this folder uses the
   defaults below.
2. Make sure the data folder is on a **local Linux filesystem** (ext4, XFS, Btrfs, ZFS). MongoDB and
   Redis refuse to start on NFS/SMB shares, NTFS/exFAT/FAT or FUSE (mergerfs) — the init container
   checks this and explains.

| Setting | Default |
| --- | --- |
| Tile / host port | `8765` (published on `0.0.0.0:8765`, container port 8080) |
| Data folder | `/DATA/AppData/noteboard/{config,database,redis,uploads,backups,logs}` |
| Time zone | `Asia/Kolkata` |
| Registration | `invite` (only the administrator can let people in) |
| E-mail | off (invitation and password links are copied from `/admin`) |
| Pictures | local folder (`uploads`); S3-compatible bucket optional |
| Admin panel | `/admin` (two-step sign-in required) |
| Public address | `https://notes.6dainas.cloud` (change it in the YAML or later in `/admin`) |

## Install

CasaOS → App Store → **+** (top right) → **Install a customized app** → **Import** → paste the
contents of `docker-compose.yml` → **Submit** → check the settings → **Install**.

CasaOS pulls `ghcr.io/iampmpksamy/noteboard-server` and `noteboard-gateway` (plus `mongo` and
`redis`). Startup order is automatic: init → MongoDB and Redis (healthy) → API (healthy) → worker and
gateway. The first start takes about a minute.

## First run

1. Click the **Noteboard** tile (opens `http://<server>:8765/`). You land on **Set up Noteboard**.
2. Get the one-time setup token — any of:
   - CasaOS → Noteboard → ⋮ → **Logs** → container `noteboard-api` (look for "setup token"),
   - `docker exec noteboard-api node cli.js setup-token`,
   - the file `/DATA/AppData/noteboard/config/setup-token.json`.
   It expires after 24 hours; restart the app (or `setup-token --new`) for a fresh one.
3. Enter the token, your name, e-mail and password (10+ characters), and the public address.
4. Turn on two-step sign-in (any authenticator app). The admin panel stays locked until you do.
5. Invite people from **/admin → Invitations** (copy the link; it works once).

## Everyday

- Updates: change the two image tags to the new version in CasaOS (app settings) and save. A backup is
  taken automatically before any database change that older versions couldn't read.
- Backups: daily at 03:00, kept 7 daily / 4 weekly / 6 monthly; **Back up now** in `/admin → Backups`.
  Copy them to another machine too — see `deploy/backup/README.md`.
- Uninstalling the app in CasaOS removes the containers; the data folder stays unless you delete it.

## Other ways to install the same thing

- **Portainer** → Stacks → Add stack → paste this file (values are written in) → Deploy.
- **Docker Compose** → `deploy/compose/` (`docker-compose.yml` + `.env`).
- **Private CasaOS app store**: this folder (`docker-compose.yml`, `icon.png`, `screenshots/`) is laid
  out like a CasaOS AppStore app (`Apps/Noteboard/`); host it in your own store repository.

All four use the same images and the same data layout, so you can move between them.
