import { type BrowserContext, type CDPSession, devices, expect, type Page, test } from '@playwright/test';
import crypto from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Android/iOS app bundle against a separate development server (never the production data):
// choosing the server, accepting an invitation, two-step sign-in, touch editing, pictures, saving
// through a broken connection, signing out, account isolation and switching servers.

const root = join(__dirname, '..', '..', '..');
const shots = join(root, '..', 'shots', 'native-alpha4');
mkdirSync(shots, { recursive: true });
const SERVER = 'http://127.0.0.1:4324';
const PW = 'correct horse battery 42';
const S: { invite?: string; secret?: string; phoneCtx?: BrowserContext; laptopCtx?: BrowserContext } = {};

// ---------- server preparation (as the administrator, through the browser API) ----------

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
let lastStep = 0;
async function freshCode(secret: string): Promise<string> {
  for (;;) {
    const step = Math.floor(Date.now() / 30000);
    if (step > lastStep && Date.now() % 30000 < 25000) {
      lastStep = step;
      return totp(secret);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** A browser-style client (cookie + CSRF) for preparing the server. */
function browserClient() {
  const jar = new Map<string, string>();
  return async (method: string, path: string, body?: unknown) => {
    const h: Record<string, string> = { origin: SERVER };
    if (jar.size) h['cookie'] = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (jar.get('nb_csrf') && method !== 'GET') h['x-csrf-token'] = jar.get('nb_csrf')!;
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(SERVER + '/api/v1' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const data = (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : null;
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
}

// A stand-in for a Noteboard server older than 3.0.0-alpha.4: it answers, but has no CORS for apps.
let oldServer: Server;
const OLD = 'http://127.0.0.1:4998';
test.beforeAll(async () => {
  oldServer = createServer((req, res) => {
    if (req.method === 'OPTIONS') return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ product: 'noteboard', apiVersion: 1, minClientApiVersion: 1, serverVersion: '3.0.0-alpha.3' }));
  });
  await new Promise<void>((r) => oldServer.listen(4998, '127.0.0.1', () => r()));
});
test.afterAll(() => oldServer?.close());

test.beforeAll(async () => {
  const admin = browserClient();
  await admin('GET', '/discovery');
  const token = JSON.parse(readFileSync(join(root, 'tmp/e2e-native/config/setup-token.json'), 'utf8')).token;
  await admin('POST', '/setup', { token, name: 'Ann Admin', email: 'ann@example.com', password: PW, passwordConfirm: PW });
  const m = await admin('POST', '/me/mfa/setup');
  S.secret = m.secret;
  await admin('POST', '/me/mfa/enable', { code: await freshCode(S.secret!) });
  const inv = await admin('POST', '/admin/invitations', { email: 'bob@example.com', hours: 24 });
  S.invite = inv.link;
});

// ---------- helpers ----------

/** Opens the app as the Android (or iOS) build: native code paths, phone screen, touch. */
async function openApp(ctx: BrowserContext, platform: 'android' | 'ios' = 'android'): Promise<Page> {
  await ctx.addInitScript((p) => ((window as { __nbPlatform?: string }).__nbPlatform = p), platform);
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    // CORS refusals are only expected from the stand-in for an old server (port 4998).
    if (/Content Security Policy|CORS/i.test(msg.text()) && !msg.text().includes('127.0.0.1:4998')) throw new Error(`browser said: ${msg.text()}`);
  });
  await page.goto('/');
  return page;
}

async function touch(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}
type P = { x: number; y: number };
async function touchDrag(cdp: CDPSession, from: P, to: P, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
  for (let i = 1; i <= steps; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function pinch(cdp: CDPSession, c: P, from: number, to: number) {
  const pts = (d: number) => [
    { x: c.x - d / 2, y: c.y, id: 1 },
    { x: c.x + d / 2, y: c.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function longPress(cdp: CDPSession, at: P) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  await new Promise((r) => setTimeout(r, 750));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp: CDPSession, at: P) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const centre = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const zoomOf = (page: Page) => page.locator('.nb-world').evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? 1));
async function loaded(page: Page) {
  await expect(page.locator('.nb-crumb.current')).toHaveText('Home', { timeout: 15_000 });
  await expect(page.locator('.nb-world nb-card-view').first()).toBeVisible({ timeout: 15_000 });
}
async function connect(page: Page) {
  await expect(page).toHaveURL(/\/connect$/);
  await page.getByTestId('server-url').fill(SERVER);
  await page.getByTestId('server-test').click();
  await expect(page.getByTestId('insecure-warning')).toBeVisible();
  await expect(page.getByTestId('connect-ok')).toContainText('Noteboard');
  await page.getByTestId('server-save').click();
  await expect(page).toHaveURL(/\/login$/);
}

// ---------- the tests (in order, one phone) ----------

test.describe.configure({ mode: 'serial' });
let ctx: BrowserContext;
let page: Page;

test('first launch asks for the server, suggests the home server, and checks it', async ({ browser }) => {
  ctx = await browser.newContext({ ...devices['Pixel 7'] });
  page = await openApp(ctx);
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.getByTestId('server-url')).toHaveValue('https://notes.6dainas.cloud');
  await page.screenshot({ path: join(shots, 'android-connect.png') });
  // Not a valid address, then a server that isn't there.
  await page.getByTestId('server-url').fill('notes example');
  await page.getByTestId('server-test').click();
  await expect(page.getByTestId('connect-error')).toContainText('not a valid address');
  await page.getByTestId('server-url').fill('http://127.0.0.1:1');
  await page.getByTestId('server-test').click();
  await expect(page.getByTestId('connect-error')).toContainText("Can't reach the server");
  await expect(page.getByTestId('server-save')).toBeDisabled();
  // A server that answers but is too old for the apps is named as such, not as unreachable.
  await page.getByTestId('server-url').fill(OLD);
  await page.getByTestId('server-test').click();
  await expect(page.getByTestId('connect-error')).toContainText("doesn't let the apps in yet");
  await connect(page);
  await expect(page.getByTestId('login-server')).toContainText(SERVER);
});

test('accepts an invitation pasted into the app and opens the boards', async () => {
  await page.getByTestId('paste-link').fill('https://elsewhere.example/invite/abcdefghijklmnop');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('alert')).toContainText('not ' + SERVER);
  await page.getByTestId('paste-link').fill(S.invite!);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('reg-email')).toHaveValue('bob@example.com');
  await page.getByTestId('reg-name').fill('Bob Member');
  await page.getByTestId('reg-password').fill(PW);
  await page.getByTestId('reg-password2').fill(PW);
  await page.getByTestId('reg-submit').click();
  await loaded(page);
  // Tokens: the refresh token is in protected storage (here the plugin's web stand-in), never a cookie.
  expect((await ctx.cookies(SERVER)).filter((c) => c.name.includes('session'))).toEqual([]);
  await page.screenshot({ path: join(shots, 'android-boards.png') });
});

