# Migration plan

From the Rust/egui desktop app (V2, kept as-is) to the Noteboard platform, in five milestones.
Each milestone ends with its acceptance tests passing; nothing moves on before that.

## Phase 0 — audit and preservation (done 2026-11-19)

| Step | Evidence |
| --- | --- |
| Source modules inspected | 14 Rust modules, 6 360 lines (model, theme, prefs, icons, cards, app/*) |
| Tests re-run independently | `cargo test` 18/18, `cargo clippy -D warnings` clean, `cargo fmt --check` clean, release build OK |
| Data format inspected | `boards.json` v2 (`Store{boards,root,next_id,trash,version}`), `prefs.json`, pictures in `images/` |
| Dependency licences | 420 crates, all permissive (MIT/Apache-2.0/BSD/Zlib/Unicode/ISC/CC0/OFL for fonts) |
| Vulnerabilities (cargo audit) | 2: RUSTSEC-2026-0194/0195 in `quick-xml 0.30` via `zbus_xml` → `accesskit_unix` — **Linux-only**, not compiled into the Windows build; fixed by a future eframe upgrade. 8 "unmaintained" warnings (zvariant etc., same Linux path) |
| Git checkpoint | repository in `app/`, commit `014f5e5`, tag `v2-rust-baseline`; `.gitignore` keeps `backups/`, `shots/data/`, `.env*` out |
| User data backed up | `app/backups/user-boards-v1.json`, `user-boards-current-<date>.json`, `user-prefs-<date>.json` (not in Git) |
| Milanote APK | kept as reference material only; not decompiled, copied or redistributed |

## Milestone 1 — shared workspace on the web (built)

Acceptance: monorepo builds; shared model, geometry and Angular workspace; web UI matching V2 and
the reference; the 18 Rust behaviours ported where they apply; desktop data importable.

Result: see TEST_REPORT.md — 32 unit/component tests and 12 browser tests pass; importer verified on
copies of the real desktop data.

## Milestone 2 — server, accounts, tenant isolation (next)

1. `apps/api` (NestJS 12) with config from environment (APP_PUBLIC_URL, API_PUBLIC_URL, MONGO_URL,
   REDIS_URL, S3_*, SMTP_*, ALLOWED_ORIGINS, MAX_UPLOAD_MB, REGISTRATION_MODE).
2. Collections and indexes from DATABASE_SCHEMA.md; migrations with `migrate-mongo`-style versioned
   scripts that only add fields, never drop data in the same release.
3. Auth per AUTHENTICATION_DESIGN.md; RBAC guards per RBAC_MATRIX.md on every route and socket event.
4. `ServerStorage` adapter in the workspace; web client signs in and loads boards from the API.
5. Server-side import: the same `validateDesktopFile` dry run, then import into a workspace.

Acceptance: API integration tests (supertest) incl. cross-user and cross-workspace denial for every
route; importer round-trip through the API; web E2E against a real API + MongoDB.

## Milestone 3 — admin, Docker, custom domain

Admin app (Angular), Dockerfiles, compose files, Nginx, backups (see DOCKER_DEPLOYMENT.md,
CUSTOM_DOMAIN_SETUP.md, BACKUP_AND_RESTORE.md), PWA service worker.

Acceptance: `docker compose up` on a clean Linux host passes health checks; first administrator
bootstrapped with a one-time token; backup → wipe → restore test.

## Milestone 4 — Windows, Android, iOS, sync

Tauri v2 shell, Ionic/Capacitor shell, server picker, offline queue and sync protocol.

Acceptance: change made offline on Windows appears on web and Android after reconnect; iOS built only
on a Mac (not claimed until it is).

## Milestone 5 — reliability and release

Load tests (1 000+ elements per board, 60 fps pan), security review, dependency scanning in CI,
signed releases.

## Data migration rules

- The desktop file is never written by the importer; imports are additive into a new board.
- Ids map deterministically: new id = old id + offset (offset recorded in `imports[]`).
- Duplicate prevention by file fingerprint.
- Everything is kept: hierarchy, positions, widths, colours, symbols, note text and marks, task
  states, columns and their order, lines (attached or free, heads, dashes, weight, labels), the trash.
- Pictures: copied when supplied; otherwise listed as missing in the report.
