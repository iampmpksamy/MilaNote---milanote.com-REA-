import { expect, Locator, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Table card: typing and moving through cells with the keyboard, adding and removing rows and
// columns, the header row, resizing, themes, the phone layout and sideways scrolling by touch.
// Local mode (boards in the browser's database); real mouse, keyboard and touch input.

const shots = join(__dirname, '..', '..', '..', '..', 'shots', 'cards-alpha6');
mkdirSync(shots, { recursive: true });

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('.nb-crumb.current')).toHaveText('Home');
  await expect(page.locator('.nb-world nb-card-view').first()).toBeVisible();
}

/** The saved boards, read back from the browser's database once the autosave has run. */
async function saved(page: Page): Promise<any> {
  await expect(page.locator('.nb-status')).toHaveText(/Saved/, { timeout: 5000 });
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

const tool = (page: Page, name: string) => page.locator(`.nb-tool[data-tool="${name}"]`);
const table = (page: Page) => page.locator('nb-card-view.nb-table');
const cell = (page: Page, r: number, c: number) => table(page).locator(`textarea[data-cell="${r}:${c}"]`);
async function savedTable(page: Page) {
  const s = await saved(page);
  const home = s.boards[String(s.root)];
  return home.cards.find((c: any) => c.content.Table);
}

async function center(l: Locator) {
  const r = (await l.boundingBox())!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

async function emptySpot(page: Page) {
  const r = (await page.locator('.nb-canvas').boundingBox())!;
  return { x: r.x + 30, y: r.y + r.height - 30 };
}

/** Fills a new table: header + two rows, typed with Tab and Enter only. */
async function fillPrices(page: Page) {
  await tool(page, 'Table').click();
  await expect(cell(page, 0, 0)).toBeFocused();
  await page.keyboard.type('Item');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Qty');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Price');
  await page.keyboard.press('Tab');
  await expect(cell(page, 1, 0)).toBeFocused();
  await page.keyboard.type('Apples');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Tab');
  await page.keyboard.type('€2.40');
  await page.keyboard.press('Shift+Tab');
  await expect(cell(page, 1, 1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cell(page, 2, 1)).toBeFocused();
  await page.keyboard.type('12');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('Pears, ripe and green');
}

test('table: type with Tab, Enter and arrows; add rows at the end; title; saved', async ({ page }) => {
  await open(page);
  await fillPrices(page);
  // Delete / Backspace / Ctrl+A in a cell stay in the cell (no board shortcuts).
  await page.keyboard.press('Backspace');
  await page.keyboard.type('n');
  await page.keyboard.press('Control+a');
  await expect(table(page)).toHaveCount(1);
  await expect(page.locator('nb-card-view.selected')).toHaveCount(1);
  await page.keyboard.press('End');
  // ↑ at the start goes up a row, ↓ at the end goes down.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowUp');
  await expect(cell(page, 1, 0)).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 2, 0)).toBeFocused();
  // Tab in the last cell adds a row; Enter in the last row adds a row too.
  await cell(page, 2, 2).click();
  await page.keyboard.type('€0.90');
  await page.keyboard.press('Tab');
  await expect(cell(page, 3, 0)).toBeFocused();
  await page.keyboard.type('Plums');
  await page.keyboard.press('Enter');
  await expect(cell(page, 4, 0)).toBeFocused();
  // Title: Shift+Tab from the first cell reaches it.
  await cell(page, 0, 0).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+Tab');
  await expect(table(page).locator('[data-tbl-title]')).toBeFocused();
  await page.keyboard.type('Shopping');
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, 0)).toBeFocused();
  await table(page).screenshot({ path: join(shots, 'table-editing.png') });

  const t = await savedTable(page);
  expect(t.content.Table.title).toBe('Shopping');
  expect(t.content.Table.cells).toEqual([
    ['Item', 'Qty', 'Price'],
    ['Apples', '3', '€2.40'],
    ['Pears, ripe and green', '12', '€0.90'],
    ['Plums', '', ''],
    ['', '', ''],
  ]);

  // Esc shows the table: title, a header row in bold, text wrapped.
  await page.keyboard.press('Escape');
  await expect(table(page).locator('textarea')).toHaveCount(0);
  await expect(table(page).locator('.nb-tbl-title')).toHaveText('Shopping');
  const head = table(page).locator('tr.nb-tbl-head td').first();
  await expect(head).toHaveText('Item');
  await expect(head).toHaveCSS('font-weight', '600');
  await expect(table(page).locator('tr')).toHaveCount(5);
  await page.mouse.click((await emptySpot(page)).x, (await emptySpot(page)).y);
  await table(page).screenshot({ path: join(shots, 'table-light.png') });

  // Comes back after a reload.
  await page.reload();
  await expect(table(page).locator('.nb-tbl-title')).toHaveText('Shopping');
  await expect(table(page).locator('tr').nth(2)).toContainText('Pears, ripe and green');
});

