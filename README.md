# Noteboard

A visual board for notes, to-dos, links, pictures, nested boards, columns and lines — an original,
independently written app inspired by visual-board workflows. No code, assets or private APIs from
any other product are included.

| Part | Folder | Version | State |
| --- | --- | --- | --- |
| Desktop app (Rust, egui/eframe) | `./` (`src/`, `Cargo.toml`) | 2.0.0 | Finished V2; 18 tests |
| Platform (Nx: Angular web app, NestJS server, Android/iOS (Capacitor) and Windows (Tauri) apps) | `noteboard-platform/` | 3.0.0-alpha.5 | Homelab Edition + native apps (Android, Windows, iOS project) with offline editing and sync; 140 unit + 37 API + 32 browser tests |
| Homelab install (CasaOS, Docker Compose, Portainer) | `deploy/` | 3.0.0-alpha.5 | One CasaOS tile; installed and tested on the home lab |

## Desktop app

```
cargo run --release            # start
cargo test                     # 18 tests (6 data, 12 simulated interactions)
cargo run -- --screenshot shot.png
```

Boards are saved in `%APPDATA%\Noteboard\boards.json` (pictures in `images\`). Older files are
upgraded on first open after being copied to `boards.backup-v1.json`.
Docs: `docs/` (reference analysis, design tokens, visual comparison, test report).

## Platform

See [noteboard-platform/README.md](noteboard-platform/README.md) and its `docs/` for the
architecture, migration plan, database schema, API, security and deployment plans.

## Homelab Edition (self-hosted)

Install on CasaOS as one app: [deploy/casaos/README.md](deploy/casaos/README.md). Choose settings
first (offline): open [deploy/installer/index.html](deploy/installer/index.html). Plain Docker Compose:
[deploy/compose](deploy/compose/README.md). How it works: [noteboard-platform/docs/HOMELAB_EDITION.md](noteboard-platform/docs/HOMELAB_EDITION.md).

## Versions

See [CHANGELOG.md](CHANGELOG.md). Releases are Git tags `vMAJOR.MINOR.PATCH[-pre]`:
the major number is the product generation (2 = Rust desktop, 3 = cross-platform platform),
pre-release labels mark milestones (`-alpha.N` = milestone N).

Personal boards, backups and `.env` files are never committed (see `.gitignore`).
