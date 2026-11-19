# Changelog

Versions follow `MAJOR.MINOR.PATCH[-pre]`. Major 2 = the Rust desktop app, major 3 = the
cross-platform platform; `-alpha.N` marks platform milestone N.

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
