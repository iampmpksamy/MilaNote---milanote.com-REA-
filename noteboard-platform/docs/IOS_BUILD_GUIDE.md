# iPhone and iPad build guide (Capacitor 8) — 3.0.0-alpha.4

`apps/mobile/ios` is the Xcode project (Swift Package Manager, no CocoaPods), generated on the home
lab with `npx cap add ios`. **No iOS build has been made yet**: compiling, signing and testing need
macOS with Xcode. No IPA or TestFlight build exists.

| | |
| --- | --- |
| Bundle id | `com.pmpksamy.noteboard` |
| Version | 3.0.0 (build 4) — `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` |
| Devices | iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`), iOS 15+, arm64; all orientations on iPad |
| Origin | `capacitor://localhost` (allowed by the server's native CORS list) |
| Tokens | iOS Keychain, this device only (no iCloud Keychain sync) |
| Networking | App Transport Security at Apple's defaults: HTTPS with trusted certificates only |
| Privacy texts | camera (photo for a card), photo library (choose a picture), add to photos (only when asked) |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` (standard HTTPS only) |
| Layout | safe areas, phone layout with bottom tools and sheets, iPad uses the desktop layout with touch targets (MOBILE_GESTURES.md) |

Same features as Android except receiving shares from other apps (needs a Share Extension target and
an App Group, which need signing) — planned.

## Build on a Mac

```bash
cd noteboard-platform
npm ci
npx nx build web -c native
cd apps/mobile && npx cap sync ios && npx cap open ios
```

In Xcode: select the *App* target → Signing & Capabilities → your Team; run on a simulator or a
connected iPhone/iPad.

## GitHub Actions (`native-ios.yml`)

On `macos-15`, for every `v3.*` tag or by hand: builds the web bundle, `cap sync ios`, then
`xcodebuild` for the iOS Simulator and for devices **without signing** (`CODE_SIGNING_ALLOWED=NO`)
to prove the project compiles. It does not produce an installable app.

## What Apple signing will need later (not requested now)

- An Apple Developer Program membership (paid, per year) and the Team ID.
- An App ID for `com.pmpksamy.noteboard` (and later an App Group for the share extension).
- An Apple Distribution certificate (.p12 + password) and an App Store provisioning profile — or an
  App Store Connect API key (Issuer ID, Key ID, .p8) so CI can manage signing automatically.
- For TestFlight: the app record in App Store Connect, privacy "nutrition label" answers (the app
  collects nothing; data stays on the person's own server).

These would go into repository secrets (e.g. `NB_IOS_P12_B64`, `NB_IOS_P12_PASSWORD`,
`NB_IOS_PROFILE_B64`, `NB_ASC_KEY_ID`, `NB_ASC_ISSUER_ID`, `NB_ASC_KEY_P8`), never into the repository.
