# Choosing a server in the apps (server discovery)

The apps contain the whole user interface; the only thing that comes from the network is the person's
own Noteboard server. On first launch the app opens **Connect to your Noteboard**.

## The screen

- The address field is pre-filled with the suggestion `https://notes.6dainas.cloud` and can be changed.
- What can be typed: a domain (`notes.example.com` → `https://notes.example.com`), a full `https://`
  address, a Cloudflare Tunnel hostname, a Tailscale HTTPS name (`*.ts.net`), or a static IP with a
  certificate the device trusts. A path is allowed; user names, `?` and `#` are not.
- **Test connection** asks `GET <address>/api/v1/discovery` (10 s timeout) and shows the server's
  name and version. **Save and continue** is only possible after a successful test.
- Several servers are remembered; each lists its signed-in accounts. *Sign in with another account*,
  switching to a remembered account, and *Forget* are on the same screen (also reachable from the
  account menu → *Switch account or server*).

## What the check verifies

| Check | Result when it fails |
| --- | --- |
| The address answers at all (TLS included) | "Can't reach the server … needs a certificate this device trusts." |
| It answers JSON with `product: "noteboard"` | "… not a Noteboard server" |
| `minClientApiVersion` ≤ the app's API version (1) | "This server needs a newer version of the app" |
| `apiVersion` ≥ 1 and `native.auth = "bearer-v1"` | "This server is too old for the apps. Update the server to 3.0.0-alpha.4 or newer." |
| `setupRequired` is false | "This server isn't set up yet. Open …/setup in a browser" (first-run setup needs the token from the server log, so it stays a browser task) |
| `publicUrl` differs from the typed address | a note is shown; the typed address is used |

The same check runs at every start. If the server can't be reached (home lab off, no network), the
app shows why, with *Try again* and *Change server*; it never shows sample boards in place of the
real ones and never saves anything while the boards are not loaded.

## Security rules

- **TLS is never relaxed.** Release builds accept `https://` only, with certificates the operating
  system trusts (Android network security config, iOS App Transport Security defaults, WebView2).
  Self-signed certificates are not accepted; use Cloudflare Tunnel, Tailscale HTTPS or a real
  certificate.
- **Plain `http://`** is accepted only by *development builds* (web app built with
  `-c native-dev`; Android additionally built with `-PnbDevHttp=true` and synced with
  `NB_DEV_HTTP=1`). The app then shows a warning on the connect screen and in the server list.
- Tokens are tied to the server they came from (see NATIVE_AUTHENTICATION.md).

## Compatibility

`apiVersion`/`minClientApiVersion` in discovery let old apps and new servers detect each other. The
apps need a server ≥ 3.0.0-alpha.4 (native sign-in); browsers work with any version as before.
