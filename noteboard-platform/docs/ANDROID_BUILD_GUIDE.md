# Android build guide (Capacitor 8) — 3.0.0-alpha.4

`apps/mobile` is the Capacitor project. The Angular app is **bundled into the APK** from
`dist/apps/native/browser`; the app is not a wrapper around a website (no `server.url`). The person
chooses their Noteboard server inside the app (SERVER_DISCOVERY.md).

| | |
| --- | --- |
| Application id | `com.pmpksamy.noteboard` (check it is free before publishing to Google Play) |
| Version | from `noteboard-platform/package.json`; versionCode = 3·10⁷ + minor·10⁵ + patch·10³ + pre-release number (3.0.0-alpha.4 → 30000004; 3.0.0 → 30000999) |
| SDK | min 24 (Android 7), target/compile 36 |
| Toolchain used | JDK 21, Android SDK platform 36, build-tools 35/36, Gradle 8.14.3 (wrapper), Node 22.23 |
| Permissions | INTERNET, CAMERA (only when taking a photo for a card), VIBRATE (long-press feedback) |
| Backups | off (`allowBackup=false`, data-extraction rules exclude everything): tokens are tied to this device's keystore |
| Network | HTTPS only, system certificates only (`src/https/res/xml/network_security_config.xml`) |

Plugins: app, app-launcher, clipboard, filesystem, haptics, keyboard, preferences, share,
splash-screen, status-bar (all `@capacitor/*` 8.x) and `@aparajita/capacitor-secure-storage` 8.0.1
(Android Keystore, AES-GCM). Plus `ShareInPlugin.java` in the project (receives shares from other apps).

## Debug APK (what was built on the home lab)

```bash
cd noteboard-platform
npm ci
npx nx build web -c native            # the bundled UI (https servers only)
cd apps/mobile && npx cap sync android
cd android && ANDROID_HOME=$HOME/Android/Sdk ./gradlew assembleDebug
# → app/build/outputs/apk/debug/Noteboard-3.0.0-alpha.4-android-debug.apk
```

Or in one step: `npx nx run mobile:apk-debug`. `android/local.properties` (not in Git) holds
`sdk.dir=…`.

Install on a phone (USB debugging on): `adb install -r Noteboard-3.0.0-alpha.4-android-debug.apk`.
A debug APK is signed with the local debug key and can be installed side by side with nothing else;
Android shows "unknown app" warnings for side-loaded APKs.

## Development build for a plain-http LAN server

Only for testing against a server without HTTPS on your own network (the app shows a warning):

```bash
npx nx build web -c native-dev
cd apps/mobile && NB_DEV_HTTP=1 npx cap sync android
cd android && ./gradlew assembleDebug -PnbDevHttp=true
# → Noteboard-3.0.0-alpha.4-android-debug-devhttp.apk
```

## Signed release (APK + AAB for Google Play)

You need an **upload key** (keep it and its passwords safe; Google Play App Signing holds the
final key). Create one once:

```bash
keytool -genkeypair -v -keystore noteboard-upload.jks -alias noteboard -keyalg RSA -keysize 4096 -validity 10000
```

Locally: `apps/mobile/android/keystore.properties` (ignored by Git):

```
storeFile=/absolute/path/noteboard-upload.jks
storePassword=…
keyAlias=noteboard
keyPassword=…
```

then `./gradlew assembleRelease bundleRelease`. In GitHub Actions (`native-android.yml`), add the
repository secrets `NB_ANDROID_KEYSTORE_B64` (`base64 -w0 noteboard-upload.jks`),
`NB_ANDROID_KEYSTORE_PASSWORD`, `NB_ANDROID_KEY_ALIAS`, `NB_ANDROID_KEY_PASSWORD`. Without them the
workflow builds the debug APK only. Keystores, `*.jks` and `keystore.properties` are in `.gitignore`.

## Icons and splash

`python tools/make_native_icons.py noteboard-platform` draws Noteboard's own icon (the same artwork as
the web app and CasaOS tile) into the launcher, adaptive, round and splash images.

## Testing

- Without a phone: `npx nx build web -c native-dev && npx playwright test -c apps/web-e2e/playwright.native.config.mts`
  runs the bundled app in mobile Chrome emulation against a throw-away server (10 tests).
- Emulator: needs hardware virtualisation (KVM). The home lab has none (`/dev/kvm` missing), so no
  emulator ran there.
- Phone: install the APK, connect to a **test account** (not the production data), and go through
  docs/TEST_REPORT section "Native apps".