test('touch: tap a tool, type a note, drag it with a finger, pinch to zoom, pan, long press', async () => {
  const cdp = await touch(page);
  await tap(cdp, await centre(page, '[data-tool="Note"]'));
  await expect(page.locator('textarea.nb-note-edit')).toBeFocused();
  await page.keyboard.type('Written on the phone – வணக்கம்');
  await page.evaluate(() => window.dispatchEvent(new Event('nb-back', { cancelable: true }))); // Back closes the editor
  await expect(page.locator('textarea.nb-note-edit')).toHaveCount(0);
  const note = page.locator('nb-card-view', { hasText: 'Written on the phone' });
  await expect(note).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });

  // One finger drags the card.
  const before = await note.evaluate((el) => (el as HTMLElement).style.left);
  const c = await centre(page, 'nb-card-view:has-text("Written on the phone")');
  await touchDrag(cdp, c, { x: c.x - 60, y: c.y - 80 });
  await expect.poll(() => note.evaluate((el) => (el as HTMLElement).style.left)).not.toBe(before);

  // Two fingers zoom, one finger on empty board pans.
  const canvas = (await page.locator('.nb-canvas').boundingBox())!;
  const z0 = await zoomOf(page);
  await pinch(cdp, { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height - 60 }, 80, 160);
  await expect.poll(() => zoomOf(page)).toBeGreaterThan(z0 * 1.5);
  await pinch(cdp, { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height - 60 }, 160, 80);
  const pan0 = await page.locator('.nb-world').evaluate((el) => (el as HTMLElement).style.transform);
  await touchDrag(cdp, { x: canvas.x + 20, y: canvas.y + canvas.height - 20 }, { x: canvas.x + 120, y: canvas.y + canvas.height - 120 });
  await expect.poll(() => page.locator('.nb-world').evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(pan0);

  // Long press opens the menu as a bottom sheet; Back closes it.
  await longPress(cdp, await centre(page, 'nb-card-view:has-text("Written on the phone")'));
  const menu = page.locator('.nb-menu');
  await expect(menu).toBeVisible();
  const mb = (await menu.boundingBox())!;
  expect(mb.width).toBeGreaterThan(300); // full-width sheet, not a tiny desktop menu
  await page.screenshot({ path: join(shots, 'android-long-press-menu.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('nb-back', { cancelable: true })));
  await expect(menu).toHaveCount(0);
});

test('a picture from the gallery is uploaded and shown through the signed-in session', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DAwMDAxMDAAAAeAQIBnCzk7wAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  const img = page.locator('nb-card-view img').first();
  await expect(img).toBeVisible();
  expect(await img.getAttribute('src')).toMatch(/^blob:/); // fetched with the token, not a cookie URL
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });
});

