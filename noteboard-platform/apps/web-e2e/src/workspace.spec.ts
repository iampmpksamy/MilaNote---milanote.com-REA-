import { expect, Locator, Page, test } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Ported from the desktop app's interaction tests (app/src/app/tests.rs). Each test opens a fresh
// browser profile, so it starts from the sample boards. Real mouse and keyboard input only.

const shots = join(__dirname, '..', '..', '..', '..', 'shots', 'web-m1');
const backups = join(__dirname, '..', '..', '..', '..', 'backups');
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

const tool = (page: Page, name: string) => page.locator(`.nb-tool[data-tool="${name}"]`);
const board = (page: Page, name: string) => page.locator('nb-card-view.nb-board', { has: page.locator('.nb-board-name', { hasText: name }) });
const square = (page: Page, name: string) => board(page, name).locator('.nb-board-square');

async function drag(page: Page, from: Locator | { x: number; y: number }, to: { x: number; y: number } | Locator, steps = 12) {
  const a = 'x' in from ? from : await center(from);
  const b = 'x' in to ? to : await center(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

async function center(l: Locator) {
  const r = (await l.boundingBox())!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

async function emptySpot(page: Page) {
  const r = (await page.locator('.nb-canvas').boundingBox())!;
  return { x: r.x + 200, y: r.y + r.height - 120 };
}

test('board: create, rename, colour, icon, move, back', async ({ page }) => {
  await open(page);
  await page.screenshot({ path: join(shots, 'light-home.png') });
  await tool(page, 'Board').click();
  const input = page.locator('.nb-board-name-edit');
  await expect(input).toBeFocused();
  await page.keyboard.type('Plans');
  await page.keyboard.press('Enter');
  await expect(board(page, 'Plans')).toBeVisible();
  await square(page, 'Plans').click();
  await expect(tool(page, 'Icon')).toBeVisible();
  await page.screenshot({ path: join(shots, 'board-selected.png') });
  await tool(page, 'Color').click();
  await page.locator('.nb-board-swatch[data-color="8"]').click();
  await expect(square(page, 'Plans')).toHaveCSS('background-color', 'rgb(224, 122, 95)');
  await tool(page, 'Icon').click();
  await page.locator('[data-icon="🚀"]').click();
  await expect(square(page, 'Plans')).toHaveText('🚀');
  const before = (await square(page, 'Plans').boundingBox())!;
  await drag(page, square(page, 'Plans'), { x: before.x + before.width / 2 + 180, y: before.y + before.height / 2 + 90 });
  const after = (await square(page, 'Plans').boundingBox())!;
  expect(Math.abs(after.x - before.x - 180)).toBeLessThan(9);
  expect(Math.abs(after.y - before.y - 90)).toBeLessThan(9);
  await tool(page, 'Back').click();
  await expect(tool(page, 'Note')).toBeVisible();
  const s = await saved(page);
  const plans = Object.values(s.boards).find((b: any) => b.name === 'Plans') as any;
  expect(plans.color).toBe(8);
  expect(plans.icon).toBe('🚀');
});

test('connect two boards; the line follows when both move', async ({ page }) => {
  await open(page);
  const lines = page.locator('svg.nb-lines > path:not(.nb-line-halo)');
  const n = await lines.count();
  await square(page, 'Project ideas').click();
  await drag(page, page.locator('.nb-handle.connect'), square(page, 'Mood & inspiration'));
  await expect(lines).toHaveCount(n + 1);
  for (const name of ['Project ideas', 'Mood & inspiration']) {
    await page.mouse.click((await emptySpot(page)).x, (await emptySpot(page)).y);
    const c = await center(square(page, name));
    await drag(page, c, { x: c.x, y: c.y + 260 });
  }
  const s = await saved(page);
  const home = s.boards[String(s.root)];
  const idOf = (name: string) => home.cards.find((c: any) => c.content.Board && s.boards[c.content.Board.board].name === name).id;
  expect(home.arrows.some((a: any) => a.from === idOf('Project ideas') && a.to === idOf('Mood & inspiration'))).toBe(true);
  await expect(lines).toHaveCount(n + 1);
});

test('a free line: drag its end onto a board, then dashed and start arrow', async ({ page }) => {
  await open(page);
  await tool(page, 'Line').click();
  const end = page.locator('.nb-handle[data-end="1"]');
  await expect(end).toBeVisible();
  await expect(tool(page, 'Dashed')).toBeVisible();
  await page.screenshot({ path: join(shots, 'line-selected.png') });
  await drag(page, end, square(page, 'Reading list'));
  await tool(page, 'Dashed').click();
  await tool(page, 'Start').click();
  const s = await saved(page);
  const home = s.boards[String(s.root)];
  const reading = home.cards.find((c: any) => c.content.Board && s.boards[c.content.Board.board].name === 'Reading list').id;
  const line = home.arrows.find((a: any) => a.to === reading && a.from === 0);
  expect(line).toBeTruthy();
  expect(line.to_pt).toBeNull();
  expect(line.dashed).toBe(true);
  expect(line.head_start).toBe(true);
});

test('note: double-click, type (with Tamil), format, resize, undo and redo', async ({ page }) => {
  await open(page);
  const spot = await emptySpot(page);
  await page.mouse.dblclick(spot.x, spot.y);
  const ta = page.locator('textarea.nb-note-edit');
  await expect(ta).toBeFocused();
  await page.keyboard.type('Hello **world** – வணக்கம்');
  await page.screenshot({ path: join(shots, 'note-editing.png') });
  await page.keyboard.press('Escape');
  const note = page.locator('nb-card-view.nb-note', { hasText: 'வணக்கம்' });
  await expect(note.locator('strong')).toHaveText('world');
  await note.click();
  const w0 = (await note.boundingBox())!.width;
  await drag(page, page.locator('.nb-resize'), { x: (await page.locator('.nb-resize').boundingBox())!.x + 120, y: (await page.locator('.nb-resize').boundingBox())!.y });
  const w1 = (await note.boundingBox())!.width;
  expect(w1).toBeGreaterThan(w0 + 100);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await note.boundingBox())!.width)).toBe(Math.round(w0));
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => Math.round((await note.boundingBox())!.width)).toBe(Math.round(w1));
});

