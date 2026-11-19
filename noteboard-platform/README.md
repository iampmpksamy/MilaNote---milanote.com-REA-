# Noteboard platform

The cross-platform successor to the Noteboard desktop app (the Rust/egui app one folder up, kept
unchanged and tagged `v2-rust-baseline` in Git). One Angular workspace, shared by every client.

**Status: Milestone 1 of 5 is built and tested** — the shared board model, canvas geometry and Angular
workspace, running as a web app that keeps boards in the browser and can import the desktop app's
boards. Server, accounts, sync, desktop and mobile shells are designed (see `docs/`) but not built
yet. Nothing in this README claims otherwise.

## Layout

```
apps/
  web/              Angular web app (the shared workspace + browser storage)
  web-e2e/          Playwright tests that drive the real web app in Microsoft Edge
packages/
  board-model/      Board data model (same format as the desktop boards.json), operations,
                    desktop importer, safe note formatting. Plain TypeScript: also for the server.
  canvas-geometry/  View transform, line ends, hit tests, alignment guides, free-spot placement.
  ui-workspace/     The workspace UI: header, contextual toolbar, canvas, cards, lines, drawer,
                    search, trash, settings. Storage is pluggable (StorageAdapter).
tools/serve.mjs     Tiny static server used by the browser tests.
docs/               Architecture, migration plan and the designs for later milestones.
```

Planned additions (not present yet): `apps/api` (NestJS), `apps/worker`, `apps/admin`,
`apps/desktop` (Tauri v2), `apps/mobile` (Ionic + Capacitor), `packages/sync`, `packages/api-client`.

## Commands

| What | Command |
| --- | --- |
| Install | `npm install` |
| Build the web app | `npx nx build web` → `dist/apps/web/browser` |
| Unit and component tests | `npx nx run-many -t test` |
| Lint | `npx nx run-many -t lint` |
| Browser tests (builds first) | `npx nx build web && npx playwright test -c apps/web-e2e/playwright.config.mts` |
| Try it locally | `npx nx build web` then `node tools/serve.mjs dist/apps/web/browser 4321` and open http://127.0.0.1:4321 |

Versions validated together on 2026-11-19: Node 26.13, npm 11.20, Nx 24.0, Angular 22.2,
TypeScript 6.0, Vitest 5, Playwright 1.65, Tailwind CSS 4. `@angular-devkit/architect` is pinned to
`0.2202.8` (see `overrides` in package.json) because a newer patch breaks Nx 24's builder loading.

## Moving boards from the desktop app

Settings → Privacy & data → *Choose boards.json* (from `%APPDATA%\Noteboard`), optionally *Add
pictures* from its `images` folder. A dry-run report shows what will come across; *Import* adds
everything as one board under Home. The desktop file is only read, and the same file can't be
imported twice.
