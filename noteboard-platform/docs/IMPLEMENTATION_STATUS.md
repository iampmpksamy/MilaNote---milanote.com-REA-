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
| 4 Windows (Tauri), Android/iOS (Capacitor), sync | **In progress** (3.0.0-alpha.4): native sign-in, server choice, reliable saving, touch UI, Android debug APK built; Windows app compiles (installers need Windows); iOS project prepared (needs macOS); offline editing is the next step — see below |
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

## Native apps (3.0.0-alpha.4) — built and tested on the home lab, 2026-11-19

Where: home lab (Ubuntu 24.04, Node 22.23.5, JDK 21, Android SDK 36, Rust 1.97.1, Chrome via
Playwright 1.65). The repository there was first fast-forwarded to `e97b7bd` (the old Windows working
copy saved as a git stash and in `sync-backup-20261119/`).

### Builds

| Artifact | Status | Where |
| --- | --- | --- |
| Android debug APK | **Built** (4.5 MB, versionCode 30000004, cleartext off, backups off) | `apps/mobile/android/app/build/outputs/apk/debug/Noteboard-3.0.0-alpha.4-android-debug.apk` |
| Android signed APK/AAB | Not built (no upload key yet) | `native-android.yml` builds them when the signing secrets exist |
| Windows app | **Compiles and starts** on Linux (`cargo build`, `tauri build --no-bundle`; shows the bundled connect screen under Xvfb) | `apps/desktop` |
| Windows setup EXE / MSI | **Not built** — needs Windows (NSIS/WiX, WebView2). `native-windows.yml` builds them on `windows-latest` | — |
| iOS / iPadOS | Project generated and configured; **not compiled** (needs macOS/Xcode). `native-ios.yml` compiles it unsigned on `macos-15` | `apps/mobile/ios` |

### Test results

| Suite | Result |
| --- | --- |
| Rust desktop app (legacy baseline) | 18 / 18 pass |
| Unit and component (Vitest) | 49 / 49 pass |
| API integration (`apps/api/integration`, now 2 files) | **36 / 36** pass (21 earlier + 15 native sign-in/saving) |
| Browser, local mode | 13 / 13 pass (Chrome on Linux; Edge on Windows CI) |
| Browser, server mode (dev stack) | 6 / 6 pass |
| **alpha.4 Docker images** (built on the home lab, isolated stack `nbtest4` on 127.0.0.1:18767, removed afterwards; the live app untouched) — native sign-in through the real nginx gateway: discovery, CORS preflight, invitation with tokens and no cookies, bearer write, refresh rotation, sign-out | **9 / 9 pass** |
| **Native app bundle** (`apps/web-e2e/native`, Pixel 7 emulation, real touch events, cross-origin bearer tokens against a separate dev server) | **10 / 10 pass** |
| Lint (7 projects) | 0 errors |
| `npm audit --omit=dev` | 0 vulnerabilities |

What the native suite covers: first-launch server choice with the suggested address, invalid and
unreachable addresses, the development http warning; invitation pasted into the app (and refused for
another server); no session cookies; tap-to-create, typing, one-finger drag, pinch zoom, pan, long
press → bottom-sheet menu, Back button; picture upload shown through the token; reopening keeps the
sign-in (refresh token); the same boards in a normal browser (cross-device); saves failing while
offline are kept and sent later; sign-out; a second account with two-step sign-in sees only its own
boards; remembered servers/accounts and an unreachable server; screenshots (`shots/native-alpha4/`)
for phone portrait/landscape, Android tablet, iPhone, iPad, dark theme and large interface size with
no sideways scrolling.

Bugs found by these tests and fixed: the CORS preflight didn't allow the app's `X-Noteboard-App`
header; an expired access token blocked its own refresh; `notes example` (with a space) was accepted
as an address.

### Release and live upgrade (2026-11-19)

- Pushed `main` and tag `v3.0.0-alpha.4`. GitHub Actions: CI (Windows: lint, unit, API, Edge browser
  suites, native app suite) **passed**; docker-release **passed** (images on GHCR:
  `noteboard-server@sha256:0349b01d…`, `noteboard-gateway@sha256:243f7096…`, SBOMs, Trivy reports);
  native-ios **passed** (unsigned simulator + device compile on macOS 15); native-windows **passed**;
  native-android failed on the tag (`gradlew` lost its executable bit in the Windows copy), fixed in
  `bf763e8` and **passed** on `main`.