test('to-do: Enter adds tasks, ticking completes one', async ({ page }) => {
  await open(page);
  await tool(page, 'To-do').click();
  await expect(page.locator('input.nb-task-text').first()).toBeFocused();
  await page.keyboard.type('Buy paper');
  await page.keyboard.press('Enter');
  await expect(page.locator('input[data-item="1"]')).toBeFocused();
  await page.keyboard.type('Call the printer');
  await page.keyboard.press('Escape');
  const todo = page.locator('nb-card-view.nb-todo', { hasText: 'Buy paper' });
  await expect(todo.locator('.nb-task-text')).toHaveText(['Buy paper', 'Call the printer']);
  await todo.locator('.nb-check').first().click();
  await expect(todo.locator('.nb-check').first()).toHaveClass(/on/);
  await expect(todo.locator('.nb-check').nth(1)).not.toHaveClass(/on/);
});

test('cards move into a column and out again', async ({ page }) => {
  await open(page);
  const note = page.locator('nb-card-view.nb-note', { hasText: 'Next steps' });
  const body = page.locator('nb-card-view.nb-column .nb-col-body');
  const b = (await body.boundingBox())!;
  await drag(page, note, { x: b.x + b.width / 2, y: b.y + b.height - 10 });
  await expect(body.locator('nb-card-view', { hasText: 'Next steps' })).toBeVisible();
  await drag(page, body.locator('nb-card-view', { hasText: 'Next steps' }), await emptySpot(page));
  await expect(body.locator('nb-card-view', { hasText: 'Next steps' })).toHaveCount(0);
  await expect(page.locator('.nb-world > nb-card-view', { hasText: 'Next steps' })).toBeVisible();
});

test('unsorted drawer opens from the pill and a card moves out', async ({ page }) => {
  await open(page);
  await expect(page.locator('.nb-drawer')).toHaveCount(0);
  await page.getByTestId('unsorted-pill').click();
  await expect(page.locator('.nb-drawer')).toBeVisible();
  const card = page.locator('.nb-drawer nb-card-view', { hasText: 'Call Sam' });
  await drag(page, card, await emptySpot(page));
  await expect(page.locator('.nb-drawer nb-card-view')).toHaveCount(0);
  await expect(page.locator('.nb-world > nb-card-view', { hasText: 'Call Sam' })).toBeVisible();
});

