# System architecture

Legend: **Built** (exists and is tested) · **Designed** (decided here, not built) · **Open** (needs a decision).

## Overview

```
 Windows (Tauri v2) ─┐
 Web / PWA ──────────┼─ shared Angular workspace (packages/ui-workspace)       ← Built (web)
 Android/iOS (Ionic) ┘      │ StorageAdapter / SyncAdapter
                            ▼
                    packages/board-model + canvas-geometry                     ← Built
                            │  (same code on server)
              HTTPS /api/v1 + Socket.IO (wss) via Nginx                         ← Designed
                            ▼
   NestJS API ── MongoDB (replica set) ── Redis (sessions, rate limits, pub/sub, BullMQ)
        │                                     │
        └── S3-compatible object storage      └── worker (exports, previews, e-mail, backups)
```

## Principles

1. **One business logic.** Board operations live in `board-model` (pure TypeScript). Clients and the
   server import the same functions, so a move, delete or restore behaves identically everywhere.
2. **Same data shape as the desktop app.** The model mirrors `boards.json` v2, so the desktop file,
   the browser store and the import/export format are one format. The server stores the same
   records split into collections (see DATABASE_SCHEMA.md).
3. **Storage and sync are adapters.** `StorageAdapter` (built: IndexedDB, memory) hides where data
   lives. Milestone 4 adds a `SyncAdapter` that wraps the local store with an operation queue.
4. **Server-side authority.** Every permission check happens in the API and the WebSocket gateway;
   clients only hide what users can't do.
5. **No shell access from UIs.** Tauri and Capacitor expose a few named, typed commands only.

## Client (Built for web)

- Angular 22, standalone components, signals, zoneless change detection, OnPush.
- Cards are real DOM elements (native text editing, selection, accessibility); lines and guides are
  SVG; pan/zoom is one CSS transform on the board layer; the dot grid is a CSS background.
- State: `Workspace` service (signals) with undo/redo snapshots (200 steps) and debounced autosave.
- Interface size (`--ui` CSS variable) is separate from board zoom.
- Theme: CSS variables from the tokens sampled in the reference recording; light, dark, system.

## Server (Designed — Milestone 2)

- NestJS modules: auth, users, workspaces, boards, elements, assets, search, admin, audit, sync.
- MongoDB: per-element documents, `workspaceId` on every private document, compound indexes that
  start with `workspaceId` so tenant isolation is index-backed.
- Redis: session store, rate-limit counters, Socket.IO adapter, BullMQ queues.
- Object storage: assets by content hash; downloads only through short-lived signed URLs issued
  after a permission check.

## Sync (Designed — Milestone 4)

- Each client change becomes an operation `{opId (uuid v7), workspaceId, boardId, baseVersion, kind, payload}`
  stored in a local queue (IndexedDB / SQLite).
- `POST /sync/push` applies operations idempotently (unique index on `opId`) and returns the new
  element versions; conflicts on the same field use last-writer-wins by server order, except deletes,
  which win (tombstones kept 30 days). Note text uses Yjs documents so concurrent typing merges.
- `GET /sync/pull?since=<cursor>` returns changes after a cursor; Socket.IO pushes "changed" hints.
- Caches and identities are separate per `(server origin, account)`; signing out removes that cache.
- If a permission is revoked, the next pull returns 403 for the workspace and the client discards
  its queue for it after telling the user.

## Platforms (Designed)

| Platform | Shell | Storage | Notes |
| --- | --- | --- | --- |
| Web / PWA | Angular build + service worker | IndexedDB | Milestone 3 adds the service worker |
| Windows | Tauri v2 | SQLite via a Tauri plugin; credentials in Windows Credential Manager | signed MSI/NSIS, updater with signature check |
| Android / iOS / iPadOS | Ionic + Capacitor | SQLite plugin; Keychain / Keystore | touch gestures in `canvas-gestures` package |

## Decisions still open

- Hosted default server address and who runs it (needed for the server picker's default).
- E-mail provider for verification and password reset (SMTP settings exist in the design).
- Whether self-hosted installs may disable e-mail verification.
