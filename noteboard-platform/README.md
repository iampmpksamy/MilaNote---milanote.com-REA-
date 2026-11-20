# Noteboard platform

The cross-platform successor to the Noteboard desktop app (the Rust/egui app one folder up, kept
unchanged and tagged `v2-rust-baseline` in Git). One Angular workspace, shared by every client, and
now a self-hosted server.

**Status: 3.0.0-alpha.6 — Homelab Edition + native apps with offline editing and 15 card kinds.** The web app runs in two modes:

- **Server mode** (Homelab Edition): served by the `noteboard-gateway` image in front of the NestJS
  API, with accounts, private boards saved to MongoDB, pictures on the NAS, `/admin`, backups and an
  installable PWA. Install with [`../deploy`](../deploy) (one CasaOS tile). Details:
  [docs/HOMELAB_EDITION.md](docs/HOMELAB_EDITION.md).
- **Local mode** (Milestone 1): served as plain files, it keeps boards in this browser (IndexedDB).

Native apps (3.0.0-alpha.4): Android (Capacitor, debug APK built), Windows (Tauri, installers built
on Windows/CI) and iPhone/iPad (Capacitor, needs macOS) share the same bundled UI and connect to the
server you choose — [docs/ANDROID_BUILD_GUIDE.md](docs/ANDROID_BUILD_GUIDE.md),
[docs/WINDOWS_BUILD_GUIDE.md](docs/WINDOWS_BUILD_GUIDE.md), [docs/IOS_BUILD_GUIDE.md](docs/IOS_BUILD_GUIDE.md).
Offline editing and sync between devices: [docs/OFFLINE_SYNC.md](docs/OFFLINE_SYNC.md); real-time collaboration is not built. Test evidence: [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

## Layout

```
apps/
  web/              Angular app: boards (shared workspace), sign-in, /setup, /account, /admin;
                    Dockerfile + gateway/ (nginx) = the noteboard-gateway image
  api/              NestJS API, worker, init and console tools (one image: noteboard-server);
                    src/ (server), integration/ (HTTP tests), build.mjs (esbuild bundle)
  web-e2e/          Playwright tests: src/ (local mode), server/ (server mode), native/ (the app
                    bundle in mobile emulation); NB_CHANNEL=chrome runs them where Edge isn't installed
  mobile/           Capacitor 8: android/ (Gradle project), ios/ (Xcode project), capacitor.config.ts
  desktop/          Tauri v2 Windows app: src-tauri/ (Rust commands, config, icons)
packages/
  board-model/      Board data model (same format as the desktop boards.json), operations,
                    desktop importer, safe note formatting. Used by the web app and the server.
  canvas-geometry/  View transform, line ends, hit tests, alignment guides, free-spot placement.
  ui-workspace/     The workspace UI. Storage is pluggable (StorageAdapter: IndexedDB, memory,
                    or the server — apps/web/src/app/server/api.ts).
tools/              serve.mjs (static files), dev-stack.mjs (MongoDB in memory + API + web, no
                    Docker), verify-instance.mjs, make_icons.py, make_comparisons.py
docs/               Architecture, Homelab Edition, migration plan, designs for later milestones.
```

## Commands

| What | Command |
| --- | --- |
| Install | `npm install` |
| Build the web app / the server bundle | `npx nx build web` / `npx nx build api` |
| Unit and component tests | `npx nx run-many -t test` |
| Server integration tests (builds first) | `npx nx run api:integration` |
| Lint | `npx nx run-many -t lint` |
| Browser tests, local mode | `npx nx build web && npx playwright test -c apps/web-e2e/playwright.config.mts` |
| Browser tests, server mode | `npx nx build web && npx nx build api && npx playwright test -c apps/web-e2e/playwright.server.config.mts` |
| … against a real install | add `NB_BASE_URL=http://host:port NB_SETUP_TOKEN=…` (fresh instance) |
| Run everything locally without Docker | build both, then `node tools/dev-stack.mjs 4322` → http://127.0.0.1:4322 |
| Native app bundle (apps) | `npx nx build web -c native` (release) / `-c native-dev` (allows http with a warning) |
| Android debug APK | `npx nx run mobile:apk-debug` → `apps/mobile/android/app/build/outputs/apk/debug/` |
| Windows installers (on Windows) | `npx nx build web -c native && cd apps/desktop && npx tauri build` |
| Native app tests (mobile emulation) | `npx nx build web -c native-dev && npx nx build api && npx playwright test -c apps/web-e2e/playwright.native.config.mts` |
| Docker images | `docker build -f apps/api/Dockerfile -t noteboard-server .` and `-f apps/web/Dockerfile -t noteboard-gateway .` |

Versions validated together on 2026-11-19: Node 26.13, npm 11.20, Nx 24.0, Angular 22.2, NestJS 12.5,
MongoDB driver 7.9 (server 8.0.38), ioredis 6 (Redis 8.10.3), TypeScript 6.0, Vitest 5,
Playwright 1.65, Tailwind CSS 4, esbuild 0.28. `@angular-devkit/architect` is pinned to `0.2202.8`
(see `overrides` in package.json) because a newer patch breaks Nx 24's builder loading.

## Moving boards in

- **From the desktop app**: Settings → Privacy & data → *Choose boards.json* (from
  `%APPDATA%\Noteboard`), optionally *Add pictures* from its `images` folder. A dry-run report shows
  what will come across; *Import* adds everything as one board under Home. The same file can't be
  imported twice. In server mode it goes into your account.
- **From this browser's local boards** (local mode): Account → *Copy into my account*.
