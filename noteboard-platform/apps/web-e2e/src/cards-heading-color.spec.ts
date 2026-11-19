import { type CDPSession, expect, type Locator, type Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Heading and Colour cards (3.0.0-alpha.6), in local mode: the app served as static files, the
// boards in the browser's database. Real mouse, keyboard and (on the phone) touch input.

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

/** Every card of a kind on any board of the saved store. */
const cardsOf = (store: any, kind: string): any[] => Object.values(store.boards).flatMap((b: any) => b.cards.filter((c: any) => kind in c.content));

const tool = (page: Page, name: string) => page.locator(`.nb-tool[data-tool="${name}"]`);

async function addMore(page: Page, kind: string) {
  // Back to all tools when a card is still selected (its own tools replace them).
  if (await tool(page, 'Back').isVisible()) await page.keyboard.press('Escape');
  await expect(tool(page, 'Back')).toHaveCount(0);
  await tool(page, 'More').click();
  await page.locator(`.nb-more-tool[data-tool="${kind}"]`).click();
}

async function centre(l: Locator) {
  await expect(l).toBeVisible();
  const r = (await l.boundingBox())!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

async function emptySpot(page: Page) {
  const r = (await page.locator('.nb-canvas').boundingBox())!;
  return { x: r.x + 30, y: r.y + r.height - 30 }; // bottom left: the zoom buttons are bottom right
}

test('heading: type, new line, size bar, alignment, Enter finishes', async ({ page }) => {
  await open(page);
  await addMore(page, 'Heading');
  const card = page.locator('nb-card-view.nb-heading').last();
  const ta = card.locator('textarea.nb-heading-edit');
  await expect(ta).toBeFocused();
  await page.keyboard.type('Spring launch');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('plan');
  await expect(ta).toHaveValue('Spring launch\nplan');
  await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(ta).toHaveCSS('font-size', '34px');

  // The size bar floats above the card.
  const bar = card.locator('.nb-heading-tools');
  await expect(bar).toBeVisible();
  const bb = (await bar.boundingBox())!;
  const cb = (await card.boundingBox())!;
  expect(bb.y + bb.height).toBeLessThanOrEqual(cb.y);
  await expect(bar.locator('.nb-heading-size.on')).toHaveAttribute('data-size', '1');
  // The text area grew to two lines.
  expect((await ta.boundingBox())!.height).toBeGreaterThan(34 * 1.15 * 1.8);
  await page.screenshot({ path: join(shots, 'heading-color-heading-editing.png') });

  // Clicking a size keeps the keyboard in the heading, and doesn't move the card.
  await bar.locator('.nb-heading-size[data-size="2"]').click();
  await expect(ta).toHaveCSS('font-size', '26px');
  await expect(ta).toBeFocused();
  expect((await card.boundingBox())!.x).toBeCloseTo(cb.x, 0);
  await page.keyboard.type('!');
  await expect(ta).toHaveValue('Spring launch\nplan!');
  await bar.locator('.nb-heading-align').click();
  await expect(ta).toHaveCSS('text-align', 'center');
  await expect(ta).toBeFocused();

  // Enter finishes editing.
  await page.keyboard.press('Enter');
  await expect(ta).toHaveCount(0);
  const text = card.locator('.nb-heading-text');
  await expect(text).toHaveText('Spring launch\nplan!');
  await expect(text).toHaveCSS('font-size', '26px');
  await expect(text).toHaveCSS('font-weight', '700');
  await expect(text).toHaveCSS('text-align', 'center');

  // Double-click edits again; Esc finishes.
  await text.dblclick();
  await expect(ta).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ta).toHaveCount(0);

  const s = await saved(page);
  const h = cardsOf(s, 'Heading').find((c) => c.content.Heading.text.startsWith('Spring'));
  expect(h.content.Heading).toEqual({ text: 'Spring launch\nplan!', size: 2 });
  expect(h.align).toBe(1);

  // An empty heading shows a muted placeholder.
  await addMore(page, 'Heading');
  await expect(page.locator('textarea.nb-heading-edit')).toBeFocused();
  await page.keyboard.press('Escape');
  const empty = page.locator('nb-card-view.nb-heading .nb-heading-text.empty');
  await expect(empty).toHaveText('Heading');
  const muted = await page.locator('.nb-shell').evaluate((el) => getComputedStyle(el).getPropertyValue('--nb-muted').trim());
  expect(muted).toBe('#868a92');
  await expect(empty).toHaveCSS('color', 'rgb(134, 138, 146)');
});

test('colour: hex field, name, quick colours, picker, copy', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await open(page);
  await addMore(page, 'Color');
  const card = page.locator('nb-card-view.nb-color').last();
  const hex = card.locator('.nb-color-hex');
  const name = card.locator('.nb-color-name');
  const swatch = card.locator('.nb-color-swatch');
  await expect(hex).toBeFocused();
  await expect(hex).toHaveValue('#5c7ff5');

  // Invalid codes are ignored and put back; Enter moves on to the name.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('xyz');
  await page.keyboard.press('Enter');
  await expect(hex).toHaveValue('#5c7ff5');
  await expect(name).toBeFocused();

  // Three digits, no #, upper case → normalised.
  await hex.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('F0A');
  await page.keyboard.press('Enter');
  await expect(hex).toHaveValue('#ff00aa');
  await expect(swatch).toHaveCSS('background-color', 'rgb(255, 0, 170)');
  await expect(name).toBeFocused();
  await page.keyboard.type('Hot pink');

  // Six digits apply while typing.
  await hex.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('#1E6091');
  await expect(swatch).toHaveCSS('background-color', 'rgb(30, 96, 145)');

  // A quick colour; the name field keeps the keyboard.
  await name.click();
  await card.locator('.nb-color-preset[data-hex="#ffffff"]').click();
  await expect(hex).toHaveValue('#ffffff');
  await expect(card.locator('.nb-color-preset.on')).toHaveAttribute('data-hex', '#ffffff');
  await expect(name).toBeFocused();
  // White on a white card still shows its ring.
  expect(await swatch.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');

  // The system colour picker (its dialog can't be driven, so its value is set as it would).
  await card.locator('input.nb-color-pick').fill('#2a9d8f');
  await expect(hex).toHaveValue('#2a9d8f');
  await page.screenshot({ path: join(shots, 'heading-color-color-editing.png') });

  await page.keyboard.press('Escape');
  await expect(card.locator('.nb-color-form')).toHaveCount(0);
  await expect(card.locator('.nb-color-title')).toHaveText('Hot pink');
  await expect(card.locator('.nb-color-code')).toHaveText('#2a9d8f');
  const sb = (await swatch.boundingBox())!;
  expect(sb.width / sb.height).toBeCloseTo(4 / 3, 1);

  // Copy puts the hex on the clipboard and says so; it doesn't start editing or move the card.
  await page.mouse.click((await emptySpot(page)).x, (await emptySpot(page)).y);
  const before = (await card.boundingBox())!;
  await card.locator('.nb-color-copy').click();
  await expect(page.locator('.nb-toast')).toContainText('Copied #2a9d8f');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('#2a9d8f');
  await expect(card.locator('.nb-color-form')).toHaveCount(0);
  expect((await card.boundingBox())!.x).toBeCloseTo(before.x, 0);

  const s = await saved(page);
  const c = cardsOf(s, 'Color').at(-1);
  expect(c.content.Color).toEqual({ hex: '#2a9d8f', name: 'Hot pink' });
});

test('light and dark: headings and swatches (white and black stay visible)', async ({ page }) => {
  await open(page);
  // A small palette on empty board space below the sample cards.
  await page.mouse.wheel(0, 900);
  await addMore(page, 'Heading');
  await expect(page.locator('textarea.nb-heading-edit')).toBeFocused();
  await page.keyboard.type('Palette');
  await page.keyboard.press('Enter');
  for (const [hexCode, label] of [
    ['#ffffff', 'Paper'],
    ['#141414', 'Ink'],
    ['#e0679f', 'Blossom'],
  ]) {
    await addMore(page, 'Color');
    const card = page.locator('nb-card-view.nb-color').last();
    await card.locator(`.nb-color-preset[data-hex="${hexCode}"]`).click();
    await card.locator('.nb-color-name').fill(label);
    await page.keyboard.press('Enter');
    await expect(card.locator('.nb-color-title')).toHaveText(label);
  }
  await addMore(page, 'Heading');
  await page.locator('nb-card-view.nb-heading').last().locator('.nb-heading-size[data-size="3"]').click();
  await expect(page.locator('textarea.nb-heading-edit')).toBeFocused();
  await page.keyboard.type('Small heading, centred');
  await page.locator('nb-card-view.nb-heading').last().locator('.nb-heading-align').click();
  await page.keyboard.press('Enter');
  await page.mouse.click((await emptySpot(page)).x, (await emptySpot(page)).y);
  await page.screenshot({ path: join(shots, 'heading-color-light.png') });

  await page.keyboard.press('ControlOrMeta+Shift+D');
  await expect(page.locator('.nb-shell.dark')).toHaveCount(1);
  const heading = page.locator('nb-card-view.nb-heading', { hasText: 'Palette' }).locator('.nb-heading-text');
  await expect(heading).toHaveCSS('color', 'rgb(230, 230, 230)');
  await expect(page.locator('nb-card-view.nb-color', { hasText: 'Ink' })).toHaveCSS('background-color', 'rgb(39, 39, 39)');
  await page.screenshot({ path: join(shots, 'heading-color-dark.png') });
});

// ---------- phone ----------

async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
  for (let i = 1; i <= steps; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function tap(cdp: CDPSession, at: { x: number; y: number }) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('phone (412 px, touch): size bar and quick colours work with a finger', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await open(page);

  await tool(page, 'More').scrollIntoViewIfNeeded(); // the bottom bar scrolls sideways
  await tap(cdp, await centre(tool(page, 'More')));
  await tap(cdp, await centre(page.locator('.nb-more-tool[data-tool="Heading"]')));
  const card = page.locator('nb-card-view.nb-heading').last();
  const ta = card.locator('textarea.nb-heading-edit');
  await expect(ta).toBeFocused();
  await page.keyboard.type('On the go');
  // A finger on the size bar: no drag, no long-press menu, the keyboard stays in the heading.
  const before = (await card.boundingBox())!;
  await tap(cdp, await centre(card.locator('.nb-heading-size[data-size="3"]')));
  await expect(ta).toHaveCSS('font-size', '20px');
  await expect(ta).toBeFocused();
  await tap(cdp, await centre(card.locator('.nb-heading-align')));
  await expect(ta).toHaveCSS('text-align', 'center');
  await expect(page.locator('.nb-menu')).toHaveCount(0);
  expect((await card.boundingBox())!.y).toBeCloseTo(before.y, 0);
  await page.screenshot({ path: join(shots, 'heading-color-phone-editing.png') });

  // Tap empty board to finish (and clear the selection, so all tools are back).
  const canvas = (await page.locator('.nb-canvas').boundingBox())!;
  await tap(cdp, { x: canvas.x + 30, y: canvas.y + canvas.height - 30 });
  await expect(ta).toHaveCount(0);
  await tool(page, 'More').scrollIntoViewIfNeeded(); // the bottom bar scrolls sideways
  await tap(cdp, await centre(tool(page, 'More')));
  await tap(cdp, await centre(page.locator('.nb-more-tool[data-tool="Color"]')));
  const color = page.locator('nb-card-view.nb-color').last();
  await expect(color.locator('.nb-color-hex')).toBeFocused();
  // A new card goes to a free spot, which on a phone can be off screen: one finger on empty board
  // brings it into view (and finishes editing), a double tap edits it again.
  const cb = (await color.boundingBox())!;
  const from = { x: 150, y: canvas.y + canvas.height - 40 };
  await touchDrag(cdp, from, { x: Math.min(400, from.x + 100 - cb.x), y: from.y + 230 - cb.y });
  await expect(color.locator('.nb-color-form')).toHaveCount(0);
  const swatch = await centre(color.locator('.nb-color-swatch'));
  await tap(cdp, swatch);
  await tap(cdp, swatch);
  await expect(color.locator('.nb-color-hex')).toBeFocused();
  await tap(cdp, await centre(color.locator('.nb-color-preset[data-hex="#3a8ee6"]')));
  await expect(color.locator('.nb-color-hex')).toHaveValue('#3a8ee6');
  await expect(color.locator('.nb-color-hex')).toBeFocused();
  await color.locator('.nb-color-name').fill('Sky');
  await page.keyboard.press('Enter');
  await expect(color.locator('.nb-color-title')).toHaveText('Sky');

  // Nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
  await page.screenshot({ path: join(shots, 'heading-color-phone.png') });

  const s = await saved(page);
  expect(cardsOf(s, 'Heading').find((c) => c.content.Heading.text === 'On the go')).toMatchObject({ align: 1, content: { Heading: { size: 3 } } });
  expect(cardsOf(s, 'Color').at(-1).content.Color).toEqual({ hex: '#3a8ee6', name: 'Sky' });
  await ctx.close();
});
