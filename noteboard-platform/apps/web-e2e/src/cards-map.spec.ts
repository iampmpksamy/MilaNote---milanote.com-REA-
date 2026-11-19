import { expect, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Map card in local mode (the app served as plain files, boards in IndexedDB). Maps come through a
// Noteboard server, so here the card can only say that; apps/web-e2e/server/cards-map.spec.ts
// searches and shows map pictures through a server.

const shots = join(__dirname, '..', '..', '..', '..', 'shots', 'cards-alpha6');
mkdirSync(shots, { recursive: true });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.nb-crumb.current')).toHaveText('Home');
  await expect(page.locator('.nb-world nb-card-view').first()).toBeVisible();
}

/** The saved boards, read back from the browser's database once the autosave has run. */
async function saved(page: Page): Promise<any> {
  await expect(page.locator('.nb-status')).toHaveText('Saved', { timeout: 5000 });
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('noteboard-local');
        r.onsuccess = () => {
          const g = r.result.transaction('kv').objectStore('kv').get('store');
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
}

const mapCards = (store: any) => Object.values(store.boards).flatMap((b: any) => b.cards.filter((c: any) => 'Map' in c.content));

async function addMap(page: Page) {
  await page.locator('.nb-tool[data-tool="More"]').first().click();
  await page.getByTestId('more-tools').locator('[data-tool="Map"]').click();
  const card = page.locator('nb-card-view.nb-map').last();
  await expect(card).toBeVisible();
  return card;
}

test('map card: without a server it says maps need one, and keeps its label', async ({ page }) => {
  await open(page);
  const card = await addMap(page);
  await expect(card).toHaveClass(/editing/);
  await expect(card.getByTestId('map-need-server')).toHaveText('Maps need a Noteboard server');
  // No search field in local mode; the label is the field being typed in.
  await expect(card.getByTestId('map-search')).toHaveCount(0);
  await expect(card.getByTestId('map-label')).toBeFocused();
  await page.keyboard.type('Grandma’s house');
  await page.screenshot({ path: join(shots, 'map-local-editing.png') });
  await page.keyboard.press('Escape');
  await expect(card).not.toHaveClass(/editing/);
  await expect(card.getByTestId('map-need-server')).toContainText('Maps need a Noteboard server');
  await expect(card).toContainText('Grandma’s house');
  await page.screenshot({ path: join(shots, 'map-local-light.png') });
  const store = await saved(page);
  const maps = mapCards(store);
  expect(maps).toHaveLength(1);
  expect(maps[0].content.Map).toEqual({ query: '', label: 'Grandma’s house', lat: null, lng: null, zoom: 13 });

  // Dark theme.
  await page.locator('.nb-canvas').click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await page.screenshot({ path: join(shots, 'map-local-dark.png') });

  // A board made on a server and opened here still shows the place's name and link.
  await page.keyboard.press('Control+Shift+KeyD');
  await card.dblclick();
  await expect(card).toHaveClass(/editing/);
});

test('map card: touch — tap selects, tap again edits; phone width', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 412, height: 860 } });
  const page = await ctx.newPage();
  await open(page);
  const card = await addMap(page);
  await page.keyboard.type('Beach');
  await page.keyboard.press('Escape');
  await expect(card).not.toHaveClass(/editing/);
  await page.locator('.nb-canvas').tap({ position: { x: 20, y: 20 } });
  await expect(card).not.toHaveClass(/selected/);
  // New cards may land partly off a phone screen: tap the part that shows.
  const box = (await card.boundingBox())!;
  const at = { x: Math.max(box.x, 0) + 16, y: box.y + 12 };
  await page.touchscreen.tap(at.x, at.y);
  await expect(card).toHaveClass(/selected/);
  await page.waitForTimeout(400); // not a double tap
  await page.touchscreen.tap(at.x, at.y);
  await expect(card).toHaveClass(/editing/);
  await expect(card.getByTestId('map-label')).toHaveValue('Beach');
  await page.screenshot({ path: join(shots, 'map-local-phone.png') });
  // Nothing on the page scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await ctx.close();
});