test('reopening the app keeps you signed in (refresh token) and the boards come back', async () => {
  await page.reload();
  await loaded(page);
  await expect(page.locator('nb-card-view', { hasText: 'Written on the phone' })).toBeVisible();
});

test('another device (a browser) sees the same boards', async ({ browser }) => {
  const b = await browser.newContext();
  const p = await b.newPage();
  await p.goto(SERVER + '/login');
  await p.getByTestId('login-email').fill('bob@example.com');
  await p.getByTestId('login-password').fill(PW);
  await p.getByTestId('login-submit').click();
  await expect(p.locator('nb-card-view', { hasText: 'Written on the phone' })).toBeVisible({ timeout: 15_000 });
  await b.close();
});

test('a broken connection: changes are kept and sent when the server answers again', async () => {
  await page.route('**/api/v1/workspace', (r) => (r.request().method() === 'PUT' ? r.abort('internetdisconnected') : r.continue()));
  const cdp = await touch(page);
  await tap(cdp, await centre(page, '[data-tool="Note"]'));
  await expect(page.locator('textarea.nb-note-edit')).toBeFocused();
  await page.keyboard.type('Typed while offline');
  await page.evaluate(() => window.dispatchEvent(new Event('nb-back', { cancelable: true })));
  await expect(page.getByTestId('banner')).toContainText("You're offline", { timeout: 15_000 });
  await page.screenshot({ path: join(shots, 'android-offline-banner.png') });
  await page.unroute('**/api/v1/workspace');
  await page.getByRole('button', { name: 'Try now' }).click();
  await expect(page.getByTestId('banner')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 15_000 });
  await page.reload();
  await loaded(page);
  await expect(page.locator('nb-card-view', { hasText: 'Typed while offline' })).toBeVisible();
});

test('sign out ends the session; another account (with two-step sign-in) sees only its own boards', async () => {
  await page.getByTestId('account-menu').click();
  await expect(page.getByTestId('menu-server')).toHaveText(SERVER);
  await page.getByTestId('menu-signout').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload(); // no token left: stays signed out
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId('login-email').fill('ann@example.com');
  await page.getByTestId('login-password').fill(PW);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('login-code').fill(await freshCode(S.secret!));
  await page.getByTestId('login-code-submit').click();
  await loaded(page);
  await expect(page.locator('nb-card-view', { hasText: 'Written on the phone' })).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText(/Saved/, { timeout: 10_000 });
});

