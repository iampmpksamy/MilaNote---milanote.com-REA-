# Changelog

Versions follow `MAJOR.MINOR.PATCH[-pre]`. Major 2 = the Rust desktop app, major 3 = the
cross-platform platform; `-alpha.N` marks platform milestone N.

## 3.0.0-alpha.6 — 2026-11-20 (more card kinds)

- **New cards** (toolbar and the new **More** menu): Heading, Colour swatch, Document (full-screen
  editor, formatting toolbar, preview, word count), Sketch (drawing editor: colours, widths, marker,
  eraser, undo) and **Draw** directly on the board, Audio (upload or record a voice note), Video
  (YouTube/Vimeo, loaded only when clicked, or an uploaded file), Map (place search and map pictures
  from OpenStreetMap through your own server), Comment threads (post, delete, resolve) and Table
  (keyboard navigation, add/remove rows and columns). Touch and phone layouts included.
- **Sync:** comments and sketch strokes from two devices are combined; tables merge cell by cell;
  every new kind gets a conflicting copy when changed in both places.
- **Server:** audio and video uploads (content-checked, `MAX_MEDIA_MB`, default 100), video served
  with HTTP ranges, map search and pictures proxy (`MAP_PROVIDER`, `MAP_SEARCH_URL`, `MAP_TILE_URL`,
  per-account limits, disk cache pruned after 30 days), clear error for a board over 15 MB, streaming
  backup restore (large files no longer slow), gateway reads old and new upload settings.
- **Safety:** size limits applied before every save (one oversized card can't stop syncing); imports
  and exports carry all kinds and their files; recordings kept when their card leaves the screen;
  refused uploads kept and reported; CSP allows only the YouTube (no-cookie) and Vimeo players.
- **Tests:** unit 205, API 57, browser 38 + 6 + 3 + 13; independent review: 18 issues found, fixed.
- 3.0.0-alpha.5 (offline editing, below) is released together with this version.

## 3.0.0-alpha.5 — 2026-11-20 (offline editing)

- **Offline editing in the apps:** boards open without a connection from the copy kept on the
  device; every change is saved there first and sent when the server answers (retries with growing
  pauses, at once when the connection or the app comes back). Header: "Saved on this device".
- **Sync between devices:** when another device saved meanwhile, the boards are merged three-way
  (field by field from the last synced version) instead of refused: both devices' changes are kept;
  a card changed on both keeps the server's version and adds this device's as a "Conflicting copy"
  in Unsorted; names and labels likewise; deleted-vs-edited keeps the edit; new items that got the
  same id are renumbered with every reference. Other devices' changes are fetched on foreground,
  reconnect and every minute. The browser uses the same layer.
- **Pictures** added offline are uploaded before the boards that use them and cached for offline
  viewing; picture file names are now unique across devices.
- **Server:** keeps the ids of its last 20 saves (`recentOps`) so a device whose answer was lost
  merges from what arrived. No database schema change.
- **Model:** `mergeStores`, `repairStore`, `mergeList` and the store check (`checkStore`, moved from
  the server) in `@noteboard/board-model`.
- **Tests:** 104 model/merge tests (69 written by an adversarial review that found 38 defects, all
  fixed), API 37, native app 13 (2 offline end-to-end), browser 13 + 6.

## 3.0.0-alpha.4 — 2026-11-19 (native apps, part 1)

- **Server:** native sign-in for the apps — `X-Noteboard-Client: native` + bearer tokens (15-minute
  access, rotating 30-day refresh, reuse ends the session), cookies ignored on app requests, CORS for
  the app origins only (`NATIVE_ORIGINS`), app sessions listed and revocable on the account page;
  idempotent saves (operation ids); discovery advertises `native.auth`. No database schema change.
- **All clients:** reliable saving — unsent changes kept on the device until confirmed, retries with
  backoff, conflict banner with "save my unsent changes as a file", no saving after a failed load.
- **Apps:** server choice (suggested `https://notes.6dainas.cloud`, editable, several servers and
  accounts, http only in development builds with a warning), invitation/password links pasted in the
  app, touch gestures (drag, pinch, pan, long press, double tap), phone layout (bottom tools, sheets),
  Android Back button, native clipboard, share-to-Noteboard on Android, original icons.
- **Android:** Capacitor 8 project `noteboard-platform/apps/mobile` (`com.pmpksamy.noteboard`),
  Keystore token storage, HTTPS-only network config, no backups; debug APK built.
- **Windows:** Tauri v2 project `noteboard-platform/apps/desktop` (Credential Manager tokens, save
  dialog, single instance, remembered window); installers built on Windows/CI.
- **iOS/iPadOS:** Capacitor project with privacy texts and Keychain storage; compiled by CI on macOS.
- **CI:** `native-android.yml`, `native-windows.yml`, `native-ios.yml`; CI runs the native app tests.
- **Tests:** API integration 36 (15 new), native app browser tests 10 (new), all earlier suites pass.
- Requires the server to be 3.0.0-alpha.4 for the apps; browsers work as before.

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
