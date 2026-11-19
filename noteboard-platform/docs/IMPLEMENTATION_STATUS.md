# Implementation status, feature parity, test report, known issues, changelog

(FEATURE_PARITY_MATRIX, TEST_REPORT, KNOWN_ISSUES and CHANGELOG point here.)

Legend: **Tested** automated test passes · **Checked** seen working in a screenshot · **Built** code
exists, no automated test · **Designed** docs only · **Deferred**.

## Milestones

| Milestone | Status |
| --- | --- |
| 0 Audit and preservation | Done (MIGRATION_PLAN.md) |
| 1 Monorepo, shared canvas, web interface | **Done** — this report |
| 2 NestJS, MongoDB, accounts, isolation | Designed |
| 3 Admin, Docker, custom domain, PWA | Designed |
| 4 Windows (Tauri), Android/iOS (Capacitor), sync | Designed |
| 5 Reliability, security hardening, release | Not started |

## Feature parity: Rust V2 → web (Milestone 1)

| Feature | Rust V2 | Web | Evidence |
| --- | --- | --- | --- |
| Pan (wheel, Space+drag, middle-drag), pointer zoom, fit, 100% | ✓ | ✓ Built (wheel/zoom), Checked | `zoomAt` unit test |
| Dot grid fixed to the board | ✓ | ✓ Checked | screenshots |
| Toolbar with mini-card icons, disabled Comment/Table/Draw | ✓ | ✓ Tested | e2e board test |
| Contextual toolbar (board, note, to-do, link, image, column, line, multi) | ✓ | ✓ Tested | component + e2e |
| Boards: standalone square, colour (14), symbol (48, searchable), rename with text selected, open, nested path | ✓ | ✓ Tested (colour emoji in the web) | e2e board, nav |
| Lines: connect dot, free lines, drag ends to attach, start/end heads, dashed, weight, label, colour, detach | ✓ | ✓ Tested (connect, free, dashed, start) | e2e line tests |
| Notes: inline editing, marks, headings, bullets, quotes, links, alignment, colours, resize | ✓ | ✓ Tested (typing incl. Tamil, bold, resize) | e2e note |
| To-do: Enter adds tasks, tick, remove, reorder | reorder buttons | Enter/tick/remove Tested; **reorder not yet** | e2e to-do |
| Links, pictures (add, drop, paste with Ctrl+V, caption, replace) | ✓ (Ctrl+V pictures not in V2) | ✓ Built; Ctrl+V pictures works in the web | — |
| Columns with drop line, in and out | ✓ | ✓ Tested | e2e columns |
| Unsorted pill + drawer, quick note, drag out | ✓ | ✓ Tested | e2e drawer |
| Search (Ctrl+F) across boards | ✓ | ✓ Tested | e2e + service test |
| Trash: restore, delete forever, empty | ✓ | ✓ Tested (restore) | e2e trash |
| Undo / redo (200 steps), copy/cut/paste/duplicate | ✓ | ✓ Tested | e2e + service tests |
| Alignment guides, grid snap, z-order, lock | ✓ | ✓ Built (guides unit-tested) | geometry tests |
| Light / dark / system, Ctrl+Shift+D | ✓ | ✓ Tested | e2e theme |
| Interface size Small/Medium/Large, Ctrl+Shift+< / > | ✓ | ✓ Tested | e2e theme |
| Settings: Appearance, Preferences, Language, Toolbar options, Privacy & data | ✓ | ✓ Checked | screenshots |
| Autosave, survives restart | file | IndexedDB, Tested (reload) | e2e reload |
| Import desktop boards (dry run, duplicates refused) | — | ✓ Tested on copies of real data | unit + e2e |
| Export all boards as JSON | — | ✓ Built | — |
| Help popup with shortcuts | ✓ | ✓ Built | — |

## Test report (2026-11-19, Windows 11, Node 26.13, Edge via Playwright 1.65)

| Suite | Result |
| --- | --- |
| `board-model` (Vitest) — 6 ported Rust model tests, importer (dry run, import, duplicates, broken files), 2 real desktop data copies, formatting + injection safety | **13 / 13 pass** |
| `canvas-geometry` (Vitest) | **8 / 8 pass** |
| `ui-workspace` service (Vitest + Angular TestBed) | **8 / 8 pass** |
| `web` component tests (Vitest + Angular TestBed, jsdom) | **3 / 3 pass** |
| `web-e2e` (Playwright, Microsoft Edge, production build) — the 12 Rust interaction scenarios ported | **12 / 12 pass, 4 consecutive runs** |
| `nx lint` (5 projects) | 0 errors, 44 warnings (non-null assertions) |
| `nx build web` (production) | OK — 268 kB JS (75 kB compressed), 29 kB CSS |
| Rust V2 (unchanged): `cargo test` / clippy / fmt / release | 18 / 18, clean, clean, OK |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (incl. dev tooling) | 28 moderate, 1 high (`undici` via Nx/Jest tooling; not shipped) |

Bugs found by the new tests and fixed: views didn't refresh after in-place data changes; fast typing
after Enter in a to-do could land in the wrong task; a shortcut pressed right after renaming a board
was swallowed; a template's inline icon styles broke the component test runner.

**Not run (honest list):** API, database, auth, sync, Docker, Windows native, Android and iOS tests —
those parts don't exist yet. Browser tests ran in Edge only (Firefox/Safari not installed here).

## Known issues

1. Milestone 1 stores boards only in the browser it's used in (IndexedDB); clearing site data
   removes them. Use Settings → Privacy & data → Download all boards to keep a copy.
2. To-do task reordering (up/down) from V2 isn't in the web version yet.
3. Notes use the same light formatting as V2 (markdown-style marks), not Tiptap rich text yet;
   Tiptap/ProseMirror arrives with Yjs collaboration in Milestone 4.
4. Pictures from the desktop app come across only if their files are picked in the import dialog.
5. Unused template dependencies (`@angular/ssr`, `express`, `@angular/platform-server`) are still in
   package.json; to be removed when the API is added.
6. Rust V2: Linux-only `quick-xml` advisory (see MIGRATION_PLAN.md).

## Changelog

### Platform M1 (2026-11-19)
- New Nx workspace `noteboard-platform` (inside `app/` because the builder may only write there).
- `board-model`, `canvas-geometry`, `ui-workspace` libraries; `web` app; Playwright browser tests.
- Desktop importer with dry-run report, deterministic id mapping and duplicate prevention.
- Architecture, migration, schema, security, deployment and platform plans.

### Rust V2 (unchanged, tagged `v2-rust-baseline`)