test('switching servers: a second server is remembered separately; an unavailable one is explained', async () => {
  await page.getByTestId('account-menu').click();
  await page.getByTestId('menu-switch').click();
  await expect(page.getByTestId('server-list')).toContainText('Ann Admin');
  // Add a second (unreachable) server, as if the home lab were off.
  await page.getByTestId('server-url').fill('http://127.0.0.1:1');
  await page.getByTestId('server-test').click();
  await expect(page.getByTestId('connect-error')).toBeVisible();
  // Back to the working server and account without signing in again.
  await page.getByRole('button', { name: /Ann Admin/ }).click();
  await loaded(page);
  await page.screenshot({ path: join(shots, 'android-switch.png') });
  await ctx.close();
});

// ---------- offline editing ----------

/** The server stops answering (the app's own files stay available, as they are bundled on a phone). */
const serverDown = (p: Page) => p.route(`${SERVER}/**`, (r) => r.abort('internetdisconnected'));
const serverUp = (p: Page) => p.unroute(`${SERVER}/**`);

async function browserSignIn(browser: Parameters<Parameters<typeof test>[1]>[0]['browser']) {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`${SERVER}/login`);
  await p.getByTestId('login-email').fill('bob@example.com');
  await p.getByTestId('login-password').fill(PW);
  await p.getByTestId('login-submit').click();
  await loaded(p);
  return { c, p };
}

/** Opens Unsorted (already open after an earlier test, or the pill hidden by a banner on a phone). */
async function openUnsorted(p: Page) {
  if (!(await p.locator('.nb-drawer').isVisible())) await p.getByTestId('unsorted-pill').dispatchEvent('click');
  await expect(p.locator('.nb-drawer')).toBeVisible();
}

async function newNote(p: Page, text: string, viaTouch = true) {
  if (viaTouch) await tap(await touch(p), await centre(p, '[data-tool="Note"]'));
  else await p.locator('[data-tool="Note"]').click();
  await expect(p.locator('textarea.nb-note-edit')).toBeFocused();
  await p.keyboard.type(text);
  if (viaTouch) await p.evaluate(() => window.dispatchEvent(new Event('nb-back', { cancelable: true })));
  else await p.keyboard.press('Escape');
}

test('offline: the app opens without the server, edits and a picture are kept, merged with another device later', async ({ browser }) => {
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await openApp(phoneCtx);
  await connect(phone);
  await phone.getByTestId('login-email').fill('bob@example.com');
  await phone.getByTestId('login-password').fill(PW);
  await phone.getByTestId('login-submit').click();
  await loaded(phone);
  await expect(phone.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });

  // The server goes away; the app is closed and opened again.
  await serverDown(phone);
  await phone.reload();
  await loaded(phone);
  await expect(phone.getByTestId('banner')).toContainText("You're offline");
  await newNote(phone, 'Made offline on the phone');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DAwMDAxMDAAAAeAQIBnCzk7wAAAABJRU5ErkJggg==', 'base64');
  await phone.locator('input[type=file]').first().setInputFiles({ name: 'offline.png', mimeType: 'image/png', buffer: png });
  await expect(phone.locator('nb-card-view img').last()).toBeVisible();
  await expect(phone.getByTestId('save-status')).toHaveText('Saved on this device', { timeout: 10_000 });
  await phone.screenshot({ path: join(shots, 'android-offline-editing.png') });
  // Still offline after another restart: the offline changes are there.
  await phone.reload();
  await loaded(phone);
  await expect(phone.locator('nb-card-view', { hasText: 'Made offline on the phone' })).toBeVisible();

  // Meanwhile on the laptop (browser), online.
  const laptop = await browserSignIn(browser);
  await newNote(laptop.p, 'Made on the laptop meanwhile', false);
  await expect(laptop.p.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });

  // The connection comes back: both sides end up with everything.
  await serverUp(phone);
  await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(phone.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 20_000 });
  await expect(phone.locator('nb-card-view', { hasText: 'Made on the laptop meanwhile' })).toBeVisible({ timeout: 10_000 });
  await expect(phone.locator('nb-card-view', { hasText: 'Made offline on the phone' })).toBeVisible();
  await laptop.p.reload();
  await loaded(laptop.p);
  await expect(laptop.p.locator('nb-card-view', { hasText: 'Made offline on the phone' })).toBeVisible();
  await expect(laptop.p.locator('nb-card-view', { hasText: 'Made on the laptop meanwhile' })).toBeVisible();
  // The offline picture was uploaded and shows on the laptop.
  const imgs = laptop.p.locator('nb-card-view img');
  await expect.poll(async () => {
    for (const i of await imgs.all()) if ((await i.evaluate((x: HTMLImageElement) => x.naturalWidth)) === 8) return true;
    return false;
  }).toBe(true);
  S.phoneCtx = phoneCtx;
  S.laptopCtx = laptop.c;
});

