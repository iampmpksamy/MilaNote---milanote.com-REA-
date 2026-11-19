# Authentication, roles and security — designed for Milestone 2–3 (not built)

This one file holds AUTHENTICATION_DESIGN, RBAC_MATRIX and SECURITY_REQUIREMENTS (the separate
file names point here).

## Authentication

| Capability | Design |
| --- | --- |
| Registration | e-mail + password (argon2id, min 10 chars, breached-password check optional). `REGISTRATION_MODE`: `open`, `approval` (admin approves before first sign-in), `invite` (one-time invitation tokens, hashed). A personal workspace is created when the account becomes active. |
| E-mail verification | single-use token (hashed in DB), 24 h; unverified accounts can't create share links |
| Sign in / out | Browser: server-managed session — `__Host-nb_session` cookie, HttpOnly, Secure, SameSite=Lax, 14 days sliding, stored in Redis. Native apps: authorization code + PKCE in the system browser, short access token (10 min) + rotating refresh token (reuse detection revokes the family) kept in Windows Credential Manager / Keychain / Android Keystore. No long-lived tokens in localStorage. |
| Password reset | single-use token by e-mail, 30 min, all sessions revoked on reset |
| Google | OpenID Connect, code + PKCE, `email_verified` required; links to an existing account only after signing in to it |
| Two-factor | TOTP (RFC 6238) + 10 recovery codes (hashed); required for platform administrators |
| Sessions and devices | list, rename, revoke one or all; revoking closes that device's sockets |
| Rate limits | sign-in 5/min per account+IP, 30/hour per IP; reset/verification 3/hour; lockout with back-off, not permanent |
| First administrator | `noteboard-admin bootstrap` prints a one-time token at install; the first person to use it sets their own password and TOTP. No default password exists anywhere. |

## Roles

Platform roles: **super_admin** (one or more; manage admins, platform settings), **platform_admin**
(users, approvals, quotas, announcements, audit), **user**. Platform roles grant **no access to
board content**; support access needs the workspace owner to invite the person.

| Action ↓ / workspace role → | Owner | Admin | Editor | Viewer | Guest |
| --- | --- | --- | --- | --- | --- |
| See boards and cards | ✓ | ✓ | ✓ | ✓ | shared boards only |
| Create, edit, move, delete cards and lines | ✓ | ✓ | ✓ | – | – |
| Upload pictures and files | ✓ | ✓ | ✓ | – | – |
| Restore from / empty trash | ✓ | ✓ | restore only | – | – |
| Comment | ✓ | ✓ | ✓ | ✓ | if the link allows |
| Create share links | ✓ | ✓ | – | – | – |
| Invite or remove members, change roles | ✓ | ✓ (not owners) | – | – | – |
| Export the workspace | ✓ | ✓ | – | – | – |
| Delete or transfer the workspace | ✓ | – | – | – | – |

Enforced on: every REST route (guard + repository scoping), every Socket.IO join and event,
asset downloads (signed URL only after a check), uploads, exports, search (query always filtered by
the caller's workspaces).

## Security requirements (checklist for the server milestones)

- Tenant isolation: repository layer requires `workspaceId`; tests try every route with another
  workspace's ids and expect 404.
- CSRF: double-submit token header for cookie sessions; SameSite=Lax; state-changing routes reject
  `GET`.
- CORS: exact origins from `ALLOWED_ORIGINS`; credentials only for those.
- Input: DTO validation (class-validator) with size limits; note text stored as text and rendered
  with the shared escaping renderer (already built and tested against injection).
- Uploads: size limit, MIME sniffing, images re-encoded, files served with
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- Link previews (worker): HTTPS/HTTP only, resolve DNS and refuse private, loopback, link-local and
  metadata addresses (SSRF), 5 s timeout, 1 MB cap, no redirects to refused addresses.
- WebSockets: authenticate on connect, re-check membership on every board join.
- Audit log for sign-ins, role changes, approvals, suspensions, exports, share links, settings.
- Backups encrypted (age / AES-256) before leaving the host.
- CI: `npm audit --omit=dev`, `cargo audit`, CodeQL or equivalent; Renovate for updates.
- Headers via Nginx: HSTS, CSP (`default-src 'self'`), frame-ancestors none, Referrer-Policy.

## Current state (Milestone 1)

The web app has no accounts and sends nothing anywhere; boards stay in the browser's IndexedDB.
Implemented now: escaping note renderer (tested), safe link opening (http/https only,
`noopener`), no `innerHTML` from user text except through the renderer, production dependencies
with 0 known vulnerabilities (npm audit).
