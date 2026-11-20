import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The Document card: the page-like card on the board and its full-screen editor (toolbar, Write /
// Preview, word count, Esc / Done), in light and dark, with a mouse and keyboard and on a phone
// with touch. Each test opens a fresh browser profile (local mode, boards in IndexedDB).

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

const docCard = (page: Page) => page.locator('.nb-world nb-card-view.nb-document');
const editor = (page: Page) => page.locator('.nb-doced');
const text = (page: Page) => page.locator('.nb-doced-text');
const fmt = (page: Page, kind: string) => page.locator(`.nb-doced-btn[data-fmt="${kind}"]`);

async function addDocument(page: Page) {
  await page.locator('.nb-tool[data-tool="More"]').click();
  await page.locator('.nb-more-tool[data-tool="Document"]').click();
  await expect(editor(page)).toBeVisible();
}

const EXPECTED = '# Packing\nBring the **tent** and boots\n1. First\n2. Second\nSee https://example.com\nit is *great*';

test('document: write with the toolbar and shortcuts, preview, close, saved', async ({ page }) => {
  await open(page);
  const cardsBefore = await page.locator('.nb-world nb-card-view').count();
  await addDocument(page);
  // The editor covers the whole window, above everything, and starts in the title.
  expect(await editor(page).boundingBox()).toEqual({ x: 0, y: 0, width: 1360, height: 860 });
  await expect(page.locator('.nb-doced-title')).toBeFocused();
  await page.keyboard.type('Trip plan');
  await page.keyboard.press('Enter');
  await expect(text(page)).toBeFocused();

  await page.keyboard.type('Packing');
  await fmt(page, 'h1').click();
  await expect(text(page)).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Bring the ');
  await fmt(page, 'bold').click();
  await page.keyboard.type('tent');
  await page.keyboard.press('End');
  await page.keyboard.type(' and boots\nFirst\nSecond');
  await page.keyboard.press('Shift+ArrowUp');
  await fmt(page, 'number').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nSee example.com');
  for (let i = 0; i < 11; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Control+KeyK');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nit is ');
  await page.keyboard.press('Control+KeyI');
  await page.keyboard.type('great');
  await expect(text(page)).toHaveValue(EXPECTED);
  await expect(page.locator('.nb-doced-count')).toHaveText('13 words');

  // Toggling: bold on the bold word takes the marks away again; the browser's undo brings them back.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  for (let i = 0; i < ' and boots'.length; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < '**tent**'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
  await fmt(page, 'bold').click();
  await expect(text(page)).toHaveValue(EXPECTED.replace('**tent**', 'tent'));
  await page.keyboard.press('Control+KeyZ');
  await expect(text(page)).toHaveValue(EXPECTED);

  // Board keys and the wheel don't reach the board while the editor is open.
  const transform = await page.locator('.nb-world').getAttribute('style');
  await page.mouse.move(680, 500);
  await page.mouse.wheel(0, 400);
  await page.keyboard.press('Control+Equal');
  await expect(page.locator('.nb-world')).toHaveAttribute('style', transform);
  await page.screenshot({ path: join(shots, 'document-editing.png') });

  // Preview: the notes' formatting, numbered list, link; formatting buttons are off.
  await page.locator('[data-mode="preview"]').click();
  const pv = page.locator('.nb-doced-preview');
  await expect(pv.locator('h1')).toHaveText('Packing');
  await expect(pv.locator('strong')).toHaveText('tent');
  await expect(pv.locator('ol li')).toHaveText(['First', 'Second']);
  await expect(pv.locator('a[href="https://example.com"]')).toBeVisible();
  await expect(pv.locator('em')).toHaveText('great');
  await expect(fmt(page, 'bold')).toBeDisabled();
  const col = (await pv.boundingBox())!;
  expect(col.width).toBeLessThanOrEqual(720);
  await page.screenshot({ path: join(shots, 'document-preview.png') });
  // Delete / Backspace in the preview must not delete the card behind.
  await pv.click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await expect(editor(page)).toBeVisible();
  await page.locator('[data-mode="write"]').click();
  await expect(text(page)).toBeFocused();

  // Esc closes; the card shows the title, the first lines as plain text and the word count.
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.nb-world nb-card-view')).toHaveCount(cardsBefore + 1);
  const card = docCard(page);
  await expect(card.locator('.nb-docface-title')).toHaveText('Trip plan');
  await expect(card.locator('.nb-docface-text')).toHaveText(/^Packing Bring the tent and boots First Second/);
  await expect(card.locator('.nb-docface-meta')).toHaveText('13 words');
  await page.mouse.click(300, 760);
  await page.screenshot({ path: join(shots, 'document-light.png') });

  const s = await saved(page);
  const home = s.boards[String(s.root)];
  const doc = home.cards.find((c: any) => c.content.Document);
  expect(doc.content.Document).toEqual({ title: 'Trip plan', text: EXPECTED });

  // Double-click opens it again where it was left; Done closes.
  await card.dblclick();
  await expect(text(page)).toHaveValue(EXPECTED);
  await expect(text(page)).toBeFocused();
  await page.locator('.nb-doced-done').click();
  await expect(editor(page)).toHaveCount(0);
});

test('document: dark theme, card and editor', async ({ page }) => {
  await open(page);
  await addDocument(page);
  await page.keyboard.type('Dark notes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Evening\nA quiet page for **long** writing.\n> Kept in the dark theme too.');
  // The theme shortcut still works inside the editor.
  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await expect(editor(page)).toHaveCSS('background-color', 'rgb(39, 39, 39)');
  await page.screenshot({ path: join(shots, 'document-dark-editing.png') });
  await page.locator('.nb-doced-done').click();
  await expect(editor(page)).toHaveCount(0);
  await page.mouse.click(300, 760);
  await expect(docCard(page).locator('.nb-docface-meta')).toHaveText('13 words');
  await page.screenshot({ path: join(shots, 'document-dark.png') });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

  async function tap(cdp: CDPSession, at: { x: number; y: number }) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function centre(page: Page, sel: string) {
    const b = (await page.locator(sel).first().boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  test('document: tap again to edit, full-screen editor, touch toolbar', async ({ page }) => {
    await open(page);
    await addDocument(page);
    expect(await editor(page).boundingBox()).toEqual({ x: 0, y: 0, width: 412, height: 860 });
    await page.keyboard.type('Phone draft');
    await page.locator('.nb-doced-done').click();
    await expect(editor(page)).toHaveCount(0);

    // Bring the new card into the middle of the narrow screen.
    const title = page.locator('.nb-world nb-card-view.nb-document .nb-docface-title');
    let at = await centre(page, '.nb-world nb-card-view.nb-document .nb-docface-title');
    await page.mouse.move(206, 300);
    await page.mouse.wheel(at.x - 206, 0);
    await expect.poll(async () => Math.round((await title.boundingBox())!.x + (await title.boundingBox())!.width / 2)).toBeLessThan(330);
    at = await centre(page, '.nb-world nb-card-view.nb-document .nb-docface-title');
    const cdp = await page.context().newCDPSession(page);
    await tap(cdp, at);
    await expect(docCard(page)).toHaveClass(/selected/);
    await new Promise((r) => setTimeout(r, 400)); // not a double tap
    await tap(cdp, at);
    await expect(editor(page)).toBeVisible();
    // Nothing on the page scrolls sideways; the toolbar is its own row under the header.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
    const tools = (await page.locator('.nb-doced-tools').boundingBox())!;
    const done = (await page.locator('.nb-doced-done').boundingBox())!;
    expect(tools.y).toBeGreaterThan(done.y + done.height - 1);

    await text(page).click();
    await page.keyboard.type('Notes from the road');
    await tap(cdp, await centre(page, '.nb-doced-btn[data-fmt="h2"]'));
    await expect(text(page)).toHaveValue('## Notes from the road');
    await expect(page.locator('.nb-doced-count')).toHaveText('4 words');
    await page.screenshot({ path: join(shots, 'document-phone-editing.png') });
    await tap(cdp, await centre(page, '.nb-doced-done'));
    await expect(editor(page)).toHaveCount(0);
    await expect(docCard(page).locator('.nb-docface-text')).toHaveText('Notes from the road');
    await page.screenshot({ path: join(shots, 'document-phone.png') });
  });
});
