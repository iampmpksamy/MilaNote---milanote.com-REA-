# Changelog

Versions follow `MAJOR.MINOR.PATCH[-pre]`. Major 2 = the Rust desktop app, major 3 = the
cross-platform platform; `-alpha.N` marks platform milestone N.

## 3.0.0-alpha.3 — 2026-11-19 (Homelab Edition, hardened images)

- Server image: Node 26.13.1 binary on a fully updated Alpine 3.24 without npm/yarn/corepack (removes
  the HIGH findings the alpha.2 scan reported in npm's own undici and brace-expansion).
- Gateway image: Alpine packages upgraded at build (alpha.2 scan: 1 critical, 12 high in brotli,
  curl, expat and others).
- Release assets get distinct names (noteboard-casaos.yml, noteboard-compose.yml, noteboard.env.example).

## 3.0.0-alpha.2 — 2026-11-19 (Homelab Edition)

- Self-hosted server: NestJS API (`apps/api`), background worker, MongoDB 8.0 replica set, Redis 8,
  nginx gateway — one Docker Compose app, one CasaOS tile, only the gateway published (port 8765).
- First-run setup wizard with a one-time token; built-in accounts (argon2id), sessions, CSRF, rate
  limits, invitations and password links that work without e-mail, optional SMTP, two-step sign-in
  (required for administrators), suspension, session revocation, console recovery.
- Private workspaces saved to the server (per-board documents, revision check, "Saved to server"
  status), pictures on the NAS (S3 optional), export, desktop and browser-local imports.
- Admin panel at `/admin`: live overview, accounts, invitations, settings, branding, backups, audit
  log, health. Administrators cannot open users' boards.
- Automatic, idempotent initialisation (folders, owners, secrets, replica set, DB user, migrations).
- Backups (daily/weekly/monthly retention, manual, pre-migration), console restore, restore-test script.
- PWA (manifest, icons, service worker that never caches private data), discovery endpoint for clients.
- Deployment: `deploy/` — CasaOS compose, Docker Compose + `.env`, offline settings generator,
  nginx/Caddy examples, scripts; Dockerfiles; GitHub Actions image release (GHCR, SBOM, Trivy).
- Tests: unit 49, API integration 21, browser 13 local + 6 server (also run against a real install on
  the home lab), Rust 18.

## 3.0.0-alpha.1 — 2026-11-19 (platform Milestone 1)

- New `noteboard-platform/` Nx monorepo (Angular 22): shared board-model, canvas-geometry and
  ui-workspace libraries and the web app, matching the desktop V2 workspace.
- Desktop `boards.json` importer with dry-run report, deterministic id mapping and duplicate
  prevention, verified on copies of real data.
- Tests: 32 unit/component, 12 browser tests in Edge.
- Architecture, migration, database, API, security, deployment and platform build plans
  (server, accounts, admin, Docker, Windows/Android/iOS and sync are planned, not built).
- CI workflow for the desktop app and the platform.

## 2.0.0 — 2026-11-19 (desktop V2)

- Light and dark themes with colours sampled from the reference recording; Match system.
- Interface sizes Small/Medium/Large; Settings window.
- Toolbar that changes with the selection; boards as standalone squares with colour and symbol.
- Free lines with draggable ends that attach to cards; arrowheads, dashes, weights, labels.
- Flat notes, compact links, to-do placeholders, Unsorted pill and drawer, alignment guides.
- Saved-file format 2 with backed-up migration from format 1; 18 tests.

## 1.0.0 — 2026-11-17 (desktop V1)

- First desktop board app: canvas, notes, to-dos, links, pictures, nested boards, columns,
  arrows, trash, search, undo/redo and autosave.
