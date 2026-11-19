# Database schema (MongoDB) — designed, Milestone 2

Every private document carries `workspaceId`; every query from the API includes it (enforced by a
repository base class, tested by cross-workspace tests). Ids are UUID v7 strings on the server;
imported desktop ids are kept in `legacyId`.

| Collection | Key fields | Indexes |
| --- | --- | --- |
| users | email (lowercased), passwordHash (argon2id), emailVerifiedAt, platformRole (super_admin, platform_admin, user), status (pending, active, suspended), mfa {totpSecretEnc, recoveryHashes[]}, oauth[{provider, subject}] | email unique; oauth.provider+subject unique |
| user_sessions | userId, deviceId, refreshHash, family, userAgent, ip, createdAt, lastSeenAt, revokedAt | userId; refreshHash unique; TTL on expiresAt |
| devices | userId, name, platform, serverOrigin, lastSyncAt | userId |
| workspaces | name, ownerId, personal (bool), quotaBytes, usedBytes | ownerId |
| workspace_members | workspaceId, userId, role (owner, admin, editor, viewer, guest) | workspaceId+userId unique; userId |
| boards | workspaceId, parentId, name, color, icon, rootOfWorkspace, view {pan, zoom} per user in board_views | workspaceId+parentId |
| board_elements | workspaceId, boardId, kind (note, todo, link, image, board, column), pos, width, z, container {canvas, column(elementId), unsorted}, color, align, locked, content (per kind), version, deletedAt | workspaceId+boardId+deletedAt; workspaceId+_id |
| connections | workspaceId, boardId, from {elementId \| point}, to {…}, color, dashed, headStart, headEnd, weight, label, version, deletedAt | workspaceId+boardId |
| documents | workspaceId, elementId, yjsState (binary), updatedAt | workspaceId+elementId unique |
| collaboration_updates | workspaceId, documentId, update (binary), opId | documentId+_id; opId unique |
| assets | workspaceId, sha256, size, mime, storageKey, uploadedBy | workspaceId+sha256 unique |
| comments | workspaceId, elementId, authorId, body (sanitised), parentId | workspaceId+elementId |
| labels | workspaceId, name, color | workspaceId+name unique |
| user_preferences | userId, theme, scale, boldHeadings, drawerOpen, guides, snapGrid, showGrid, hiddenTools | userId unique |
| board_permissions | workspaceId, boardId, principal (user/group/link), role | workspaceId+boardId |
| share_links | workspaceId, boardId, tokenHash, role, expiresAt, revokedAt | tokenHash unique |
| sync_ops | workspaceId, opId, deviceId, appliedAt, result | opId unique; workspaceId+appliedAt |
| trash | workspaceId, boardId, elementIds, deletedBy, deletedAt | workspaceId+deletedAt |
| notifications | userId, kind, payload, readAt | userId+readAt |
| audit_logs | actorId, action, target, workspaceId, ip, at, details | at; actorId+at; workspaceId+at |
| platform_settings | registrationMode (open, approval, invite), smtp {…enc}, branding, announcements | singleton |
| imports | workspaceId, fingerprint, legacyIdOffset, importedBy, at, report | workspaceId+fingerprint unique |

## Mapping from the desktop/web format

| boards.json | MongoDB |
| --- | --- |
| `boards[id]` | `boards` (+ `board_views` for pan/zoom per user) |
| `cards[]` | `board_elements` (content per kind; `Container::Column(id)` → `container.column`) |
| `arrows[]` | `connections` (`from = 0` + `from_pt` → `from.point`) |
| `unsorted[]` | `board_elements.container = unsorted` + `unsortedOrder` |
| `trash[]` | `trash` + elements with `deletedAt` |
| `prefs.json` | `user_preferences` |
