import { type Browser, expect, type Page, test } from '@playwright/test';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The Homelab Edition through a real browser: first-run setup, administrator two-step sign-in,
// an invitation without e-mail, private boards that follow the account to another browser,
// a picture, a desktop import, the admin panel and signing out. Runs in order.

const root = join(__dirname, '..', '..', '..');
const shots = join(root, '..', 'shots', process.env['NB_SHOTS'] ?? 'homelab');
mkdirSync(shots, { recursive: true });
const PW = 'correct horse battery 42';
const ADMIN = { name: 'Ann Admin', email: 'ann@example.com' };
const BOB = { name: 'Bob Member', email: 'bob@example.com' };
// Kept in a file so a later test still has them if Playwright restarts its worker after a failure.
const stateFile = join(root, '..', 'noteboard-platform', 'tmp', `e2e-state-${(process.env['NB_BASE_URL'] ?? 'local').replace(/\W+/g, '_')}.json`);
const state: { secret?: string; invite?: string } = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const keep = () => writeFileSync(stateFile, JSON.stringify(state));
const cspErrors: string[] = [];

test.beforeEach(({ page }) => {
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text());
  });
});
test.afterEach(() => {
  expect(cspErrors, 'no Content-Security-Policy violations').toEqual([]);
});

function setupToken(): string {
  if (process.env['NB_SETUP_TOKEN']) return process.env['NB_SETUP_TOKEN'];
  const file = join(root, process.env['NB_DATA_DIR'] ?? 'tmp/e2e-server', 'config', 'setup-token.json');
  return JSON.parse(readFileSync(file, 'utf8')).token;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secret: string, at = Date.now()): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

/** A code from a later 30-second step than any used before, so it is never a replay. */
let lastStep = 0;
async function freshCode(secret: string): Promise<string> {
  for (;;) {
    const step = Math.floor(Date.now() / 30000);
    const target = Math.max(step, lastStep + 1);
    // Use the current 30-second step only (each code works once; clocks may differ a little).
    if (target === step && Date.now() % 30000 < 25000) {
      lastStep = target;
      return totp(secret, target * 30000 + 1000);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** The boards have arrived from the server (the sample board has cards; Home shows before loading). */
async function loaded(page: Page) {
  await expect(page.locator('.nb-crumb.current')).toHaveText('Home');
  await expect(page.locator('.nb-world nb-card-view').first()).toBeVisible({ timeout: 15_000 });
}

async function signIn(page: Page, email: string, secret?: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PW);
  await page.getByTestId('login-submit').click();
  if (secret) {
    await page.getByTestId('login-code').fill(await freshCode(secret));
    await page.getByTestId('login-code-submit').click();
  }
  await loaded(page);
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test('first run: the setup wizard creates the super administrator and two-step sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByTestId('setup-checks')).toContainText('Database (MongoDB)');
  await expect(page.getByTestId('setup-checks').locator('li.bad')).toHaveCount(0);
  await page.screenshot({ path: join(shots, 'setup.png') });
  await page.getByTestId('setup-token').fill(setupToken());
  await page.getByTestId('setup-name').fill(ADMIN.name);
  await page.getByTestId('setup-email').fill(ADMIN.email);
  await page.getByTestId('setup-password').fill(PW);
  await page.getByTestId('setup-password2').fill(PW);
  await page.getByTestId('setup-submit').click();
  await page.getByTestId('mfa-start').click();
  const secret = (await page.getByTestId('mfa-secret').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  state.secret = secret;
  keep();
  await page.getByTestId('mfa-code').fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await page.getByRole('button', { name: "I've saved them" }).click();
  await loaded(page);
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });
  // Setup is closed for good.
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Already set up' })).toBeVisible();
});

test('the admin panel shows real numbers and makes an invitation link without e-mail', async ({ page }) => {
  await signIn(page, ADMIN.email, state.secret);
  await page.getByTestId('account-menu').click();
  await page.getByTestId('menu-admin').click();
  const ov = page.getByTestId('overview');
  await expect(ov).toContainText('active accounts');
  await expect(ov.locator('div').first().locator('b')).toHaveText('1');
  await page.screenshot({ path: join(shots, 'admin-overview.png') });
  await page.getByTestId('tab-invitations').click();
  await page.getByTestId('inv-email').fill(BOB.email);
  await page.getByTestId('inv-submit').click();
  const url = await page.getByTestId('admin-link-url').inputValue();
  expect(url).toMatch(/\/invite\/[\w-]{20,}$/);
  state.invite = new URL(url).pathname;
  keep();
  await expect(page.getByTestId('invitations')).toContainText('open');
  await page.getByTestId('tab-health').click();
  await expect(page.getByTestId('health').locator('li')).toHaveCount(5);
  await page.getByTestId('tab-users').click();
  await expect(page.getByTestId('users')).toContainText(ADMIN.email);
  await page.screenshot({ path: join(shots, 'admin-users.png') });
});

test('an invited person creates an account and their boards follow them to another browser', async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(state.invite!);
  await expect(page.getByTestId('reg-email')).toHaveValue(BOB.email);
  await page.getByTestId('reg-name').fill(BOB.name);
  await page.getByTestId('reg-password').fill(PW);
  await page.getByTestId('reg-password2').fill(PW);
  await page.getByTestId('reg-submit').click();
  await loaded(page);
  // Write a note.
  const r = (await page.locator('.nb-canvas').boundingBox())!;
  await page.mouse.dblclick(r.x + 200, r.y + r.height - 120);
  await expect(page.locator('textarea.nb-note-edit')).toBeFocused();
  await page.keyboard.type('Only Bob can read this – வணக்கம்');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });
  // A picture, uploaded to the server.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DAwMDAxMDAAAAeAQIBnCzk7wAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('input[type=file]').first().setInputFiles({ name: 'square.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('nb-card-view img').first()).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });
  await page.screenshot({ path: join(shots, 'boards.png') });

  const other = await newPage(browser);
  await signIn(other, BOB.email);
  await expect(other.locator('nb-card-view', { hasText: 'Only Bob can read this' })).toBeVisible();
  const img = other.locator('nb-card-view img').first();
  await expect(img).toBeVisible();
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(8);
});

