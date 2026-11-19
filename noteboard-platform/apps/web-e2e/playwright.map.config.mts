import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

// Map cards in server mode: like playwright.server.config.mts (tools/dev-stack.mjs, in-memory
// MongoDB, no Docker) on its own port and data folder, with the server's map search and map
// pictures pointed at a fake map service on this machine (server/fake-geo.mjs): no internet.
// Run: npx playwright test -c apps/web-e2e/playwright.map.config.mts
const port = 4348;
const fakePort = 47348;
const fake = `http://127.0.0.1:${fakePort}`;

export default defineConfig({
  testDir: './server',
  testMatch: 'cards-map.spec.ts',
  outputDir: '../../dist/.playwright/apps/web-e2e/map-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1360, height: 860 },
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: `node apps/web-e2e/server/fake-geo.mjs ${fakePort}`, url: `${fake}/health`, reuseExistingServer: false, cwd: workspaceRoot, timeout: 20_000 },
    {
      command: `node tools/dev-stack.mjs ${port} tmp/e2e-map`,
      url: `http://127.0.0.1:${port}/api/v1/ready`,
      reuseExistingServer: false,
      cwd: workspaceRoot,
      timeout: 120_000,
      env: { MAP_SEARCH_URL: `${fake}/search?format=jsonv2&limit=6&addressdetails=1&q={q}`, MAP_TILE_URL: `${fake}/tiles/{z}/{x}/{y}.png`, NB_FAKE_GEO: fake },
    },
  ],
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: process.env.NB_CHANNEL ?? 'msedge', viewport: { width: 1360, height: 860 } } }],
});
