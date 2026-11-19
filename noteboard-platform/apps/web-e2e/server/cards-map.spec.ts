import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Map cards through a Noteboard server: search, pick a place, map pictures, zoom, the link, touch,
// and offline. Run with playwright.map.config.mts (a fake map service stands in for OpenStreetMap);
// the other server configs skip this file.

const root = join(__dirname, '..', '..', '..');
const shots = join(root, '..', 'shots', 'cards-alpha6');
mkdirSync(shots, { recursive: true });
const PW = 'correct horse battery 42';
const PORT = 4348;
const FAKE = 'http://127.0.0.1:47348';

test.skip(({ baseURL }) => baseURL !== `http://127.0.0.1:${PORT}`, 'runs with playwright.map.config.mts');

const cspErrors: string[] = [];
const elsewhere: string[] = [];
test.beforeEach(({ page }) => watch(page));
test.afterEach(() => {
  expect(cspErrors, 'no Content-Security-Policy violations').toEqual([]);
  expect(elsewhere, 'the page only talks to its own server').toEqual([]);
});
function watch(page: Page) {
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text());
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['blob:', 'data:'].includes(u.protocol) && u.host !== `127.0.0.1:${PORT}`) elsewhere.push(r.url());
  });
}

/** Signs in through the API (the first time this creates the super administrator with the setup token). */
async function signedIn(ctx: BrowserContext) {
  const r = ctx.request;
  await r.get('/api/v1/discovery');
  const csrf = (await ctx.cookies()).find((c) => /nb_csrf$/.test(c.name))!.value;
  const headers = { 'x-csrf-token': csrf };
  const tokenFile = join(root, 'tmp', 'e2e-map', 'config', 'setup-token.json');
  if (existsSync(tokenFile)) {
    const token = JSON.parse(readFileSync(tokenFile, 'utf8')).token;
    const s = await r.post('/api/v1/setup', { headers, data: { token, name: 'Ann Admin', email: 'ann@example.com', password: PW, passwordConfirm: PW } });
    if (s.status() === 201) return;
  }
  const l = await r.post('/api/v1/auth/login', { headers, data: { email: 'ann@example.com', password: PW } });
  expect(l.status(), await l.text()).toBe(200);
}

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.nb-crumb.current')).toHaveText('Home');
  await expect(page.locator('.nb-world nb-card-view').first()).toBeVisible({ timeout: 15_000 });
}

/** The boards as the server has them, once this page's changes are saved. */
async function server(page: Page): Promise<any> {
  await expect(page.getByTestId('save-status')).toHaveText('Saved to server', { timeout: 10_000 });
  return (await (await page.request.get('/api/v1/workspace')).json()).store;
}
const mapsIn = (store: any) => Object.values(store.boards).flatMap((b: any) => b.cards.filter((c: any) => 'Map' in c.content));

/** Map pictures shown and fully loaded. */
async function tilesShown(card: Locator) {
  const imgs = card.locator('.nb-map-tiles img');
  await expect(imgs.first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => imgs.evaluateAll((l) => l.length > 0 && l.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 256))).toBe(true);
  return imgs.count();
}

test('map card: search, pick a place, see the map, zoom, open in maps', async ({ page, context }) => {
  await signedIn(context);
  const d = await (await page.request.get('/api/v1/discovery')).json();
  expect(d.features.maps).toBe(true);
  await open(page);
  await page.locator('.nb-tool[data-tool="More"]').first().click();
  await page.getByTestId('more-tools').locator('[data-tool="Map"]').click();
  const card = page.locator('nb-card-view.nb-map').last();
  await expect(card).toHaveClass(/editing/);
  const q = card.getByTestId('map-search');
  await expect(q).toBeFocused();
  // Typing searches by itself after a pause.
  await page.keyboard.type('eiffel tower');
  const results = card.getByTestId('map-results').locator('.nb-map-result');
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText('Eiffel Tower, Paris, France');
  await expect(results.first()).toContainText('Avenue Anatole France');
  await page.screenshot({ path: join(shots, 'map-search.png') });
  // A drag-free pick: clicking a result doesn't move the card.
  const before = await card.boundingBox();
  await results.first().click();
  await expect(results).toHaveCount(0);
  const after = (await card.boundingBox())!;
  expect([after.x, after.y]).toEqual([before!.x, before!.y]);
  await tilesShown(card);
  await expect(card.getByTestId('map-label')).toHaveValue('Eiffel Tower, Paris, France');
  let map = mapsIn(await server(page))[0].content.Map;
  expect(map).toMatchObject({ query: 'eiffel tower', label: 'Eiffel Tower, Paris, France', lat: 48.85826, lng: 2.294501, zoom: 13 });

  // Zoom in twice and out once.
  await card.getByTestId('map-zoom-in').click();
  await card.getByTestId('map-zoom-in').click();
  await card.getByTestId('map-zoom-out').click();
  await tilesShown(card);
  // The label can be changed.
  await card.getByTestId('map-label').fill('Eiffel Tower, Paris');
  await page.screenshot({ path: join(shots, 'map-editing.png') });
  map = mapsIn(await server(page))[0].content.Map;
  expect(map.zoom).toBe(14);
  expect(map.label).toBe('Eiffel Tower, Paris');

  // Enter searches at once (no waiting).
  await q.fill('');
  await q.click();
  await page.keyboard.type('nowhere at all');
  await page.keyboard.press('Enter');
  await expect(card.getByTestId('map-status')).toHaveText('No places found', { timeout: 400 });

  await page.keyboard.press('Escape');
  await expect(card).not.toHaveClass(/editing/);
  await expect(card.getByTestId('map-label')).toHaveText('Eiffel Tower, Paris');
  await expect(card.getByTestId('map-open')).toHaveAttribute('href', 'https://www.openstreetmap.org/?mlat=48.85826&mlon=2.29450#map=14/48.85826/2.29450');
  await expect(card.locator('.nb-map-attr')).toHaveText('© OpenStreetMap contributors');
  await expect(card.locator('.nb-map-pin')).toBeVisible();
  await page.screenshot({ path: join(shots, 'map-light.png') });
  await card.screenshot({ path: join(shots, 'map-card-light.png') });

  // Dark theme.
  await page.locator('.nb-canvas').click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await page.screenshot({ path: join(shots, 'map-dark.png') });
  await card.screenshot({ path: join(shots, 'map-card-dark.png') });
  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).not.toHaveClass(/dark/);

  // The pictures came through the server from the (fake) map service, with its user agent.
  const stats = await (await page.request.get(`${FAKE}/stats`)).json();
  expect(stats.searches).toBeGreaterThanOrEqual(2);
  expect(stats.tiles).toBeGreaterThan(0);
  expect(stats.agents).toEqual(['Noteboard self-hosted (https://github.com/iampmpksamy/MilaNote---milanote.com-REA-)']);
});