test('table: add and remove rows and columns (never below 1×1), undo, double-click a cell', async ({ page }) => {
  await open(page);
  await fillPrices(page);
  await table(page).locator('[data-add-col]').click();
  await expect(table(page).locator('tr.nb-tbl-head textarea')).toHaveCount(4);
  await table(page).locator('[data-add-row]').click();
  await expect(table(page).locator('tr:not(.nb-tbl-ctl)')).toHaveCount(4);
  // Remove the "Qty" column and the "Apples" row.
  await table(page).locator('[data-remove-col="1"]').click();
  await table(page).locator('[data-remove-row="1"]').click();
  let t = await savedTable(page);
  expect(t.content.Table.cells).toEqual([
    ['Item', 'Price', ''],
    ['Pears, ripe and green', '', ''],
    ['', '', ''],
  ]);
  // Each change is its own undo step (Esc first, so Ctrl+Z is the board's undo).
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect(table(page).locator('tr')).toHaveCount(4);
  await expect(table(page).locator('tr').nth(1)).toContainText('Apples');
  // Double-clicking a cell starts editing in that cell.
  await table(page).locator('tr').nth(2).locator('td').nth(1).dblclick();
  await expect(cell(page, 2, 1)).toBeFocused();
  // Remove everything: at least one cell stays, and its remove buttons are disabled.
  for (let i = 0; i < 6; i++) {
    const row = table(page).locator('[data-remove-row="0"]');
    if (await row.isEnabled()) await row.click();
    const col = table(page).locator('[data-remove-col="0"]');
    if (await col.isEnabled()) await col.click();
  }
  await expect(table(page).locator('textarea.nb-tbl-in')).toHaveCount(1);
  await expect(table(page).locator('[data-remove-row="0"]')).toBeDisabled();
  await expect(table(page).locator('[data-remove-col="0"]')).toBeDisabled();
  t = await savedTable(page);
  expect(t.content.Table.cells.length).toBe(1);
  expect(t.content.Table.cells[0].length).toBe(1);
});

test('table: columns share the card width when it is resized; dark theme', async ({ page }) => {
  await open(page);
  await fillPrices(page);
  await page.keyboard.press('Escape');
  const card = table(page);
  await card.click();
  const widths = async () => card.locator('tr.nb-tbl-head td').evaluateAll((tds) => tds.map((t) => t.getBoundingClientRect().width));
  const w0 = await widths();
  expect(Math.max(...w0) - Math.min(...w0)).toBeLessThan(2);
  const handle = page.locator('.nb-resize');
  const h = await center(handle);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 150, h.y, { steps: 10 });
  await page.mouse.up();
  const w1 = await widths();
  expect(w1[0]).toBeGreaterThan(w0[0] + 40);
  expect(Math.max(...w1) - Math.min(...w1)).toBeLessThan(2);
  const t = await savedTable(page);
  expect(t.width).toBeGreaterThan(500);

  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await page.mouse.click((await emptySpot(page)).x, (await emptySpot(page)).y);
  await card.screenshot({ path: join(shots, 'table-dark.png') });
  await card.dblclick();
  await expect(card.locator('textarea:focus')).toHaveCount(1);
  await card.screenshot({ path: join(shots, 'table-dark-editing.png') });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

  test('table on a phone: tap buttons, swipe sideways inside a wide table', async ({ page }) => {
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    const tap = async (l: Locator) => {
      const p = await center(l);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await tool(page, 'Table').scrollIntoViewIfNeeded();
    await tap(tool(page, 'Table'));
    await expect(cell(page, 0, 0)).toBeFocused();
    for (let i = 0; i < 6; i++) await tap(table(page).locator('[data-add-col]'));
    await expect(table(page).locator('tr.nb-tbl-head textarea')).toHaveCount(9);
    await tap(cell(page, 0, 0));
    await expect(cell(page, 0, 0)).toBeFocused();
    for (const [i, w] of ['Day', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].entries()) {
      if (i) await page.keyboard.press('Tab');
      await page.keyboard.type(w);
    }
    const scroller = table(page).locator('.nb-tbl-scroll');
    // Show the start of the table again (typing scrolled it to the last column).
    await scroller.evaluate((el) => (el.scrollLeft = 0));
    const box0 = (await table(page).boundingBox())!;
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: join(shots, 'table-phone-editing.png') });

    // One finger sideways on a cell scrolls the table, not the card.
    const from = await center(cell(page, 1, 1));
    const steps = 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x - (160 * i) / steps, y: from.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(60);
    const box1 = (await table(page).boundingBox())!;
    expect(Math.abs(box1.x - box0.x)).toBeLessThan(2);
    expect(Math.abs(box1.y - box0.y)).toBeLessThan(2);
    // Let the fling settle (a tap during it only stops it, as on a real phone).
    let last = -1;
    await expect
      .poll(async () => {
        const now = await scroller.evaluate((el) => el.scrollLeft);
        const still = now === last;
        last = now;
        return still;
      }, { intervals: [150] })
      .toBe(true);
    await page.screenshot({ path: join(shots, 'table-phone-scrolled.png') });

    // Buttons work by tap too.
    await tap(table(page).locator('[data-add-row]'));
    await expect(table(page).locator('tr:not(.nb-tbl-ctl)')).toHaveCount(4);
    // The table is scrolled to its end, so the column remove buttons on screen are the last ones.
    await tap(table(page).locator('[data-remove-col="6"]'));
    await expect(table(page).locator('tr.nb-tbl-head textarea')).toHaveCount(8);
    const t = await savedTable(page);
    expect(t.content.Table.cells.length).toBe(4);
    expect(t.content.Table.cells[0]).toEqual(['Day', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', '', '']);

    await page.keyboard.press('Escape');
    await expect(table(page).locator('textarea')).toHaveCount(0);
    await page.screenshot({ path: join(shots, 'table-phone.png') });
  });
});