test('offline: the same note changed on both devices keeps both texts (conflicting copy in Unsorted)', async () => {
  const phone = S.phoneCtx!.pages()[0];
  const laptop = S.laptopCtx!.pages()[0];
  await serverDown(phone);
  // (Touch gestures have their own test; here only the merge matters.)
  const edit = async (p: Page, text: string) => {
    // Notes made on two devices may overlap: double-click a point where this note is on top.
    const pt = await p.locator('nb-card-view', { hasText: 'Made on the laptop meanwhile' }).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      for (let y = r.top + 4; y < r.bottom; y += 6)
        for (let x = r.left + 4; x < r.right; x += 6) if (document.elementFromPoint(x, y)?.closest('nb-card-view') === el) return { x, y };
      return null;
    });
    expect(pt, 'some part of the note is visible').not.toBeNull();
    await p.mouse.dblclick(pt!.x, pt!.y);
    await expect(p.locator('textarea.nb-note-edit')).toBeFocused();
    await p.keyboard.press('ControlOrMeta+a');
    await p.keyboard.type(text);
    await p.keyboard.press('Escape');
  };
  await edit(phone, 'Made on the laptop meanwhile — phone wording');
  await expect(phone.getByTestId('save-status')).toHaveText('Saved on this device', { timeout: 10_000 });
  await edit(laptop, 'Made on the laptop meanwhile — laptop wording');
  await expect(laptop.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });
  await serverUp(phone);
  await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(phone.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 20_000 });
  await expect(phone.getByTestId('banner')).toContainText('Conflicting copy', { timeout: 10_000 });
  await expect(phone.locator('nb-card-view', { hasText: 'laptop wording' })).toBeVisible();
  await openUnsorted(phone);
  await expect(phone.locator('.nb-drawer nb-card-view', { hasText: 'phone wording' })).toBeVisible();
  await phone.waitForTimeout(400); // let the sheet finish sliding in
  await phone.screenshot({ path: join(shots, 'android-conflict-copy.png') });
  await laptop.reload();
  await loaded(laptop);
  await openUnsorted(laptop);
  await expect(laptop.locator('.nb-drawer nb-card-view', { hasText: 'phone wording' })).toBeVisible();
  await S.phoneCtx!.close();
  await S.laptopCtx!.close();
});

test('safe areas: on an edge-to-edge Android tablet and phone nothing sits under the status or gesture bar', async ({ browser }) => {
  // What Capacitor 8 injects on Android 15+ (the app is drawn edge to edge).
  const insets = { top: 28, bottom: 24, left: 0, right: 0 };
  for (const [name, opts] of [
    ['tablet', { ...devices['Galaxy Tab S4'] }],
    ['tablet-landscape', { ...devices['Galaxy Tab S4 landscape'] }],
    ['phone', { ...devices['Pixel 7'] }],
  ] as const) {
    const c = await browser.newContext(opts);
    await c.addInitScript((i) => {
      const set = () => {
        for (const [k, v] of Object.entries(i)) document.documentElement.style.setProperty(`--safe-area-inset-${k}`, `${v}px`);
      };
      if (document.documentElement) set();
      document.addEventListener('DOMContentLoaded', set);
    }, insets);
    const p = await openApp(c);
    // The connect / sign-in page.
    const card = (await p.locator('.nb-auth-card').boundingBox())!;
    expect(card.y, `${name}: sign-in card below the status bar`).toBeGreaterThanOrEqual(insets.top);
    await connect(p);
    await p.getByTestId('login-email').fill('bob@example.com');
    await p.getByTestId('login-password').fill(PW);
    await p.getByTestId('login-submit').click();
    await loaded(p);
    const vh = await p.evaluate(() => window.innerHeight);
    for (const sel of ['.nb-crumb.current', '.nb-header .nb-iconbtn']) {
      const b = (await p.locator(sel).first().boundingBox())!;
      expect(b.y, `${name}: ${sel} below the status bar`).toBeGreaterThanOrEqual(insets.top);
    }
    const zoom = (await p.locator('.nb-zoom').boundingBox())!;
    expect(zoom.y + zoom.height, `${name}: zoom buttons above the gesture bar`).toBeLessThanOrEqual(vh - insets.bottom + 1);
    // The tools may scroll; scrolled to the end they stop above the gesture bar.
    const pad = await p.locator('.nb-toolbar').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(pad, `${name}: toolbar keeps clear of the gesture bar`).toBeGreaterThanOrEqual(insets.bottom);
    await p.screenshot({ path: join(shots, `safe-area-${name}.png`) });
    await c.close();
  }
});

