import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

// Server mode (Homelab Edition): the built web app and API together. By default Playwright starts
// tools/dev-stack.mjs (in-memory MongoDB, no Docker). Set NB_BASE_URL (and NB_DATA_DIR for the
// setup token) to run the same tests against a real installation instead.
const port = 4322;
const external = process.env['NB_BASE_URL'];

export default defineConfig({
  testDir: './server',
  outputDir: '../../dist/.playwright/apps/web-e2e/server-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: external ?? `http://127.0.0.1:${port}`,
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: external
    ? undefined
    : { command: `node tools/dev-stack.mjs ${port} tmp/e2e-server`, url: `http://127.0.0.1:${port}/api/v1/ready`, reuseExistingServer: false, cwd: workspaceRoot, timeout: 120_000 },
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: process.env.NB_CHANNEL ?? 'msedge', viewport: { width: 1360, height: 860 } } }],
});
