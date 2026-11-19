# API specification — designed, Milestone 2 (not built)

Base: `${API_PUBLIC_URL}` (e.g. `https://notes.example.com/api/v1`). JSON. Errors:
`{ "error": { "code": "not_found", "message": "…" } }`. Every route except auth and health requires
a session; every workspace route checks membership and role (SECURITY_AND_ACCESS.md).

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| GET | /health | liveness + dependencies | public |
| GET | /.well-known/noteboard.json (served at the site root) | server name, version, auth methods | public |
| POST | /auth/register | create account (mode open/approval/invite) | public |
| POST | /auth/verify-email | confirm token | public |
| POST | /auth/login · /auth/logout | session cookie (browser) | public / user |
| POST | /auth/token · /auth/token/refresh | PKCE code exchange and refresh rotation (native) | public |
| POST | /auth/password/forgot · /auth/password/reset | reset by e-mail | public |
| GET/POST | /auth/oauth/google/start · /callback | Google sign-in | public |
| POST | /auth/mfa/totp/setup · /verify · /disable | two-factor | user |
| GET/DELETE | /me/sessions[/:id] | devices and revocation | user |
| GET/PUT | /me/preferences | theme, size, drawer, guides… | user |
| GET/POST | /workspaces | list / create | user |
| GET/PATCH/DELETE | /workspaces/:ws | read / rename / delete | member / admin / owner |
| GET/POST/PATCH/DELETE | /workspaces/:ws/members[/:userId] | membership and roles | admin |
| GET | /workspaces/:ws/boards/:id | board with elements and connections | viewer |
| POST/PATCH/DELETE | /workspaces/:ws/boards[/:id] | create / update / trash | editor |
| POST | /workspaces/:ws/ops | batch of operations (same as sync push) | editor |
| GET | /workspaces/:ws/trash · POST …/trash/:id/restore · DELETE …/trash/:id | trash | editor / admin |
| POST | /workspaces/:ws/assets/upload-url · /assets/complete | signed upload | editor |
| GET | /workspaces/:ws/assets/:id/url | short-lived download URL | viewer |
| GET | /workspaces/:ws/search?q= | search in that workspace | viewer |
| POST | /workspaces/:ws/import/dry-run · /import | desktop boards.json import | admin |
| POST | /workspaces/:ws/export | export job (JSON + pictures zip) | admin |
| POST | /sync/push · GET /sync/pull?cursor= | offline sync | member |
| … | /admin/* (users, approvals, invitations, quotas, settings, announcements, audit, backups, health) | administration | platform roles |

Socket.IO namespace `/boards`: `board:join {ws, boardId}` (membership re-checked) → `board:changed
{opIds, version}`, `presence {userId, cursor}`; `board:leave`. Yjs updates on `/docs`.
