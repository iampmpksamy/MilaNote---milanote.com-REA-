# Implementation status, feature parity, test report, known issues, changelog

(FEATURE_PARITY_MATRIX, TEST_REPORT, KNOWN_ISSUES and CHANGELOG point here.)

Legend: **Tested** automated test passes · **Checked** seen working in a screenshot · **Built** code
exists, no automated test · **Designed** docs only · **Deferred**.

## Milestones

| Milestone | Status |
| --- | --- |
| 0 Audit and preservation | Done (MIGRATION_PLAN.md) |
| 1 Monorepo, shared canvas, web interface | **Done** (3.0.0-alpha.1) |
| 2+3 Homelab Edition: NestJS, MongoDB, Redis, accounts, admin, Docker, CasaOS, PWA | **Done** (3.0.0-alpha.2) — see below and [HOMELAB_EDITION.md](HOMELAB_EDITION.md) |
| 4 Windows (Tauri), Android/iOS (Capacitor), sync | Designed (not built; no native installers exist) |
| 5 Reliability, security hardening, release | Not started |

## Homelab Edition (3.0.0-alpha.2) — tests run on 2026-11-19

| Suite | Where | Result |
| --- | --- | --- |
| Rust desktop app (baseline) | this PC | 18 / 18 pass, release build OK |
| Unit and component (Vitest): board-model 13, canvas-geometry 8, ui-workspace 8, web 3, api 17 | this PC | 49 / 49 pass |
| API integration (built bundle over HTTP, real MongoDB replica set in memory) | this PC | 21 / 21 pass |
| Browser, local mode (Milestone 1 suite) + settings generator | Edge, this PC | 13 / 13 pass |
| Browser, server mode (`apps/web-e2e/server`) against `tools/dev-stack.mjs` | Edge, this PC | 6 / 6 pass |
| Browser, server mode against the **real Docker install on the home lab** (10.0.0.2:18765) | Edge → home lab | 6 / 6 pass, no CSP violations |
| Lint (6 projects) | this PC | 0 errors |
| `npm audit --omit=dev` | this PC | 0 vulnerabilities |
| CasaOS `app-management install --dry-run` (CasaOS v0.4.15) | home lab | accepted |

Home lab: Ubuntu 24.04.5, Docker 29.9.3, Compose v5.7.1, CasaOS v0.4.15, data on ext4.

| # | Acceptance test | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Clean Docker host installs the stack | **Passed** | fresh data folder → all 6 services healthy in 25 s; replica set initiated, DB user created, migration 1, setup token printed |
| 2 | Internal services start automatically | **Passed** | init → mongo/redis healthy → api healthy → worker/gateway (Compose conditions) |
| 3 | CasaOS shows exactly one Noteboard tile | **Passed (CLI)** | `casaos-cli app-management list apps` → one `noteboard` app, running, `http://10.0.0.2:8765/` (test instances removed). The dashboard itself was not viewed (no CasaOS login used) |
| 4 | The tile opens the app | **Passed (CLI)** | web UI `http://10.0.0.2:8765/` answers; smoke test 200 on `/healthz`, `/api/v1/health`, `/ready`, `/discovery` |
| 5 | Setup creates the super administrator | **Passed** | browser test on the home-lab install; route closed afterwards (410, "Already set up") |
| 6 | Invite without SMTP | **Passed** | invitation link copied from `/admin`, account created, link single-use |
| 7 | Log in and create private boards | **Passed** | note typed, "Saved to server" |
| 8 | Desktop data import | **Passed** | `backups/user-boards-v1.json` imported through Settings, visible in another browser |
| 9 | Same account in another browser | **Passed** | note and picture (8×8 PNG, pixel size checked) in a second browser context |
| 10 | No access to another user's content | **Passed** | integration + browser tests: 401/404 for other users, admin sees counts only |
| 11 | Pictures survive container recreation | **Passed** | `up --force-recreate` and `down` + `up`: same board hash `9dd7e834…`, same picture hash `9334858d…` |
| 12 | Databases survive host restart | **Partly** | MongoDB/Redis container restarts and full `down`/`up` keep everything; `restart: unless-stopped` everywhere. **The home-lab host itself was not rebooted** (other services run there) |
| 13 | Custom HTTPS domain | **Not verified** | needs `notes.6dainas.cloud` added to the tunnel and DNS (root on the host + Cloudflare account); steps in HOMELAB_EDITION.md §6. `Secure`/`__Host-` cookies over HTTPS are covered by code, not by a live HTTPS test |
| 14 | Reverse-proxy configuration | **Partly** | the gateway itself is a reverse proxy in front of the API (all tests go through it); external Nginx/Caddy examples written, not run |
| 15 | Administration through `/admin` | **Passed** | overview with live MongoDB 8.0.38 / Redis 8.10.3 / disk / worker numbers, accounts, invitations, health, audit; settings validated and masked |
| 16 | Backup and restore | **Passed** | "Back up now" → worker wrote the archive; scheduled backup ran; `restore-test.sh` restored it into a separate instance (port 18766) with identical hashes |
| 17 | Controlled upgrade keeps data | **Passed** | test instance switched to newer image tags (3.0.0-alpha.3-upgradetest): app containers recreated, version changed, data hashes unchanged. No breaking migration exists yet, so the pre-migration backup path is code-reviewed only |
| 18 | Existing regression tests pass | **Passed** | Rust 18, unit 49 (incl. M1's 32), M1 browser 12 |

Images: GitHub Actions published 3.0.0-alpha.2 to GHCR (public, pulled anonymously from the home lab)
with SBOMs and Trivy reports; that scan found fixable HIGH/CRITICAL issues in the base images, fixed in
3.0.0-alpha.3 (hardened images re-tested: 6/6 browser tests against a home-lab stack; its scan shows no
HIGH/CRITICAL findings). The live CasaOS app was then upgraded with `casaos-cli app-management apply`:
CasaOS pulled `noteboard-server@sha256:15dbb4fc…` and `noteboard-gateway@sha256:eb8e72c7…` from GHCR and
all services came back healthy (setup still waiting for the owner).

Not done / needs your access: the Cloudflare hostname; a host reboot test; the CasaOS dashboard view;
S3 against a real bucket; ARM64.

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