test('map card on a phone with touch: tap the search field, tap a result', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 860 } });
  await signedIn(ctx);
  const page = await ctx.newPage();
  watch(page);
  await open(page);
  await page.locator('.nb-tool[data-tool="More"]').first().tap();
  await page.getByTestId('more-tools').locator('[data-tool="Map"]').tap();
  const card = page.locator('nb-card-view.nb-map').last();
  await expect(card).toHaveClass(/editing/);
  // Finish editing, then a single tap on the empty card's search field starts searching.
  await page.keyboard.press('Escape');
  await expect(card).not.toHaveClass(/editing/);
  const field = card.getByTestId('map-start');
  await expect(field).toBeVisible();
  const f = (await field.boundingBox())!;
  await page.touchscreen.tap(Math.max(f.x, 0) + 30, f.y + f.height / 2);
  await expect(card).toHaveClass(/editing/);
  await expect(card.getByTestId('map-search')).toBeFocused();
  await page.keyboard.type('Eiffel');
  await page.keyboard.press('Enter');
  const result = card.locator('.nb-map-result').nth(1);
  await expect(result).toContainText('Eiffel Tower, Paradise, United States');
  const r = (await result.boundingBox())!;
  const cardBefore = await card.boundingBox();
  await page.touchscreen.tap(Math.max(r.x, 0) + 30, r.y + r.height / 2);
  await tilesShown(card);
  expect(await card.boundingBox().then((b) => b!.x)).toBe(cardBefore!.x);
  // The zoom buttons work with a finger too and never drag the card.
  const z = (await card.getByTestId('map-zoom-in').boundingBox())!;
  await page.touchscreen.tap(z.x + z.width / 2, z.y + z.height / 2);
  await expect.poll(async () => mapsIn(await server(page)).find((m: any) => m.content.Map.lng === -115.1726)?.content.Map.zoom).toBe(14);
  // One finger on empty board space moves the board, to bring the whole card into view.
  await page.keyboard.press('Escape');
  const b = (await card.boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  const from = await page.evaluate(() => {
    for (let y = 120; y < 700; y += 20)
      for (let x = 40; x < 380; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el?.closest('.nb-canvas') && !el.closest('nb-card-view, .nb-float, button')) return { x, y };
      }
    return { x: 200, y: 400 };
  });
  const to = { x: from.x + (16 - b.x), y: from.y + (90 - b.y) };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => Math.round((await card.boundingBox())!.x)).toBe(16);
  await tilesShown(card);
  await page.screenshot({ path: join(shots, 'map-phone.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});

test('map card offline: the label stays, with a quiet note instead of the map', async ({ page, context }) => {
  await signedIn(context);
  // A new page has no pictures kept from before; the map service can't be reached.
  await page.route('**/api/v1/geo/**', (route) => route.abort('internetdisconnected'));
  await open(page);
  const card = page.locator('nb-card-view.nb-map', { hasText: 'Eiffel Tower, Paris' }).first();
  await expect(card.getByTestId('map-offline')).toHaveText('Map not available offline');
  await expect(card.getByTestId('map-label')).toHaveText('Eiffel Tower, Paris');
  await card.screenshot({ path: join(shots, 'map-offline.png') });
});
