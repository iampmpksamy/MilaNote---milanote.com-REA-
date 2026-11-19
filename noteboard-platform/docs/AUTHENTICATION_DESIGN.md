# AUTHENTICATION DESIGN

Built in the Homelab Edition: see [HOMELAB_EDITION.md §3–4](HOMELAB_EDITION.md) (setup, sessions,
passwords, two-step sign-in, invitations, recovery). The longer-term design (OAuth, native PKCE
sign-in) stays in [SECURITY_AND_ACCESS.md](SECURITY_AND_ACCESS.md).

Native apps (Android, iOS, Windows, 3.0.0-alpha.4): bearer tokens with rotating refresh tokens kept
in the system's protected storage, CORS for the app origins only, browser cookies and CSRF unchanged —
see [NATIVE_AUTHENTICATION.md](NATIVE_AUTHENTICATION.md).