- Release https://github.com/iampmpksamy/MilaNote---milanote.com-REA-/releases/tag/v3.0.0-alpha.4:
  `Noteboard-3.0.0-alpha.4-android-debug.apk` (+ `SHA256SUMS-android.txt`),
  `Noteboard-3.0.0-alpha.4-windows-x64-setup.exe` (sha256 `29a4e822…`) and `…-windows-x64.msi`
  (sha256 `b3a6372b…`) with `SHA256SUMS-windows.txt`, plus the server deployment files.
- Live CasaOS app upgraded alpha.3 → alpha.4 with `casaos-cli app-management apply` (only the four
  image tags changed; manual backup `noteboard-backup-20261119-141747-manual.tar.gz` taken first);
  all five services healthy. Through Cloudflare, `https://notes.6dainas.cloud` reports
  `native.auth = bearer-v1` and answers the Android app's CORS preflight (204, `https://localhost`).
- First real-phone attempt (before the upgrade) showed "Can't reach the server": the alpha.3 server
  refused the app's preflight. The app now reports "server too old" in that case.

### Not verified (honest list)

- **No physical phone, emulator, Mac or Windows run.** The Android APK has not been installed
  anywhere; the home lab has no KVM, so no emulator. The browser-emulation tests use the plugins' web
  implementations: Android Keystore, iOS Keychain, the share-in plugin, haptics, the status bar and
  the Back button are only exercised on a device.
- Windows Credential Manager, installers, WebView2 drag-and-drop/paste and high-DPI behaviour.
- iOS compile, signing, devices.
- The Windows installers were built by CI but not yet installed on a Windows PC; the Android app has
  not yet completed a sign-in on a real phone (in progress with the owner).

### Checklist for the first phone test (test account, not production data)

1. Install the APK, open it: the connect screen suggests `https://notes.6dainas.cloud`.
2. Test connection → name and version (needs the server on 3.0.0-alpha.4), Save.
3. Paste an invitation link for a test account → create the account → boards appear.
4. Create a note, drag it, pinch, long-press a card, rotate the phone, open the keyboard.
5. Add a photo from the gallery and from the camera; share a link from Chrome to Noteboard.
6. Airplane mode → edit → banner; back online → "Saved".
7. Close and reopen the app (still signed in); open the boards in a browser (same content).
8. Account page in the browser → *Signed-in devices* lists "Noteboard Android 3.0.0-alpha.4" →
   *Sign out* → the phone asks to sign in again.

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
7. Native apps (alpha.4): no offline editing yet — the server must be reachable to open boards;
   unsent changes are kept and retried (OFFLINE_SYNC.md).
8. Native apps need a server on 3.0.0-alpha.4 or newer (native sign-in).
9. The sample board for new accounts still says "Double-click", "Ctrl + scroll" (desktop wording)
   on phones too.
10. iOS: no share-to-Noteboard yet (needs a Share Extension and signing); no build exists yet.
11. Windows installers are unsigned (SmartScreen warning) until a code-signing certificate exists.
12. Invitation and password links open in the browser; in the apps they are pasted on the sign-in
    screen (no Android App Links / iOS Universal Links yet — they need files on the server domain and
    signing).
13. The Admin panel opens in the system browser from the apps.

## Changelog

### Platform 3.0.0-alpha.4 (2026-11-19) — native apps, part 1
- Native sign-in for apps (bearer tokens, rotation, reuse detection, CORS for app origins only);
  browser cookies/CSRF unchanged. Idempotent saves.
- Server choice, accounts per server, reliable saving with drafts and retries, touch gestures and
  phone layout (shared by browser and apps).
- Android Capacitor project and debug APK; Windows Tauri project; iOS Capacitor project; CI workflows.

### Platform M1 (2026-11-19)
- New Nx workspace `noteboard-platform` (inside `app/` because the builder may only write there).
- `board-model`, `canvas-geometry`, `ui-workspace` libraries; `web` app; Playwright browser tests.
- Desktop importer with dry-run report, deterministic id mapping and duplicate prevention.
- Architecture, migration, schema, security, deployment and platform plans.

### Rust V2 (unchanged, tagged `v2-rust-baseline`)
