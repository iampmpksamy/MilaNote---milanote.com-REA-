# Native authentication (Android, iOS, Windows) — 3.0.0-alpha.4

The browser keeps its existing sign-in unchanged: an HttpOnly session cookie (`__Host-nb_session`
over HTTPS), a CSRF cookie echoed in `X-CSRF-Token`, and an Origin check on every change. The native
apps can't use that safely (their pages are not on the server's origin, and third-party cookies are
unreliable in webviews), so they get a separate, token-based session.

## How an app request is recognised

- Every app request carries `X-Noteboard-Client: native` (and `X-Noteboard-App: Noteboard Android
  3.0.0-alpha.4`, shown on the account page).
- For such a request the server **ignores all cookies** and only accepts `Authorization: Bearer
  <access token>`. Because nothing ambient (no cookie) can sign the request in, CSRF does not apply
  and the CSRF check is skipped for these requests only.
- A browser page on another site can't send that header without a CORS preflight, and the preflight
  is answered only for the app origins (below). Even if it could, it would have no token.
- A native-marked request with an `Origin` that is neither an app origin nor the server itself is
  refused (`403 bad_origin`).

## CORS

Only for the native apps' own origins, exact matches, never `*`, never with credentials:

| App | Origin |
| --- | --- |
| Android (Capacitor) | `https://localhost` |
| iOS / iPadOS (Capacitor) | `capacitor://localhost` |
| Windows (Tauri v2) | `http://tauri.localhost` |
| Tauri on other systems | `tauri://localhost` |

Changeable with `NATIVE_ORIGINS` (comma-separated). Allowed headers: `Authorization, Content-Type,
X-Noteboard-Client, X-Noteboard-App`; exposed: `Content-Disposition, Content-Length, ETag`.

## Tokens

| | Access token | Refresh token |
| --- | --- | --- |
| Lifetime | 15 minutes (`ACCESS_MINUTES`) | 30 days, extended on each use (`SESSION_DAYS`) |
| Kept by the app | in memory only | Android Keystore (AES-GCM) / iOS Keychain (this device only, no iCloud sync) / Windows Credential Manager (DPAPI) |
| Kept by the server | SHA-256 hash | SHA-256 hash, plus the previous one |
| Sent as | `Authorization: Bearer …` | body of `POST /api/v1/native/refresh` |

- **Rotation:** each refresh returns a new access token *and* a new refresh token; the old refresh
  token stops working.
- **Reuse detection:** if a refresh token that was already replaced is presented again, someone has
  a copy: the whole session is deleted (`401 session_revoked`) and both the thief and the real app
  must sign in again. The event is written to the audit log (`auth.refresh_reused`).
- **Expiry:** an expired access token answers `401 token_expired`; the app refreshes once and
  repeats the request. A `401 signed_out` (session gone) sends the app back to sign-in.
- **Revocation:** app sessions are ordinary session records: *Sign out* in the app, *Signed-in
  devices → Sign out* on the account page, a password change/reset, suspension by an administrator
  and the console recovery all end them immediately.

## Flows (same routes as the browser, tokens instead of a cookie)

| Step | Request | App receives |
| --- | --- | --- |
| Check the server | `GET /api/v1/discovery` | `native.auth = "bearer-v1"` means the server supports apps |
| Sign in | `POST /api/v1/auth/login` | `tokens` (+ `mfaRequired`) |
| Two-step code | `POST /api/v1/auth/mfa` with the (MFA-pending) access token | the session becomes usable |
| Accept an invitation | `POST /api/v1/auth/register` | `tokens` |
| Password link | `POST /api/v1/auth/password/reset` | — (then sign in) |
| Keep signed in | `POST /api/v1/native/refresh` | new `tokens` |
| Sign out | `POST /api/v1/native/logout` | — (both tokens end) |

A session that still waits for the two-step code can do nothing except send the code (`401
mfa_required` everywhere else), exactly like the browser.

Invitation and password links are web addresses; in the apps they are pasted into the sign-in screen
("Invitation or password link") and opened inside the app — only if the link belongs to the server
the app is connected to.

## Account and server isolation

- Tokens are stored under a key made from the server address **and** the account id; a token is
  only ever sent to the server it came from. Changing the server address never sends existing tokens
  to the new address.
- Each server keeps its own list of accounts; switching account or server reloads the app so nothing
  from the previous account stays in memory.
- Unsent changes (see OFFLINE_SYNC.md) are kept per server and account.
- *Forget server* ends the session on that server (best effort) and deletes its tokens on the device.

## What is not stored

Passwords are never stored by the apps. Nothing secret is written to `localStorage`, the WebView
cache or app backups (Android backups are switched off; iOS keychain items are this-device-only).

## Tests

`apps/api/integration/native.test.mjs` (15 tests): discovery, CORS for each app origin and refusal
for others, refusal of native-marked requests from web sites, invitation acceptance with tokens and
no cookies, password sign-in, cookies ignored on native requests, cross-device read in a browser,
refresh rotation, reuse detection, expired access tokens, revocation from the browser's account page,
sign-out, two-step sign-in, idempotent saves. Browser sessions keep their own tests (CSRF refusal,
cookie sessions) unchanged.
