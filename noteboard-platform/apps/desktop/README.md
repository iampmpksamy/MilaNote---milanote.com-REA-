# Noteboard for Windows (Tauri v2)

The shared Angular app (`dist/apps/native/browser`, built with `npx nx build web -c native`) in a
native window. It connects to the Noteboard server you choose; sign-in tokens are kept in the
Windows Credential Manager. See `docs/WINDOWS_BUILD_GUIDE.md`.

```
npx nx build web -c native
(cd apps/desktop && npx tauri build)   # on Windows: NSIS .exe + .msi
```