test('double-click opens a nested board; search jumps to a result', async ({ page }) => {
  await open(page);
  await square(page, 'Project ideas').dblclick();
  await expect(page.locator('.nb-crumb.current')).toHaveText('Project ideas');
  await page.keyboard.press('Control+f');
  await page.getByTestId('search-input').fill('weekly');
  await page.screenshot({ path: join(shots, 'search.png') });
  await page.keyboard.press('Enter');
  await expect(page.locator('.nb-crumb.current')).toHaveText('Home');
  await expect(page.locator('nb-card-view.selected')).toContainText('weekly');
});

test('delete, undo, redo and restore from the trash', async ({ page }) => {
  await open(page);
  const note = page.locator('nb-card-view.nb-note', { hasText: 'Next steps' });
  await note.click();
  await page.keyboard.press('Delete');
  await expect(note).toHaveCount(0);
  await expect(page.locator('.nb-badge')).toHaveText('1');
  await page.keyboard.press('Control+z');
  await expect(note).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await expect(note).toHaveCount(0);
  await tool(page, 'Trash').click();
  await page.screenshot({ path: join(shots, 'trash.png') });
  await page.locator('.nb-trash-row', { hasText: 'Next steps' }).getByRole('button', { name: 'Restore' }).click();
  await expect(note).toHaveCount(1);
});

test('theme and interface size shortcuts, and the settings window', async ({ page }) => {
  await open(page);
  const shell = page.locator('nb-workspace');
  await page.keyboard.press('Control+Shift+KeyD');
  await expect(shell).toHaveClass(/dark/);
  await page.screenshot({ path: join(shots, 'dark-home.png') });
  await page.keyboard.press('Control+Shift+Period');
  await expect(shell).toHaveAttribute('style', /--ui: 1.12/);
  await page.keyboard.press('Control+Shift+Comma');
  await page.keyboard.press('Control+Shift+Comma');
  await expect(shell).toHaveAttribute('style', /--ui: 0.9/);
  await page.keyboard.press('Control+Shift+Period');
  await page.getByTestId('settings').click();
  await expect(page.locator('.nb-settings')).toBeVisible();
  await page.screenshot({ path: join(shots, 'dark-settings.png') });
  await page.locator('.nb-tile.theme[data-theme="0"]').click();
  await expect(shell).not.toHaveClass(/dark/);
  await page.screenshot({ path: join(shots, 'settings.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-settings')).toHaveCount(0);
});

test('everything comes back after reloading the page', async ({ page }) => {
  await open(page);
  await tool(page, 'Board').click();
  await expect(page.locator('.nb-board-name-edit')).toBeFocused();
  await page.keyboard.type('Kept');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Shift+KeyD');
  await page.keyboard.press('Control+Shift+Period');
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await saved(page);
  await page.reload();
  await expect(board(page, 'Kept')).toBeVisible();
  await expect(page.locator('nb-workspace')).toHaveClass(/dark/);
  await expect(page.locator('nb-workspace')).toHaveAttribute('style', /--ui: 1.12/);
});

test('import the desktop app boards: dry run first, then import, never twice', async ({ page }) => {
  const file = ['user-boards-v1.json'].map((f) => join(backups, f)).find(existsSync);
  test.skip(!file, 'no copy of desktop boards available');
  await open(page);
  await page.getByTestId('settings').click();
  await page.locator('.nb-settings nav button', { hasText: 'Privacy' }).click();
  await page.getByTestId('import-file').setInputFiles(file!);
  const report = page.getByTestId('import-report');
  await expect(report).toContainText('Ready to import');
  await page.screenshot({ path: join(shots, 'import-report.png') });
  await page.getByTestId('import-apply').click();
  await expect(page.locator('.nb-crumb.current')).toContainText('Imported from desktop');
  const s = await saved(page);
  expect(s.imports.length).toBe(1);
  await page.getByTestId('settings').click();
  await page.locator('.nb-settings nav button', { hasText: 'Privacy' }).click();
  await page.getByTestId('import-file').setInputFiles(file!);
  await expect(page.getByTestId('import-report')).toContainText('already imported');
});
