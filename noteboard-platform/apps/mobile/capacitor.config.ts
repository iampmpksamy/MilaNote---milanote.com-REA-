/**
 * Noteboard for Android and iOS (Capacitor 8). The Angular app is bundled from
 * dist/apps/native/browser (`npx nx build web -c native`); it is NOT loaded from a server
 * (no server.url): the person chooses their Noteboard server inside the app.
 *
 * Development builds that may talk to a plain http:// server on the LAN: build the web app with
 * `-c native-dev`, then sync with NB_DEV_HTTP=1 (allows mixed content in the Android WebView) and
 * build the APK with `-PnbDevHttp=true` (allows cleartext traffic). Release builds never do.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const devHttp = process.env['NB_DEV_HTTP'] === '1';

const config: CapacitorConfig = {
  appId: 'com.pmpksamy.noteboard',
  appName: 'Noteboard',
  webDir: '../../dist/apps/native/browser',
  loggingBehavior: devHttp ? 'debug' : 'none',
  android: {
    allowMixedContent: devHttp,
    // Keystore-backed secure storage needs no backup of tokens: see backup rules in the manifest.
    webContentsDebuggingEnabled: devHttp,
  },
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#eaebee', showSpinner: false },
    StatusBar: { overlaysWebView: false },
  },
};

export default config;
