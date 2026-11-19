# Deployment, custom domains, backups and platform builds

The Docker/CasaOS deployment that was built is described in [HOMELAB_EDITION.md](HOMELAB_EDITION.md)
and `../deploy`; the sections on Docker, domains and backups below are the original Milestone 1 plan,
kept for reference. The native apps have their own guides (3.0.0-alpha.4):

| Platform | Guide | Status |
| --- | --- | --- |
| Android phones and tablets | [ANDROID_BUILD_GUIDE.md](ANDROID_BUILD_GUIDE.md) | debug APK built and tested in emulation |
| Windows 10/11 | [WINDOWS_BUILD_GUIDE.md](WINDOWS_BUILD_GUIDE.md) | app compiles; installers built by CI/Windows |
| iPhone and iPad | [IOS_BUILD_GUIDE.md](IOS_BUILD_GUIDE.md) | project prepared; needs macOS |

How the apps connect and sign in: [SERVER_DISCOVERY.md](SERVER_DISCOVERY.md),
[NATIVE_AUTHENTICATION.md](NATIVE_AUTHENTICATION.md); touch: [MOBILE_GESTURES.md](MOBILE_GESTURES.md);
saving and offline: [OFFLINE_SYNC.md](OFFLINE_SYNC.md).

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

## Native apps

Built in 3.0.0-alpha.4 — see the guides linked at the top. Differences from the original plan:
Ionic UI components were not added (the apps use Noteboard's own design system with a phone layout;
Capacitor provides the native layer), and the Windows app stores tokens with the `keyring` crate
(Credential Manager) instead of a SQLite store; offline storage comes with the offline milestone.
