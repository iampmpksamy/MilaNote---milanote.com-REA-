# Windows build guide (Tauri v2) — 3.0.0-alpha.4

`apps/desktop` is the new Windows app: the same bundled Angular UI as the phones in a native
WebView2 window, connected to the person's Noteboard server. It is **not** the original Rust/egui
desktop app (`app/src`, v2.0.0), which stays as the legacy local-only program; its
`%APPDATA%\Noteboard\boards.json` is never read or migrated automatically (Settings → Privacy & data
→ *Choose boards.json* imports it on request).

| | |
| --- | --- |
| Identifier | `com.pmpksamy.noteboard` |
| Rust | tauri 2.12, plugins dialog, opener, notification, window-state, single-instance; keyring 4.2 |
| Window | 1360×860, min 720×480, native title bar (minimise/maximise/snap), size and position remembered, one instance (a second launch focuses the first) |
| High DPI | WebView2 per-monitor DPI awareness (Tauri default) |
| Tokens | Windows Credential Manager (DPAPI, per Windows user), service "Noteboard" |
| Page permissions | `core:default`, save dialog, notifications, window state; no file-system or shell access from the page; only http(s) links can be opened in the browser |
| Drag and drop | the webview passes dropped files to the board (`dragDropEnabled: false`) |
| Clipboard | Ctrl+V pictures and text work through WebView2's normal paste events |
| Installers | NSIS `…-setup.exe` (per-user, no admin rights) and `.msi` (WiX; MSI version 3.0.0.4) |
| WebView2 | downloaded by the installer if missing (Windows 10); built in on Windows 11 |

## Build on the Windows PC

Prerequisites: Node 22.22+/24.15+/26, Rust stable (MSVC), Visual Studio Build Tools (C++), WebView2.
NSIS and WiX are downloaded by the Tauri bundler on first use.

```powershell
cd noteboard-platform
npm ci
npx nx build web -c native
cd apps\desktop
npx tauri build
# → src-tauri\target\release\bundle\nsis\Noteboard_3.0.0-alpha.4_x64-setup.exe
# → src-tauri\target\release\bundle\msi\Noteboard_3.0.0.4_x64_en-US.msi
```

The GitHub workflow `native-windows.yml` does the same on `windows-latest` for every `v3.*` tag (or
by hand) and attaches `Noteboard-<version>-windows-x64-setup.exe`, `…-x64.msi` and
`SHA256SUMS-windows.txt` to the release.

## Signing

Unsigned builds work but SmartScreen warns ("Windows protected your PC" → More info → Run anyway).
To sign: a code-signing certificate (OV/EV or Azure Trusted Signing), then `bundle.windows.
certificateThumbprint` / `signCommand` in `tauri.conf.json` and the certificate as a CI secret.
Auto-update (Tauri updater) needs an update signing key; not set up yet.

## What was verified where

- Home lab (Linux): `cargo build` and `npx tauri build --no-bundle` of the same app succeed; the app
  starts under a virtual display, recognises the Tauri shell and shows the bundled *Connect to your
  Noteboard* screen. Credential Manager, the installers and Windows-specific behaviour can only be
  checked on Windows.
- Windows PC / CI: not run yet (see IMPLEMENTATION_STATUS.md).
