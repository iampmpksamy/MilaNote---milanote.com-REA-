import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The offline settings generator (deploy/installer/index.html), opened straight from disk.
const page = pathToFileURL(join(__dirname, '..', '..', '..', '..', 'deploy', 'installer', 'index.html')).href;

test('settings generator: defaults, validation and the generated CasaOS file', async ({ page: p }) => {
  const requests: string[] = [];
  p.on('request', (r) => {
    if (!r.url().startsWith('file:')) requests.push(r.url());
  });
  await p.goto(page);
  const out = p.locator('#out');
  await expect(out).toContainText('x-casaos:');
  await expect(out).toContainText('main: noteboard-gateway');
  await expect(out).toContainText('port_map: "8765"');
  await expect(out).toContainText('"0.0.0.0:8765:8080"');
  await expect(out).toContainText('"/DATA/AppData/noteboard/database:/data/database"');
  await expect(out).toContainText('TZ: "Asia/Kolkata"');
  await expect(out).toContainText('REGISTRATION_MODE: "invite"');
  await expect(out).not.toContainText('PASSWORD: "');

  await p.locator('input[name=port]').fill('80');
  await expect(p.locator('#problems')).toContainText('Host port');
  await p.locator('input[name=port]').fill('9100');
  await p.locator('input[name=publicUrl]').fill('notes.example.com');
  await expect(p.locator('#problems')).toContainText('Public address');
  await p.locator('input[name=publicUrl]').fill('https://boards.example.org');
  await p.locator('input[name=dataPath]').fill('/mnt/ssd/noteboard');
  await p.locator('input[name=smtpEnabled]').check();
  await expect(p.locator('#problems')).toContainText('SMTP server');
  await p.locator('input[name=smtpHost]').fill('smtp.example.org');
  await p.locator('input[name=smtpFrom]').fill('Boards <boards@example.org>');
  await expect(p.locator('#problems')).toBeEmpty();
  await expect(out).toContainText('"0.0.0.0:9100:8080"');
  await expect(out).toContainText('port_map: "9100"');
  await expect(out).toContainText('APP_PUBLIC_URL: "https://boards.example.org"');
  await expect(out).toContainText('"/mnt/ssd/noteboard/uploads:/data/uploads"');
  await expect(out).toContainText('SMTP_ENABLED: "true"');

  await p.getByRole('button', { name: '.env' }).click();
  await expect(out).toContainText('APP_PORT=9100');
  await p.getByRole('button', { name: 'Connection steps' }).click();
  await expect(out).toContainText('Cloudflare Tunnel');
  await expect(out).toContainText('boards.example.org');
  await p.locator('select[name=connection]').selectOption('lan');
  await expect(out).toContainText('Tailscale');
  expect(requests, 'the generator works offline and sends nothing').toEqual([]);
});
