import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

/**
 * The native app bundle (dist/apps/native/browser, built with `-c native-dev`) in mobile Chrome
 * emulation, talking cross-origin to a separate development server with bearer tokens, exactly as
 * the Android/iOS apps do. `window.__nbPlatform` makes the bundle take its native code paths; the
 * Capacitor plugins then use their web implementations. The real Android/iOS bridge, Keystore and
 * Keychain are not exercised here (see docs/TEST_REPORT.md).
 *
 * Build first: npx nx build web -c native-dev && npx nx build api
 */
const stack = 4324;
const app = 4331;

export default defineConfig({
  testDir: './native',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${app}`, trace: 'retain-on-failure', channel: process.env['NB_CHANNEL'] ?? 'chrome' },
  webServer: [
    {
      command: `node tools/dev-stack.mjs ${stack} tmp/e2e-native`,
      url: `http://127.0.0.1:${stack}/api/v1/ready`,
      env: { NATIVE_ORIGINS: `http://127.0.0.1:${app},https://localhost,capacitor://localhost` },
      reuseExistingServer: false,
      cwd: workspaceRoot,
      timeout: 120_000,
    },
    { command: `node tools/serve.mjs dist/apps/native/browser ${app}`, url: `http://127.0.0.1:${app}`, reuseExistingServer: false, cwd: workspaceRoot },
  ],
  projects: [
    { name: 'android-phone', use: { ...devices['Pixel 7'], channel: process.env['NB_CHANNEL'] ?? 'chrome' } },
  ],
});
