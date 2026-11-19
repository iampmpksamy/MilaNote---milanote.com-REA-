# Deployment, custom domains, backups and platform builds — designed (Milestones 3–4)

This file holds DOCKER_DEPLOYMENT, CUSTOM_DOMAIN_SETUP, BACKUP_AND_RESTORE and the Windows,
Android and iOS build guides (the separate file names point here). None of it is built yet; Docker
isn't installed on the machine used for Milestone 1, so nothing here has been run.

## Docker Compose (planned)

Services on an internal network; only Nginx publishes ports 80/443.

| Service | Image (pin exact versions at build time) | Notes |
| --- | --- | --- |
| nginx | nginx:<stable>-alpine | TLS, security headers, serves web + admin builds, proxies `/api/v1` and `/socket.io` |
| api | node:<LTS>-alpine, non-root user | health `/api/v1/health`; reads config from env and Docker secrets |
| worker | same image as api, `node dist/worker` | BullMQ jobs: e-mail, previews, exports, backups |
| mongo | mongo:<stable> as a single-node replica set | volume `mongo-data`; never published |
| redis | redis:<stable>-alpine, `requirepass` | volume `redis-data`; never published |
| minio (optional) | minio | or any S3 provider via `S3_ENDPOINT` |

Files to add in Milestone 3: `apps/*/Dockerfile` (multi-stage, `npm ci`, non-root), `docker-compose.yml`,
`docker-compose.prod.yml`, `.env.example`, `deploy/nginx/*.conf`, `deploy/backup/*.sh`. Start order via
`depends_on: condition: service_healthy`; database changes run as a one-shot `migrate` service before
`api` starts; each migration has a down step and a backup is taken first.

CasaOS and Portainer: both accept a compose file as a "stack"; secrets go in their environment UI.

## Personal domain (planned)

All addresses come from environment — nothing is hard-coded:

```
APP_PUBLIC_URL=https://notes.example.com
ADMIN_PUBLIC_URL=https://admin.notes.example.com
API_PUBLIC_URL=https://notes.example.com/api/v1
ALLOWED_ORIGINS=https://notes.example.com,https://admin.notes.example.com
```

DNS: A/AAAA records for both names to the server. TLS: Let's Encrypt via certbot or a companion
container. Native apps: a server picker accepts `https://` URLs only (plain http only for
`localhost`), fetches `/.well-known/noteboard.json` to confirm it's a Noteboard server and shows its
name and certificate host before signing in. Each server+account gets its own cache and keychain
entry; credentials are never sent to a different origin.

## Backups (planned)

Nightly worker job: `mongodump --archive --gzip` + object-store sync + Redis RDB, encrypted with
`age` to a public key from config, 7 daily / 4 weekly / 12 monthly kept. Restore script: stop api and
worker, restore archive into a fresh database, verify counts, start. A restore test runs in CI on a
throwaway stack. Admin panel shows last backup time and size.

## Windows desktop (Tauri v2, planned)

Prerequisites: Rust stable (present), WebView2 (present on Windows 11), `@tauri-apps/cli` 2.12.
`apps/desktop` wraps the same Angular build; capabilities limited to dialog (open file), clipboard
(read image/text), notification, store (SQLite), updater, and a custom `credentials` command backed
by Windows Credential Manager. Navigation restricted to the app origin. Packaging: MSI + NSIS;
signing needs a code-signing certificate (not available yet); updates signed with a Tauri key.

## Android (Ionic + Capacitor 8, planned)

Prerequisites not yet on this machine: Android Studio, SDK 35+, JDK 21. `npx cap add android`,
debug APK via Gradle; signed AAB needs the person's upload key. Gestures: pinch-zoom, two-finger pan,
long-press to pick up a card.

## iOS / iPadOS (planned)

Needs a Mac with Xcode, an Apple developer account and signing certificates. The project can be
generated here (`npx cap add ios`) but **cannot be built or tested on Windows**; no iOS build will be
claimed until one succeeds on a Mac.