test('the connect screen is readable in dark mode', async ({ browser }) => {
  const c = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  const p = await openApp(c);
  await expect(p.getByTestId('server-url')).toBeVisible();
  const look = await p.evaluate(() => {
    const lum = (c: string) => {
      const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const card = getComputedStyle(document.querySelector('.nb-auth-card')!).backgroundColor;
    const page = getComputedStyle(document.querySelector('nb-connect-page')!).backgroundColor;
    const h1 = getComputedStyle(document.querySelector('h1')!).color;
    const input = document.querySelector('[data-testid=server-url]')!;
    return { pageDark: lum(page) < 0.1, h1: ratio(h1, card), inputBorder: getComputedStyle(input).borderTopStyle };
  });
  expect(look.pageDark).toBe(true);
  expect(look.h1).toBeGreaterThan(4.5);
  expect(look.inputBorder).toBe('solid');
  await p.screenshot({ path: join(shots, 'android-connect-dark.png') });
  await c.close();
});

test('screens: phone landscape, Android tablet, iPhone, iPad, dark theme, large text', async ({ browser }) => {
  const shotsFor: [string, Parameters<typeof browser.newContext>[0], 'android' | 'ios'][] = [
    ['android-landscape', { ...devices['Pixel 7 landscape'] }, 'android'],
    ['android-tablet', { ...devices['Galaxy Tab S4'] }, 'android'],
    ['iphone', { ...devices['iPhone 15'], defaultBrowserType: undefined }, 'ios'],
    ['ipad', { ...devices['iPad Pro 11'], defaultBrowserType: undefined }, 'ios'],
    ['android-dark', { ...devices['Pixel 7'], colorScheme: 'dark' }, 'android'],
  ];
  for (const [name, opts, platform] of shotsFor) {
    const { defaultBrowserType: _ignored, ...o } = opts as { defaultBrowserType?: string };
    const c = await browser.newContext(o);
    const p = await openApp(c, platform);
    await connect(p);
    await p.getByTestId('login-email').fill('bob@example.com');
    await p.getByTestId('login-password').fill(PW);
    await p.getByTestId('login-submit').click();
    await loaded(p);
    if (name === 'android-dark') {
      await p.getByTestId('settings').click();
      await p.locator('[data-theme="1"]').click();
      await p.screenshot({ path: join(shots, 'android-settings-sheet.png') });
      await p.evaluate(() => window.dispatchEvent(new Event('nb-back', { cancelable: true })));
      await expect(p.locator('.nb-settings')).toHaveCount(0);
      await expect(p.locator('nb-workspace')).toHaveClass(/dark/);
    }
    // Nothing may stick out sideways (no horizontal page scroll).
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await p.screenshot({ path: join(shots, `${name}.png`) });
    await c.close();
  }
  // Large text: the interface size setting at Large on a phone.
  const c = await browser.newContext({ ...devices['Pixel 7'] });
  const p = await openApp(c);
  await connect(p);
  await p.getByTestId('login-email').fill('bob@example.com');
  await p.getByTestId('login-password').fill(PW);
  await p.getByTestId('login-submit').click();
  await loaded(p);
  await p.keyboard.press('Control+Shift+>');
  await p.keyboard.press('Control+Shift+>');
  expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await p.screenshot({ path: join(shots, 'android-large-text.png') });
  await c.close();
});
