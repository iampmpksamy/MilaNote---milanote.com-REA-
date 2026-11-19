import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// The tests run the production build in Microsoft Edge (installed with Windows), served by a tiny
// static server that Playwright starts before the tests and stops afterwards.
const port = 4321;

export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node tools/serve.mjs dist/apps/web/browser ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    cwd: workspaceRoot,
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: process.env.NB_CHANNEL ?? 'msedge', viewport: { width: 1360, height: 860 } } }],
});