test("the administrator sees usage but never the member's boards", async ({ page }) => {
  await signIn(page, ADMIN.email, state.secret);
  await expect(page.locator('nb-card-view', { hasText: 'Only Bob can read this' })).toHaveCount(0);
  const r = await page.request.get('/api/v1/admin/users');
  const bob = (await r.json()).users.find((u: { email: string }) => u.email === BOB.email);
  expect(bob.usage.cards).toBeGreaterThan(0);
  expect(JSON.stringify(bob)).not.toContain('Only Bob');
  expect((await page.request.get('/api/v1/assets')).status()).toBe(200);
  expect((await (await page.request.get('/api/v1/assets')).json()).names).toEqual([]);
});

test('desktop boards import into the account through Settings', async ({ browser }) => {
  const file = join(root, '..', 'backups', 'user-boards-v1.json');
  test.skip(!existsSync(file), 'no copy of desktop boards available');
  const page = await newPage(browser);
  await signIn(page, BOB.email);
  await page.getByTestId('settings').click();
  await page.locator('.nb-settings nav button', { hasText: 'Privacy' }).click();
  await expect(page.locator('.nb-settings')).toContainText('saved to your');
  await page.getByTestId('import-file').setInputFiles(file);
  await expect(page.getByTestId('import-report')).toContainText('Ready to import');
  await page.getByTestId('import-apply').click();
  await expect(page.locator('.nb-crumb.current')).toContainText('Imported from desktop');
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });
  const again = await newPage(browser);
  await signIn(again, BOB.email);
  await expect(again.locator('nb-card-view.nb-board', { hasText: 'Imported from desktop' })).toBeVisible();
});

test('the account page, export and signing out', async ({ page }) => {
  await signIn(page, BOB.email);
  await page.getByTestId('account-menu').click();
  await page.getByTestId('menu-account').click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await page.screenshot({ path: join(shots, 'account.png') });
  const download = page.waitForEvent('download');
  await page.getByTestId('export').click();
  expect((await download).suggestedFilename()).toMatch(/^noteboard-export-.*\.tar\.gz$/);
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
