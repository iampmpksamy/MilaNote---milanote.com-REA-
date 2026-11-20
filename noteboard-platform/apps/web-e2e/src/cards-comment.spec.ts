import { expect, Locator, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Comment cards: posting, deleting, resolving and reopening, a long thread, and touch on a phone.
// Local mode (boards in the browser's database); real mouse, keyboard and touch input only.

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

/** The saved thread of the (only) comment card on Home. */
async function savedThread(page: Page): Promise<{ entries: { text: string; author: string; at: number }[]; resolved: boolean }> {
  const s = await saved(page);
  const c = s.boards[String(s.root)].cards.find((x: any) => x.content.Comment);
  return c.content.Comment;
}

const tool = (page: Page, name: string) => page.locator(`.nb-tool[data-tool="${name}"]`);
const comment = (page: Page) => page.locator('nb-card-view.nb-comment');
const field = (page: Page) => page.locator('textarea.nb-comment-input');

async function emptySpot(page: Page) {
  const r = (await page.locator('.nb-canvas').boundingBox())!;
  return { x: r.x + 60, y: r.y + r.height - 60 };
}

/** A screenshot of the card with a margin of board around it. */
async function shot(page: Page, card: Locator, name: string, pad = 36) {
  const r = (await card.boundingBox())!;
  const vp = page.viewportSize()!;
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  await page.screenshot({ path: join(shots, name), clip: { x, y, width: Math.min(vp.width - x, r.width + pad * 2), height: Math.min(vp.height - y, r.height + pad * 2) } });
}

test('comment: post with Enter, new lines, delete, resolve and reopen, dark theme', async ({ page }) => {
  await open(page);
  await tool(page, 'Comment').click();
  await expect(field(page)).toBeFocused();
  const card = comment(page);
  // Blank posts are ignored.
  await page.keyboard.press('Enter');
  await page.keyboard.type('   ');
  await page.keyboard.press('Enter');
  await expect(card.locator('.nb-comment-entry')).toHaveCount(0);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  // Shift+Enter is a new line, Enter posts.
  await page.keyboard.type('Should the header be darker?');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('It feels a little faint.');
  await page.keyboard.press('Enter');
  await expect(card.locator('.nb-comment-entry')).toHaveCount(1);
  await expect(field(page)).toHaveValue('');
  await expect(field(page)).toBeFocused();
  await page.keyboard.type('Second thought: try it on the phone first.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Typo here');
  await page.keyboard.press('Enter');
  const entries = card.locator('.nb-comment-entry');
  await expect(entries).toHaveCount(3);
  await expect(entries.first().locator('.nb-comment-text')).toHaveText('Should the header be darker?\nIt feels a little faint.');
  await expect(entries.first().locator('.nb-comment-avatar')).toHaveText('Y');
  await expect(entries.first().locator('b')).toHaveText('You');
  await expect(entries.first().locator('time')).toHaveText('just now');
  // Line breaks show as line breaks.
  expect((await entries.first().locator('.nb-comment-text').boundingBox())!.height).toBeGreaterThan(30);
  let t = await savedThread(page);
  expect(t.entries.map((e) => e.text)).toEqual(['Should the header be darker?\nIt feels a little faint.', 'Second thought: try it on the phone first.', 'Typo here']);
  expect(t.entries.every((e) => e.author === 'You' && Math.abs(e.at - Date.now() / 1000) < 60)).toBe(true);
  expect(t.resolved).toBe(false);
  await page.keyboard.type('Draft not sent');
  await shot(page, card, 'comment-editing.png');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');

  // Delete your own entry with ×; undo brings it back, redo removes it again.
  await entries.nth(2).hover();
  await entries.nth(2).locator('.nb-comment-del').click();
  await expect(entries).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(card.locator('.nb-comment-del')).toHaveCount(0);
  await expect(field(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(entries).toHaveCount(3);
  await page.keyboard.press('Control+Shift+z');
  await expect(entries).toHaveCount(2);
  const spot = await emptySpot(page);
  await page.mouse.click(spot.x, spot.y);
  await shot(page, card, 'comment-light.png');

  // Resolve (while editing), then the thread folds to its first entry.
  await card.locator('.nb-comment-text').first().dblclick();
  await expect(field(page)).toBeFocused();
  await card.locator('.nb-comment-resolve').click();
  await expect(card.locator('.nb-comment-resolve')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.click(spot.x, spot.y);
  await expect(entries).toHaveCount(1);
  await expect(card.locator('.nb-comment-status')).toContainText('Resolved · 1 reply');
  await expect(card.locator('.nb-comment-body')).toHaveCSS('opacity', '0.68');
  expect((await savedThread(page)).resolved).toBe(true);
  await shot(page, card, 'comment-resolved.png');
  await card.locator('.nb-comment-reopen').click();
  await expect(entries).toHaveCount(2);
  expect((await savedThread(page)).resolved).toBe(false);

  // Dark theme.
  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await shot(page, card, 'comment-dark.png');
  await card.locator('.nb-comment-text').first().dblclick();
  await expect(field(page)).toBeFocused();
  await page.keyboard.type('Dark mode reply');
  await page.keyboard.press('Enter');
  await shot(page, card, 'comment-dark-editing.png');
  t = await savedThread(page);
  expect(t.entries).toHaveLength(3);
});

test('comment: a long thread scrolls inside the card and keeps the newest entry in view', async ({ page }) => {
  await open(page);
  await tool(page, 'Comment').click();
  await expect(field(page)).toBeFocused();
  for (let i = 1; i <= 14; i++) {
    await page.keyboard.type(`Point number ${i}`);
    await page.keyboard.press('Enter');
  }
  const card = comment(page);
  const list = card.locator('.nb-comment-list');
  await expect(card.locator('.nb-comment-entry')).toHaveCount(14);
  const box = (await list.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(321);
  // The newest entry is visible, the first is scrolled away.
  await expect(card.locator('[data-entry="13"]')).toBeInViewport();
  const atEnd = await list.evaluate((el) => Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 2);
  expect(atEnd).toBe(true);
  // The mouse wheel scrolls the thread (not the board) while it can.
  const before = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect.poll(() => list.evaluate((el) => el.scrollTop + el.clientHeight < el.scrollHeight - 50)).toBe(true);
  expect((await card.boundingBox())!.y).toBeCloseTo(before!.y, 0);
  expect((await savedThread(page)).entries).toHaveLength(14);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

  test('comment: tap to add, Post button, tap again to edit, resolve and reopen with touch', async ({ page }) => {
    await open(page);
    await tool(page, 'Comment').tap();
    await expect(page.locator('.nb-trash'), "the tap's leftover click pressed nothing").toHaveCount(0);
    await expect(field(page)).toBeFocused();
    await page.keyboard.type('Can we meet on Friday?');
    const card = comment(page);
    await card.locator('.nb-comment-post').tap();
    await expect(card.locator('.nb-comment-entry')).toHaveCount(1);
    await expect(field(page)).toHaveValue('');
    await page.keyboard.type('Friday works for me.');
    await page.keyboard.press('Enter');
    await expect(card.locator('.nb-comment-entry')).toHaveCount(2);
    await shot(page, card, 'comment-phone-editing.png', 16);
    // The delete button is big enough for a finger.
    const del = (await card.locator('.nb-comment-del').first().boundingBox())!;
    expect(del.width).toBeGreaterThanOrEqual(28);
    await card.locator('.nb-comment-resolve').tap();
    await expect(card.locator('.nb-comment-resolve')).toHaveAttribute('aria-pressed', 'true');
    // Tap empty board: editing ends and the resolved thread folds.
    const spot = await emptySpot(page);
    await page.touchscreen.tap(spot.x, spot.y - 140);
    await expect(field(page)).toHaveCount(0);
    await expect(card.locator('.nb-comment-status')).toContainText('Resolved · 1 reply');
    await page.screenshot({ path: join(shots, 'comment-phone.png') });
    // Reopen with a finger.
    await card.locator('.nb-comment-reopen').tap();
    await expect(card.locator('.nb-comment-entry')).toHaveCount(2);
    // Tap to select, tap again to edit.
    const text = card.locator('.nb-comment-text').first();
    await text.tap();
    await expect(card).toHaveClass(/selected/);
    await page.waitForTimeout(400);
    await text.tap();
    await expect(field(page)).toBeVisible();
    const t = await savedThread(page);
    expect(t.entries.map((e) => e.text)).toEqual(['Can we meet on Friday?', 'Friday works for me.']);
    expect(t.resolved).toBe(false);
    // No sideways scrolling on the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
